import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../mcp/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/auth.js")>()),
  resolveProjectFromToken: vi.fn(async (token: string) => {
    if (token === "good-token") return "project-1";
    throw new Error("Token MCP non valido o revocato");
  }),
}));

import { handleOAuthRequest, isAllowedRedirectUri } from "./oauth.js";
import { setSecretKeyProvider } from "../lib/secretBox.js";
import { createUser } from "../services/userService.js";
import { resolveUserFromMcpToken } from "../mcp/auth.js";
import { prisma } from "../lib/prisma.js";

const BASE = "https://planner.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function pkce() {
  const verifier = "verifier-" + crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  const challenge = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

function authorizeForm(challenge: string, token: string, redirect = REDIRECT) {
  const form = new FormData();
  form.set("client_id", "client-1");
  form.set("redirect_uri", redirect);
  form.set("state", "st-1");
  form.set("code_challenge", challenge);
  form.set("code_challenge_method", "S256");
  form.set("token", token);
  return new Request(`${BASE}/authorize`, { method: "POST", body: form });
}

async function getCode(challenge: string): Promise<string> {
  const res = (await handleOAuthRequest(authorizeForm(challenge, "good-token")))!;
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("Location")!);
  expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT);
  expect(loc.searchParams.get("state")).toBe("st-1");
  return loc.searchParams.get("code")!;
}

function tokenRequest(fields: Record<string, string>) {
  return new Request(`${BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeAll(() => setSecretKeyProvider(() => "test-secret"));

describe("cf oauth", () => {
  it("ignora path non OAuth", async () => {
    expect(await handleOAuthRequest(new Request(`${BASE}/mcp`))).toBeNull();
    expect(await handleOAuthRequest(new Request(`${BASE}/api/projects`))).toBeNull();
  });

  it("espone i metadata", async () => {
    const pr = await (await handleOAuthRequest(new Request(`${BASE}/.well-known/oauth-protected-resource`)))!.json();
    expect(pr).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    const as = await (await handleOAuthRequest(new Request(`${BASE}/.well-known/oauth-authorization-server`)))!.json();
    expect(as).toMatchObject({ token_endpoint: `${BASE}/token`, code_challenge_methods_supported: ["S256"] });
  });

  it("registra client solo con redirect ammessi", async () => {
    const ok = (await handleOAuthRequest(
      new Request(`${BASE}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: [REDIRECT] }) }),
    ))!;
    expect(ok.status).toBe(201);
    expect((await ok.json()).client_id).toBeTruthy();

    const bad = (await handleOAuthRequest(
      new Request(`${BASE}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: ["https://evil.test/cb"] }) }),
    ))!;
    expect(bad.status).toBe(400);
  });

  it("rifiuta redirect non ammessi su /authorize", async () => {
    const { challenge } = await pkce();
    const q = new URLSearchParams({
      response_type: "code", client_id: "c", redirect_uri: "https://evil.test/cb",
      code_challenge: challenge, code_challenge_method: "S256",
    });
    expect((await handleOAuthRequest(new Request(`${BASE}/authorize?${q}`)))!.status).toBe(400);
    expect((await handleOAuthRequest(authorizeForm(challenge, "good-token", "https://evil.test/cb")))!.status).toBe(400);
  });

  it("mostra il form e rifiuta token non validi", async () => {
    const { challenge } = await pkce();
    const q = new URLSearchParams({
      response_type: "code", client_id: "c", redirect_uri: REDIRECT, state: "s",
      code_challenge: challenge, code_challenge_method: "S256",
    });
    const page = (await handleOAuthRequest(new Request(`${BASE}/authorize?${q}`)))!;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('name="token"');
    // Chrome applica form-action anche al redirect post-submit verso Claude.
    expect(page.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://claude.ai;");

    const bad = (await handleOAuthRequest(authorizeForm(challenge, "wrong")))!;
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Token non valido");
  });

  it("scambia il codice con PKCE e restituisce il token di progetto", async () => {
    const { verifier, challenge } = await pkce();
    const code = await getCode(challenge);
    const res = (await handleOAuthRequest(
      tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: "client-1" }),
    ))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "good-token", token_type: "Bearer" });
  });

  it("rifiuta verifier sbagliato, redirect diverso e codice manomesso", async () => {
    const { challenge } = await pkce();
    const code = await getCode(challenge);
    const wrongVerifier = (await handleOAuthRequest(
      tokenRequest({ grant_type: "authorization_code", code, code_verifier: "nope" }),
    ))!;
    expect(wrongVerifier.status).toBe(400);

    const { verifier, challenge: c2 } = await pkce();
    const code2 = await getCode(c2);
    const wrongRedirect = (await handleOAuthRequest(
      tokenRequest({ grant_type: "authorization_code", code: code2, code_verifier: verifier, redirect_uri: "http://localhost:1/cb" }),
    ))!;
    expect(wrongRedirect.status).toBe(400);

    const tampered = (await handleOAuthRequest(
      tokenRequest({ grant_type: "authorization_code", code: code2.slice(0, -4) + "AAAA", code_verifier: verifier }),
    ))!;
    expect(tampered.status).toBe(400);
  });

  it("rifiuta codici scaduti", async () => {
    const { verifier, challenge } = await pkce();
    const code = await getCode(challenge);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    try {
      const res = (await handleOAuthRequest(
        tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier }),
      ))!;
      expect(res.status).toBe(400);
      expect((await res.json()).error_description).toBe("Codice scaduto");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ammette solo callback Claude e loopback", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.ai.evil.test/api/mcp/auth_callback")).toBe(false);
    expect(isAllowedRedirectUri("https://localhost/cb")).toBe(false);
  });

  describe("MCP globale (login web)", () => {
    const GLOBAL_RESOURCE = `${BASE}/mcp/global`;

    function userForm(challenge: string, email: string, password: string, extra: Record<string, string> = {}) {
      const form = new FormData();
      form.set("client_id", "client-1");
      form.set("redirect_uri", REDIRECT);
      form.set("state", "st-g");
      form.set("code_challenge", challenge);
      form.set("code_challenge_method", "S256");
      form.set("email", email);
      form.set("password", password);
      for (const [k, v] of Object.entries(extra)) form.set(k, v);
      return new Request(`${BASE}/authorize`, { method: "POST", body: form });
    }

    it("espone i metadata della risorsa globale", async () => {
      const pr = await (await handleOAuthRequest(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp/global`)))!.json();
      // Authorization server distinto da quello dei token di progetto (BASE):
      // altrimenti claude.ai riusa il token del connector di progetto.
      expect(pr).toMatchObject({ resource: GLOBAL_RESOURCE, authorization_servers: [`${BASE}/global`] });

      for (const path of [
        "/.well-known/oauth-authorization-server/global",
        "/.well-known/openid-configuration/global",
        "/global/.well-known/oauth-authorization-server",
      ]) {
        const as = await (await handleOAuthRequest(new Request(`${BASE}${path}`)))!.json();
        expect(as).toMatchObject({
          issuer: `${BASE}/global`,
          authorization_endpoint: `${BASE}/global/authorize`,
          token_endpoint: `${BASE}/global/token`,
          registration_endpoint: `${BASE}/global/register`,
        });
      }
      const legacy = await (await handleOAuthRequest(new Request(`${BASE}/.well-known/oauth-authorization-server`)))!.json();
      expect(legacy.issuer).toBe(BASE);
    });

    it("flusso completo sull'authorization server globale (/global/*)", async () => {
      const user = await createUser({ email: "glob@test.dev", password: "password-123", role: "admin" });
      const reg = (await handleOAuthRequest(
        new Request(`${BASE}/global/register`, { method: "POST", body: JSON.stringify({ redirect_uris: [REDIRECT] }) }),
      ))!;
      expect(reg.status).toBe(201);

      const { verifier, challenge } = await pkce();
      // Nessun resource/mode: su /global/authorize e' sempre il login utente.
      const q = new URLSearchParams({
        response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, state: "s",
        code_challenge: challenge, code_challenge_method: "S256",
      });
      const page = await (await handleOAuthRequest(new Request(`${BASE}/global/authorize?${q}`)))!.text();
      expect(page).toContain('action="/global/authorize"');
      expect(page).toContain('name="password"');
      expect(page).not.toContain("token MCP di progetto");

      const form = new FormData();
      for (const [k, v] of q) if (k !== "response_type") form.set(k, v);
      form.set("email", "glob@test.dev");
      form.set("password", "password-123");
      const res = (await handleOAuthRequest(new Request(`${BASE}/global/authorize`, { method: "POST", body: form })))!;
      expect(res.status).toBe(302);
      const code = new URL(res.headers.get("Location")!).searchParams.get("code")!;

      const tok = (await handleOAuthRequest(
        new Request(`${BASE}/global/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT }).toString(),
        }),
      ))!;
      expect(tok.status).toBe(200);
      expect(await resolveUserFromMcpToken((await tok.json()).access_token)).toBe(user.id);
    });

    it("/global/token rifiuta codici del flusso con token di progetto", async () => {
      const { verifier, challenge } = await pkce();
      const code = await getCode(challenge);
      const res = (await handleOAuthRequest(
        new Request(`${BASE}/global/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier }).toString(),
        }),
      ))!;
      expect(res.status).toBe(400);
    });

    it("con resource=/mcp/global mostra il login email/password", async () => {
      const { challenge } = await pkce();
      const q = new URLSearchParams({
        response_type: "code", client_id: "c", redirect_uri: REDIRECT, state: "s",
        code_challenge: challenge, code_challenge_method: "S256", resource: GLOBAL_RESOURCE,
      });
      const page = (await handleOAuthRequest(new Request(`${BASE}/authorize?${q}`)))!;
      expect(page.status).toBe(200);
      const text = await page.text();
      expect(text).toContain('name="email"');
      expect(text).toContain('name="password"');
      expect(text).toContain('name="mode" value="user"');
      expect(text).not.toContain('name="token"');
    });

    it("login + PKCE emette un token utente valido e revocabile", async () => {
      const user = await createUser({ email: "mgr@test.dev", password: "password-123", role: "admin" });
      const { verifier, challenge } = await pkce();

      const bad = (await handleOAuthRequest(userForm(challenge, "mgr@test.dev", "sbagliata", { mode: "user" })))!;
      expect(bad.status).toBe(400);
      expect(await bad.text()).toContain("Email o password non validi");

      const res = (await handleOAuthRequest(userForm(challenge, " MGR@test.dev ", "password-123", { resource: GLOBAL_RESOURCE })))!;
      expect(res.status).toBe(302);
      const code = new URL(res.headers.get("Location")!).searchParams.get("code")!;

      const tok = (await handleOAuthRequest(
        tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT }),
      ))!;
      expect(tok.status).toBe(200);
      const { access_token } = await tok.json();
      expect(access_token).toMatch(/^mpu_[0-9a-f]{64}$/);
      expect(await resolveUserFromMcpToken(access_token)).toBe(user.id);

      const stored = await prisma.userMcpToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(stored.label).toBe("claude.ai");
      expect(stored.tokenHash).not.toContain(access_token);
    });
  });
});

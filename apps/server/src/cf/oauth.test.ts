import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../mcp/auth.js", () => ({
  resolveProjectFromToken: vi.fn(async (token: string) => {
    if (token === "good-token") return "project-1";
    throw new Error("Token MCP non valido o revocato");
  }),
}));

import { handleOAuthRequest, isAllowedRedirectUri } from "./oauth.js";
import { setSecretKeyProvider } from "../lib/secretBox.js";

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
});

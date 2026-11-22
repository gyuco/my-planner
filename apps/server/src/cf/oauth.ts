import bcrypt from "bcryptjs";
import { issueUserMcpToken, resolveProjectFromToken } from "../mcp/auth.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";
import { prisma } from "../lib/prisma.js";

/**
 * OAuth 2.1 minimo per i custom connector di Claude (claude.ai / Desktop /
 * mobile), che non possono inviare un header `Authorization` statico.
 *
 * Il flusso NON introduce nuove credenziali: nella pagina /authorize l'utente
 * incolla il token MCP di progetto gia' esistente; /token lo restituisce come
 * access_token, quindi /mcp continua ad accettare lo stesso `Bearer <token>` e
 * la revoca del token dalla UI di my-planner revoca anche il connector.
 *
 * Stateless (niente KV/D1): il codice di autorizzazione e' un blob cifrato
 * AES-GCM (lib/secretBox.ts) con token, PKCE challenge, redirect_uri e
 * scadenza. Non e' single-use: lo mitigano la scadenza breve e PKCE S256
 * obbligatorio (senza code_verifier il codice non serve a nulla).
 *
 * Redirect ammessi solo verso i callback di Claude e localhost: altrimenti
 * chiunque potrebbe costruire un link /authorize che fa incollare il token e
 * lo recapita a un redirect_uri proprio.
 *
 * MCP globale (/mcp/global): stesso flusso, ma in /authorize l'utente fa il
 * login con email e password di My Planner e autorizza l'accesso a tutti i
 * suoi progetti. /token emette allora un token utente nuovo (`mpu_…`, solo
 * l'hash in DB, revocabile dal profilo). E' l'unico modo di ottenerlo: il
 * permesso passa sempre da questo link web. La modalita' si sceglie dal
 * parametro `resource` (RFC 8707, inviato dai client MCP) o dal campo `mode`.
 */

export const GLOBAL_MCP_PATH = "/mcp/global";

/**
 * Authorization server dedicato all'MCP globale (issuer `<origin>/global`).
 * Deve essere DISTINTO da quello dei token di progetto (issuer `<origin>`):
 * claude.ai associa le credenziali OAuth all'authorization server, quindi con
 * un issuer condiviso il connector globale riusava il token del connector di
 * progetto gia' presente e /mcp/global lo rifiutava (token emesso ma "mai
 * usato"). Endpoint: /global/authorize, /global/token, /global/register.
 */
export const GLOBAL_AS_PATH = "/global";

const CODE_TTL_MS = 5 * 60 * 1000;

const ALLOWED_REDIRECTS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export function isAllowedRedirectUri(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  if (ALLOWED_REDIRECTS.has(raw)) return true;
  try {
    const u = new URL(raw);
    // Client MCP locali (Claude Code, MCP Inspector) usano un callback loopback.
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function protectedResourceMetadataUrl(origin: string, resourcePath = "/mcp"): string {
  // /mcp mantiene l'URL storico (senza suffisso) per i connector gia' configurati.
  if (resourcePath === GLOBAL_MCP_PATH) return `${origin}/.well-known/oauth-protected-resource${GLOBAL_MCP_PATH}`;
  return `${origin}/.well-known/oauth-protected-resource`;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * `formActionOrigin`: origine del redirect_uri (gia' validato). Chrome applica
 * `form-action` anche ai redirect dopo il submit: con solo 'self' il 302 verso
 * claude.ai viene bloccato e il pulsante "Autorizza" sembra non fare nulla.
 */
function html(body: string, status = 200, formActionOrigin?: string): Response {
  const formAction = formActionOrigin ? `'self' ${formActionOrigin}` : "'self'";
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface AuthParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  /** "user" = login per l'MCP globale, "project" = token di progetto. */
  mode: string;
}

const AUTH_FIELDS: (keyof AuthParams)[] = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
  "mode",
];

type AuthMode = "user" | "project";

function isGlobalResource(resource: string): boolean {
  if (!resource) return false;
  try {
    return new URL(resource).pathname.replace(/\/+$/, "") === GLOBAL_MCP_PATH;
  } catch {
    return false;
  }
}

function readAuthParams(get: (k: string) => string | null): AuthParams {
  const p = {} as AuthParams;
  for (const k of AUTH_FIELDS) p[k] = get(k) ?? "";
  if (p.mode !== "user" && p.mode !== "project") p.mode = isGlobalResource(p.resource) ? "user" : "project";
  return p;
}

function validateAuthParams(p: AuthParams, responseType: string | null): string | null {
  if (!isAllowedRedirectUri(p.redirect_uri)) return "redirect_uri non ammesso";
  if (responseType !== null && responseType !== "code") return "response_type deve essere 'code'";
  if (!p.code_challenge) return "code_challenge (PKCE) obbligatorio";
  if (p.code_challenge_method !== "S256") return "code_challenge_method deve essere S256";
  return null;
}

const PAGE_STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--fg:#1a1a1a;--muted:#666;--border:#ddd;--accent:#1a1a1a;--accent-fg:#fff;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--fg:#eee;--muted:#999;--border:#333;--accent:#eee;--accent-fg:#111;--err:#f97066}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;max-width:420px;width:100%}
h1{font-size:20px;margin:0 0 8px}p{color:var(--muted);margin:0 0 20px;font-size:14px}
label{display:block;font-size:14px;margin:12px 0 6px}
input[type=password],input[type=email]{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--fg);font:inherit}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--err);font-size:14px;margin:10px 0 0}
.switch{display:block;margin-top:16px;font-size:13px;color:var(--muted);text-align:center}
.switch a{color:inherit}`;

function renderAuthorizePage(p: AuthParams, error?: string, globalAs = false): Response {
  const mode: AuthMode = globalAs || p.mode === "user" ? "user" : "project";
  const action = globalAs ? `${GLOBAL_AS_PATH}/authorize` : "/authorize";
  const hidden = AUTH_FIELDS.filter((k) => k !== "mode")
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(p[k])}">`)
    .join("") + `<input type="hidden" name="mode" value="${mode}">`;
  const errAttrs = error ? ' aria-invalid="true" aria-describedby="err"' : "";
  const errBlock = error ? `<p class="err" id="err" role="alert">${escapeHtml(error)}</p>` : "";

  // Link per cambiare modalita' (es. client che non invia `resource`): stessa
  // GET /authorize con gli stessi parametri e l'altra modalita'.
  const other: AuthMode = mode === "user" ? "project" : "user";
  const switchQuery = new URLSearchParams();
  for (const k of AUTH_FIELDS) if (k !== "mode" && p[k]) switchQuery.set(k, p[k]);
  switchQuery.set("response_type", "code");
  switchQuery.set("mode", other);
  const switchLabel = other === "user" ? "Accedi con il tuo account (tutti i progetti)" : "Usa un token MCP di progetto";

  const body =
    mode === "user"
      ? `<h1>Collega My Planner — tutti i progetti</h1>
<p>Accedi con il tuo account My Planner per autorizzare questo client MCP a leggere e modificare <strong>tutti i progetti a cui hai accesso</strong>. Puoi revocare l'accesso in qualunque momento dal tuo profilo.</p>
<form method="post" action="${action}">${hidden}
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username" required autofocus aria-required="true"${errAttrs}>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required aria-required="true"${errAttrs}>
${errBlock}
<button type="submit">Accedi e autorizza</button>
</form>`
      : `<h1>Collega My Planner</h1>
<p>Incolla il token MCP del progetto. Lo trovi nelle impostazioni del progetto in My Planner.</p>
<form method="post" action="${action}">${hidden}
<label for="token">Token MCP</label>
<input id="token" name="token" type="password" autocomplete="off" required autofocus aria-required="true"${errAttrs}>
${errBlock}
<button type="submit">Autorizza</button>
</form>`;

  return html(`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Collega My Planner</title>
<style>${PAGE_STYLE}</style></head><body><main>
${body}
${globalAs ? "" : `<span class="switch"><a href="/authorize?${escapeHtml(switchQuery.toString())}">${switchLabel}</a></span>`}
</main></body></html>`, error ? 400 : 200, new URL(p.redirect_uri).origin);
}

interface CodePayload {
  t?: string; // token di progetto (modalita' project)
  u?: string; // id utente (modalita' user / MCP globale)
  c: string; // code_challenge
  r: string; // redirect_uri
  i: string; // client_id
  e: number; // scadenza (ms epoch)
}

/** Verifica email/password come il login REST; id utente o null. */
async function verifyCredentials(email: string, password: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) return null;
  const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true, passwordHash: true } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;
  return user.id;
}

/** Etichetta leggibile del connector, mostrata nel profilo (es. "claude.ai"). */
function connectorLabel(redirectUri: string): string {
  try {
    const host = new URL(redirectUri).hostname;
    return host === "localhost" || host === "127.0.0.1" ? "Client MCP locale" : host;
  } catch {
    return "Client MCP";
  }
}

async function handleAuthorize(request: Request, globalAs = false): Promise<Response> {
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams;
    const p = readAuthParams((k) => q.get(k));
    if (globalAs) p.mode = "user";
    const invalid = validateAuthParams(p, q.get("response_type"));
    if (invalid) return html(`<!doctype html><meta charset="utf-8"><title>Errore</title><p>Richiesta non valida: ${escapeHtml(invalid)}</p>`, 400);
    return renderAuthorizePage(p, undefined, globalAs);
  }

  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });

  const form = await request.formData();
  const p = readAuthParams((k) => (typeof form.get(k) === "string" ? (form.get(k) as string) : null));
  if (globalAs) p.mode = "user";
  const invalid = validateAuthParams(p, null);
  if (invalid) return html(`<!doctype html><meta charset="utf-8"><title>Errore</title><p>Richiesta non valida: ${escapeHtml(invalid)}</p>`, 400);

  const base = { c: p.code_challenge, r: p.redirect_uri, i: p.client_id, e: Date.now() + CODE_TTL_MS };
  let payload: CodePayload;
  if (p.mode === "user") {
    const userId = await verifyCredentials(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    if (!userId) return renderAuthorizePage(p, "Email o password non validi.", globalAs);
    payload = { ...base, u: userId };
  } else {
    const token = String(form.get("token") ?? "").trim();
    try {
      await resolveProjectFromToken(token);
    } catch {
      return renderAuthorizePage(p, "Token non valido o revocato.");
    }
    payload = { ...base, t: token };
  }
  const code = await encryptSecret(JSON.stringify(payload));

  const redirect = new URL(p.redirect_uri);
  redirect.searchParams.set("code", code);
  if (p.state) redirect.searchParams.set("state", p.state);
  return new Response(null, { status: 302, headers: { Location: redirect.toString(), "Cache-Control": "no-store" } });
}

async function handleToken(request: Request, globalAs = false): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Usare POST", 405);

  const contentType = request.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    params = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  } else {
    params = new URLSearchParams(await request.text());
  }

  if (params.get("grant_type") !== "authorization_code") {
    return oauthError("unsupported_grant_type", "Supportato solo authorization_code");
  }

  let payload: CodePayload;
  try {
    payload = JSON.parse(await decryptSecret(params.get("code") ?? ""));
  } catch {
    return oauthError("invalid_grant", "Codice non valido");
  }

  if (Date.now() > payload.e) return oauthError("invalid_grant", "Codice scaduto");
  if (params.get("redirect_uri") && params.get("redirect_uri") !== payload.r) {
    return oauthError("invalid_grant", "redirect_uri non corrisponde");
  }
  if (params.get("client_id") && params.get("client_id") !== payload.i) {
    return oauthError("invalid_grant", "client_id non corrisponde");
  }
  const verifier = params.get("code_verifier");
  if (!verifier || (await sha256Base64Url(verifier)) !== payload.c) {
    return oauthError("invalid_grant", "code_verifier non valido");
  }

  // L'authorization server globale emette solo token utente.
  if (globalAs && !payload.u) return oauthError("invalid_grant", "Codice non valido per l'MCP globale");

  if (payload.u) {
    // MCP globale: il token utente nasce qui, dopo PKCE. L'utente potrebbe
    // essere stato eliminato tra /authorize e /token.
    const user = await prisma.user.findUnique({ where: { id: payload.u }, select: { id: true } });
    if (!user) return oauthError("invalid_grant", "Utente non piu' esistente");
    const accessToken = await issueUserMcpToken(user.id, connectorLabel(payload.r));
    return json({ access_token: accessToken, token_type: "Bearer" });
  }

  // Il token potrebbe essere stato revocato tra /authorize e /token.
  try {
    await resolveProjectFromToken(payload.t ?? "");
  } catch {
    return oauthError("invalid_grant", "Token revocato");
  }

  return json({ access_token: payload.t, token_type: "Bearer" });
}

async function handleRegister(request: Request): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Usare POST", 405);
  const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const redirectUris = Array.isArray(body?.redirect_uris) ? body!.redirect_uris.map(String) : [];
  if (redirectUris.length === 0 || !redirectUris.every(isAllowedRedirectUri)) {
    return oauthError("invalid_redirect_uri", "redirect_uris mancanti o non ammessi");
  }
  return json(
    {
      client_id: crypto.randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: typeof body?.client_name === "string" ? body.client_name : undefined,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

/**
 * Gestisce gli endpoint OAuth; restituisce null se il path non e' OAuth.
 * Le route /authorize e /token devono girare dentro withRequestPrisma
 * (validano il token su D1).
 */
export async function handleOAuthRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;

  const G = GLOBAL_AS_PATH;
  const isOAuthPath =
    path.startsWith("/.well-known/oauth-") ||
    path.startsWith("/.well-known/openid-configuration") ||
    path === "/authorize" ||
    path === "/token" ||
    path === "/register" ||
    path.startsWith(`${G}/`);
  if (!isOAuthPath) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === `/.well-known/oauth-protected-resource${GLOBAL_MCP_PATH}`) {
    return json({
      resource: `${origin}${GLOBAL_MCP_PATH}`,
      authorization_servers: [`${origin}${G}`],
      bearer_methods_supported: ["header"],
    });
  }
  // Metadata dell'authorization server globale: tutte le varianti che i
  // client provano per un issuer con path (RFC 8414 path insertion, OIDC).
  if (
    path === `/.well-known/oauth-authorization-server${G}` ||
    path === `/.well-known/openid-configuration${G}` ||
    path === `${G}/.well-known/oauth-authorization-server` ||
    path === `${G}/.well-known/openid-configuration`
  ) {
    return json({
      issuer: `${origin}${G}`,
      authorization_endpoint: `${origin}${G}/authorize`,
      token_endpoint: `${origin}${G}/token`,
      registration_endpoint: `${origin}${G}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }
  if (path === `${G}/authorize`) return handleAuthorize(request, true);
  if (path === `${G}/token`) return handleToken(request, true);
  if (path === `${G}/register`) return handleRegister(request);
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
    return json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
    });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }
  if (path === "/authorize") return handleAuthorize(request);
  if (path === "/token") return handleToken(request);
  if (path === "/register") return handleRegister(request);
  return null;
}

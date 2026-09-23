import type { Page } from "@playwright/test";
import { E2E_BOOTSTRAP_PASSWORD, E2E_BOOTSTRAP_USERNAME } from "../playwright.config";

/** Base REST del backend "local" avviato da playwright.config.ts (webServer). */
export const API_BASE = "http://localhost:3050";
// In modalita' Cloudflare (E2E_CF=1) MCP e REST sono serviti dallo stesso
// Worker (porta 3050): il base MCP e' override-abile via env.
export const MCP_HTTP_BASE = process.env.MCP_HTTP_BASE ?? "http://localhost:3150";

export const API_BASE_S3 = "http://localhost:3051";
export const MCP_HTTP_BASE_S3 = "http://localhost:3151";

/**
 * Login via UI con l'utente bootstrap e2e (vedi playwright.config.ts,
 * BOOTSTRAP_USERNAME/PASSWORD passate al backend "local"). Riusata da tutti
 * gli scenari che partono da un'app già autenticata.
 */
export async function loginViaUi(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(E2E_BOOTSTRAP_USERNAME);
  await page.getByLabel("Password").fill(E2E_BOOTSTRAP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Attende lo shell applicativo post-login (header sidebar "Progetti"),
  // presente sia su desktop che su mobile (la sidebar e' solo nascosta via
  // CSS su mobile, non smontata dal DOM).
  await page.locator(".sidebar-header").waitFor({ state: "attached" });
}

/**
 * Seleziona un progetto dalla sidebar per nome esatto (evita strict-mode
 * violation: lo stesso testo compare anche nel bottone "Impostazioni" e nei
 * chip di filtro progetto della vista aggregata).
 */
export async function selectProjectInSidebar(page: Page, name: string) {
  await page.locator(".sidebar-nav").getByRole("button", { name, exact: true }).click();
}

/** Ottiene un JWT valido chiamando direttamente /auth/login (per setup via API, senza UI). */
export async function getJwt(base = API_BASE): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: E2E_BOOTSTRAP_USERNAME, password: E2E_BOOTSTRAP_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login fallito: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

export async function createProjectViaApi(name: string, base = API_BASE): Promise<{ id: string; name: string }> {
  const token = await getJwt(base);
  const res = await fetch(`${base}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`creazione progetto fallita: ${res.status}`);
  return res.json();
}

export async function createTaskViaApi(
  projectId: string,
  input: Record<string, unknown>,
  base = API_BASE,
): Promise<{ id: string; title: string }> {
  const token = await getJwt(base);
  const res = await fetch(`${base}/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`creazione task fallita: ${res.status}`);
  return res.json();
}

export async function createProjectTokenViaApi(
  projectId: string,
  label = "e2e-token",
  base = API_BASE,
): Promise<string> {
  const token = await getJwt(base);
  const res = await fetch(`${base}/projects/${projectId}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`creazione token fallita: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

let mcpRequestId = 1;

/** Chiamata JSON-RPC diretta a POST /mcp (T7/T8), senza client MCP completo. */
export async function callMcpTool(
  projectToken: string,
  name: string,
  args: Record<string, unknown>,
  base = MCP_HTTP_BASE,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${projectToken}`,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: mcpRequestId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const status = res.status;
  const text = await res.text();
  let body: any = text;
  // StreamableHTTPServerTransport puo' rispondere come text/event-stream
  // ("data: {...}" per riga) o come JSON puro a seconda del client; gestiamo
  // entrambi i casi per una fetch "cruda" come questa.
  try {
    if (text.startsWith("event:") || text.includes("data:")) {
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
      body = dataLine ? JSON.parse(dataLine.slice(5).trim()) : text;
    } else {
      body = JSON.parse(text);
    }
  } catch {
    // lascia body come testo grezzo
  }
  return { status, body };
}

/** Estrae il payload di un tool result MCP (successo o errore, vedi API_CONTRACT.md §1). */
export function parseMcpToolResult(rpcBody: any): any {
  const text = rpcBody?.result?.content?.[0]?.text;
  if (typeof text !== "string") return rpcBody;
  return JSON.parse(text);
}

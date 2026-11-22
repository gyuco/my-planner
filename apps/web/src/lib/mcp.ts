/**
 * Base URL pubblica del server MCP HTTP. Su Cloudflare Worker MCP e REST
 * condividono lo stesso host (nessuna porta 3100): si configura via
 * VITE_MCP_HTTP_BASE_URL in build (vedi README §Cloudflare). Default: stesso
 * host della UI, porta 3100, coerente con lo stack Node/Docker.
 */
export function mcpBaseUrl(): string {
  const configuredBase = import.meta.env.VITE_MCP_HTTP_BASE_URL;
  return configuredBase
    ? configuredBase.replace(/\/$/, "")
    : `${window.location.protocol}//${window.location.hostname}:3100`;
}

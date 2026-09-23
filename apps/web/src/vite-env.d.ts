/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL pubblica del server MCP HTTP, usata per costruire la config MCP
   * mostrata in UI. Obbligatoria sul deploy Cloudflare (dove MCP e REST
   * condividono l'host del Worker, senza porta 3100), es.
   * `https://my-planner.<account>.workers.dev`.
   */
  readonly VITE_MCP_HTTP_BASE_URL?: string;
}

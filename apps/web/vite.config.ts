import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_API_PROXY_TARGET / VITE_DEV_PORT permettono di puntare il dev server
// a un backend diverso da quello di default (usato dai test e2e Playwright,
// vedi apps/web/playwright.config.ts, per avviare istanze isolate del
// backend su porte dedicate senza toccare il flusso di sviluppo normale).
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";
const devPort = process.env.VITE_DEV_PORT ? Number(process.env.VITE_DEV_PORT) : 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      "/api": { target: apiProxyTarget, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});

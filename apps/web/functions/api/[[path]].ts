/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Pages Function (CF13): sostituisce il reverse proxy nginx
 * (apps/web/nginx.conf) usato nello stack Docker. Il frontend chiama `/api/*`
 * (vedi apps/web/src/api.ts); qui il prefisso `/api` viene rimosso e la
 * richiesta inoltrata al Worker REST via service binding `API`
 * (stesso contratto path/metodo/header/body).
 */
interface Env {
  // Service binding verso il Worker REST `my-planner` (vedi wrangler.toml).
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  return env.API.fetch(new Request(url.toString(), request));
};

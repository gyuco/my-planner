# my-planner

Gestore di progetti e task con board Kanban, utilizzabile da UI web e da server MCP.
Vedi [prd.md](./prd.md) per requisiti e decisioni tecniche complete.

## Stack
Node.js/TypeScript + Fastify, SQLite + Prisma, React + Vite, MCP SDK (stdio + HTTP).

## Struttura

```
apps/server   Fastify REST API + server MCP (stdio e HTTP)
apps/web      React SPA (board Kanban)
packages/core Tipi condivisi tra server e web
```

## Setup locale

```bash
npm install
cp config.example.md .env   # poi modifica i valori (vedi config.example.md)
npm run --workspace apps/server prisma:migrate
npm run dev
```

## MCP

- **stdio:** `npm run --workspace apps/server mcp:stdio` (richiede `MCP_PROJECT_TOKEN` in env)
- **HTTP:** `npm run --workspace apps/server mcp:http`, poi chiamare `/mcp` con header `Authorization: Bearer <token>`

I token si generano/revocano dalla UI, uno per progetto.

## Agenti

Definiti in `.claude/agents/`: `analyst`, `architect`, `planner`, `coder`, `reviewer`, `dev-ops`.
Il `planner` è notificato di ogni cambio di stato dei task (`draft → in_progress → done`) e verifica le dipendenze bloccanti.

#!/bin/sh
set -e

# Migrazioni non interattive (I3): usate in CI/produzione/docker, a differenza
# di `prisma migrate dev` usato in sviluppo locale (vedi README.md).
npm run prisma:migrate:deploy

# Avvia REST API (porta $PORT, default 3000) e server MCP HTTP (porta
# $MCP_HTTP_PORT, default 3100) come due processi nello stesso container.
# Scelta pragmatica per lo sviluppo/self-hosting locale (single-container,
# nessun orchestratore): se in futuro serve scalare i due componenti in modo
# indipendente si possono separare in due servizi/container distinti.
node dist/index.js &
REST_PID=$!

node dist/mcp/http.js &
MCP_PID=$!

trap 'kill -TERM $REST_PID $MCP_PID 2>/dev/null' TERM INT

wait $REST_PID $MCP_PID

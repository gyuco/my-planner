# Variabili d'ambiente

Copia questi valori in un file `.env` locale (non committare mai `.env`):

```
DATABASE_URL="file:./dev.db"
JWT_SECRET="change-me-in-production"
PORT=3000
MCP_HTTP_PORT=3100

# Storage allegati: "local" oppure "s3"
ATTACHMENTS_BACKEND=local
ATTACHMENTS_LOCAL_DIR=./attachments/local

# Solo se ATTACHMENTS_BACKEND=s3
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=us-east-1

# Base URL pubblico del server MCP HTTP, usato per costruire l'URL di
# download allegati (backend locale) restituito da get_attachment_url.
# Default: http://localhost:<MCP_HTTP_PORT>
MCP_HTTP_BASE_URL=http://localhost:3100

# Solo per apps/server/src/mcp/stdio.ts
MCP_PROJECT_TOKEN=
```

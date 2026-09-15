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

# Solo per apps/server/src/mcp/stdio.ts
MCP_PROJECT_TOKEN=
```

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGlobalMcpServer, createProjectMcpServer } from "./server.js";
import { resolveProjectFromToken, resolveUserFromMcpToken } from "./auth.js";
// Runtime Node: inizializza il client Prisma SQLite e registra il selettore
// storage allegati (local/S3) sul provider condiviso.
import { initNodePrisma } from "../lib/prisma.node.js";
import "../lib/attachmentStorage/index.js";
import "../lib/email/index.js";

/**
 * Entry point MCP via stdio, per uso locale con Claude Code/Desktop.
 * Il token di progetto va passato come variabile d'ambiente MCP_PROJECT_TOKEN
 * (impostata nella configurazione MCP del client). In alternativa
 * MCP_USER_TOKEN (token globale `mpu_…`, ottenuto col login web OAuth)
 * espone l'MCP globale su tutti i progetti dell'utente.
 */
async function main() {
  initNodePrisma();
  const userToken = process.env.MCP_USER_TOKEN;
  const token = process.env.MCP_PROJECT_TOKEN;
  if (!token && !userToken) {
    console.error("MCP_PROJECT_TOKEN (o MCP_USER_TOKEN) mancante");
    process.exit(1);
  }
  const server = userToken
    ? createGlobalMcpServer(await resolveUserFromMcpToken(userToken))
    : createProjectMcpServer(await resolveProjectFromToken(token!));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();

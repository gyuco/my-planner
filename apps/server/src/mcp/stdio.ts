import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProjectMcpServer } from "./server.js";
import { resolveProjectFromToken } from "./auth.js";

/**
 * Entry point MCP via stdio, per uso locale con Claude Code/Desktop.
 * Il token di progetto va passato come variabile d'ambiente MCP_PROJECT_TOKEN
 * (impostata nella configurazione MCP del client).
 */
async function main() {
  const token = process.env.MCP_PROJECT_TOKEN;
  if (!token) {
    console.error("MCP_PROJECT_TOKEN mancante");
    process.exit(1);
  }
  const projectId = await resolveProjectFromToken(token);
  const server = createProjectMcpServer(projectId);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();

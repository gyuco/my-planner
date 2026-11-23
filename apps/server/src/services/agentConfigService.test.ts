import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/secretBox.js";
import { resolveProjectFromToken } from "../mcp/auth.js";
import { createProject, listProjects, updateProject } from "./taskService.js";
import {
  clearAgentConfig,
  getAgentConfig,
  getAgentRuntime,
  setAgentClientFactory,
  setAgentConfig,
} from "./agentConfigService.js";

/** Configurazione dell'agente Claude Managed Agents del progetto (client Anthropic simulato). */

const API_KEY = "sk-ant-api03-test-key-0123456789abcdef";
const GH_TOKEN = "github_pat_TEST0123456789abcdef";
const MCP_URL = "https://planner.example.com/mcp";

interface Call {
  method: string;
  args: any[];
}

let calls: Call[] = [];
let usedApiKeys: string[] = [];
let failOn: string | null = null;
let counter = 0;

function fakeError(method: string) {
  const err: any = new Error(`401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`);
  err.status = 401;
  err.error = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
  err.method = method;
  return err;
}

function record(method: string, result: () => any) {
  return async (...args: any[]) => {
    calls.push({ method, args });
    if (failOn === method) throw fakeError(method);
    return result();
  };
}

beforeEach(() => {
  calls = [];
  usedApiKeys = [];
  failOn = null;
  counter = 0;
  setAgentClientFactory((apiKey: string) => {
    usedApiKeys.push(apiKey);
    return {
      beta: {
        environments: { create: record("environments.create", () => ({ id: `env_${++counter}` })) },
        vaults: {
          create: record("vaults.create", () => ({ id: `vlt_${++counter}` })),
          credentials: { create: record("credentials.create", () => ({ id: `vcrd_${++counter}` })) },
        },
        agents: { create: record("agents.create", () => ({ id: `agent_${++counter}`, version: 1 })) },
      },
    } as any;
  });
});

afterEach(() => setAgentClientFactory(null));

async function setup(repoUrl: string | null = "gyuco/clinica") {
  const project = await createProject("Clinica");
  if (repoUrl) await updateProject(project.id, { repoUrl });
  return project;
}

describe("validazione", () => {
  it("rifiuta chiave senza prefisso sk-ant-, repository mancante, segreti mancanti, URL MCP non valido", async () => {
    const noRepo = await setup(null);
    await expect(
      setAgentConfig(noRepo.id, { apiKey: API_KEY, githubToken: GH_TOKEN, mcpUrl: MCP_URL }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "Imposta prima il repository GitHub del progetto" });

    const project = await setup();
    await expect(
      setAgentConfig(project.id, { apiKey: "abc-123", githubToken: GH_TOKEN, mcpUrl: MCP_URL }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(setAgentConfig(project.id, { githubToken: GH_TOKEN, mcpUrl: MCP_URL })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(setAgentConfig(project.id, { apiKey: API_KEY, mcpUrl: MCP_URL })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      setAgentConfig(project.id, { apiKey: API_KEY, githubToken: "con spazi dentro", mcpUrl: MCP_URL }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      setAgentConfig(project.id, { apiKey: API_KEY, githubToken: GH_TOKEN, mcpUrl: "http://planner.example.com/mcp" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      setAgentConfig(project.id, { apiKey: API_KEY, githubToken: GH_TOKEN, mcpUrl: MCP_URL, budgetUsd: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(calls).toHaveLength(0);
    expect(await prisma.projectToken.count()).toBe(0);
    await expect(getAgentRuntime(project.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Agente AI non configurato",
    });
  });
});

describe("provisioning", () => {
  it("crea token MCP, environment, vault con le due credenziali e agente; salva segreti cifrati e id; non restituisce mai segreti", async () => {
    const project = await setup();
    expect(await getAgentConfig(project.id)).toEqual({
      configured: false,
      hasApiKey: false,
      hasGithubToken: false,
      budgetUsd: 5,
      lastError: null,
      agentId: null,
    });

    const view = await setAgentConfig(project.id, {
      apiKey: API_KEY,
      githubToken: GH_TOKEN,
      budgetUsd: 12.5,
      mcpUrl: MCP_URL,
    });
    expect(view).toEqual({
      configured: true,
      hasApiKey: true,
      hasGithubToken: true,
      budgetUsd: 12.5,
      lastError: null,
      agentId: expect.stringMatching(/^agent_/),
    });
    expect(JSON.stringify(view)).not.toContain(API_KEY);
    expect(JSON.stringify(view)).not.toContain(GH_TOKEN);
    expect(usedApiKeys).toEqual([API_KEY]);

    // Environment cloud con rete limitata.
    const env = calls.find((c) => c.method === "environments.create")!;
    expect(env.args[0].config).toMatchObject({
      type: "cloud",
      networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: true, allowed_hosts: ["api.github.com"] },
    });

    // Vault con due credenziali: bearer per MCP e variabile d'ambiente GITHUB_TOKEN.
    const creds = calls.filter((c) => c.method === "credentials.create");
    expect(creds).toHaveLength(2);
    const vaultId = creds[0].args[0];
    expect(vaultId).toMatch(/^vlt_/);
    const bearer = creds.find((c) => c.args[1].auth.type === "static_bearer")!;
    expect(bearer.args[1].auth.mcp_server_url).toBe(MCP_URL);
    const mcpToken = bearer.args[1].auth.token as string;
    expect(await resolveProjectFromToken(mcpToken)).toBe(project.id);
    const envVar = creds.find((c) => c.args[1].auth.type === "environment_variable")!;
    expect(envVar.args[1].auth).toMatchObject({
      secret_name: "GITHUB_TOKEN",
      secret_value: GH_TOKEN,
      networking: { type: "limited", allowed_hosts: ["api.github.com"] },
      injection_location: { header: true },
    });

    // Agente: MCP del progetto, niente segreti nel system prompt.
    const agent = calls.find((c) => c.method === "agents.create")!;
    expect(agent.args[0].model).toBe("claude-opus-5-5");
    expect(agent.args[0].mcp_servers).toEqual([{ type: "url", name: "my-planner", url: MCP_URL }]);
    expect(agent.args[0].tools).toContainEqual({ type: "mcp_toolset", mcp_server_name: "my-planner" });
    const system = agent.args[0].system as string;
    expect(system).toContain(project.id);
    expect(system).toContain("https://github.com/gyuco/clinica");
    expect(system).toContain("/workspace/repo");
    expect(system).not.toContain(API_KEY);
    expect(system).not.toContain(GH_TOKEN);
    expect(system).not.toContain(mcpToken);

    // DB: segreti cifrati, id salvati.
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.agentApiKeyEncrypted?.startsWith("v1:")).toBe(true);
    expect(row.agentGithubTokenEncrypted?.startsWith("v1:")).toBe(true);
    expect(await decryptSecret(row.agentApiKeyEncrypted!)).toBe(API_KEY);
    expect(await decryptSecret(row.agentGithubTokenEncrypted!)).toBe(GH_TOKEN);
    expect(row.agentEnvironmentId).toMatch(/^env_/);
    expect(row.agentVaultId).toBe(vaultId);
    expect(row.agentId).toBe(view.agentId);
    expect(row.agentBudgetCents).toBe(1250);
    const token = await prisma.projectToken.findUniqueOrThrow({ where: { id: row.agentMcpTokenId! } });
    expect(token.label).toBe("Agente AI (chat)");

    // Le API dei progetti espongono solo il flag.
    const listed = await listProjects();
    expect(listed[0]).toMatchObject({ id: project.id, aiAgentConfigured: true });
    expect(JSON.stringify(listed)).not.toContain("v1:");
    expect(JSON.stringify(listed)).not.toContain("agentApiKeyEncrypted");

    // Runtime per le sessioni: segreti in chiaro solo lato server.
    expect(await getAgentRuntime(project.id)).toEqual({
      apiKey: API_KEY,
      githubToken: GH_TOKEN,
      agentId: row.agentId,
      environmentId: row.agentEnvironmentId,
      vaultId: row.agentVaultId,
      budgetCents: 1250,
      repoUrl: "https://github.com/gyuco/clinica",
    });
  });

  it("al nuovo salvataggio riusa i segreti salvati, crea risorse nuove e revoca il token precedente", async () => {
    const project = await setup();
    const first = await setAgentConfig(project.id, { apiKey: API_KEY, githubToken: GH_TOKEN, mcpUrl: MCP_URL });
    const before = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });

    const second = await setAgentConfig(project.id, { mcpUrl: MCP_URL });
    expect(second.configured).toBe(true);
    expect(second.agentId).not.toBe(first.agentId);
    expect(second.budgetUsd).toBe(5);
    expect(usedApiKeys).toEqual([API_KEY, API_KEY]);

    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.agentMcpTokenId).not.toBe(before.agentMcpTokenId);
    expect((await prisma.projectToken.findUniqueOrThrow({ where: { id: before.agentMcpTokenId! } })).revokedAt).not.toBeNull();
    expect((await prisma.projectToken.findUniqueOrThrow({ where: { id: after.agentMcpTokenId! } })).revokedAt).toBeNull();
  });
});

describe("errori Anthropic", () => {
  it("salva lastError leggibile senza la chiave e lancia AGENT_API_ERROR; il token creato viene revocato", async () => {
    const project = await setup();
    failOn = "agents.create";
    const err = await setAgentConfig(project.id, { apiKey: API_KEY, githubToken: GH_TOKEN, mcpUrl: MCP_URL }).catch((e) => e);
    expect(err).toMatchObject({ code: "AGENT_API_ERROR" });
    expect(err.message).not.toContain(API_KEY);

    const view = await getAgentConfig(project.id);
    expect(view.configured).toBe(false);
    expect(view.lastError).toContain("401");
    expect(view.lastError).toContain("invalid x-api-key");
    expect(view.lastError).not.toContain(API_KEY);
    expect(view.lastError).not.toContain(GH_TOKEN);

    const tokens = await prisma.projectToken.findMany({ where: { projectId: project.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });
});

describe("rimozione", () => {
  it("azzera i campi, riporta il budget a 500 e revoca il token dell'agente", async () => {
    const project = await setup();
    await setAgentConfig(project.id, { apiKey: API_KEY, githubToken: GH_TOKEN, budgetUsd: 20, mcpUrl: MCP_URL });
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });

    const view = await clearAgentConfig(project.id);
    expect(view).toEqual({
      configured: false,
      hasApiKey: false,
      hasGithubToken: false,
      budgetUsd: 5,
      lastError: null,
      agentId: null,
    });
    const cleared = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(cleared).toMatchObject({
      agentApiKeyEncrypted: null,
      agentGithubTokenEncrypted: null,
      agentId: null,
      agentEnvironmentId: null,
      agentVaultId: null,
      agentMcpTokenId: null,
      agentBudgetCents: 500,
      agentLastError: null,
    });
    expect((await prisma.projectToken.findUniqueOrThrow({ where: { id: row.agentMcpTokenId! } })).revokedAt).not.toBeNull();
  });
});

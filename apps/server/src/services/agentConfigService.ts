import Anthropic from "@anthropic-ai/sdk";
import { ApiErrorException, type AgentConfigView } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";
import { createProjectToken } from "../mcp/auth.js";
import { agentSystemPrompt } from "./agentInstructions.js";

/**
 * Configurazione dell'agente Claude Managed Agents usato dalla chat di
 * progetto. L'admin salva la chiave API Anthropic e un token GitHub (cifrati
 * con secretBox, mai restituiti ne' loggati); il server crea su Anthropic:
 *  - un environment cloud con rete limitata (api.github.com, package manager, MCP);
 *  - un vault con due credenziali: bearer statico per l'MCP di My Planner
 *    (token di progetto dedicato) e la variabile d'ambiente GITHUB_TOKEN
 *    (il sandbox vede un segnaposto, il valore reale e' sostituito in uscita);
 *  - l'agente, con system prompt da agentInstructions.ts.
 * A ogni salvataggio crea risorse nuove e sostituisce gli id (le vecchie non
 * vengono archiviate). Usato da REST Node e Cloudflare.
 */

export const AGENT_MODEL = "claude-opus-5-5";
export const AGENT_MCP_SERVER_NAME = "my-planner";
export const AGENT_TOKEN_LABEL = "Agente AI (chat)";
export const DEFAULT_AGENT_BUDGET_CENTS = 500;
const GITHUB_API_HOST = "api.github.com";

/** Sottoinsieme del client Anthropic usato qui (iniettabile nei test). */
export interface AgentProvisioningClient {
  beta: {
    environments: Pick<Anthropic["beta"]["environments"], "create">;
    vaults: Pick<Anthropic["beta"]["vaults"], "create"> & {
      credentials: Pick<Anthropic["beta"]["vaults"]["credentials"], "create">;
    };
    agents: Pick<Anthropic["beta"]["agents"], "create">;
  };
}

type ClientFactory = (apiKey: string) => AgentProvisioningClient;

const defaultFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey });
let clientFactory: ClientFactory = defaultFactory;

/** Sostituisce il client Anthropic (test). `null` ripristina quello reale. */
export function setAgentClientFactory(factory: ClientFactory | null) {
  clientFactory = factory ?? defaultFactory;
}

export interface AgentConfigInput {
  apiKey?: string | null;
  githubToken?: string | null;
  budgetUsd?: number | null;
  mcpUrl: string;
}

export interface AgentRuntime {
  apiKey: string;
  githubToken: string;
  agentId: string;
  environmentId: string;
  vaultId: string;
  budgetCents: number;
  repoUrl: string;
}

type ProjectRow = NonNullable<Awaited<ReturnType<typeof prisma.project.findUnique>>>;

async function getProject(projectId: string): Promise<ProjectRow> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");
  return project;
}

function toView(project: ProjectRow): AgentConfigView {
  return {
    configured: Boolean(project.agentApiKeyEncrypted && project.agentGithubTokenEncrypted && project.agentId),
    hasApiKey: Boolean(project.agentApiKeyEncrypted),
    hasGithubToken: Boolean(project.agentGithubTokenEncrypted),
    budgetUsd: project.agentBudgetCents / 100,
    lastError: project.agentLastError,
    agentId: project.agentId,
  };
}

export async function getAgentConfig(projectId: string): Promise<AgentConfigView> {
  return toView(await getProject(projectId));
}

/** https qualsiasi, oppure http solo verso localhost (sviluppo). */
export function isValidMcpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

async function revokeToken(tokenId: string | null | undefined) {
  if (!tokenId) return;
  await prisma.projectToken.updateMany({ where: { id: tokenId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Messaggio leggibile dall'errore Anthropic, senza segreti. */
function describeError(err: unknown, secrets: string[]): string {
  let message: string;
  if (err instanceof Anthropic.APIError || (err && typeof (err as any).status === "number")) {
    const e = err as { status?: number; error?: any; message?: string };
    const detail = e.error?.error?.message ?? e.error?.message ?? e.message ?? "errore sconosciuto";
    message = `Errore API Anthropic (HTTP ${e.status ?? "?"}): ${String(detail)}`;
  } else {
    message = `Errore API Anthropic: ${(err as Error)?.message ?? "errore di rete"}`;
  }
  for (const s of secrets) if (s) message = message.split(s).join("***");
  return message.slice(0, 500);
}

/**
 * Salva la configurazione e crea le risorse Anthropic. `apiKey` e
 * `githubToken` sono facoltativi solo se gia' salvati.
 */
export async function setAgentConfig(projectId: string, input: AgentConfigInput): Promise<AgentConfigView> {
  const project = await getProject(projectId);
  if (!project.repoUrl) {
    throw new ApiErrorException("VALIDATION_ERROR", "Imposta prima il repository GitHub del progetto");
  }

  const newApiKey = input.apiKey?.trim();
  if (newApiKey && (!newApiKey.startsWith("sk-ant-") || /\s/.test(newApiKey))) {
    throw new ApiErrorException("VALIDATION_ERROR", "Chiave API Anthropic non valida: deve iniziare con sk-ant-");
  }
  if (!newApiKey && !project.agentApiKeyEncrypted) {
    throw new ApiErrorException("VALIDATION_ERROR", "Serve la chiave API Anthropic");
  }
  const newGithubToken = input.githubToken?.trim();
  if (newGithubToken && /\s/.test(newGithubToken)) {
    throw new ApiErrorException("VALIDATION_ERROR", "Token GitHub non valido");
  }
  if (!newGithubToken && !project.agentGithubTokenEncrypted) {
    throw new ApiErrorException("VALIDATION_ERROR", "Serve il token GitHub");
  }
  let budgetCents = project.agentBudgetCents;
  if (input.budgetUsd !== undefined && input.budgetUsd !== null) {
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 1 || input.budgetUsd > 100) {
      throw new ApiErrorException("VALIDATION_ERROR", "Il budget deve essere tra 1 e 100 dollari");
    }
    budgetCents = Math.round(input.budgetUsd * 100);
  }
  const mcpUrl = input.mcpUrl?.trim() ?? "";
  if (!isValidMcpUrl(mcpUrl)) {
    throw new ApiErrorException("VALIDATION_ERROR", "URL MCP non valido: usa https (http solo per localhost)");
  }

  let apiKey: string;
  let githubToken: string;
  try {
    apiKey = newApiKey || (await decryptSecret(project.agentApiKeyEncrypted!));
    githubToken = newGithubToken || (await decryptSecret(project.agentGithubTokenEncrypted!));
  } catch {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      "Segreti salvati non leggibili (chiave di cifratura cambiata?): inserisci di nuovo chiave API e token GitHub",
    );
  }

  const mcpToken = await createProjectToken(projectId, AGENT_TOKEN_LABEL);
  let ids: { environmentId: string; vaultId: string; agentId: string };
  try {
    ids = await provision(clientFactory(apiKey), {
      project: { id: project.id, name: project.name, repoUrl: project.repoUrl },
      mcpUrl,
      mcpToken: mcpToken.token,
      githubToken,
    });
  } catch (err) {
    await revokeToken(mcpToken.id);
    const reason = describeError(err, [apiKey, githubToken, mcpToken.token]);
    await prisma.project.update({ where: { id: projectId }, data: { agentLastError: reason } });
    throw new ApiErrorException("AGENT_API_ERROR", reason);
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(newApiKey ? { agentApiKeyEncrypted: await encryptSecret(newApiKey) } : {}),
      ...(newGithubToken ? { agentGithubTokenEncrypted: await encryptSecret(newGithubToken) } : {}),
      agentId: ids.agentId,
      agentEnvironmentId: ids.environmentId,
      agentVaultId: ids.vaultId,
      agentMcpTokenId: mcpToken.id,
      agentBudgetCents: budgetCents,
      agentLastError: null,
    },
  });
  if (project.agentMcpTokenId && project.agentMcpTokenId !== mcpToken.id) await revokeToken(project.agentMcpTokenId);
  return toView(updated);
}

async function provision(
  client: AgentProvisioningClient,
  args: {
    project: { id: string; name: string; repoUrl: string };
    mcpUrl: string;
    mcpToken: string;
    githubToken: string;
  },
) {
  const label = `My Planner - ${args.project.name}`.slice(0, 200);
  const environment = await client.beta.environments.create({
    name: label,
    config: {
      type: "cloud",
      networking: {
        type: "limited",
        allow_package_managers: true,
        allow_mcp_servers: true,
        allowed_hosts: [GITHUB_API_HOST],
      },
    },
  });
  const vault = await client.beta.vaults.create({ display_name: label });
  await client.beta.vaults.credentials.create(vault.id, {
    display_name: "My Planner MCP",
    auth: { type: "static_bearer", mcp_server_url: args.mcpUrl, token: args.mcpToken },
  });
  await client.beta.vaults.credentials.create(vault.id, {
    display_name: "GitHub token",
    auth: {
      type: "environment_variable",
      secret_name: "GITHUB_TOKEN",
      secret_value: args.githubToken,
      networking: { type: "limited", allowed_hosts: [GITHUB_API_HOST] },
      injection_location: { header: true },
    },
  });
  const agent = await client.beta.agents.create({
    name: label,
    model: AGENT_MODEL,
    system: agentSystemPrompt(args.project),
    mcp_servers: [{ type: "url", name: AGENT_MCP_SERVER_NAME, url: args.mcpUrl }],
    tools: [
      {
        type: "agent_toolset_20260401",
        default_config: { enabled: true, permission_policy: { type: "auto" } },
        configs: [
          { name: "web_fetch", enabled: false },
          { name: "web_search", enabled: false },
        ],
      },
      { type: "mcp_toolset", mcp_server_name: AGENT_MCP_SERVER_NAME },
    ],
  });
  return { environmentId: environment.id, vaultId: vault.id, agentId: agent.id };
}

/** Rimuove la configurazione (budget di nuovo a 500) e revoca il token MCP dell'agente. */
export async function clearAgentConfig(projectId: string): Promise<AgentConfigView> {
  const project = await getProject(projectId);
  await revokeToken(project.agentMcpTokenId);
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      agentApiKeyEncrypted: null,
      agentGithubTokenEncrypted: null,
      agentId: null,
      agentEnvironmentId: null,
      agentVaultId: null,
      agentMcpTokenId: null,
      agentBudgetCents: DEFAULT_AGENT_BUDGET_CENTS,
      agentLastError: null,
    },
  });
  return toView(updated);
}

/** Dati per avviare le sessioni (solo lato server: contiene segreti in chiaro). */
export async function getAgentRuntime(projectId: string): Promise<AgentRuntime> {
  const project = await getProject(projectId);
  if (
    !project.agentApiKeyEncrypted ||
    !project.agentGithubTokenEncrypted ||
    !project.agentId ||
    !project.agentEnvironmentId ||
    !project.agentVaultId ||
    !project.repoUrl
  ) {
    throw new ApiErrorException("VALIDATION_ERROR", "Agente AI non configurato");
  }
  let apiKey: string;
  let githubToken: string;
  try {
    apiKey = await decryptSecret(project.agentApiKeyEncrypted);
    githubToken = await decryptSecret(project.agentGithubTokenEncrypted);
  } catch {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      "Segreti dell'agente non leggibili (chiave di cifratura cambiata?): configura di nuovo l'agente",
    );
  }
  return {
    apiKey,
    githubToken,
    agentId: project.agentId,
    environmentId: project.agentEnvironmentId,
    vaultId: project.agentVaultId,
    budgetCents: project.agentBudgetCents,
    repoUrl: project.repoUrl,
  };
}

import { test, expect } from "@playwright/test";
import {
  API_BASE,
  callMcpTool,
  createProjectTokenViaApi,
  createProjectViaApi,
  createTaskViaApi,
  getJwt,
  loginViaUi,
  parseMcpToolResult,
  selectProjectInSidebar,
} from "./helpers";

async function getTask(taskId: string): Promise<any> {
  const token = await getJwt();
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

test.describe("T17 - gestione AI del task", () => {
  test("l'admin attiva l'AI dal drawer: passi, avvisi, badge col passo in attesa", async ({ page }) => {
    const project = await createProjectViaApi(`T17 AI ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Ticket AI" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    const card = page.locator(".task-card", { hasText: "Ticket AI" });
    await expect(card.locator(".badge-ai")).toHaveCount(0);

    // Pulsante AI sulla card: apre la modal senza aprire il task.
    await card.getByRole("button", { name: "Manage AI handling for this task" }).click();
    const modal = page.locator(".task-ai-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator(".drawer")).toHaveCount(0);
    const section = modal.locator(".ai-section");
    await section.getByLabel("Handle with an AI model").check();
    await section.getByRole("checkbox", { name: /Triage/ }).check();
    await section.getByRole("checkbox", { name: /Reviewer/ }).check();
    await section.getByRole("radio", { name: "On every status change" }).check();
    await section.getByRole("button", { name: "Save AI handling" }).click();
    await expect(section).toContainText("Pending step: Triage");

    const saved = await getTask(task.id);
    expect(saved.ai).toMatchObject({ enabled: true, steps: ["triage", "reviewer"], notify: "each" });

    // Badge sulla card con il passo in attesa (il task e' in Draft -> Triage).
    await modal.getByRole("button", { name: "Close" }).click();
    await expect(modal).toHaveCount(0);
    await expect(card.locator(".badge-ai")).toContainText("Triage");

    // Nel drawer la gestione AI e' in cima e l'eliminazione in fondo.
    await card.click();
    const drawer = page.locator(".drawer");
    await expect(drawer.locator(".drawer-body > .drawer-section").first()).toHaveClass(/drawer-ai-bar/);
    await expect(drawer.locator(".drawer-body > .drawer-section").last()).toHaveClass(/drawer-danger-zone/);
    await expect(drawer.locator(".drawer-header").getByRole("button", { name: "Delete task" })).toHaveCount(0);
  });

  test("un agente lavora la coda via MCP: presa in carico, passo completato, percorso fermato", async ({ page }) => {
    const project = await createProjectViaApi(`T17 MCP ${Date.now()}`);
    const token = await getJwt();
    await fetch(`${API_BASE}/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ repoUrl: "gyuco/demo" }),
    });
    const a = await createTaskViaApi(project.id, { title: "Ticket A" });
    const b = await createTaskViaApi(project.id, { title: "Ticket B" });
    for (const id of [a.id, b.id]) {
      await fetch(`${API_BASE}/tasks/${id}/ai`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: true, steps: ["triage"], notify: "end" }),
      });
    }
    const mcpToken = await createProjectTokenViaApi(project.id);

    const queue = parseMcpToolResult((await callMcpTool(mcpToken, "list_ai_tasks", {})).body);
    expect(queue.map((q: any) => [q.title, q.step, q.repoUrl])).toEqual([
      ["Ticket A", "triage", "https://github.com/gyuco/demo"],
      ["Ticket B", "triage", "https://github.com/gyuco/demo"],
    ]);
    await callMcpTool(mcpToken, "ai_start_step", { taskId: a.id });
    const done = parseMcpToolResult((await callMcpTool(mcpToken, "ai_complete_step", { taskId: a.id, summary: "Analisi fatta" })).body);
    expect(done.status).toBe("todo");
    await callMcpTool(mcpToken, "ai_fail", { taskId: b.id, reason: "Mancano i dettagli" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".task-card", { hasText: "Ticket A" })).toBeVisible();
    await expect(page.locator(".column").nth(1).locator(".task-card", { hasText: "Ticket A" })).toBeVisible();
    await expect(page.locator(".task-card", { hasText: "Ticket B" }).locator(".badge-ai-failed")).toBeVisible();

    // L'admin riprende il percorso dalla scheda.
    await page.locator(".task-card", { hasText: "Ticket B" }).click();
    await page.locator(".drawer").getByRole("button", { name: "Manage AI" }).click();
    const section = page.locator(".task-ai-modal .ai-section");
    await expect(section).toContainText("Mancano i dettagli");
    await section.getByRole("button", { name: "Resume" }).click();
    await expect(section).toContainText("Pending step: Triage");
  });

  test("guida AI: dalla sidebar e dalla scheda del task", async ({ page }) => {
    const project = await createProjectViaApi(`T17 Guida ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Ticket guida" });
    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);

    await page.getByRole("button", { name: "AI guide" }).click();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(page.locator(".guide-card h2")).toHaveText("Guide: AI-handled tasks");
    await expect(page.locator(".guide-url code")).toContainText("/mcp/global");
    await expect(page.locator("#guide-routine")).toContainText("Generate token");

    await selectProjectInSidebar(page, project.name);
    await page.locator(".task-card", { hasText: "Ticket guida" }).click();
    await page.locator(".drawer").getByRole("button", { name: "Manage AI" }).click();
    await page.locator(".task-ai-modal .ai-section").getByRole("link", { name: "Guide" }).click();
    await expect(page).toHaveURL(/\/guide#guide-use$/);
  });

  test("solo l'admin gestisce l'AI: il manager non vede il pulsante e il server rifiuta", async ({ page }) => {
    const project = await createProjectViaApi(`T17 Manager ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Ticket manager" });
    const adminToken = await getJwt();
    const email = `manager-${Date.now()}@example.com`;
    const password = "password-123";
    const created = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email, password, role: "manager", projectIds: [project.id] }),
    });
    expect(created.status).toBe(201);
    const login = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const { token } = await login.json();

    const denied = await fetch(`${API_BASE}/tasks/${task.id}/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: true, steps: ["triage"], notify: "end" }),
    });
    expect(denied.status).toBe(403);

    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.locator(".sidebar-header").waitFor({ state: "attached" });
    await selectProjectInSidebar(page, project.name);
    const card = page.locator(".task-card", { hasText: "Ticket manager" });
    await expect(card).toBeVisible();
    await expect(card.locator(".task-card-ai")).toHaveCount(0);
    await card.click();
    await expect(page.locator(".drawer").getByRole("button", { name: "Manage AI" })).toHaveCount(0);
    await expect(page.locator(".drawer .drawer-ai-bar")).toHaveCount(0);
  });
});

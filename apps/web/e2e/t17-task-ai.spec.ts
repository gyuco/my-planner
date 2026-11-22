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

    await card.click();
    const section = page.locator(".drawer .ai-section");
    await section.getByLabel("Handle with an AI model").check();
    await section.getByRole("checkbox", { name: /Triage/ }).check();
    await section.getByRole("checkbox", { name: /Reviewer/ }).check();
    await section.getByRole("radio", { name: "On every status change" }).check();
    await section.getByRole("button", { name: "Save AI handling" }).click();
    await expect(section).toContainText("Pending step: Triage");

    const saved = await getTask(task.id);
    expect(saved.ai).toMatchObject({ enabled: true, steps: ["triage", "reviewer"], notify: "each" });

    // Badge sulla card con il passo in attesa (il task e' in Draft -> Triage).
    await page.locator(".drawer").getByRole("button", { name: "Close" }).first().click();
    await expect(card.locator(".badge-ai")).toContainText("Triage");
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
    const section = page.locator(".drawer .ai-section");
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
    await page.locator(".drawer .ai-section").getByRole("link", { name: "Guide" }).click();
    await expect(page).toHaveURL(/\/guide#guide-use$/);
  });
});

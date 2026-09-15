import { test, expect } from "@playwright/test";
import {
  callMcpTool,
  createProjectTokenViaApi,
  createProjectViaApi,
  loginViaUi,
  parseMcpToolResult,
  selectProjectInSidebar,
} from "./helpers";

test.describe("T7 - MCP end-to-end verso UI", () => {
  test("crea/modifica un task via MCP HTTP e verifica il riflesso in UI", async ({ page }) => {
    const project = await createProjectViaApi(`T7 MCP ${Date.now()}`);
    const projectToken = await createProjectTokenViaApi(project.id, "e2e-mcp-token");

    // Crea un task via chiamata JSON-RPC diretta a POST /mcp (create_task)
    const createRes = await callMcpTool(projectToken, "create_task", {
      title: "Task creato via MCP",
      priority: "high",
    });
    expect(createRes.status).toBe(200);
    const created = parseMcpToolResult(createRes.body);
    expect(created.isError).toBeFalsy();
    const taskId = created.id ?? JSON.parse(JSON.stringify(created)).id;
    expect(taskId).toBeTruthy();

    // Verifica riflesso in UI
    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".task-card", { hasText: "Task creato via MCP" })).toBeVisible();

    // Modifica via MCP (update_task) e ricarica la board nella UI
    const updateRes = await callMcpTool(projectToken, "update_task", {
      taskId,
      title: "Task modificato via MCP",
    });
    expect(updateRes.status).toBe(200);
    const updated = parseMcpToolResult(updateRes.body);
    expect(updated.isError).toBeFalsy();

    await page.reload();
    // Dopo il reload l'app riseleziona di default il primo progetto (per
    // creazione): rifacciamo la selezione esplicita per progetto, coerente
    // con l'esecuzione nella suite completa dove esistono altri progetti.
    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".task-card", { hasText: "Task modificato via MCP" })).toBeVisible();
    await expect(page.locator(".task-card", { hasText: "Task creato via MCP" })).toHaveCount(0);
  });
});

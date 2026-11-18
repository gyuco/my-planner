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

async function getTaskStatus(taskId: string): Promise<string> {
  const token = await getJwt();
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).status;
}

test.describe("T16 - stati personalizzati per progetto", () => {
  test("crea e rinomina uno stato, sposta un task da board e da MCP; gli stati di base restano", async ({ page }) => {
    const project = await createProjectViaApi(`T16 Stati ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Bug login" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".column")).toHaveCount(4);

    // Crea lo stato dalle impostazioni del progetto.
    await page.getByRole("button", { name: `Project settings ${project.name}` }).click();
    const modal = page.locator(".settings-modal");
    await modal.getByLabel("New status name (e.g. Blocking)").fill("Bloqueante");
    await modal.getByRole("button", { name: "Add status" }).click();
    const row = modal.locator(".status-list li", { hasText: "bloqueante" });
    await expect(row).toContainText("Bloqueante");

    // Rinomina: cambia il nome, la chiave resta.
    await row.getByRole("button", { name: "Rename" }).click();
    await modal.getByLabel("Status name", { exact: true }).fill("Bloccante");
    await modal.getByRole("button", { name: "Save" }).click();
    await expect(modal.locator(".status-list li", { hasText: "bloqueante" })).toContainText("Bloccante");
    // Gli stati di base non hanno azioni.
    await expect(modal.locator(".status-list li", { hasText: "Testing" }).getByRole("button")).toHaveCount(0);
    await modal.getByRole("button", { name: "Close" }).last().click();

    // Nuova colonna tra In progress e Testing.
    await expect(page.locator(".column")).toHaveCount(5);
    await expect(page.locator(".column h2").nth(3)).toContainText("Bloccante");

    // Sposta il task nello stato personalizzato dalla board (drawer).
    await page.locator(".task-card", { hasText: "Bug login" }).click();
    const drawer = page.locator(".drawer");
    await drawer.getByLabel("Change task status").selectOption("bloqueante");
    await expect.poll(() => getTaskStatus(task.id)).toBe("bloqueante");
    await page.keyboard.press("Escape");
    await expect(page.locator(".column-status-custom .task-card", { hasText: "Bug login" })).toBeVisible();

    // Da MCP: list_statuses, move_task per nome e verso uno stato di base.
    const mcpToken = await createProjectTokenViaApi(project.id);
    const statuses = parseMcpToolResult((await callMcpTool(mcpToken, "list_statuses", {})).body);
    expect(statuses.map((s: { key: string }) => s.key)).toEqual([
      "draft",
      "todo",
      "in_progress",
      "bloqueante",
      "testing",
      "done",
    ]);
    const toTodo = parseMcpToolResult((await callMcpTool(mcpToken, "move_task", { taskId: task.id, status: "todo" })).body);
    expect(toTodo.status).toBe("todo");
    const byName = parseMcpToolResult(
      (await callMcpTool(mcpToken, "move_task", { taskId: task.id, status: "Bloccante" })).body,
    );
    expect(byName.status).toBe("bloqueante");
  });
});

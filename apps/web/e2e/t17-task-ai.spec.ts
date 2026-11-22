import { test, expect } from "@playwright/test";
import { API_BASE, createProjectViaApi, createTaskViaApi, getJwt, loginViaUi, selectProjectInSidebar } from "./helpers";

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
});

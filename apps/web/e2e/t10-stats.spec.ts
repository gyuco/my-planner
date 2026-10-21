import { test, expect } from "@playwright/test";
import { API_BASE, createProjectViaApi, createTaskViaApi, getJwt, loginViaUi, selectProjectInSidebar } from "./helpers";

async function moveTaskViaApi(taskId: string, status: string) {
  const token = await getJwt();
  const res = await fetch(`${API_BASE}/tasks/${taskId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`move fallito: ${res.status}`);
}

test.describe("T10 - statistiche di progetto", () => {
  test("tab Statistiche: KPI, grafici e filtro per tipo", async ({ page }) => {
    const project = await createProjectViaApi(`Stats E2E ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Bug urgente", type: "bug", priority: "urgent", tags: ["api"] });
    await createTaskViaApi(project.id, { title: "Feature", priority: "high", complexity: 5, tags: ["ui"] });
    const done = await createTaskViaApi(project.id, { title: "Fatto", complexity: 3 });
    const wip = await createTaskViaApi(project.id, { title: "In corso", type: "analysis" });
    await moveTaskViaApi(done.id, "done");
    await moveTaskViaApi(wip.id, "in_progress");

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await page.getByRole("tab", { name: "Statistics" }).click();

    const kpis = page.locator(".stats-kpis");
    await expect(kpis.locator(".stats-kpi", { hasText: "Total" }).locator(".stats-kpi-value")).toHaveText("4");
    await expect(kpis.locator(".stats-kpi", { hasText: "Open" }).locator(".stats-kpi-value")).toHaveText("3");
    await expect(kpis.locator(".stats-kpi", { hasText: "Closed in 30 days" }).locator(".stats-kpi-value")).toHaveText("1");
    await expect(kpis.locator(".stats-kpi", { hasText: "Completion" }).locator(".stats-kpi-value")).toHaveText("25%");
    const byStatus = page.locator(".stats-card", { hasText: "Tasks by status" });
    await expect(byStatus.locator(".recharts-bar-rectangle")).toHaveCount(3); // 3 stati non vuoti
    // Le etichette compaiono a fine animazione: draft=2, in_progress=1, done=1.
    await expect(byStatus.locator(".recharts-label-list")).toHaveText(/2.*1.*1/);
    await expect(page.locator(".stats-matrix")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("t10-stats.png"), fullPage: true });

    await page.locator(".stats-filters label", { hasText: "Type" }).locator("select").selectOption("bug");
    await expect(kpis.locator(".stats-kpi", { hasText: "Total" }).locator(".stats-kpi-value")).toHaveText("1");

    await page.getByRole("tab", { name: "Board" }).click();
    await expect(page.locator(".board")).toBeVisible();
  });
});

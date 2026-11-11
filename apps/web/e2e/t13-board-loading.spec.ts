import { test, expect } from "@playwright/test";
import { createProjectViaApi, createTaskViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

test.describe("T13 - caricamento al cambio progetto", () => {
  test("mostra loader e placeholder finche' la board del nuovo progetto non arriva", async ({ page }) => {
    const stamp = Date.now();
    const first = await createProjectViaApi(`T13 Primo ${stamp}`);
    const second = await createProjectViaApi(`T13 Secondo ${stamp}`);
    await createTaskViaApi(first.id, { title: "Task del primo" });
    await createTaskViaApi(second.id, { title: "Task del secondo" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, first.name);
    await expect(page.locator(".task-card", { hasText: "Task del primo" })).toBeVisible();

    // La board del secondo progetto risponde solo quando lo decide il test.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/projects/${second.id}/board*`, async (route) => {
      await gate;
      await route.continue();
    });

    await selectProjectInSidebar(page, second.name);
    await expect(page.locator(".topbar h1")).toHaveText(second.name);
    await expect(page.locator(".board-loading")).toHaveText("Loading project…");
    await expect(page.locator(".top-progress")).toBeVisible();
    await expect(page.locator(".skeleton-card").first()).toBeVisible();
    // Nessuna card del progetto precedente resta visibile durante il caricamento.
    await expect(page.locator(".task-card")).toHaveCount(0);

    release();
    await expect(page.locator(".task-card", { hasText: "Task del secondo" })).toBeVisible();
    await expect(page.locator(".skeleton-card")).toHaveCount(0);
    await expect(page.locator(".top-progress")).toHaveCount(0);
  });
});

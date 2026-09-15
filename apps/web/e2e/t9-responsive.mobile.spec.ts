import { test, expect } from "@playwright/test";
import { createProjectViaApi, createTaskViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

test.describe("T9 - responsive mobile (375x667)", () => {
  test("sidebar nascosta con hamburger, drawer full-screen, nessun overflow orizzontale", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const project = await createProjectViaApi(`T9 Mobile ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Task mobile" });

    await loginViaUi(page);

    // Sidebar inizialmente nascosta, bottone hamburger visibile
    const sidebar = page.locator(".sidebar");
    const hamburger = page.locator(".sidebar-toggle");
    await expect(hamburger).toBeVisible();
    await expect(sidebar).not.toBeInViewport();

    await hamburger.click();
    await expect(page.locator(".app-shell.sidebar-open")).toBeVisible();
    await expect(sidebar).toBeInViewport();

    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".topbar h1")).toHaveText(project.name);

    // Drawer dettaglio task occupa tutto lo schermo
    await page.locator(".task-card", { hasText: task.title }).click();
    const drawer = page.locator(".drawer");
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(370);

    // Nessun overflow orizzontale della pagina
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });
});

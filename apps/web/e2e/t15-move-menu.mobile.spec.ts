import { test, expect } from "@playwright/test";
import { createProjectViaApi, createTaskViaApi, loginViaUi } from "./helpers";

test.describe("T15 - spostamento card da menu su mobile", () => {
  test("su mobile il drag e' disattivato e la card si sposta dal menu", async ({ page }) => {
    const project = await createProjectViaApi(`T15 Mobile ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Task da spostare" });

    await loginViaUi(page);
    await page.goto(`/projects/${project.id}`);
    const card = page.locator(".task-card", { hasText: "Task da spostare" });
    await expect(card).toBeVisible();

    // Card non trascinabile: niente attributi dnd-kit, scroll nativo.
    await expect(card).toHaveClass(/task-card-static/);
    await expect(card).not.toHaveAttribute("aria-roledescription", "sortable");

    const menu = card.getByRole("combobox", { name: "Move to…" });
    // La colonna attuale (Draft) non e' tra le destinazioni, e nemmeno Done.
    await expect(menu.locator("option")).toHaveText(["Move to…", "To do", "In progress", "Testing"]);

    await menu.selectOption("in_progress");
    const inProgress = page.locator(".column-status-in_progress");
    await expect(inProgress.locator(".task-card", { hasText: "Task da spostare" })).toBeVisible();
    await expect(page.locator(".column-status-draft .task-card", { hasText: "Task da spostare" })).toHaveCount(0);

    // Persistito sul server: dopo il reload resta in In progress.
    await page.reload();
    await expect(inProgress.locator(".task-card", { hasText: "Task da spostare" })).toBeVisible();
  });
});

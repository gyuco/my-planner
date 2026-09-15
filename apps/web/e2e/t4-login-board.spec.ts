import { test, expect } from "@playwright/test";
import { E2E_BOOTSTRAP_PASSWORD, E2E_BOOTSTRAP_USERNAME } from "../playwright.config";
import { loginViaUi, selectProjectInSidebar } from "./helpers";

test.describe("T4 - login e board base", () => {
  test("login, creazione progetto, board, creazione task, drag&drop, persistenza", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "my-planner" })).toBeVisible();

    await page.getByLabel("Username").fill(E2E_BOOTSTRAP_USERNAME);
    await page.getByLabel("Password").fill(E2E_BOOTSTRAP_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    const newProjectButton = page.locator(".sidebar-header").getByRole("button", { name: "+", exact: true });
    await expect(newProjectButton).toBeVisible();

    // Creazione progetto
    const projectName = `Progetto E2E ${Date.now()}`;
    await newProjectButton.click();
    await page.getByLabel("Name").fill(projectName);
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page.locator(".sidebar-nav").getByRole("button", { name: projectName, exact: true })).toBeVisible();
    await selectProjectInSidebar(page, projectName);

    await expect(page.locator(".topbar h1")).toHaveText(projectName);
    await expect(page.locator(".board")).toBeVisible();
    await expect(page.locator(".column")).toHaveCount(3);

    // Creazione task via modale
    const taskTitle = `Task E2E ${Date.now()}`;
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(taskTitle);
    await page.getByRole("button", { name: "Create task" }).click();

    const draftColumn = page.locator(".column", { hasText: "Draft" });
    const inProgressColumn = page.locator(".column", { hasText: "In progress" });
    const taskCard = draftColumn.locator(".task-card", { hasText: taskTitle });
    await expect(taskCard).toBeVisible();

    // Drag & drop verso "In progress"
    const cardBox = await taskCard.boundingBox();
    const targetBox = await inProgressColumn.boundingBox();
    if (!cardBox || !targetBox) throw new Error("bounding box mancante per drag&drop");

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 10 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 40, { steps: 10 });
    await page.mouse.up();

    await expect(inProgressColumn.locator(".task-card", { hasText: taskTitle })).toBeVisible();
    await expect(draftColumn.locator(".task-card", { hasText: taskTitle })).toHaveCount(0);

    // Persistenza dopo reload (riselezione esplicita: dopo reload l'app
    // sceglie di default il primo progetto, non necessariamente questo)
    await page.reload();
    await selectProjectInSidebar(page, projectName);
    await expect(page.locator(".column", { hasText: "In progress" }).locator(".task-card", { hasText: taskTitle })).toBeVisible();
  });
});

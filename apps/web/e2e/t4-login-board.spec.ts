import { test, expect } from "@playwright/test";
import { E2E_BOOTSTRAP_PASSWORD, E2E_BOOTSTRAP_USERNAME } from "../playwright.config";
import { createProjectViaApi, createTaskViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

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
    await expect(page.locator(".column")).toHaveCount(5);

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

  test("le colonne della board sono configurabili localmente", async ({ page }) => {
    const project = await createProjectViaApi(`T4 Colonne ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Task colonne" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);

    // Di default sono visibili tutte e cinque le colonne.
    await expect(page.locator(".column")).toHaveCount(5);
    await expect(page.locator(".column", { hasText: "Testing" })).toBeVisible();

    // Il pulsante "Columns" permette di nascondere una colonna.
    await page.getByRole("button", { name: /Columns/ }).click();
    await page.getByRole("checkbox", { name: "Testing" }).uncheck();
    await expect(page.locator(".column")).toHaveCount(4);
    await expect(page.locator(".column", { hasText: "Testing" })).toHaveCount(0);

    // La preferenza è solo locale e sopravvive al reload.
    await page.reload();
    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".column")).toHaveCount(4);

    // "Mostra tutte" ripristina tutte le colonne.
    await page.getByRole("button", { name: /Columns/ }).click();
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(page.locator(".column")).toHaveCount(5);
  });

  test("la sidebar sinistra è comprimibile e il titolo pagina segue il progetto", async ({ page }) => {
    const project = await createProjectViaApi(`T4 Sidebar ${Date.now()}`);

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await expect(page).toHaveTitle(`${project.name} · My Planner`);

    // Su desktop il pulsante ☰ comprime/espande la colonna sinistra.
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toBeVisible();
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(sidebar).toBeHidden();

    // La preferenza sopravvive al reload; la sidebar si riapre dal pulsante.
    await page.reload();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await selectProjectInSidebar(page, project.name);
    await expect(page).toHaveTitle(`${project.name} · My Planner`);
  });
});

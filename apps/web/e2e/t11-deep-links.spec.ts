import { test, expect, type Page } from "@playwright/test";
import { E2E_BOOTSTRAP_EMAIL, E2E_BOOTSTRAP_PASSWORD } from "../playwright.config";
import { createProjectViaApi, createTaskViaApi, loginViaUi } from "./helpers";

async function fillLogin(page: Page) {
  await page.getByLabel("Email").fill(E2E_BOOTSTRAP_EMAIL);
  await page.getByLabel("Password").fill(E2E_BOOTSTRAP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("T11 - URL condivisibili (deep link)", () => {
  test("apertura diretta di progetto, statistiche e task; indietro chiude il drawer", async ({ page }) => {
    const project = await createProjectViaApi(`T11 Links ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Task linkato" });

    await loginViaUi(page);

    await page.goto(`/projects/${project.id}`);
    await expect(page.locator(".topbar h1")).toHaveText(project.name);
    await expect(page.locator(".task-card", { hasText: "Task linkato" })).toBeVisible();

    await page.goto(`/projects/${project.id}/stats`);
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/stats$`));
    await expect(page.locator(".view-tab.active")).toHaveText("Statistics");

    // Deep link al task: il drawer si apre sul task giusto.
    await page.goto(`/projects/${project.id}?task=${task.id}`);
    const drawer = page.locator(".drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("input").first()).toHaveValue("Task linkato");

    // Chiudere il drawer toglie ?task= dall'URL.
    await page.locator(".drawer-header .icon-button").click();
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/task=/);

    // Cliccare una card scrive ?task=, "indietro" chiude il drawer.
    await page.locator(".task-card", { hasText: "Task linkato" }).click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`task=${task.id}`));
    await page.goBack();
    await expect(drawer).toBeHidden();
  });

  test("deep link da non loggato: dopo il login si arriva sul task", async ({ page }) => {
    const project = await createProjectViaApi(`T11 Login ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Task post-login" });

    await page.goto(`/projects/${project.id}?task=${task.id}`);
    await fillLogin(page);

    await expect(page.locator(".drawer")).toBeVisible();
    await expect(page.locator(".drawer input").first()).toHaveValue("Task post-login");
    await expect(page.locator(".topbar h1")).toHaveText(project.name);
  });

  test("task o progetto inesistenti: avviso e redirect", async ({ page }) => {
    const project = await createProjectViaApi(`T11 Missing ${Date.now()}`);
    await loginViaUi(page);

    await page.goto(`/projects/${project.id}?task=non-esiste`);
    await expect(page.locator(".board-error", { hasText: "Task not found" })).toBeVisible();
    await expect(page.locator(".drawer")).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);

    await page.goto("/projects/non-esiste");
    await expect(page.locator(".board-error", { hasText: "Project not found" })).toBeVisible();
    await expect(page).not.toHaveURL(/non-esiste/);
  });

  test("path sconosciuto porta al progetto di default", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/qualcosa/di/strano");
    await expect(page).toHaveURL(/\/projects\//);
  });

  test("i filtri della board stanno nell'URL e sopravvivono a reload e apertura task", async ({ page }) => {
    const project = await createProjectViaApi(`T11 Filtri ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Alfa uno" });
    const beta = await createTaskViaApi(project.id, { title: "Beta due" });

    await loginViaUi(page);
    await page.goto(`/projects/${project.id}`);
    await page.getByPlaceholder("Search by title or description...").fill("Alfa");
    await expect(page).toHaveURL(/q=Alfa/);
    await expect(page.locator(".task-card", { hasText: "Alfa uno" })).toBeVisible();
    await expect(page.locator(".task-card", { hasText: "Beta due" })).toHaveCount(0);

    // Reload: i filtri tornano dall'URL.
    await page.reload();
    await expect(page.getByPlaceholder("Search by title or description...")).toHaveValue("Alfa");
    await expect(page.locator(".task-card", { hasText: "Beta due" })).toHaveCount(0);

    // Aprire un task non perde i filtri.
    await page.locator(".task-card", { hasText: "Alfa uno" }).click();
    await expect(page.locator(".drawer")).toBeVisible();
    await expect(page).toHaveURL(/q=Alfa/);
    await expect(page).toHaveURL(/task=/);

    // Deep link con filtro che esclude il task: il drawer si apre comunque.
    await page.goto(`/projects/${project.id}?q=Alfa&task=${beta.id}`);
    await expect(page.locator(".drawer input").first()).toHaveValue("Beta due");
  });
});

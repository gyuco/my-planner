import { test, expect } from "@playwright/test";
import { loginViaUi, createProjectViaApi, createTaskViaApi, selectProjectInSidebar } from "./helpers";

test.describe("T5 - dipendenze, blocco stato", () => {
  test("dipendenza A bloccato da B, blocco/sblocco via drag e via select", async ({
    page,
  }) => {
    const project = await createProjectViaApi(`T5 Deps ${Date.now()}`);
    const taskA = await createTaskViaApi(project.id, { title: "Task A (bloccato)" });
    const taskB = await createTaskViaApi(project.id, { title: "Task B (blocker)" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await expect(page.locator(".topbar h1")).toHaveText(project.name);

    // Apri il drawer del task A
    const cardA = page.locator(".task-card", { hasText: "Task A (bloccato)" });
    await expect(cardA).toBeVisible();
    await cardA.click();

    const drawer = page.locator(".drawer");
    await expect(drawer).toBeVisible();

    // Aggiunge dipendenza verso B
    await drawer.locator("select").first().waitFor(); // select stato
    const blockerSelect = drawer.locator(".drawer-inline-form select");
    await blockerSelect.selectOption({ label: "Task B (blocker)" });
    await drawer.getByRole("button", { name: "Aggiungi" }).first().click();
    await expect(drawer.locator(".drawer-list li", { hasText: "Task B (blocker)" })).toBeVisible();

    await page.locator(".drawer-header .icon-button").click();
    await expect(drawer).toBeHidden();
    await expect(cardA.locator(".task-card-blocked")).toBeVisible();

    // Tentativo di spostare A in in_progress via select nel drawer -> DEPENDENCY_BLOCKED
    await cardA.click();
    await expect(drawer).toBeVisible();
    const statusSelect = drawer.getByLabel("Cambia stato del task");
    await statusSelect.selectOption("in_progress");
    await expect(page.locator(".board-error", { hasText: /DEPENDENCY_BLOCKED|bloccat/i })).toBeVisible();
    await expect(statusSelect).toHaveValue("draft");

    await page.locator(".drawer-header .icon-button").click();
    await expect(drawer).toBeHidden();

    // Tentativo di spostare A in in_progress via drag -> rifiutato, resta in draft
    const draftColumn = page.locator(".column", { hasText: "Draft" });
    const inProgressColumn = page.locator(".column", { hasText: "In progress" });
    const cardBox = await cardA.boundingBox();
    const targetBox = await inProgressColumn.boundingBox();
    if (!cardBox || !targetBox) throw new Error("bounding box mancante");
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 40, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator(".board-error")).toBeVisible();
    await expect(draftColumn.locator(".task-card", { hasText: "Task A (bloccato)" })).toBeVisible();
    await expect(inProgressColumn.locator(".task-card", { hasText: "Task A (bloccato)" })).toHaveCount(0);

    // Il drag rifiutato lascia momentaneamente i listener pointer di dnd-kit
    // in uno stato residuo: attendiamo che nessuna card sia piu' "in drag"
    // prima di interagire di nuovo via click, per evitare un click perso.
    await expect(page.locator(".task-card-dragging")).toHaveCount(0);

    // Completa B -> A si sblocca
    const cardB = page.locator(".task-card", { hasText: "Task B (blocker)" });
    await expect(async () => {
      await cardB.click();
      await expect(drawer).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await drawer.getByLabel("Cambia stato del task").selectOption("done");
    await page.locator(".drawer-header .icon-button").click();
    await expect(drawer).toBeHidden();

    await expect(cardA.locator(".task-card-blocked")).toHaveCount(0);

    await cardA.click();
    await drawer.getByLabel("Cambia stato del task").selectOption("in_progress");
    await expect(drawer.getByLabel("Cambia stato del task")).toHaveValue("in_progress");
  });
});

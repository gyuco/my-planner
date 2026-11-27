import { test, expect, type Page } from "@playwright/test";
import { createProjectViaApi, createTaskViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

/**
 * Rallenta (o fa fallire) la PATCH /tasks/:id del task per rendere osservabile
 * lo stato di salvataggio dell'assegnatario. Le GET passano invariate.
 */
async function holdPatch(page: Page, taskId: string, opts: { fail?: boolean } = {}) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/tasks/${taskId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await released;
    if (opts.fail) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL", message: "Assignee save failed" } }),
      });
    }
    return route.continue();
  });
  return release;
}

async function openTaskDrawer(page: Page, projectName: string, title: string) {
  await loginViaUi(page);
  await selectProjectInSidebar(page, projectName);
  await page.locator(".task-card", { hasText: title }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("T20 - salvataggio assegnatario nel drawer", () => {
  test("mostra spinner ottimistico durante la PATCH e poi la conferma", async ({ page }) => {
    const project = await createProjectViaApi(`T20 Assignee ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Task da assegnare" });
    const drawer = await openTaskDrawer(page, project.name, "Task da assegnare");

    const trigger = drawer.locator(".assignee-select-trigger");
    await expect(trigger).toContainText("Unassigned");
    await expect(trigger).toBeEnabled();

    const release = await holdPatch(page, task.id);
    await trigger.click();
    // Prima opzione dopo "Non assegnato": l'utente bootstrap (admin, sempre assegnabile).
    const option = page.locator(".assignee-select-option:not(.is-unassigned)").first();
    const name = (await option.locator(".assignee-select-option-name").innerText()).trim();
    await option.click();

    // Ottimistico + bloccato durante il salvataggio.
    await expect(trigger).toHaveAttribute("aria-busy", "true");
    await expect(trigger).toBeDisabled();
    await expect(trigger.locator(".assignee-select-value")).toHaveText(name);
    await expect(trigger.locator(".assignee-select-status.is-saving .spinner")).toBeVisible();
    await expect(trigger).toContainText("Saving...");

    release();

    // Conferma breve, poi torna la freccia; campo di nuovo utilizzabile.
    await expect(trigger.locator(".assignee-select-status.is-saved")).toContainText("Saved");
    await expect(trigger).not.toHaveAttribute("aria-busy", "true");
    await expect(trigger).toBeEnabled();
    await expect(page.locator(".toast-success")).toHaveCount(1);
    await expect(trigger.locator(".assignee-select-status")).toHaveCount(0, { timeout: 4000 });
    await expect(trigger.locator(".assignee-select-chevron")).toBeVisible();
    await expect(trigger.locator(".assignee-select-value")).toHaveText(name);
  });

  test("in errore ripristina il valore precedente", async ({ page }) => {
    const project = await createProjectViaApi(`T20 Assignee err ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Task errore assegnatario" });
    const drawer = await openTaskDrawer(page, project.name, "Task errore assegnatario");

    const trigger = drawer.locator(".assignee-select-trigger");
    await expect(trigger).toContainText("Unassigned");

    const release = await holdPatch(page, task.id, { fail: true });
    await trigger.click();
    await page.locator(".assignee-select-option:not(.is-unassigned)").first().click();
    await expect(trigger).toHaveAttribute("aria-busy", "true");

    release();

    await expect(trigger).not.toHaveAttribute("aria-busy", "true");
    await expect(trigger.locator(".assignee-select-value")).toHaveText("Unassigned");
    await expect(trigger.locator(".assignee-select-status.is-saved")).toHaveCount(0);
    await expect(drawer).toContainText("Assignee save failed");
  });
});

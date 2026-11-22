import { test, expect } from "@playwright/test";
import { createProjectViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

test.describe("T19 - toolbar della board: Aggiorna e Avvia coda AI", () => {
  test("Aggiorna c'e' sempre; Avvia coda AI compare solo con la routine configurata", async ({ page }) => {
    const project = await createProjectViaApi(`T19 Toolbar ${Date.now()}`);
    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);

    const toolbar = page.locator(".board-toolbar");
    await expect(toolbar.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Start AI queue" })).toHaveCount(0);
    // Il refresh non e' piu' nella riga del progetto in sidebar.
    await expect(page.locator(".sidebar-project-refresh")).toHaveCount(0);

    await toolbar.getByRole("button", { name: "Refresh" }).click();
    await expect(toolbar.getByRole("button", { name: "Refresh" })).toBeEnabled();

    await page.getByRole("button", { name: `Project settings ${project.name}` }).click();
    const modal = page.locator(".settings-modal");
    await modal.getByLabel("Routine ID").fill("trig_e2eToolbar12345");
    await modal.getByLabel("API trigger token").fill("sk-ant-oat01-e2e-fake-token-000000");
    await modal.getByRole("button", { name: "Save routine" }).click();
    await expect(modal.getByRole("button", { name: "Start the queue now" })).toHaveCount(0);
    await modal.getByRole("button", { name: "Close" }).last().click();

    const runButton = toolbar.getByRole("button", { name: "Start AI queue" });
    await expect(runButton).toBeVisible();
    // Nessun task AI in attesa: la routine non viene chiamata.
    await runButton.click();
    await expect(page.getByText(/Nessun task AI in attesa/)).toBeVisible();
  });
});

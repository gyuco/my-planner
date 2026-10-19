import { test } from "@playwright/test";
import { createProjectViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("preview create task modal", async ({ page }) => {
  const project = await createProjectViaApi(`Preview ${Date.now()}`);
  await loginViaUi(page);
  await selectProjectInSidebar(page, project.name);
  await page.getByRole("button", { name: "+ New task" }).click();
  await page.getByLabel("Title").fill("Rifattorizzare l'onboarding");
  await page.getByLabel("Description (markdown)").fill("Rivedere i primi tre passaggi del flusso di attivazione.");
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "design-spec.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("a".repeat(248_000)),
    },
    {
      name: "screenshot-onboarding.png",
      mimeType: "image/png",
      buffer: Buffer.from("b".repeat(1_240_000)),
    },
  ]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "../../test-results/preview-task-mobile.png", fullPage: true });
  await page.getByRole("button", { name: /Advanced settings/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "../../test-results/preview-task-open.png", fullPage: true });
});

import { test, expect } from "@playwright/test";
import { createProjectViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

test.describe("T18 - gruppi di progetti nella sidebar", () => {
  test("il gruppo si imposta dalle impostazioni; il contenitore si apre, si chiude e ricorda lo stato", async ({ page }) => {
    const stamp = Date.now();
    const group = `Gruppo ${stamp}`;
    const a = await createProjectViaApi(`T18 API ${stamp}`);
    const b = await createProjectViaApi(`T18 App ${stamp}`);

    await loginViaUi(page);
    for (const project of [a, b]) {
      await selectProjectInSidebar(page, project.name);
      await page.getByRole("button", { name: `Project settings ${project.name}` }).click();
      const modal = page.locator(".settings-modal");
      await modal.getByLabel("Group").fill(group);
      await modal.getByRole("button", { name: "Save group" }).click();
      await expect(modal).toContainText("Group updated");
      await modal.getByRole("button", { name: "Close" }).last().click();
    }

    const container = page.locator(".sidebar-group", { hasText: group });
    const header = container.locator(".sidebar-group-header");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(header).toContainText("2");
    await expect(container.locator(".sidebar-item")).toHaveText([a.name, b.name]);

    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(container.locator(".sidebar-item")).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".sidebar-group", { hasText: group }).locator(".sidebar-group-header")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

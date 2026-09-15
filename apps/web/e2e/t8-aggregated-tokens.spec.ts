import { test, expect } from "@playwright/test";
import { callMcpTool, createProjectViaApi, createTaskViaApi, loginViaUi, selectProjectInSidebar } from "./helpers";

test.describe("T8 - vista aggregata e token MCP UI", () => {
  test("board aggregata multi-progetto con etichetta progetto", async ({ page }) => {
    const stamp = Date.now();
    const projectA = await createProjectViaApi(`T8 Aggregata A ${stamp}`);
    const projectB = await createProjectViaApi(`T8 Aggregata B ${stamp}`);
    await createTaskViaApi(projectA.id, { title: `Task A-${stamp}` });
    await createTaskViaApi(projectB.id, { title: `Task B-${stamp}` });

    await loginViaUi(page);
    await page.locator(".sidebar-nav").getByRole("button", { name: "All projects", exact: true }).click();

    const cardA = page.locator(".task-card", { hasText: `Task A-${stamp}` });
    const cardB = page.locator(".task-card", { hasText: `Task B-${stamp}` });
    await expect(cardA).toBeVisible();
    await expect(cardB).toBeVisible();
    await expect(cardA.locator(".badge-project")).toHaveText(projectA.name);
    await expect(cardB.locator(".badge-project")).toHaveText(projectB.name);
  });

  test("creazione e revoca token MCP dalla UI (ProjectSettingsModal)", async ({ page }) => {
    const project = await createProjectViaApi(`T8 Token ${Date.now()}`);

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await page.getByRole("button", { name: `Project settings ${project.name}`, exact: true }).click();

    const modal = page.locator(".settings-modal");
    await expect(modal).toBeVisible();

    await modal.getByPlaceholder("Label (optional)").fill("token-ui-e2e");
    await modal.getByRole("button", { name: "New token" }).click();

    const revealedCode = modal.locator(".token-reveal code");
    await expect(revealedCode).toBeVisible();
    const token = await revealedCode.textContent();
    expect(token).toBeTruthy();

    // Il token funziona via MCP prima della revoca
    const beforeRevoke = await callMcpTool(token!.trim(), "get_board", {});
    expect(beforeRevoke.status).toBe(200);

    await modal.getByRole("button", { name: "I've copied the token, close" }).click();

    await expect(modal.locator(".drawer-list li", { hasText: "token-ui-e2e" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await modal.locator(".drawer-list li", { hasText: "token-ui-e2e" }).getByRole("button", { name: "Revoke" }).click();
    await expect(modal.locator(".drawer-list li", { hasText: "token-ui-e2e" }).locator(".token-revoked")).toBeVisible({
      timeout: 10_000,
    });

    // Dopo la revoca, la chiamata MCP con lo stesso token fallisce con 401
    const afterRevoke = await callMcpTool(token!.trim(), "get_board", {});
    expect(afterRevoke.status).toBe(401);
  });
});

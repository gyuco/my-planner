import { test, expect } from "@playwright/test";
import { API_BASE, createProjectViaApi, createTaskViaApi, getJwt, loginViaUi, selectProjectInSidebar } from "./helpers";

const CHECKLIST = [
  "Intro",
  "",
  "- [x] Prima voce spuntata con un testo abbastanza lungo da andare a capo su mobile",
  "- [ ] Seconda voce da fare, anche questa con un testo lungo che occupa piu' righe",
  "- [ ] Terza voce breve",
  "",
  "Altro:",
  "",
  "- elemento di lista normale",
].join("\n");

test.describe("T20 - task list markdown (mobile 375)", () => {
  test("checklist senza pallino, checkbox piccola in riga, testo con rientro", async ({ page }) => {
    const project = await createProjectViaApi(`T20 Checklist ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Task checklist", description: CHECKLIST });
    const token = await getJwt();
    const res = await fetch(`${API_BASE}/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: "- [x] Commento spuntato con testo lungo che va a capo\n- [ ] Commento da fare" }),
    });
    expect(res.ok).toBeTruthy();

    await loginViaUi(page);
    await page.locator(".sidebar-toggle").click();
    await selectProjectInSidebar(page, project.name);
    await page.locator(".task-card", { hasText: task.title }).click();

    const preview = page.locator(".drawer-description-preview");
    await expect(preview.locator("ul.contains-task-list")).toHaveCount(1);
    const items = preview.locator("li.task-list-item");
    await expect(items).toHaveCount(3);
    await expect(items.first()).toHaveClass(/is-checked/);
    await expect(items.first()).toHaveCSS("list-style-type", "none");

    const checkbox = items.nth(1).locator("input.task-list-checkbox");
    await expect(checkbox).toBeDisabled();
    const cbBox = (await checkbox.boundingBox())!;
    const textBox = (await items.nth(1).locator(".task-list-text").boundingBox())!;
    expect(cbBox.width).toBeLessThanOrEqual(18);
    // Checkbox a sinistra del testo, sulla stessa prima riga.
    expect(cbBox.x + cbBox.width).toBeLessThanOrEqual(textBox.x);
    expect(Math.abs(cbBox.y - textBox.y)).toBeLessThan(12);

    // Lista normale invariata: pallino presente.
    await expect(preview.locator("ul:not(.contains-task-list) > li")).toHaveCSS("list-style-type", "disc");

    // Anche nei commenti.
    await expect(page.locator(".comment-body li.task-list-item")).toHaveCount(2);
  });
});

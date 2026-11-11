import { test, expect } from "@playwright/test";
import { API_BASE, createProjectViaApi, createTaskViaApi, getJwt, loginViaUi, selectProjectInSidebar } from "./helpers";

async function api(path: string, init: RequestInit = {}) {
  const token = await getJwt();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} fallita: ${res.status}`);
  return res.json();
}

async function toTesting(taskId: string) {
  for (const status of ["todo", "in_progress", "testing"]) {
    await api(`/tasks/${taskId}/move`, { method: "POST", body: JSON.stringify({ status }) });
  }
}

test.describe("T14 - revisione in Testing e archivio completati", () => {
  test("Done chiude la card, Rimetti in corso salva il commento, la tabella elenca i completati", async ({ page }) => {
    const project = await createProjectViaApi(`T14 Review ${Date.now()}`);
    const ok = await createTaskViaApi(project.id, { title: "Task approvato" });
    const ko = await createTaskViaApi(project.id, { title: "Task respinto" });
    await createTaskViaApi(project.id, { title: "Task in bozza" });
    await toTesting(ok.id);
    await toTesting(ko.id);

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);

    // Niente colonna Done; i pulsanti di revisione solo sulle card in Testing.
    await expect(page.locator(".column")).toHaveCount(4);
    await expect(page.locator(".column-status-done")).toHaveCount(0);
    const testing = page.locator(".column", { hasText: "Testing" });
    const draftCard = page.locator(".task-card", { hasText: "Task in bozza" });
    await expect(draftCard.getByRole("button", { name: "Done" })).toHaveCount(0);
    const doneToggle = page.locator(".done-toggle");
    await expect(doneToggle).toContainText("0");

    // Done: la card esce con l'animazione e finisce tra i completati.
    const okCard = testing.locator(".task-card", { hasText: "Task approvato" });
    await okCard.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".task-card", { hasText: "Task approvato" })).toHaveCount(0);
    await expect(doneToggle).toContainText("1");
    expect((await api(`/tasks/${ok.id}`)).status).toBe("done");

    // Rimetti in corso: messaggio obbligatorio, salvato come commento.
    const koCard = testing.locator(".task-card", { hasText: "Task respinto" });
    await koCard.getByRole("button", { name: "Back to in progress" }).click();
    const dialog = page.getByRole("dialog", { name: "Send back to In progress" });
    await expect(dialog.getByRole("button", { name: "Send back" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("Il login fallisce su Safari");
    await dialog.getByRole("button", { name: "Send back" }).click();
    await expect(dialog).toHaveCount(0);
    const inProgress = page.locator(".column", { hasText: "In progress" });
    await expect(inProgress.locator(".task-card", { hasText: "Task respinto" })).toBeVisible();
    const comments = await api(`/tasks/${ko.id}/comments`);
    expect(comments.map((c: { body: string }) => c.body)).toContain("Il login fallisce su Safari");

    // Tabella completati: riga cliccabile che apre il drawer del task.
    await doneToggle.click();
    const table = page.getByRole("dialog", { name: /Completed tasks/ });
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.locator("tbody tr")).toContainText("Task approvato");
    await table.locator("tbody tr").click();
    await expect(table).toHaveCount(0);
    await expect(page.locator(".drawer input").first()).toHaveValue("Task approvato");
  });
});

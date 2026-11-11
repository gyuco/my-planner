import { test, expect, type Page } from "@playwright/test";
import { API_BASE, createProjectViaApi, createTaskViaApi, getJwt, loginViaUi, selectProjectInSidebar } from "./helpers";

// PNG 40x20 (meta' verde, meta' ocra): non quadrato, per esercitare il ritaglio.
const WIDE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAKUlEQVR4nGPQj/UiGx2aoE82Yhi1eNTiUYtHLR61eNTiUYtHLR45FgMAOyqoHtYnSxMAAAAASUVORK5CYII=",
  "base64",
);

async function pickAvatarFile(page: Page) {
  await page.locator('.profile-avatar-actions input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: WIDE_PNG,
  });
}

test.describe("T12 - avatar utente", () => {
  test("ritaglia, carica, mostra in topbar/profilo/card, persiste e si rimuove", async ({ page }) => {
    // Task assegnato all'utente bootstrap: la card deve mostrare la sua foto.
    const token = await getJwt();
    const me = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const project = await createProjectViaApi(`T12 Avatar ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Task con avatar", assigneeId: me.id });

    await loginViaUi(page);
    await page.goto("/profile");
    const profileAvatar = page.locator(".profile-avatar");
    await expect(profileAvatar.locator("img")).toHaveCount(0);

    // Annulla: la modale si chiude senza salvare.
    await pickAvatarFile(page);
    const crop = page.getByRole("dialog", { name: "Crop photo" });
    await expect(crop).toBeVisible();
    await crop.getByRole("button", { name: "Cancel" }).click();
    await expect(crop).toHaveCount(0);
    await expect(profileAvatar.locator("img")).toHaveCount(0);

    // Ritaglio: zoom + trascinamento, poi salvataggio.
    await pickAvatarFile(page);
    await expect(crop).toBeVisible();
    await crop.getByRole("slider", { name: "Zoom" }).fill("2");
    const box = (await crop.locator(".avatar-crop-viewport").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await crop.getByRole("button", { name: "Save photo" }).click();
    await expect(crop).toHaveCount(0);

    await expect(profileAvatar.locator("img.avatar-img")).toBeVisible();
    await expect(page.locator(".topbar-avatar img.avatar-img")).toBeVisible();
    const src = await profileAvatar.locator("img").getAttribute("src");
    expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);

    // Card dell'assegnatario.
    await page.goto("/");
    await selectProjectInSidebar(page, project.name);
    const card = page.locator(".task-card", { hasText: "Task con avatar" });
    await expect(card.locator(".task-card-assignee img.avatar-img")).toBeVisible();

    // Persistenza dopo reload, poi rimozione.
    await page.goto("/profile");
    await page.reload();
    await expect(page.locator(".topbar-avatar img.avatar-img")).toBeVisible();
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.locator(".profile-avatar img")).toHaveCount(0);
    await expect(page.locator(".topbar-avatar img")).toHaveCount(0);
  });

  test("rifiuta file non immagine", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/profile");
    await page.locator('.profile-avatar-actions input[type="file"]').setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ciao"),
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".profile-avatar-actions + .login-error")).toHaveText(
      "Choose a PNG, JPEG or WebP image",
    );
  });
});

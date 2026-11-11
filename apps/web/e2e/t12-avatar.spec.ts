import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers";

// PNG 8x8 rosso pieno, generato una volta: basta a createImageBitmap/canvas.
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
  "base64",
);

test.describe("T12 - avatar utente", () => {
  test("carica, mostra in topbar/profilo, persiste al reload e si rimuove", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/profile");

    const topbarAvatar = page.locator(".topbar-avatar");
    const profileAvatar = page.locator(".profile-avatar");
    await expect(profileAvatar.locator("img")).toHaveCount(0);

    await page.locator('.profile-avatar-actions input[type="file"]').setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: RED_PNG,
    });

    await expect(profileAvatar.locator("img.avatar-img")).toBeVisible();
    await expect(topbarAvatar.locator("img.avatar-img")).toBeVisible();
    const src = await profileAvatar.locator("img").getAttribute("src");
    expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);

    // Persistenza: dopo il reload l'avatar arriva da GET /auth/me/avatar.
    await page.reload();
    await expect(page.locator(".topbar-avatar img.avatar-img")).toBeVisible();

    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.locator(".profile-avatar img")).toHaveCount(0);
    await expect(page.locator(".topbar-avatar img")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
  });

  test("rifiuta file non immagine", async ({ page }) => {
    await loginViaUi(page);
    await page.goto("/profile");
    await page.locator('.profile-avatar-actions input[type="file"]').setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ciao"),
    });
    await expect(page.locator(".profile-avatar-actions + .login-error")).toHaveText(
      "Choose a PNG, JPEG or WebP image",
    );
  });
});

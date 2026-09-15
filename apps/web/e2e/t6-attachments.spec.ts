import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3_BASE_URL, E2E_BOOTSTRAP_PASSWORD, E2E_BOOTSTRAP_USERNAME } from "../playwright.config";
import { createProjectViaApi, createTaskViaApi, loginViaUi, selectProjectInSidebar, API_BASE_S3 } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, ".fixtures");
const fixtureFile = path.join(fixturesDir, "e2e-attachment.txt");

test.beforeAll(() => {
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(fixtureFile, `contenuto di test e2e - ${Date.now()}\n`);
});

test.afterAll(() => {
  rmSync(fixturesDir, { recursive: true, force: true });
});

async function uploadAndDownload(
  page: import("@playwright/test").Page,
  project: { id: string; name: string },
  apiBase?: string,
) {
  const task = await createTaskViaApi(project.id, { title: "Task con allegato" }, apiBase);

  await selectProjectInSidebar(page, project.name);
  await expect(page.locator(".topbar h1")).toHaveText(project.name);
  // Il task e' stato creato via API dopo il caricamento iniziale della board
  // (gia' avvenuto al login): un reload + riselezione esplicita del
  // progetto forza un fetch fresco cosi' che la card compaia (il reload da
  // solo non basta quando ci sono altri progetti creati prima nella suite,
  // dato che dopo reload l'app riseleziona di default il primo progetto).
  await page.reload();
  await selectProjectInSidebar(page, project.name);
  await expect(page.locator(".topbar h1")).toHaveText(project.name);

  const card = page.locator(".task-card", { hasText: "Task con allegato" });
  await card.click();
  const drawer = page.locator(".drawer");
  await expect(drawer).toBeVisible();

  const fileInput = drawer.locator('input[type="file"]');
  await fileInput.setInputFiles(fixtureFile);

  await expect(drawer.locator(".drawer-list li", { hasText: "e2e-attachment.txt" })).toBeVisible({
    timeout: 15_000,
  });

  const downloadPromise = page.waitForEvent("download");
  await drawer.locator(".drawer-list li", { hasText: "e2e-attachment.txt" }).getByRole("button", { name: "Scarica" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("e2e-attachment.txt");

  return task;
}

test.describe("T6 - allegati locale e S3", () => {
  test("upload/download con storage locale", async ({ page }) => {
    const project = await createProjectViaApi(`T6 Local ${Date.now()}`);
    await loginViaUi(page);
    await uploadAndDownload(page, project);
  });

  test("upload/download con storage S3 (MinIO)", async ({ page }) => {
    test.skip(process.env.E2E_S3 !== "1", "E2E_S3=1 richiesto (backend s3 + MinIO via docker-compose, vedi playwright.config.ts)");

    // Verifica preliminare che il backend s3 e2e sia effettivamente su, per un errore chiaro
    const health = await fetch(`${API_BASE_S3}/health`).catch(() => null);
    if (!health || !health.ok) {
      test.skip(true, "Backend e2e s3 (porta 3051) non raggiungibile");
    }

    const project = await createProjectViaApi(`T6 S3 ${Date.now()}`, API_BASE_S3);

    await page.goto(S3_BASE_URL);
    await page.getByLabel("Username").fill(E2E_BOOTSTRAP_USERNAME);
    await page.getByLabel("Password").fill(E2E_BOOTSTRAP_PASSWORD);
    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page.locator(".sidebar-header")).toBeVisible();

    await uploadAndDownload(page, project, API_BASE_S3);
  });
});

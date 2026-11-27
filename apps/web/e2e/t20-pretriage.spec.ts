import { test, expect } from "@playwright/test";
import { API_BASE, createProjectViaApi, createTaskViaApi, getJwt, loginViaUi, selectProjectInSidebar } from "./helpers";

/**
 * T20 - Pre-triage con Gemini dal drawer del task.
 *
 * Senza rete esterna: il pulsante compare solo se il pre-triage e' attivo
 * (impostazioni Gemini con chiave finta); la chiamata POST /tasks/:id/pretriage
 * e' intercettata nel browser, che riceve un esito simulato mentre il commento
 * viene creato davvero tramite l'API dei commenti (come fa il server).
 */

async function putGeminiSettings(body: Record<string, unknown>) {
  const token = await getJwt();
  const res = await fetch(`${API_BASE}/settings/voice`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`impostazioni Gemini: ${res.status} ${await res.text()}`);
}

test.describe("T20 - pre-triage del task", () => {
  test.afterAll(async () => {
    await putGeminiSettings({ enabled: false, pretriageEnabled: false, removeApiKey: true });
  });

  test("il pulsante compare solo col pre-triage attivo; l'esito arriva come commento", async ({ page }) => {
    await putGeminiSettings({ enabled: false, pretriageEnabled: false, removeApiKey: true });
    const project = await createProjectViaApi(`T20 Pretriage ${Date.now()}`);
    const task = await createTaskViaApi(project.id, { title: "Ticket da valutare", description: "Login lento" });

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await page.locator(".task-card", { hasText: "Ticket da valutare" }).click();
    const drawer = page.locator(".drawer");
    await expect(drawer.locator(".drawer-description")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Pre-triage" })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close" }).first().click();

    // Attivo anche con l'assistente vocale spento, basta la chiave.
    await putGeminiSettings({
      enabled: false,
      apiKey: "AIzaSyE2E-fake-key-0123456789abcdef",
      pretriageEnabled: true,
    });

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/tasks/*/pretriage", async (route) => {
      await gate;
      const token = await getJwt();
      const res = await fetch(`${API_BASE}/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: "### Pre-triage (Gemini · test)\n\n⚠️ **Da completare**" }),
      });
      const comment = await res.json();
      await route.fulfill({
        json: {
          result: {
            ready: false,
            missing: [],
            ambiguities: [],
            suggestedPriority: null,
            suggestedComplexity: null,
            possibleDuplicates: [],
            summary: "",
            model: "test",
          },
          comment,
        },
      });
    });

    await page.locator(".task-card", { hasText: "Ticket da valutare" }).click();
    const button = drawer.getByRole("button", { name: "Pre-triage" });
    await expect(button).toBeVisible();
    await button.click();

    const running = drawer.locator(".drawer-pretriage-button");
    await expect(running).toContainText("Analyzing...");
    await expect(running).toBeDisabled();
    release();

    await expect(page.locator(".toast-message", { hasText: "Pre-triage added to the comments" })).toBeVisible();
    await expect(drawer.locator(".drawer-comments")).toContainText("Pre-triage (Gemini · test)");
    await expect(drawer.getByRole("button", { name: "Pre-triage" })).toBeEnabled();
  });

  test("quota esaurita: messaggio d'errore", async ({ page }) => {
    await putGeminiSettings({
      enabled: false,
      apiKey: "AIzaSyE2E-fake-key-0123456789abcdef",
      pretriageEnabled: true,
    });
    const project = await createProjectViaApi(`T20 Quota ${Date.now()}`);
    await createTaskViaApi(project.id, { title: "Ticket quota" });
    await page.route("**/tasks/*/pretriage", (route) =>
      route.fulfill({
        status: 429,
        json: {
          error: { code: "PRETRIAGE_QUOTA", message: "Quota gratuita di Gemini esaurita per oggi, riprova piu' tardi" },
        },
      }),
    );

    await loginViaUi(page);
    await selectProjectInSidebar(page, project.name);
    await page.locator(".task-card", { hasText: "Ticket quota" }).click();
    await page.locator(".drawer").getByRole("button", { name: "Pre-triage" }).click();
    await expect(page.locator(".toast-message", { hasText: "Quota gratuita di Gemini esaurita" })).toBeVisible();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { setBackgroundRunner, setSmtpSocketFactory } from "../lib/email/provider.js";
import { setSecretKeyProvider } from "../lib/secretBox.js";
import { addComment, createProject, createTask } from "./taskService.js";
import { createUser } from "./userService.js";
import {
  getActiveEmailConfig,
  getEmailSettings,
  sendTestEmail,
  updateEmailSettings,
  type EmailSettingsInput,
} from "./emailSettingsService.js";
import type { Actor } from "./notificationService.js";
import { createFakeSmtp, decodeMimeBodies } from "../lib/email/fakeSmtp.js";

/**
 * Email di notifica: config SMTP cifrata, destinatari = chi vede la notifica
 * in-app, e soprattutto mai un errore che risalga alla mutazione.
 */

const smtpInput: EmailSettingsInput = {
  enabled: true,
  host: "smtp.example.com",
  port: 465,
  security: "tls",
  username: "bot@example.com",
  password: "app-password",
  fromAddress: "bot@example.com",
  fromName: "my-planner",
  appUrl: "https://planner.example.com/",
};

let background: Promise<unknown>[] = [];
const flush = () => Promise.all(background);

beforeEach(() => {
  background = [];
  setBackgroundRunner((task) => background.push(task));
});

afterEach(() => {
  setSmtpSocketFactory(null);
  setSecretKeyProvider(() => process.env.JWT_SECRET ?? null);
});

function userActor(account: UserAccount): Actor {
  return { type: "user", id: account.id };
}

async function createTestUser(email: string, role: "admin" | "manager" = "admin", projectIds: string[] = []) {
  return createUser({ email, password: "password123", role, firstName: "Test", lastName: email.split("@")[0], projectIds: role === "manager" ? projectIds : undefined });
}

describe("emailSettingsService", () => {
  it("restituisce default disattivati se non configurato", async () => {
    expect(await getEmailSettings()).toMatchObject({ enabled: false, configured: false, passwordSet: false });
  });

  it("salva la password cifrata e non la espone mai", async () => {
    const settings = await updateEmailSettings(smtpInput);
    expect(settings).toMatchObject({ configured: true, passwordSet: true, appUrl: "https://planner.example.com" });
    expect(JSON.stringify(settings)).not.toContain("app-password");

    const row = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.passwordEnc).toMatch(/^v1:/);
    expect(row.passwordEnc).not.toContain("app-password");
  });

  it("password vuota mantiene quella salvata, senza username viene rimossa", async () => {
    await updateEmailSettings(smtpInput);
    const before = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });

    await updateEmailSettings({ ...smtpInput, password: "" });
    const kept = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(kept.passwordEnc).toBe(before.passwordEnc);

    const cleared = await updateEmailSettings({ ...smtpInput, username: "", password: undefined });
    expect(cleared.passwordSet).toBe(false);
  });

  it("rifiuta config incomplete o insicure", async () => {
    await expect(updateEmailSettings({ ...smtpInput, host: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateEmailSettings({ ...smtpInput, password: undefined })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateEmailSettings({ ...smtpInput, security: "none" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateEmailSettings({ ...smtpInput, fromAddress: "x\r\n@y" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Disattivata si puo' salvare anche incompleta.
    await expect(updateEmailSettings({ ...smtpInput, enabled: false, host: "" })).resolves.toMatchObject({ enabled: false });
  });

  it("config non decifrabile (chiave cambiata) => nessun invio, nessun errore", async () => {
    setSmtpSocketFactory(createFakeSmtp().factory);
    await updateEmailSettings(smtpInput);
    setSecretKeyProvider(() => "chiave-diversa");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getActiveEmailConfig()).toBeNull();
    spy.mockRestore();
  });

  it("email di prova: usa la config salvata e mappa gli errori SMTP", async () => {
    await updateEmailSettings({ ...smtpInput, enabled: false });
    const smtp = createFakeSmtp();
    setSmtpSocketFactory(smtp.factory);
    await expect(sendTestEmail("admin@example.com")).resolves.toEqual({ ok: true, to: "admin@example.com" });
    expect(smtp.sessions[0].messages[0].to).toEqual(["admin@example.com"]);

    setSmtpSocketFactory(createFakeSmtp({ rejectAuth: true }).factory);
    await expect(sendTestEmail("admin@example.com")).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });
  });
});

describe("emailNotificationService", () => {
  it("senza config SMTP non invia nulla e la notifica in-app resta", async () => {
    const smtp = createFakeSmtp();
    setSmtpSocketFactory(smtp.factory);
    const author = await createTestUser("author@test.it");
    await createTestUser("other@test.it");
    const project = await createProject("Progetto");

    await createTask(project.id, { title: "Task" }, userActor(author));
    await flush();

    expect(background).toHaveLength(0);
    expect(smtp.connections).toHaveLength(0);
    expect(await prisma.taskEvent.count()).toBe(1);
  });

  it("con config disattivata non invia nulla", async () => {
    const smtp = createFakeSmtp();
    setSmtpSocketFactory(smtp.factory);
    await updateEmailSettings({ ...smtpInput, enabled: false });
    const author = await createTestUser("author@test.it");
    await createTestUser("other@test.it");
    const project = await createProject("Progetto");

    await createTask(project.id, { title: "Task" }, userActor(author));
    await flush();
    expect(smtp.connections).toHaveLength(0);
  });

  it("invia a chi vede la notifica: admin e manager del progetto, mai l'autore", async () => {
    const smtp = createFakeSmtp();
    setSmtpSocketFactory(smtp.factory);
    await updateEmailSettings(smtpInput);

    const project = await createProject("Alpha");
    const other = await createProject("Beta");
    const author = await createTestUser("author@test.it");
    await createTestUser("admin2@test.it");
    await createTestUser("manager@test.it", "manager", [project.id]);
    await createTestUser("outsider@test.it", "manager", [other.id]);

    await createTask(project.id, { title: "Nuovo task" }, userActor(author));
    await flush();

    const [session] = smtp.sessions;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].to.sort()).toEqual(["admin2@test.it", "manager@test.it"]);
    expect(smtp.connections[0]).toEqual({ host: "smtp.example.com", port: 465, security: "tls" });

    const body = decodeMimeBodies(session.messages[0].data);
    expect(body).toContain('Test author ha creato il task "Nuovo task"');
    expect(body).toContain("https://planner.example.com");
  });

  it("include l'estratto del commento, con HTML escapato", async () => {
    const smtp = createFakeSmtp();
    setSmtpSocketFactory(smtp.factory);
    await updateEmailSettings(smtpInput);
    const author = await createTestUser("author@test.it");
    await createTestUser("other@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Task" });
    await flush();
    background = [];

    await addComment(task.id, "<script>x</script> ciao", userActor(author));
    await flush();

    const last = smtp.sessions.at(-1)!.messages[0];
    const body = decodeMimeBodies(last.data);
    expect(body).toContain("&lt;script&gt;x&lt;/script&gt; ciao");
    // La parte text/plain resta testuale, solo l'HTML va escapato.
    expect(body).not.toMatch(/<blockquote[^>]*><script>/);
  });

  it("un SMTP irraggiungibile non fa fallire la mutazione né la notifica", async () => {
    const smtp = createFakeSmtp({ failConnect: true });
    setSmtpSocketFactory(smtp.factory);
    await updateEmailSettings(smtpInput);
    const author = await createTestUser("author@test.it");
    await createTestUser("other@test.it");
    const project = await createProject("Progetto");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const task = await createTask(project.id, { title: "Resiste" }, userActor(author));
    await flush();

    expect(task.title).toBe("Resiste");
    expect(smtp.connections).toHaveLength(1);
    expect(await prisma.taskEvent.count()).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("invio email di notifica fallito"), expect.any(Error));
    spy.mockRestore();
  });
});

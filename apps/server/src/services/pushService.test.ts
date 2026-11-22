import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { setBackgroundRunner } from "../lib/email/provider.js";
import { base64UrlEncode } from "../lib/webpush.js";
import { createProject, createTask, moveTask, setTaskAi, updateTask, archiveProject } from "./taskService.js";
import { createUser } from "./userService.js";
import { aiFinalStatus, getVapidKeys, listDevices, removeDevice, sendTestPush, subscribeDevice } from "./pushService.js";

/**
 * Notifiche push: dispositivi, chiavi VAPID e regole di invio. Il push
 * service e' simulato con uno stub di fetch; i messaggi vengono decifrati
 * come farebbe il browser (node:crypto) per controllarne il testo.
 */

interface FakeDevice {
  endpoint: string;
  ecdh: ReturnType<typeof createECDH>;
  auth: Buffer;
}

const devices = new Map<string, FakeDevice>();
let pushes: { endpoint: string; message: any }[] = [];
let goneEndpoints = new Set<string>();
let pending: Promise<unknown>[] = [];

function decrypt(body: Uint8Array, device: FakeDevice) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  const shared = device.ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, device.auth, Buffer.concat([Buffer.from("WebPush: info\0"), device.ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
}

async function registerDevice(userId: string, locale = "it") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(6).toString("hex")}`;
  devices.set(endpoint, { endpoint, ecdh, auth });
  return subscribeDevice(userId, {
    endpoint,
    keys: { p256dh: base64UrlEncode(ecdh.getPublicKey()), auth: base64UrlEncode(auth) },
    locale,
    label: "Chrome test",
  });
}

async function flush() {
  // Le push partono in background (dopo la risposta): le attendiamo tutte.
  while (pending.length > 0) {
    const batch = pending;
    pending = [];
    await Promise.all(batch);
  }
}

function pushesFor(userEndpoints: string[]) {
  return pushes.filter((p) => userEndpoints.includes(p.endpoint)).map((p) => p.message);
}

beforeEach(() => {
  devices.clear();
  pushes = [];
  goneEndpoints = new Set();
  pending = [];
  setBackgroundRunner((task) => {
    pending.push(task);
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const device = devices.get(url);
    if (!device) throw new Error(`fetch inatteso: ${url}`);
    if (goneEndpoints.has(url)) return new Response(null, { status: 410 });
    pushes.push({ endpoint: url, message: decrypt(init.body as Uint8Array, device) });
    return new Response(null, { status: 201 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const project = await createProject("Clinica");
  const admin = await createUser({ email: "admin@test.it", password: "password123", role: "admin", firstName: "Ada" });
  const dev = await createUser({ email: "dev@test.it", password: "password123", role: "manager", projectIds: [project.id], firstName: "Dario" });
  const task = await createTask(project.id, { title: "Login rotto", assigneeId: dev.id });
  await flush();
  return { project, admin, dev, task };
}

describe("pushService — chiavi e dispositivi", () => {
  it("le chiavi VAPID sono generate una volta e la privata e' cifrata", async () => {
    await createUser({ email: "boss@test.it", password: "password123", role: "admin" });
    const a = await getVapidKeys();
    const b = await getVapidKeys();
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.subject).toBe("mailto:boss@test.it");
    const row = await prisma.pushSettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.privateKeyEncrypted.startsWith("v1:")).toBe(true);
    expect(row.privateKeyEncrypted).not.toContain(String(a.privateKeyJwk.d));
  });

  it("registra, elenca e rimuove; endpoint non supportati rifiutati; lo stesso browser passa all'ultimo utente", async () => {
    const { admin, dev } = await setup();
    const device = await registerDevice(admin.id);
    expect(device).toMatchObject({ label: "Chrome test", locale: "it", service: "fcm.googleapis.com" });
    expect(await listDevices(admin.id)).toHaveLength(1);

    await expect(
      subscribeDevice(admin.id, { endpoint: "https://evil.example.com/x", keys: { p256dh: "a", auth: "b" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const endpoint = [...devices.keys()][0];
    const d = devices.get(endpoint)!;
    await subscribeDevice(dev.id, { endpoint, keys: { p256dh: base64UrlEncode(d.ecdh.getPublicKey()), auth: base64UrlEncode(d.auth) } });
    expect(await listDevices(admin.id)).toHaveLength(0);
    expect(await listDevices(dev.id)).toHaveLength(1);

    await expect(removeDevice(admin.id, device.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await removeDevice(dev.id, device.id);
    expect(await listDevices(dev.id)).toHaveLength(0);
  });

  it("notifica di prova nella lingua del dispositivo; i dispositivi scaduti (410) vengono rimossi", async () => {
    const { admin } = await setup();
    await registerDevice(admin.id, "en");
    const gone = await registerDevice(admin.id, "it");
    goneEndpoints.add([...devices.keys()][1]);

    expect(await sendTestPush(admin.id)).toEqual({ sent: 1, failed: 1 });
    expect(pushes[0].message).toMatchObject({ title: "Notifications on", url: "/profile" });
    expect((await listDevices(admin.id)).map((d) => d.id)).not.toContain(gone.id);
  });
});

describe("pushService — regole di invio", () => {
  it("l'assegnatario riceve le stesse notifiche della campanella, mai per le proprie azioni", async () => {
    const { admin, dev, task } = await setup();
    await registerDevice(dev.id);
    const devEndpoints = [...devices.keys()];

    await moveTask(task.id, "todo", undefined, { type: "user", id: admin.id });
    await flush();
    expect(pushesFor(devEndpoints)).toEqual([
      { title: "Clinica", body: "Ada ha spostato «Login rotto» da Draft a TODO", url: `/projects/${task.projectId}?task=${task.id}`, tag: `task-${task.id}` },
    ]);

    await moveTask(task.id, "in_progress", undefined, { type: "user", id: dev.id });
    await updateTask(task.id, { title: "Login rotto (Google)" }, { type: "user", id: admin.id }); // task.updated: non notificabile
    await flush();
    expect(pushesFor(devEndpoints)).toHaveLength(1);
  });

  it("AI 'a ogni cambio': l'admin che la segue riceve ogni spostamento (l'ultimo come fine), ma non i propri", async () => {
    const { admin, task } = await setup();
    await setTaskAi(task.id, { enabled: true, steps: ["triage", "coder"], notify: "each" }, admin.id);
    await registerDevice(admin.id);
    const adminEndpoints = [...devices.keys()];

    await moveTask(task.id, "todo", undefined, { type: "mcp" });
    await moveTask(task.id, "testing", undefined, { type: "mcp" });
    await moveTask(task.id, "todo", undefined, { type: "user", id: admin.id });
    await flush();
    const msgs = pushesFor(adminEndpoints);
    expect(msgs.map((m) => m.body)).toEqual([
      "Un agente AI ha spostato «Login rotto» da Draft a TODO",
      "«Login rotto» è ora in Testing",
    ]);
    expect(msgs.map((m) => m.title)).toEqual(["AI · Clinica", "AI completata · Clinica"]);
  });

  it("AI 'alla fine': una sola push quando il task arriva alla colonna finale dell'ultimo passo", async () => {
    const { admin, task } = await setup();
    await setTaskAi(task.id, { enabled: true, steps: ["triage", "coder", "reviewer"], notify: "end" }, admin.id);
    await registerDevice(admin.id, "es");
    const adminEndpoints = [...devices.keys()];

    for (const status of ["todo", "testing", "todo", "testing", "done"]) {
      await moveTask(task.id, status, undefined, { type: "mcp" });
    }
    await flush();
    expect(pushesFor(adminEndpoints)).toEqual([
      { title: "IA completada · Clinica", body: "«Login rotto» ahora está en Hecho", url: `/projects/${task.projectId}?task=${task.id}`, tag: `task-${task.id}` },
    ]);
    expect(aiFinalStatus(["triage"])).toBe("todo");
    expect(aiFinalStatus(["triage", "coder"])).toBe("testing");
    expect(aiFinalStatus([])).toBeNull();
  });

  it("chi segue l'AI ed e' anche assegnatario riceve una sola push; 'mai' non invia nulla all'admin", async () => {
    const { admin, dev, task } = await setup();
    await updateTask(task.id, { assigneeId: admin.id }, { type: "user", id: dev.id });
    await setTaskAi(task.id, { enabled: true, steps: ["triage"], notify: "end" }, admin.id);
    await registerDevice(admin.id);
    const adminEndpoints = [...devices.keys()];
    await flush();
    pushes = [];

    await moveTask(task.id, "todo", undefined, { type: "mcp" });
    await flush();
    expect(pushesFor(adminEndpoints).map((m) => m.title)).toEqual(["AI completata · Clinica"]);

    await setTaskAi(task.id, { enabled: true, steps: ["triage"], notify: "none" }, admin.id);
    await updateTask(task.id, { assigneeId: dev.id }, { type: "user", id: admin.id });
    await moveTask(task.id, "draft", undefined, { type: "mcp" });
    await moveTask(task.id, "todo", undefined, { type: "mcp" });
    await flush();
    expect(pushesFor(adminEndpoints)).toHaveLength(1);
  });

  it("progetti archiviati e utenti senza piu' accesso non ricevono push", async () => {
    const { admin, dev, project, task } = await setup();
    await registerDevice(dev.id);
    await archiveProject(project.id);
    await moveTask(task.id, "todo", undefined, { type: "user", id: admin.id });
    await flush();
    expect(pushes).toHaveLength(0);
  });
});

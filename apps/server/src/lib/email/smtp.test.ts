import { describe, expect, it } from "vitest";
import { sendMail, type SmtpConfig } from "./smtp.js";
import { createFakeSmtp, decodeMimeBodies } from "./fakeSmtp.js";

const base: SmtpConfig = {
  host: "smtp.example.com",
  port: 465,
  security: "tls",
  username: "bot@example.com",
  password: "secret",
  fromAddress: "bot@example.com",
  fromName: "my-planner",
};

describe("sendMail", () => {
  it("autentica, invia a tutti i destinatari e chiude la connessione", async () => {
    const smtp = createFakeSmtp();
    await sendMail(smtp.factory, base, { to: ["a@example.com", "b@example.com"], subject: "Ciao", text: "corpo", html: "<p>corpo</p>" });

    const [session] = smtp.sessions;
    expect(session.commands).toContain("AUTH LOGIN");
    expect(session.commands).toContain(Buffer.from("secret").toString("base64"));
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].to).toEqual(["a@example.com", "b@example.com"]);
    // Destinatari multipli: nessuno vede gli altri indirizzi.
    expect(session.messages[0].data).toContain("To: undisclosed-recipients:;");
    expect(decodeMimeBodies(session.messages[0].data)).toContain("<p>corpo</p>");
    expect(session.closed).toBe(true);
  });

  it("fa l'upgrade STARTTLS prima dell'autenticazione", async () => {
    const smtp = createFakeSmtp();
    await sendMail(smtp.factory, { ...base, port: 587, security: "starttls" }, { to: ["a@example.com"], subject: "s", text: "t" });

    const { commands, startTlsCount } = smtp.sessions[0];
    expect(startTlsCount).toBe(1);
    expect(commands.indexOf("STARTTLS")).toBeLessThan(commands.indexOf("AUTH LOGIN"));
    expect(commands.filter((c) => c.startsWith("EHLO"))).toHaveLength(2);
  });

  it("rifiuta credenziali senza TLS", async () => {
    const smtp = createFakeSmtp();
    await expect(
      sendMail(smtp.factory, { ...base, security: "none" }, { to: ["a@example.com"], subject: "s", text: "t" }),
    ).rejects.toThrow(/TLS/);
    expect(smtp.connections).toHaveLength(0);
  });

  it("propaga l'errore di autenticazione", async () => {
    const smtp = createFakeSmtp({ rejectAuth: true });
    await expect(sendMail(smtp.factory, base, { to: ["a@example.com"], subject: "s", text: "t" })).rejects.toThrow(/535/);
    expect(smtp.sessions[0].closed).toBe(true);
  });

  it("un destinatario rifiutato non blocca gli altri", async () => {
    const smtp = createFakeSmtp({ rejectRcpt: ["bad@example.com"] });
    await sendMail(smtp.factory, base, { to: ["bad@example.com", "ok@example.com"], subject: "s", text: "t" });
    expect(smtp.sessions[0].messages[0].to).toEqual(["ok@example.com"]);
  });

  it("neutralizza CR/LF negli header e scarta indirizzi pericolosi", async () => {
    const smtp = createFakeSmtp();
    await sendMail(smtp.factory, base, {
      to: ["evil@example.com>\r\nRCPT TO:<x@example.com", "ok@example.com"],
      subject: "Titolo\r\nBcc: spia@example.com",
      text: "t",
    });
    const { commands, messages } = smtp.sessions[0];
    expect(commands.filter((c) => c.startsWith("RCPT TO"))).toEqual(["RCPT TO:<ok@example.com>"]);
    expect(messages[0].data).not.toMatch(/^Bcc:/m);
  });

  it("va in timeout se il server non risponde", async () => {
    let closed = false;
    const hanging = async () => ({
      read: () => new Promise<Uint8Array | null>(() => undefined),
      write: async () => undefined,
      startTls: async () => {
        throw new Error("n/a");
      },
      close: async () => {
        closed = true;
      },
    });
    await expect(sendMail(hanging, base, { to: ["a@example.com"], subject: "s", text: "t" }, 50)).rejects.toThrow(/Timeout/);
    expect(closed).toBe(true);
  });
});

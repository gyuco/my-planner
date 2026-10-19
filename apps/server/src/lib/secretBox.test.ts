import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, setSecretKeyProvider } from "./secretBox.js";

const defaultProvider = () => process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || null;

describe("secretBox", () => {
  afterEach(() => setSecretKeyProvider(defaultProvider));

  it("cifra e decifra senza lasciare il segreto in chiaro", async () => {
    const stored = await encryptSecret("app-password-123");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("app-password-123");
    expect(await decryptSecret(stored)).toBe("app-password-123");
  });

  it("usa un IV diverso ad ogni cifratura", async () => {
    expect(await encryptSecret("x")).not.toBe(await encryptSecret("x"));
  });

  it("fallisce se la chiave cambia o il dato e' manomesso", async () => {
    const stored = await encryptSecret("segreto");
    setSecretKeyProvider(() => "un-altra-chiave");
    await expect(decryptSecret(stored)).rejects.toThrow();

    setSecretKeyProvider(defaultProvider);
    const [v, iv, ct] = stored.split(":");
    const tampered = `${v}:${iv}:${ct.slice(0, -4)}AAAA`;
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });
});

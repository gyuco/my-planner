import { describe, it, expect, vi } from "vitest";

vi.mock("../../services/storageSettingsService.js", () => ({
  getInternalStorageSettings: vi.fn(),
}));

const { getInternalStorageSettings } = await import("../../services/storageSettingsService.js");
const { getAttachmentStorage } = await import("./index.js");

function baseSettings(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "singleton",
    backend: "local",
    localDir: "./attachments/local",
    s3Endpoint: null,
    s3Bucket: null,
    s3Region: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getAttachmentStorage", () => {
  it("seleziona il backend locale quando configurato in DB", async () => {
    vi.mocked(getInternalStorageSettings).mockResolvedValue(baseSettings({ backend: "local" }) as any);
    const storage = await getAttachmentStorage();
    const result = await storage.getUrl("some/ref", { id: "a1", fileName: "f.txt", mimeType: "text/plain" });
    expect(result.expiresAt).toBeNull();
  });

  it("seleziona il backend s3 quando configurato in DB", async () => {
    vi.mocked(getInternalStorageSettings).mockResolvedValue(
      baseSettings({ backend: "s3", s3Bucket: "my-bucket" }) as any
    );
    const storage = await getAttachmentStorage();
    // Il backend s3 firma un URL invece di puntare alla route MCP locale.
    const result = await storage.getUrl("task1/ref", { id: "a1", fileName: "f.txt", mimeType: "text/plain" });
    expect(result.url).not.toContain("/mcp/attachments/");
    expect(result.expiresAt).not.toBeNull();
  });

  it("ricade sul backend locale per un valore sconosciuto", async () => {
    vi.mocked(getInternalStorageSettings).mockResolvedValue(baseSettings({ backend: "azure" }) as any);
    const storage = await getAttachmentStorage();
    const result = await storage.getUrl("some/ref", { id: "a1", fileName: "f.txt", mimeType: "text/plain" });
    expect(result.expiresAt).toBeNull();
  });
});

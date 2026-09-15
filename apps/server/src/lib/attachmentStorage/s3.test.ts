import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class S3Client {
    send = sendMock;
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

const getSignedUrlMock = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

// Import dopo i mock, cosi' s3.ts riceve i moduli mockati.
const { createS3AttachmentStorage } = await import("./s3.js");

const s3AttachmentStorage = createS3AttachmentStorage({
  bucket: "test-bucket",
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  accessKeyId: "test",
  secretAccessKey: "test",
});

describe("s3AttachmentStorage", () => {
  beforeEach(() => {
    sendMock.mockReset();
    getSignedUrlMock.mockReset();
  });

  it("upload chiama PutObjectCommand con Bucket/Key/Body/ContentType corretti", async () => {
    sendMock.mockResolvedValueOnce({});
    const result = await s3AttachmentStorage.upload({
      taskId: "task-1",
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.Key).toContain("task-1/");
    expect(command.input.Key).toContain("note.txt");
    expect(command.input.Body).toEqual(Buffer.from("hello"));
    expect(command.input.ContentType).toBe("text/plain");

    expect(result.storageBackend).toBe("s3");
    expect(result.storageRef).toBe(command.input.Key);
  });

  it("download chiama GetObjectCommand con Bucket/Key e restituisce Body", async () => {
    const fakeBody = { fake: "stream" };
    sendMock.mockResolvedValueOnce({ Body: fakeBody });

    const result = await s3AttachmentStorage.download("task-1/foo.txt");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: "test-bucket", Key: "task-1/foo.txt" });
    expect(result).toBe(fakeBody);
  });

  it("delete chiama DeleteObjectCommand con Bucket/Key", async () => {
    sendMock.mockResolvedValueOnce({});
    await s3AttachmentStorage.delete("task-1/foo.txt");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: "test-bucket", Key: "task-1/foo.txt" });
  });

  it("delete è best-effort: non lancia se il comando fallisce", async () => {
    sendMock.mockRejectedValueOnce(new Error("boom"));
    await expect(s3AttachmentStorage.delete("task-1/foo.txt")).resolves.toBeUndefined();
  });

  it("getUrl chiama getSignedUrl e restituisce url + expiresAt valorizzato", async () => {
    getSignedUrlMock.mockResolvedValueOnce("https://signed.example/task-1/foo.txt?sig=abc");

    const result = await s3AttachmentStorage.getUrl("task-1/foo.txt", {
      id: "att-1",
      fileName: "foo.txt",
      mimeType: "text/plain",
    });

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, command, options] = getSignedUrlMock.mock.calls[0];
    expect(command.input).toEqual({ Bucket: "test-bucket", Key: "task-1/foo.txt" });
    expect(options.expiresIn).toBe(15 * 60);

    expect(result.url).toBe("https://signed.example/task-1/foo.txt?sig=abc");
    expect(result.expiresAt).not.toBeNull();
    expect(new Date(result.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { getAttachmentStorage } from "./index.js";
import { localAttachmentStorage } from "./local.js";
import { s3AttachmentStorage } from "./s3.js";

describe("getAttachmentStorage", () => {
  const original = process.env.ATTACHMENTS_BACKEND;

  afterEach(() => {
    if (original === undefined) delete process.env.ATTACHMENTS_BACKEND;
    else process.env.ATTACHMENTS_BACKEND = original;
  });

  it("seleziona il backend locale per default (variabile assente)", () => {
    delete process.env.ATTACHMENTS_BACKEND;
    expect(getAttachmentStorage()).toBe(localAttachmentStorage);
  });

  it("seleziona il backend locale esplicitamente", () => {
    process.env.ATTACHMENTS_BACKEND = "local";
    expect(getAttachmentStorage()).toBe(localAttachmentStorage);
  });

  it("seleziona il backend s3", () => {
    process.env.ATTACHMENTS_BACKEND = "s3";
    expect(getAttachmentStorage()).toBe(s3AttachmentStorage);
  });

  it("è case-insensitive su ATTACHMENTS_BACKEND", () => {
    process.env.ATTACHMENTS_BACKEND = "S3";
    expect(getAttachmentStorage()).toBe(s3AttachmentStorage);
  });

  it("ricade sul backend locale per un valore sconosciuto", () => {
    process.env.ATTACHMENTS_BACKEND = "azure";
    expect(getAttachmentStorage()).toBe(localAttachmentStorage);
  });
});

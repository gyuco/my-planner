import { describe, it, expect } from "vitest";
import { validateAttachment, MAX_ATTACHMENT_SIZE_BYTES } from "./attachmentService.js";

describe("attachmentService — validateAttachment", () => {
  it("accetta un file di tipo/dimensione validi", () => {
    expect(() => validateAttachment("note.txt", 100, Buffer.from("hello world"))).not.toThrow();
  });

  it("rifiuta file oltre 20MB con ATTACHMENT_TOO_LARGE", () => {
    const size = MAX_ATTACHMENT_SIZE_BYTES + 1;
    expect(() => validateAttachment("big.pdf", size, Buffer.from("x"))).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TOO_LARGE" })
    );
  });

  it("accetta un file esattamente a 20MB", () => {
    expect(() =>
      validateAttachment("boundary.pdf", MAX_ATTACHMENT_SIZE_BYTES, Buffer.from("x"))
    ).not.toThrow();
  });

  it("rifiuta estensioni non in whitelist con ATTACHMENT_TYPE_NOT_ALLOWED", () => {
    expect(() => validateAttachment("archive.rar", 10, Buffer.from("x"))).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
  });

  it("rifiuta file senza estensione", () => {
    expect(() => validateAttachment("README", 10, Buffer.from("x"))).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
  });

  it("rifiuta estensioni eseguibili in blacklist anche se piccole", () => {
    expect(() => validateAttachment("script.sh", 10, Buffer.from("echo hi"))).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
    expect(() => validateAttachment("virus.exe", 10, Buffer.from("x"))).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
  });

  it("rifiuta un eseguibile PE (MZ) rinominato con estensione ammessa", () => {
    const buffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    expect(() => validateAttachment("innocuo.txt", buffer.length, buffer)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
  });

  it("rifiuta un eseguibile ELF rinominato con estensione ammessa", () => {
    const buffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]);
    expect(() => validateAttachment("innocuo.png", buffer.length, buffer)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
  });

  it("rifiuta uno script con shebang rinominato con estensione ammessa", () => {
    const buffer = Buffer.from("#!/bin/bash\necho hi\n");
    expect(() => validateAttachment("innocuo.md", buffer.length, buffer)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" })
    );
  });
});

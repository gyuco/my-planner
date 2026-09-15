import type { FastifyInstance } from "fastify";
import { apiError } from "@my-planner/core";
import {
  createAttachment,
  listAttachments,
  getAttachmentForDownload,
  deleteAttachment,
} from "../services/attachmentService.js";

/**
 * REST allegati (B11, vedi API_CONTRACT.md §6). Upload multipart, download
 * come stream binario, delete che rimuove anche l'oggetto fisico via
 * AttachmentStorage.delete (delegato dal service layer condiviso con MCP).
 */
export async function attachmentRoutes(app: FastifyInstance) {
  app.post("/tasks/:taskId/attachments", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const file = await (req as any).file();
    if (!file) {
      return reply.code(400).send(apiError("VALIDATION_ERROR", "Campo file 'file' mancante nel form multipart"));
    }
    const buffer = await file.toBuffer();
    const attachment = await createAttachment(taskId, {
      fileName: file.filename,
      mimeType: file.mimetype,
      buffer,
    });
    return reply.code(201).send(attachment);
  });

  app.get("/tasks/:taskId/attachments", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return listAttachments(taskId);
  });

  app.get("/attachments/:attachmentId/download", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const { attachment, stream } = await getAttachmentForDownload(attachmentId);
    reply.header("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
    reply.header("Content-Type", attachment.mimeType);
    return reply.send(stream);
  });

  app.delete("/attachments/:attachmentId", { onRequest: [app.authenticate] }, async (req) => {
    const { attachmentId } = req.params as { attachmentId: string };
    return deleteAttachment(attachmentId);
  });
}

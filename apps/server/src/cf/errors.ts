import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE, type ApiError } from "@my-planner/core";
import { ZodError } from "zod";

/**
 * Mappatura errori condivisa per Hono (CF3/CF5). Rispecchia l'error handler
 * globale Fastify (src/index.ts):
 *  - ApiErrorException -> status HTTP da HTTP_STATUS_BY_ERROR_CODE + envelope
 *  - ZodError -> 400 VALIDATION_ERROR
 *  - resto -> 500 INTERNAL_ERROR
 */
export function errorToResponse(err: unknown): { status: number; body: ApiError } {
  if (err instanceof ApiErrorException) {
    return { status: HTTP_STATUS_BY_ERROR_CODE[err.code], body: err.toApiError() };
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { status: 400, body: apiError("VALIDATION_ERROR", message || "Input non valido") };
  }
  return { status: 500, body: apiError("INTERNAL_ERROR", "Errore interno del server") };
}
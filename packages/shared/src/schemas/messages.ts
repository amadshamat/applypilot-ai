import { z } from 'zod';
import { jobExtractionResultSchema } from './job-posting';

/**
 * Typed runtime messaging contract. Every message crossing an extension
 * boundary (side panel ⇄ service worker ⇄ content script) is validated with
 * these schemas on receipt, because messages are untrusted input.
 */

// ---- Requests handled by the background service worker ----
export const backgroundRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('app/ping') }),
  z.object({ type: z.literal('job/extract-active-tab') }),
  z.object({ type: z.literal('job/get-cached'), tabId: z.number().int().nonnegative() }),
]);
export type BackgroundRequest = z.infer<typeof backgroundRequestSchema>;

// ---- Requests handled by the injected content script ----
export const contentRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('content/extract-job'),
    /** Upper bound for waiting on dynamically rendered content. */
    waitMs: z.number().int().min(0).max(10_000),
  }),
]);
export type ContentRequest = z.infer<typeof contentRequestSchema>;

export const errorCodeSchema = z.enum([
  'INVALID_MESSAGE',
  'NO_ACTIVE_TAB',
  'UNSUPPORTED_PAGE',
  'PERMISSION_REQUIRED',
  'EXTRACTION_FAILED',
  'TIMEOUT',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const appErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});
export type AppError = z.infer<typeof appErrorSchema>;

function resultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: appErrorSchema }),
  ]);
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Response schema for each request type, used to validate replies at the caller. */
export const responseSchemas = {
  'app/ping': resultSchema(z.object({ version: z.string() })),
  'job/extract-active-tab': resultSchema(jobExtractionResultSchema),
  'job/get-cached': resultSchema(jobExtractionResultSchema.nullable()),
  'content/extract-job': resultSchema(jobExtractionResultSchema),
} as const;

export type MessageType = keyof typeof responseSchemas;
export type ResponseFor<K extends MessageType> = z.infer<(typeof responseSchemas)[K]>;

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string): { ok: false; error: AppError } {
  return { ok: false, error: { code, message } };
}

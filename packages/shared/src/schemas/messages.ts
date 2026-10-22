import { z } from 'zod';
import { fillInstructionSchema, fillReportSchema, formScanSchema } from './autofill';
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
  z.object({ type: z.literal('autofill/scan') }),
  z.object({
    type: z.literal('autofill/fill'),
    /** The address that was scanned; filling is refused if the tab moved to another page. */
    pageUrl: z.string().max(4000),
    /** Only fields the user approved, with the values they approved. */
    instructions: z.array(fillInstructionSchema).min(1).max(300),
  }),
]);
export type BackgroundRequest = z.infer<typeof backgroundRequestSchema>;

// ---- Requests handled by the injected content script ----
export const contentRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('content/extract-job'),
    /** Upper bound for waiting on dynamically rendered content. */
    waitMs: z.number().int().min(0).max(10_000),
    /** Read this frame on its own: it is a job details frame inside the page. */
    embedded: z.boolean().optional(),
  }),
  z.object({ type: z.literal('content/scan-form') }),
  z.object({
    type: z.literal('content/fill-form'),
    instructions: z.array(fillInstructionSchema).min(1).max(300),
  }),
]);
export type ContentRequest = z.infer<typeof contentRequestSchema>;

/**
 * What each frame's content script reports when the background asks which
 * frame holds a job. Frames run inside untrusted pages, so this is validated.
 */
export const frameProbeSchema = z.object({
  url: z.string().max(4000),
  isJobPosting: z.boolean(),
  jobId: z.string().max(64).nullable(),
  title: z.string().max(300).nullable(),
});
export type FrameProbe = z.infer<typeof frameProbeSchema>;

export const errorCodeSchema = z.enum([
  'INVALID_MESSAGE',
  'NO_ACTIVE_TAB',
  'UNSUPPORTED_PAGE',
  'PERMISSION_REQUIRED',
  'EXTRACTION_FAILED',
  'SCAN_FAILED',
  'FILL_FAILED',
  'PAGE_CHANGED',
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
  'autofill/scan': resultSchema(formScanSchema),
  'autofill/fill': resultSchema(fillReportSchema),
  'content/scan-form': resultSchema(formScanSchema),
  'content/fill-form': resultSchema(fillReportSchema),
} as const;

export type MessageType = keyof typeof responseSchemas;
export type ResponseFor<K extends MessageType> = z.infer<(typeof responseSchemas)[K]>;

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string): { ok: false; error: AppError } {
  return { ok: false, error: { code, message } };
}

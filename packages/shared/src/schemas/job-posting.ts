import { z } from 'zod';

/**
 * Where a value came from. Ordered roughly from most to least trustworthy;
 * `ai` is reserved for Phase 3 and is never produced by the deterministic engine.
 */
export const extractionSourceSchema = z.enum(['json-ld', 'adapter', 'dom', 'url', 'ai']);
export type ExtractionSource = z.infer<typeof extractionSourceSchema>;

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof confidenceSchema>;

/**
 * Every extracted job attribute carries provenance. A field is either `found`
 * (with a value, source and confidence) or `missing` (no value). Missing fields
 * are never filled with guesses.
 */
export function extractedFieldSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('status', [
    z.object({
      status: z.literal('found'),
      value,
      source: extractionSourceSchema,
      confidence: confidenceSchema,
    }),
    z.object({ status: z.literal('missing') }),
  ]);
}

export type ExtractedField<T> =
  | { status: 'found'; value: T; source: ExtractionSource; confidence: Confidence }
  | { status: 'missing' };

export const workArrangementSchema = z.enum(['remote', 'hybrid', 'on-site']);
export type WorkArrangement = z.infer<typeof workArrangementSchema>;

export const employmentTypeSchema = z.enum([
  'full-time',
  'part-time',
  'contract',
  'temporary',
  'internship',
  'volunteer',
  'other',
]);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const salaryRangeSchema = z
  .object({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: z.string().length(3).nullable(),
    period: z.enum(['hour', 'day', 'week', 'month', 'year']).nullable(),
  })
  .refine((s) => s.min !== null || s.max !== null, 'A salary range needs a minimum or maximum')
  .refine(
    (s) => s.min === null || s.max === null || s.min <= s.max,
    'Salary minimum exceeds maximum',
  );
export type SalaryRange = z.infer<typeof salaryRangeSchema>;

const text = z.string().trim().min(1);
const textList = z.array(text).min(1);

export const jobPostingSchema = z.object({
  title: extractedFieldSchema(text),
  company: extractedFieldSchema(text),
  description: extractedFieldSchema(text),
  location: extractedFieldSchema(text),
  workArrangement: extractedFieldSchema(workArrangementSchema),
  salary: extractedFieldSchema(salaryRangeSchema),
  /** Postings often offer several ("Part-time, Full-time"), so this is a list. */
  employmentType: extractedFieldSchema(z.array(employmentTypeSchema).min(1)),
  requiredQualifications: extractedFieldSchema(textList),
  preferredQualifications: extractedFieldSchema(textList),
  skills: extractedFieldSchema(textList),
  yearsOfExperience: extractedFieldSchema(
    z.object({ min: z.number().nonnegative(), max: z.number().nonnegative().nullable() }),
  ),
  education: extractedFieldSchema(textList),
  applicationDeadline: extractedFieldSchema(z.iso.date()),
  url: extractedFieldSchema(z.url()),
  jobId: extractedFieldSchema(text),
  hasApplicationForm: extractedFieldSchema(z.boolean()),
});
export type JobPosting = z.infer<typeof jobPostingSchema>;
export type JobPostingField = keyof JobPosting;

export const platformSchema = z.enum([
  'greenhouse',
  'indeed',
  'lever',
  'workday',
  'smartrecruiters',
  'ashby',
  'generic',
]);
export type Platform = z.infer<typeof platformSchema>;

/** One self-check the extractor ran, shown to the user as "How this was read". */
export const extractionCheckSchema = z.object({
  id: z.string().max(40),
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string().max(400),
});
export type ExtractionCheck = z.infer<typeof extractionCheckSchema>;

export const extractionDiagnosticsSchema = z.object({
  /**
   * `selected-job`: every value was read from one job's container (for example
   * the details panel of a search results page). `page`: the whole page was read.
   */
  scope: z.enum(['selected-job', 'page']),
  /** The site's id for the job being read, when the page exposes one. */
  selectedJobId: z.string().max(64).nullable(),
  checks: z.array(extractionCheckSchema),
});
export type ExtractionDiagnostics = z.infer<typeof extractionDiagnosticsSchema>;

export const jobExtractionResultSchema = z.object({
  /** False when the page does not look like a job posting at all. */
  isJobPosting: z.boolean(),
  platform: platformSchema,
  pageUrl: z.url(),
  extractedAt: z.iso.datetime(),
  strategies: z.array(z.enum(['json-ld', 'adapter', 'dom'])),
  job: jobPostingSchema,
  warnings: z.array(z.string()),
  /** Optional so analyses cached by an earlier version still parse. */
  diagnostics: extractionDiagnosticsSchema.optional(),
});
export type JobExtractionResult = z.infer<typeof jobExtractionResultSchema>;

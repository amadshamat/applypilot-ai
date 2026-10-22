import { z } from 'zod';

/**
 * The wire contract between the extension and the ApplyPilot API. Both sides
 * validate every payload with these schemas: the API never trusts the request,
 * and the extension never trusts the response.
 *
 * Candidate and job data are reduced to what each task needs before they leave
 * the browser (see context.ts). Entries are referred to by short refs ("E1",
 * "P2") rather than storage ids, so the model can cite its sources reliably
 * and storage ids never leave the device.
 */

const line = (max: number) => z.string().trim().max(max);
const lines = (maxItems: number, maxChars: number) => z.array(line(maxChars)).max(maxItems);

export const AI_TASKS = [
  'tailor-resume',
  'cover-letter',
  'screening-answers',
  'map-fields',
] as const;
export const aiTaskSchema = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof aiTaskSchema>;
/** Tasks that draft text for one job from the candidate's profile. */
export type JobAiTask = Exclude<AiTask, 'map-fields'>;

export const refSchema = z.string().regex(/^[EPDC]\d{1,2}$/);

// ---- Inputs ----------------------------------------------------------------

export const candidateContextSchema = z.object({
  /** Empty unless the task signs something with the candidate's name (cover letters). */
  name: line(120),
  summary: line(2000),
  experience: z
    .array(
      z.object({
        ref: refSchema,
        position: line(200),
        employer: line(200),
        start: line(7),
        /** 'present' for a current role. */
        end: line(7),
        bullets: lines(30, 600),
        technologies: lines(50, 60),
      }),
    )
    .max(50),
  projects: z
    .array(
      z.object({
        ref: refSchema,
        name: line(200),
        description: line(1000),
        technologies: lines(50, 60),
        bullets: lines(30, 600),
      }),
    )
    .max(50),
  education: z
    .array(
      z.object({
        ref: refSchema,
        degree: line(200),
        field: line(200),
        institution: line(200),
        start: line(7),
        end: line(7),
        inProgress: z.boolean(),
        coursework: lines(50, 120),
      }),
    )
    .max(20),
  certifications: z
    .array(z.object({ ref: refSchema, name: line(200), issuer: line(200), date: line(7) }))
    .max(50),
  skills: lines(200, 80),
});
export type CandidateContext = z.infer<typeof candidateContextSchema>;

export const jobContextSchema = z.object({
  title: line(300),
  company: line(300),
  location: line(300),
  /** Untrusted page text. Prompts fence it off as data. */
  description: line(20_000),
  requiredQualifications: lines(60, 1000),
  preferredQualifications: lines(60, 1000),
  skills: lines(100, 100),
});
export type JobContext = z.infer<typeof jobContextSchema>;

export const coverLetterOptionsSchema = z.object({
  tone: z.enum(['professional', 'warm', 'concise']),
  length: z.enum(['short', 'standard']),
  /**
   * Facts the user typed for this letter ("I use their app daily"). Treated as
   * candidate-supplied, so the letter may use them.
   */
  notes: line(1000),
});
export type CoverLetterOptions = z.infer<typeof coverLetterOptionsSchema>;

export const screeningQuestionSchema = z.object({
  id: z.string().regex(/^Q\d{1,2}$/),
  text: line(1000).min(3),
});
export type ScreeningQuestion = z.infer<typeof screeningQuestionSchema>;

export const tailorResumeRequestSchema = z.object({
  job: jobContextSchema,
  candidate: candidateContextSchema,
});
export type TailorResumeRequest = z.infer<typeof tailorResumeRequestSchema>;

export const coverLetterRequestSchema = z.object({
  job: jobContextSchema,
  candidate: candidateContextSchema,
  options: coverLetterOptionsSchema,
});
export type CoverLetterRequest = z.infer<typeof coverLetterRequestSchema>;

export const screeningRequestSchema = z.object({
  job: jobContextSchema,
  candidate: candidateContextSchema,
  questions: z.array(screeningQuestionSchema).min(1).max(15),
});
export type ScreeningRequest = z.infer<typeof screeningRequestSchema>;

/**
 * Profile fields an application form field may ask for. The autofill engine
 * maps most fields with rules; only fields it cannot place are sent to the
 * model, which picks one of these kinds or "none". Sensitive and personal
 * kinds are deliberately absent, so a model can never route a profile value
 * into a question the user must answer themselves.
 */
export const MAPPABLE_FIELD_KINDS = [
  'name.full',
  'name.first',
  'name.last',
  'email',
  'phone',
  'location.full',
  'location.city',
  'location.state',
  'location.country',
  'location.postal',
  'link.linkedin',
  'link.github',
  'link.portfolio',
  'current.employer',
  'current.title',
  'experience.employer',
  'experience.title',
  'experience.location',
  'experience.description',
  'education.school',
  'education.degree',
  'education.field',
  'education.gpa',
  'skills',
  'certifications',
  'summary',
] as const;
export type MappableFieldKind = (typeof MAPPABLE_FIELD_KINDS)[number];

export const formFieldContextSchema = z.object({
  id: z.string().regex(/^F\d{1,2}$/),
  /** Untrusted page text. The prompt fences it off as data. */
  label: line(300).min(1),
  hint: line(300),
  section: line(200),
  control: line(30),
  options: lines(20, 100),
});
export type FormFieldContext = z.infer<typeof formFieldContextSchema>;

/** Only the form's own labels are sent: no profile data and no job. */
export const mapFieldsRequestSchema = z.object({
  fields: z.array(formFieldContextSchema).min(1).max(40),
});
export type MapFieldsRequest = z.infer<typeof mapFieldsRequestSchema>;

// ---- Model outputs -----------------------------------------------------------
// Kept to plain objects, strings, arrays and enums so the same schemas work as
// structured-output formats. Business rules are enforced afterwards by
// grounding.ts, not by the schema.

const bulletSchema = z.object({
  text: z.string(),
  /** Indexes (0-based) of the original bullets this one is rewritten from. Never empty. */
  basedOn: z.array(z.number().int()),
});

export const tailoredResumeSchema = z.object({
  summary: z.string(),
  experience: z.array(z.object({ ref: z.string(), bullets: z.array(bulletSchema) })),
  projects: z.array(z.object({ ref: z.string(), bullets: z.array(bulletSchema) })),
  /** Skill names from the candidate's list, most relevant first. */
  skillsToFeature: z.array(z.string()),
  /** What changed and why, one short sentence each. */
  changes: z.array(z.string()),
  /** Job requirements the profile does not show. Never added to the resume. */
  notShownInProfile: z.array(z.string()),
});
export type TailoredResume = z.infer<typeof tailoredResumeSchema>;

export const coverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  closing: z.string(),
  /** Refs ("E1", "P2") of the entries the letter draws on. */
  sources: z.array(z.string()),
});
export type CoverLetter = z.infer<typeof coverLetterSchema>;

export const screeningAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.string(),
      sources: z.array(z.string()),
      /** What only the candidate can add, or '' when the draft is complete. */
      needsYourInput: z.string(),
    }),
  ),
});
export type ScreeningAnswers = z.infer<typeof screeningAnswersSchema>;

export const fieldMappingsSchema = z.object({
  mappings: z.array(
    z.object({
      fieldId: z.string(),
      /** One of MAPPABLE_FIELD_KINDS, or "none" when no profile field fits. */
      kind: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});
export type FieldMappings = z.infer<typeof fieldMappingsSchema>;

export interface TaskTypes {
  'tailor-resume': { request: TailorResumeRequest; output: TailoredResume };
  'cover-letter': { request: CoverLetterRequest; output: CoverLetter };
  'screening-answers': { request: ScreeningRequest; output: ScreeningAnswers };
  'map-fields': { request: MapFieldsRequest; output: FieldMappings };
}

export const TASK_SCHEMAS = {
  'tailor-resume': { request: tailorResumeRequestSchema, output: tailoredResumeSchema },
  'cover-letter': { request: coverLetterRequestSchema, output: coverLetterSchema },
  'screening-answers': { request: screeningRequestSchema, output: screeningAnswersSchema },
  'map-fields': { request: mapFieldsRequestSchema, output: fieldMappingsSchema },
} as const satisfies Record<AiTask, { request: z.ZodType; output: z.ZodType }>;

// ---- Responses ---------------------------------------------------------------

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Null when the model's price is not known to this build. */
  estimatedCostUsd: z.number().nonnegative().nullable(),
});
export type Usage = z.infer<typeof usageSchema>;

export const providerKindSchema = z.enum(['anthropic', 'mock']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export function taskResponseSchema<T extends z.ZodType>(output: T) {
  return z.object({
    task: aiTaskSchema,
    promptVersion: z.string(),
    provider: providerKindSchema,
    /** The model that produced the output (can differ from the requested one after a fallback). */
    model: z.string(),
    output,
    usage: usageSchema.nullable(),
    /** Screening questions (or form fields) the server declined to send, with the reason. */
    skipped: z.array(z.object({ questionId: z.string(), reason: z.string() })),
    generatedAt: z.iso.datetime(),
  });
}
export interface TaskResponse<T extends AiTask> {
  task: T;
  promptVersion: string;
  provider: ProviderKind;
  model: string;
  output: TaskTypes[T]['output'];
  usage: Usage | null;
  skipped: { questionId: string; reason: string }[];
  generatedAt: string;
}

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('applypilot-api'),
  version: z.string(),
  provider: providerKindSchema,
  model: z.string(),
  requestsToday: z.number().int().nonnegative(),
  dailyLimit: z.number().int().positive(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'DAILY_LIMIT',
  'RATE_LIMITED',
  'PROVIDER_AUTH',
  'PROVIDER_UNAVAILABLE',
  'REFUSED',
  'INVALID_OUTPUT',
  'INTERNAL',
] as const;
export const apiErrorSchema = z.object({
  error: z.object({ code: z.enum(API_ERROR_CODES), message: z.string() }),
});
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

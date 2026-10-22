import { z } from 'zod';

/**
 * Contracts for assisted autofill (Phase 4). The content script scans the
 * application form and reports what it found; the side panel proposes values
 * and the user approves them; the content script fills only those. Everything
 * the content script reports comes from an untrusted page, so it is bounded
 * and validated like any other message.
 */

export const formPlatformSchema = z.enum([
  'indeed',
  'greenhouse',
  'lever',
  'workday',
  'ashby',
  'smartrecruiters',
  'generic',
]);
export type FormPlatform = z.infer<typeof formPlatformSchema>;

export const controlKindSchema = z.enum([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'month',
  'textarea',
  'select',
  'radio-group',
  'checkbox',
  'checkbox-group',
  /** A text box that filters a list of options (ARIA combobox, react-select). */
  'combobox',
  /** A button that opens a list of options (Workday-style dropdowns). */
  'listbox-button',
  'file',
]);
export type ControlKind = z.infer<typeof controlKindSchema>;

const pageText = (max: number) => z.string().max(max);

export const fieldOptionSchema = z.object({
  value: pageText(300),
  label: pageText(300),
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

export const fieldRefSchema = z.string().regex(/^f\d{1,4}$/);

export const detectedFieldSchema = z.object({
  /** Stable for one scan; the page element carries it as a data attribute. */
  ref: fieldRefSchema,
  control: controlKindSchema,
  /** The question or label the page shows for the field. */
  label: pageText(500),
  /** Placeholder, help text or a group legend that describes the field further. */
  hint: pageText(500),
  /** The nearest section heading ("Work experience", "Education"). */
  section: pageText(200),
  /** The field's name, id and test hooks as words ("first name", "experience 0 company"). */
  name: pageText(300),
  autocomplete: pageText(100),
  required: z.boolean(),
  options: z.array(fieldOptionSchema).max(300),
  /** False when the options load only when the list opens (some comboboxes). */
  optionsComplete: z.boolean(),
  /** What the page already shows in the field. */
  currentValue: pageText(2000),
  /** Accepted file types for file inputs. */
  accept: pageText(200),
  maxLength: z.number().int().positive().nullable(),
  /** Position of the repeated block the field sits in (job 1, job 2…), when the form repeats one. */
  repeatIndex: z.number().int().nonnegative().max(50).nullable(),
});
export type DetectedField = z.infer<typeof detectedFieldSchema>;

export const blockedFrameSchema = z.object({
  origin: pageText(200),
  url: pageText(2000),
});

export const formScanSchema = z.object({
  url: pageText(4000),
  platform: formPlatformSchema,
  /** The form's heading or the page title. */
  title: pageText(300),
  fields: z.array(detectedFieldSchema).max(300),
  /** Visible fields left alone on purpose: passwords, read-only and disabled fields. */
  skippedCount: z.number().int().nonnegative(),
  /** Labels of visible questions drawn in a way ApplyPilot cannot fill (such as Yes/No buttons). */
  unsupportedFields: z.array(pageText(300)).max(50),
  step: z.object({
    current: z.number().int().positive().nullable(),
    total: z.number().int().positive().nullable(),
    /** A Next or Continue button: more questions may follow on later steps. */
    hasNext: z.boolean(),
  }),
  captcha: z.boolean(),
  /** Labels of buttons that submit or advance the application. ApplyPilot never clicks them. */
  submitControls: z.array(pageText(80)).max(10),
  /** "Add another" buttons for repeated sections such as work experience. */
  addControls: z.array(pageText(80)).max(10),
  /** Frames on other sites that may hold the application form. */
  blockedFrames: z.array(blockedFrameSchema).max(5),
  scannedAt: z.iso.datetime(),
});
export type FormScan = z.infer<typeof formScanSchema>;

export const fillActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string().max(10_000) }),
  /** Selects, radio groups, comboboxes and listbox buttons: pick one option. */
  z.object({
    type: z.literal('choose'),
    value: z.string().max(300),
    label: z.string().max(300),
  }),
  /** Checkbox groups: tick exactly these options. */
  z.object({
    type: z.literal('choose-many'),
    values: z.array(z.string().max(300)).max(50),
  }),
  z.object({ type: z.literal('check'), checked: z.boolean() }),
  z.object({
    type: z.literal('file'),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().max(120),
    /** Base64 file content; resumes are at most 5 MB. */
    base64: z.string().max(7_200_000),
  }),
]);
export type FillAction = z.infer<typeof fillActionSchema>;

export const fillInstructionSchema = z.object({
  ref: fieldRefSchema,
  control: controlKindSchema,
  /** The label at scan time, to detect a page that changed since. */
  label: pageText(500),
  action: fillActionSchema,
});
export type FillInstruction = z.infer<typeof fillInstructionSchema>;

export const fillStatusSchema = z.enum(['filled', 'skipped', 'failed', 'unsupported']);
export type FillStatus = z.infer<typeof fillStatusSchema>;

export const fillReportSchema = z.object({
  results: z
    .array(
      z.object({
        ref: fieldRefSchema,
        status: fillStatusSchema,
        message: pageText(300),
      }),
    )
    .max(300),
  /** Attempts to submit or advance the form that were stopped while filling. */
  blockedSubmissions: z.number().int().nonnegative(),
  /** Fields that appeared after filling (conditional questions). Scan again to see them. */
  newFields: z.number().int().nonnegative(),
  filledAt: z.iso.datetime(),
});
export type FillReport = z.infer<typeof fillReportSchema>;

import { z } from 'zod';
import { employmentTypeSchema, workArrangementSchema } from './job-posting';

/**
 * The user's professional profile. Everything here is entered or confirmed by
 * the user; the matching engine treats it as the only source of truth about
 * the candidate. Optional text is stored as '' rather than undefined so forms
 * stay controlled.
 */

const text = (max: number) => z.string().trim().max(max);
const id = z.string().min(1).max(64);

/** "2024", "2024-05" or '' when unknown. */
export const partialDateSchema = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/),
]);
export type PartialDate = z.infer<typeof partialDateSchema>;

const url = z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)]);

export const personalInfoSchema = z.object({
  fullName: text(120),
  email: z.union([z.literal(''), z.email().max(200)]),
  phone: text(40),
  location: text(120),
  portfolioUrl: url,
  linkedinUrl: url,
  githubUrl: url,
});
export type PersonalInfo = z.infer<typeof personalInfoSchema>;

export const educationSchema = z
  .object({
    id,
    institution: text(200),
    degree: text(200),
    field: text(200),
    startDate: partialDateSchema,
    endDate: partialDateSchema,
    /** True while studying; endDate is then the expected graduation date. */
    current: z.boolean(),
    gpa: text(20),
    coursework: z.array(text(120).min(1)).max(50),
  })
  .refine((e) => e.institution.length > 0 || e.degree.length > 0, 'Add an institution or a degree');
export type Education = z.infer<typeof educationSchema>;

export const experienceSchema = z
  .object({
    id,
    employer: text(200),
    position: text(200),
    location: text(120),
    startDate: partialDateSchema,
    endDate: partialDateSchema,
    current: z.boolean(),
    /** Responsibilities and achievements, one per line, in the user's words. */
    bullets: z.array(text(600).min(1)).max(30),
    technologies: z.array(text(60).min(1)).max(50),
  })
  .refine((e) => e.employer.length > 0 || e.position.length > 0, 'Add an employer or a position');
export type Experience = z.infer<typeof experienceSchema>;

export const skillCategorySchema = z.enum([
  'language',
  'framework',
  'cloud',
  'devops',
  'data',
  'tool',
  'practice',
  'professional',
  'spoken-language',
  'other',
]);
export type SkillCategory = z.infer<typeof skillCategorySchema>;

export const skillSchema = z.object({
  id,
  name: text(80).min(1),
  category: skillCategorySchema,
});
export type Skill = z.infer<typeof skillSchema>;

export const certificationSchema = z.object({
  id,
  name: text(200).min(1),
  issuer: text(200),
  date: partialDateSchema,
  credentialUrl: url,
});
export type Certification = z.infer<typeof certificationSchema>;

export const projectSchema = z.object({
  id,
  name: text(200).min(1),
  description: text(1000),
  technologies: z.array(text(60).min(1)).max(50),
  url,
  bullets: z.array(text(600).min(1)).max(30),
});
export type Project = z.infer<typeof projectSchema>;

export const jobPreferencesSchema = z.object({
  desiredRoles: z.array(text(120).min(1)).max(20),
  employmentTypes: z.array(employmentTypeSchema).max(7),
  workArrangements: z.array(workArrangementSchema).max(3),
  locations: z.array(text(120).min(1)).max(20),
  industries: z.array(text(120).min(1)).max(20),
  /** Minimum acceptable pay, in the user's own terms ("$20/hour"). Not used for scoring yet. */
  salaryExpectation: text(80),
});
export type JobPreferences = z.infer<typeof jobPreferencesSchema>;

export const profileContentSchema = z.object({
  personal: personalInfoSchema,
  summary: text(2000),
  education: z.array(educationSchema).max(20),
  experience: z.array(experienceSchema).max(50),
  skills: z.array(skillSchema).max(200),
  certifications: z.array(certificationSchema).max(50),
  projects: z.array(projectSchema).max(50),
  preferences: jobPreferencesSchema,
});
export type ProfileContent = z.infer<typeof profileContentSchema>;

export const PROFILE_VERSION = 1;

export const profileSchema = profileContentSchema.extend({
  version: z.literal(PROFILE_VERSION),
  updatedAt: z.iso.datetime(),
});
export type Profile = z.infer<typeof profileSchema>;

export function emptyProfileContent(): ProfileContent {
  return {
    personal: {
      fullName: '',
      email: '',
      phone: '',
      location: '',
      portfolioUrl: '',
      linkedinUrl: '',
      githubUrl: '',
    },
    summary: '',
    education: [],
    experience: [],
    skills: [],
    certifications: [],
    projects: [],
    preferences: {
      desiredRoles: [],
      employmentTypes: [],
      workArrangements: [],
      locations: [],
      industries: [],
      salaryExpectation: '',
    },
  };
}

/** True when the profile has nothing a match could use. */
export function isProfileEmpty(profile: ProfileContent): boolean {
  return (
    profile.education.length === 0 &&
    profile.experience.length === 0 &&
    profile.skills.length === 0 &&
    profile.certifications.length === 0 &&
    profile.projects.length === 0
  );
}

/** Result of parsing a resume: a draft the user reviews before anything is saved. */
export const parsedResumeSchema = z.object({
  draft: profileContentSchema,
  /** Section headings recognised in the document, in order. */
  sections: z.array(z.string()),
  /** Things the parser was unsure about, shown during review. */
  warnings: z.array(z.string()),
});
export type ParsedResume = z.infer<typeof parsedResumeSchema>;

export const RESUME_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Metadata for a stored resume file. The original bytes are kept alongside, unmodified. */
export const resumeVersionMetaSchema = z.object({
  id,
  fileName: text(255).min(1),
  mimeType: z.enum([RESUME_MIME_TYPES.pdf, RESUME_MIME_TYPES.docx]),
  size: z.number().int().positive().max(MAX_RESUME_BYTES),
  uploadedAt: z.iso.datetime(),
  /** Plain text extracted from the file. */
  text: z.string().max(200_000),
  parsed: parsedResumeSchema,
  /** When the user last applied this resume's draft to their profile, if ever. */
  appliedAt: z.iso.datetime().nullable(),
  label: text(80),
});
export type ResumeVersionMeta = z.infer<typeof resumeVersionMetaSchema>;

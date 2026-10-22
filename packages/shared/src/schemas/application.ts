import { z } from 'zod';
import { APPLICATION_STAGES } from '../constants/app';

/**
 * A job the user is tracking, from saved to offer. Records live only in this
 * browser (chrome.storage.local) and are validated on every read and write.
 * Everything here was entered by the user or copied from a job they analyzed;
 * nothing is inferred.
 */

export const APPLICATIONS_VERSION = 1;
export const MAX_APPLICATIONS = 1000;
export const MAX_NOTES = 100;

export const applicationStageSchema = z.enum(APPLICATION_STAGES);

const line = (max: number) => z.string().trim().max(max);
const isoDay = z.iso.date();

export const applicationSourceSchema = z.enum(['analyzed', 'autofill', 'manual']);
export type ApplicationSource = z.infer<typeof applicationSourceSchema>;

export const applicationNoteSchema = z.object({
  id: z.string().min(1).max(64),
  text: line(2000).min(1),
  at: z.iso.datetime(),
});
export type ApplicationNote = z.infer<typeof applicationNoteSchema>;

export const statusChangeSchema = z.object({
  status: applicationStageSchema,
  at: z.iso.datetime(),
});
export type StatusChange = z.infer<typeof statusChangeSchema>;

export const followUpSchema = z.object({
  /** The day to follow up (local date, YYYY-MM-DD). */
  due: isoDay,
  note: line(300),
});
export type FollowUp = z.infer<typeof followUpSchema>;

export const applicationJobSchema = z.object({
  title: line(300).min(1),
  company: line(300),
  location: line(300),
  /** The posting's address, when there is one. */
  url: z.union([z.url().max(4000), z.literal('')]),
  /** Stable identity of the posting (see jobPageIdentity), used to spot duplicates. */
  jobKey: line(4100),
  /** Where the job was found: "indeed", "greenhouse", "generic" or "manual". */
  platform: line(40),
  /** Pay as the posting showed it, already formatted for reading. */
  pay: line(200),
});
export type ApplicationJob = z.infer<typeof applicationJobSchema>;

export const applicationRecordSchema = z.object({
  id: z.string().min(1).max(64),
  job: applicationJobSchema,
  source: applicationSourceSchema,
  status: applicationStageSchema,
  /** Oldest first. The first entry is the status the record was created with. */
  history: z.array(statusChangeSchema).min(1).max(200),
  notes: z.array(applicationNoteSchema).max(MAX_NOTES),
  followUp: followUpSchema.nullable(),
  /** The 0–100 match score when the job was saved, if the profile was complete enough. */
  matchScore: z.number().int().min(0).max(100).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>;

/** What a user (or the Analyze and Autofill tabs) provides to start tracking a job. */
export const newApplicationSchema = z.object({
  job: applicationJobSchema,
  source: applicationSourceSchema,
  status: applicationStageSchema,
  matchScore: z.number().int().min(0).max(100).nullable(),
});
export type NewApplication = z.infer<typeof newApplicationSchema>;

import { z } from 'zod';
import {
  applicationRecordSchema,
  applicationStageSchema,
  followUpSchema,
  profileSchema,
  type ApplicationRecord,
  type Profile,
} from '@applypilot/shared';

/**
 * The cloud API contract (version 1), shared by the extension, the API and
 * the CDK stack, so the three cannot drift apart.
 *
 * Every stored thing is an item: the user's profile (one per account) or one
 * tracked application. Each write gives the item a new `version`; a write
 * names the version it was based on and is refused with a conflict if the
 * item changed since. A deleted item stays as a tombstone (`data: null`) so
 * other devices learn about the deletion.
 */

export const CLOUD_API_VERSION = 'v1';

export const PROFILE_ITEM_ID = 'profile';

/** Item ids become part of database keys, so only safe characters are allowed. */
export const itemIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, digits, ".", "_", ":" or "-".');

const version = z.number().int().min(1);
const changedAt = z.number().int().nonnegative();

export const profileItemSchema = z.object({
  kind: z.literal('profile'),
  id: z.literal(PROFILE_ITEM_ID),
  version,
  /** Server time (milliseconds) of the last write. */
  changedAt,
  data: profileSchema.nullable(),
});

export const applicationItemSchema = z
  .object({
    kind: z.literal('application'),
    id: itemIdSchema,
    version,
    changedAt,
    data: applicationRecordSchema.nullable(),
  })
  .refine((item) => item.data === null || item.data.id === item.id, {
    message: 'The record id must match the item id.',
    path: ['data', 'id'],
  });

export const cloudItemSchema = z.union([profileItemSchema, applicationItemSchema]);

export type ProfileItem = z.infer<typeof profileItemSchema>;
export type ApplicationItem = z.infer<typeof applicationItemSchema>;
export type CloudItem = ProfileItem | ApplicationItem;
export type ItemKind = CloudItem['kind'];
export type ItemData<K extends ItemKind> = K extends 'profile' ? Profile : ApplicationRecord;

/** A write from a device: the new data (or null to delete) and the version it was based on. */
export const profileChangeSchema = z.object({
  kind: z.literal('profile'),
  id: z.literal(PROFILE_ITEM_ID),
  /** 0 when the device has never seen this item in the cloud. */
  baseVersion: z.number().int().nonnegative(),
  data: profileSchema.nullable(),
});

export const applicationChangeSchema = z
  .object({
    kind: z.literal('application'),
    id: itemIdSchema,
    baseVersion: z.number().int().nonnegative(),
    data: applicationRecordSchema.nullable(),
  })
  .refine((c) => c.data === null || c.data.id === c.id, {
    message: 'The record id must match the item id.',
    path: ['data', 'id'],
  });

export const itemChangeSchema = z.union([profileChangeSchema, applicationChangeSchema]);
export type ItemChange = z.infer<typeof itemChangeSchema>;

export const MAX_PUSH_CHANGES = 50;

/** POST /v1/sync/push */
export const pushRequestSchema = z.object({
  /** The data epoch the device synced with; a push is refused if the cloud data was reset since. */
  epoch: z.string().min(1).max(64),
  changes: z.array(itemChangeSchema).min(1).max(MAX_PUSH_CHANGES),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('applied'), item: cloudItemSchema }),
  /** The item changed in the cloud since `baseVersion`; `current` is what is there now. */
  z.object({
    outcome: z.literal('conflict'),
    kind: z.enum(['profile', 'application']),
    id: itemIdSchema,
    current: cloudItemSchema.nullable(),
  }),
  z.object({
    outcome: z.literal('rejected'),
    kind: z.enum(['profile', 'application']),
    id: itemIdSchema,
    code: z.enum(['LIMIT_REACHED', 'PAYLOAD_TOO_LARGE', 'INVALID_REQUEST']),
    message: z.string(),
  }),
]);
export type PushResult = z.infer<typeof pushResultSchema>;

export const pushResponseSchema = z.object({
  epoch: z.string(),
  results: z.array(pushResultSchema),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

/** GET /v1/sync/changes?since=…&page=… */
export const changesResponseSchema = z.object({
  /** Changes when this differs from the device's epoch: the cloud data was deleted or reset. */
  epoch: z.string(),
  items: z.array(cloudItemSchema),
  /** Continue with this page token; null on the last page. */
  page: z.string().nullable(),
  /** On the last page: pass as `since` next time. */
  cursor: z.number().int().nonnegative().nullable(),
});
export type ChangesResponse = z.infer<typeof changesResponseSchema>;

/** Writes the cloud accepts for one record without a full copy (REST sub-resources). */
export const putItemRequestSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  data: z.unknown(),
});
export const statusRequestSchema = z.object({ status: applicationStageSchema });
export const noteRequestSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const followUpRequestSchema = z.object({ followUp: followUpSchema.nullable() });

export const accountResponseSchema = z.object({
  userId: z.string(),
  epoch: z.string(),
  profile: z.boolean(),
  applications: z.number().int().nonnegative(),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;

export const accountExportSchema = z.object({
  format: z.literal('applypilot-cloud-export'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  profile: profileSchema.nullable(),
  applications: z.array(applicationRecordSchema),
});
export type AccountExport = z.infer<typeof accountExportSchema>;

export const CLOUD_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'CONFLICT',
  'EPOCH_CHANGED',
  'LIMIT_REACHED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[number];

export const cloudErrorSchema = z.object({
  error: z.object({
    code: z.enum(CLOUD_ERROR_CODES),
    message: z.string(),
    /** Quote this when reporting a problem; it finds the request in the logs. */
    requestId: z.string().optional(),
    /** CONFLICT only: the item as it is in the cloud now. */
    current: cloudItemSchema.nullable().optional(),
  }),
});
export type CloudErrorBody = z.infer<typeof cloudErrorSchema>;

import { profileContentSchema, type ProfileContent } from '@applypilot/shared';

export type FieldErrors = Record<string, string>;

/** Turns "Invalid string: must match pattern" into something a person can act on. */
function friendlyMessage(path: string, message: string): string {
  if (/Date$|\.date$/.test(path)) return 'Use YYYY or YYYY-MM, for example 2024-05.';
  if (/Url$|\.url$/i.test(path)) return 'Enter a full link starting with https://';
  if (path.endsWith('email')) return 'Enter a valid email address.';
  if (/too_big|Too big/i.test(message) || /at most/i.test(message)) return 'This is too long.';
  if (/too_small|Too small|>=1/i.test(message)) return 'This cannot be empty.';
  return message;
}

/**
 * Validates a profile before saving. Errors are keyed by dotted path
 * ("experience.0.startDate") so each field can show its own message; errors on
 * a whole entry (such as a missing employer and position) use the entry's path.
 */
export function validateProfile(
  content: ProfileContent,
): { ok: true; data: ProfileContent } | { ok: false; errors: FieldErrors } {
  const result = profileContentSchema.safeParse(content);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.');
    errors[path] ??= friendlyMessage(path, issue.message);
  }
  return { ok: false, errors };
}

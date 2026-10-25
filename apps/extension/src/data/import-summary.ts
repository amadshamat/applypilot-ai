import type { ParsedBackup } from './backup-format';
import type { ImportPlan } from './import-plan';

/** Plain-language lines for the import preview and the result report. */

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export interface BackupContents {
  /** "Exported 25 Oct 2026 from ApplyPilot 0.7.0" and similar. */
  source: string;
  items: string[];
  /** Entries that failed the checks and will not be imported. */
  problems: string[];
  /** Things worth knowing that are not errors. */
  notes: string[];
  /** Items in the file that are never imported (device settings, unknown keys). */
  ignored: string[];
}

export function describeBackup(backup: ParsedBackup, locale?: string): BackupContents {
  const date = backup.exportedAt ? new Date(backup.exportedAt) : null;
  const when =
    date && !Number.isNaN(date.getTime())
      ? `Exported ${date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Export date unknown';
  const from = backup.appVersion
    ? ` from ApplyPilot ${backup.appVersion}`
    : backup.formatVersion === 1
      ? ' from ApplyPilot 0.6 or earlier'
      : '';
  const items: string[] = [];
  if (backup.profile.status === 'ok') items.push('Your profile');
  if (backup.applications) items.push(n(backup.applications.records.length, 'tracked application'));
  if (backup.aiDrafts) items.push(n(backup.aiDrafts.drafts.length, 'saved AI draft'));
  if (backup.settings.status === 'ok') items.push('Settings');
  if (backup.resumes.files.length > 0) items.push(n(backup.resumes.files.length, 'resume file'));

  const problems: string[] = [];
  if (backup.profile.status === 'invalid')
    problems.push('The profile in this file could not be read.');
  if (backup.applications?.invalid)
    problems.push(`${n(backup.applications.invalid, 'tracked application')} could not be read.`);
  if (backup.applications?.duplicateIds)
    problems.push(
      `${n(backup.applications.duplicateIds, 'tracked application')} appear twice; the first copy is used.`,
    );
  if (backup.aiDrafts?.invalid)
    problems.push(`${n(backup.aiDrafts.invalid, 'AI draft')} could not be read.`);
  if (backup.resumes.invalid)
    problems.push(
      `${n(backup.resumes.invalid, 'resume')} could not be read or failed the file checks.`,
    );
  const notes: string[] = [];
  if (backup.resumes.withoutFile)
    notes.push(
      `${n(backup.resumes.withoutFile, 'resume')} in this file ${backup.resumes.withoutFile === 1 ? 'has' : 'have'} no original file (exports before 0.7 did not include it), so ${backup.resumes.withoutFile === 1 ? 'it is' : 'they are'} skipped. Your profile keeps what was read from them.`,
    );
  if (backup.settings.status === 'ok' && backup.settings.defaulted)
    problems.push('Some settings were not recognised and will use their defaults.');
  return { source: `${when}${from}.`, items, problems, notes, ignored: backup.ignored };
}

export type EffectTone = 'add' | 'keep' | 'remove';
export interface Effect {
  tone: EffectTone;
  text: string;
}

/** What applying the plan would do, part by part. */
export function describePlan(plan: ImportPlan): Effect[] {
  const effects: Effect[] = [];
  const merge = plan.mode === 'merge';
  switch (plan.profile.action) {
    case 'add':
      effects.push({ tone: 'add', text: 'Your profile is restored (there is none here yet).' });
      break;
    case 'replace':
      effects.push({
        tone: 'remove',
        text: 'Your profile here is replaced by the one in the file.',
      });
      break;
    case 'keep':
      effects.push({
        tone: 'keep',
        text: 'Your profile here is kept; the one in the file is not used.',
      });
      break;
    case 'same':
      effects.push({ tone: 'keep', text: 'Your profile is already the same.' });
      break;
    case 'none':
      break;
  }

  const a = plan.applications;
  if (a.added) effects.push({ tone: 'add', text: `${n(a.added, 'tracked application')} added.` });
  if (a.already)
    effects.push({
      tone: 'keep',
      text: `${n(a.already, 'tracked application')} already here, unchanged.`,
    });
  if (a.differing)
    effects.push(
      merge
        ? {
            tone: 'keep',
            text: `${n(a.differing, 'tracked application')} also here with changes; your copy here is kept.`,
          }
        : {
            tone: 'remove',
            text: `${n(a.differing, 'tracked application')} here replaced by the copy in the file.`,
          },
    );
  if (a.sameJob)
    effects.push({
      tone: 'keep',
      text: `${n(a.sameJob, 'tracked application')} skipped: the same job is already tracked.`,
    });
  if (a.overLimit)
    effects.push({
      tone: 'keep',
      text: `${n(a.overLimit, 'tracked application')} skipped: the tracker holds at most 1000.`,
    });
  if (a.removed)
    effects.push({
      tone: 'remove',
      text: `${n(a.removed, 'tracked application')} here, not in the file, removed.`,
    });

  switch (plan.settings.action) {
    case 'restore':
      effects.push({ tone: 'remove', text: 'Settings here are replaced by the ones in the file.' });
      break;
    case 'keep':
      effects.push({ tone: 'keep', text: 'Settings here are kept.' });
      break;
    default:
      break;
  }

  const d = plan.aiDrafts;
  if (d.added) effects.push({ tone: 'add', text: `${n(d.added, 'saved AI draft')} added.` });
  if (d.already)
    effects.push(
      merge
        ? {
            tone: 'keep',
            text: `${n(d.already, 'saved AI draft')} for the same job already here; yours kept.`,
          }
        : {
            tone: 'remove',
            text: `${n(d.already, 'saved AI draft')} for the same job replaced by the copy in the file.`,
          },
    );
  if (d.overLimit)
    effects.push({
      tone: 'keep',
      text: `${n(d.overLimit, 'AI draft')} skipped: at most 30 are kept.`,
    });
  if (d.removed)
    effects.push({
      tone: 'remove',
      text: `${n(d.removed, 'saved AI draft')} here, not in the file, removed.`,
    });

  const r = plan.resumes;
  if (r.add.length) effects.push({ tone: 'add', text: `${n(r.add.length, 'resume file')} added.` });
  if (r.already)
    effects.push({ tone: 'keep', text: `${n(r.already, 'resume file')} already here, unchanged.` });
  if (r.remove.length)
    effects.push({
      tone: 'remove',
      text: `${n(r.remove.length, 'uploaded resume')} here, not in the file, removed.`,
    });
  return effects;
}

export interface ImportReport {
  restored: string[];
  removed: string[];
  skipped: string[];
  failed: string[];
}

/** The result shown after an import: what was restored, skipped, and could not be read. */
export function reportImport(plan: ImportPlan, backup: ParsedBackup): ImportReport {
  const restored: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  const merge = plan.mode === 'merge';
  if (plan.profile.action === 'add' || plan.profile.action === 'replace') restored.push('profile');
  if (plan.profile.action === 'keep') skipped.push('profile (kept yours)');
  const a = plan.applications;
  const appsWritten = a.added + (merge ? 0 : a.differing);
  if (appsWritten) restored.push(n(appsWritten, 'tracked application'));
  if (a.already) skipped.push(`${n(a.already, 'tracked application')} already here`);
  if (merge && a.differing)
    skipped.push(`${n(a.differing, 'tracked application')} changed here (kept yours)`);
  if (a.sameJob) skipped.push(`${n(a.sameJob, 'tracked application')} for jobs already tracked`);
  if (a.overLimit) skipped.push(`${n(a.overLimit, 'tracked application')} over the 1000 limit`);
  if (a.removed) removed.push(n(a.removed, 'tracked application'));
  if (plan.settings.action === 'restore') restored.push('settings');
  if (plan.settings.action === 'keep') skipped.push('settings (kept yours)');
  const d = plan.aiDrafts;
  if (d.removed) removed.push(n(d.removed, 'AI draft'));
  const draftsWritten = d.added + (merge ? 0 : d.already);
  if (draftsWritten) restored.push(n(draftsWritten, 'AI draft'));
  if (merge && d.already) skipped.push(`${n(d.already, 'AI draft')} already here`);
  if (d.overLimit) skipped.push(`${n(d.overLimit, 'AI draft')} over the limit of 30`);
  if (plan.resumes.add.length) restored.push(n(plan.resumes.add.length, 'resume file'));
  if (plan.resumes.already) skipped.push(`${n(plan.resumes.already, 'resume file')} already here`);
  if (plan.resumes.remove.length) removed.push(n(plan.resumes.remove.length, 'resume'));
  if (backup.resumes.withoutFile)
    skipped.push(`${n(backup.resumes.withoutFile, 'resume')} without the original file`);
  return { restored, removed, skipped, failed: describeBackup(backup).problems };
}

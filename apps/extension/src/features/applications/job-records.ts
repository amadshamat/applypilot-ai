import {
  jobPageIdentity,
  type ApplicationJob,
  type FormScan,
  type JobExtractionResult,
} from '@applypilot/shared';
import { formatSalary } from '../analyze/format';

/**
 * Builds the job part of a tracked application from what the extension
 * already read: an analyzed posting, or an application form the user filled.
 * Only found values are copied; nothing is guessed.
 */

const found = <T>(field: { status: 'found'; value: T } | { status: 'missing' }): T | null =>
  field.status === 'found' ? field.value : null;

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.href.slice(0, 4000) : '';
  } catch {
    return '';
  }
}

function identity(url: string): string {
  try {
    return jobPageIdentity(url);
  } catch {
    return '';
  }
}

export function jobFromAnalysis(result: JobExtractionResult): ApplicationJob | null {
  const { job } = result;
  const title = found(job.title)?.trim() ?? '';
  if (!title) return null;
  const salary = found(job.salary);
  const url = safeUrl(found(job.url) ?? result.pageUrl);
  return {
    title: title.slice(0, 300),
    company: (found(job.company) ?? '').slice(0, 300),
    location: (found(job.location) ?? '').slice(0, 300),
    url,
    jobKey: identity(result.pageUrl).slice(0, 4100),
    platform: result.platform,
    pay: salary ? formatSalary(salary).slice(0, 200) : '',
  };
}

/** For a form with no analyzed posting: the form's title and address are all that is known. */
export function jobFromForm(scan: FormScan): ApplicationJob | null {
  const title = scan.title.trim();
  if (!title) return null;
  const url = safeUrl(scan.url);
  return {
    title: title.slice(0, 300),
    company: '',
    location: '',
    url,
    jobKey: url ? identity(url).slice(0, 4100) : '',
    platform: scan.platform,
    pay: '',
  };
}

import {
  DEFAULT_SETTINGS,
  RESUME_MIME_TYPES,
  STORAGE_KEYS,
  emptyProfileContent,
  type ApplicationRecord,
  type ResumeVersionMeta,
} from '@applypilot/shared';
import { createApplication } from '@applypilot/tracking';
import { buildCandidateContext, buildJobContext } from '@applypilot/ai-core';
import { sampleJob, sampleProfile } from '../../../packages/ai-core/test/fixtures';
import { ProfileRepository } from '../src/storage/profile-repository';
import { memoryResumeStore, type ResumeStore } from '../src/storage/resume-store';
import { memoryStore, type KeyValueStore } from '../src/storage/storage-area';
import type { SavedDraft } from '../src/storage/ai-drafts-repository';

/** Test data for export, import and delete. */

let counter = 0;
export function application(
  title: string,
  company = 'Acme',
  extra: Partial<ApplicationRecord> = {},
) {
  counter += 1;
  const clock = { now: () => new Date('2026-10-01T12:00:00.000Z'), newId: () => `app-${counter}` };
  const record = createApplication(
    {
      job: { title, company, location: '', url: '', jobKey: '', platform: 'manual', pay: '' },
      source: 'manual',
      status: 'applied',
      matchScore: null,
    },
    clock,
  );
  return { ...record, ...extra };
}

export function resumeMeta(id: string, bytes: Uint8Array, extra: Partial<ResumeVersionMeta> = {}) {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: RESUME_MIME_TYPES.pdf,
    size: bytes.length,
    uploadedAt: '2026-10-01T00:00:00.000Z',
    text: 'resume text',
    parsed: { draft: emptyProfileContent(), sections: [], warnings: [] },
    appliedAt: null,
    label: '',
    ...extra,
  } satisfies ResumeVersionMeta;
}

export const pdfBytes = (body = 'resume') => new TextEncoder().encode(`%PDF-1.4 ${body}`);

export function draft(jobKey: string): SavedDraft {
  return {
    task: 'cover-letter',
    jobKey,
    savedAt: '2026-10-14T12:00:00.000Z',
    request: {
      job: buildJobContext(sampleJob()),
      candidate: buildCandidateContext(sampleProfile(), { includeName: true }).context,
      options: { tone: 'warm', length: 'short', notes: '' },
    },
    response: {
      task: 'cover-letter',
      promptVersion: 'cover-letter@2026-10-14.1',
      provider: 'mock',
      model: 'mock-drafter',
      output: {
        greeting: 'Dear Hiring Manager,',
        paragraphs: ['Hello.'],
        closing: 'Sincerely,',
        sources: [],
      },
      usage: null,
      skipped: [],
      generatedAt: '2026-10-14T12:00:00.000Z',
    },
  };
}

/** A browser with a profile, two tracked applications, one AI draft and one resume. */
export async function populated(): Promise<{ store: KeyValueStore; resumes: ResumeStore }> {
  const store = memoryStore();
  const resumes = memoryResumeStore();
  await new ProfileRepository(store, () => new Date('2026-10-14T12:00:00Z')).save(sampleProfile());
  await store.set(STORAGE_KEYS.applications, [
    application('Cloud intern'),
    application('IT support', 'Globex'),
  ]);
  await store.set(STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS, theme: 'dark' });
  await store.set(STORAGE_KEYS.aiDrafts, [draft('https://jobs.example/1')]);
  await store.set(STORAGE_KEYS.aiConnection, {
    apiUrl: 'http://127.0.0.1:8787',
    token: 'secret-token',
  });
  const bytes = pdfBytes();
  await resumes.put(
    resumeMeta('resume-1', bytes),
    new Blob([bytes], { type: RESUME_MIME_TYPES.pdf }),
  );
  return { store, resumes };
}

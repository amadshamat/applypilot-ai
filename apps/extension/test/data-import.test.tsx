import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { extractJob } from '@applypilot/job-extraction';
import { RESUME_MIME_TYPES, STORAGE_KEYS, ok, type BackgroundRequest } from '@applypilot/shared';
import { sampleProfile } from '../../../packages/ai-core/test/fixtures';
import { useAnalysis } from '../src/features/analyze/store';
import { useTrackerFocus } from '../src/features/applications/focus-store';
import { useNavigation } from '../src/features/navigation/store';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { application, draft, pdfBytes, resumeMeta } from './data-fixtures';
import { fakeServices } from './fakes';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/jobs');
const JOB_URL = 'https://job-boards.greenhouse.io/lumenrobotics/jobs/4012345007';
const jobResult = () => {
  const doc = new JSDOM(
    readFileSync(resolve(FIXTURES, 'greenhouse-software-intern.html'), 'utf8'),
    {
      url: JOB_URL,
    },
  ).window.document;
  return extractJob(doc, JOB_URL);
};

/** A side panel whose background answers cached-analysis requests from the fake session storage. */
function renderPanel() {
  const holder: { fake?: ReturnType<typeof fakeServices> } = {};
  const fake = fakeServices((request: BackgroundRequest) =>
    request.type === 'job/get-cached'
      ? holder
          .fake!.services.sessionStore.get(`job-analysis:${request.tabId}`)
          .then((v) => ok(v ?? null))
      : ok(null),
  );
  holder.fake = fake;
  const view = render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
  return { ...fake, view };
}

function captureDownloads() {
  const files: { name: string; blob: Blob }[] = [];
  let pending: Blob | null = null;
  // Only the two methods are replaced: the profile schema still needs the URL constructor.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    pending = blob;
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (pending) files.push({ name: this.download, blob: pending });
    pending = null;
  });
  return files;
}

async function fillBrowser(fake: ReturnType<typeof fakeServices>) {
  const { services } = fake;
  await services.profile.save(sampleProfile());
  await services.localStore.set(STORAGE_KEYS.applications, [
    application('Cloud intern'),
    application('IT support', 'Globex'),
  ]);
  await services.localStore.set(STORAGE_KEYS.aiDrafts, [draft('https://jobs.example/1')]);
  const bytes = pdfBytes();
  await services.resumes.put(
    resumeMeta('resume-1', bytes),
    new Blob([bytes], { type: RESUME_MIME_TYPES.pdf }),
  );
}

const openSettings = () => userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
const upload = async (text: string, name = 'applypilot-export.json') =>
  userEvent.upload(
    await screen.findByLabelText('Backup file to import'),
    new File([text], name, { type: 'application/json' }),
  );

beforeEach(() => {
  useAnalysis.setState({ state: { status: 'idle' } });
  useNavigation.setState({ view: 'settings' });
  useTrackerFocus.setState({ openId: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Import data', () => {
  it('restores an export into an empty browser after a preview', async () => {
    const downloads = captureDownloads();
    const source = renderPanel();
    await fillBrowser(source);
    await userEvent.click(await screen.findByRole('button', { name: /Export data/ }));
    expect(await screen.findByText(/Export downloaded/)).toBeInTheDocument();
    const text = await downloads[0]!.blob.text();
    expect(text).toContain('"format": "applypilot-backup"');
    source.view.unmount();

    const target = renderPanel();
    await upload(text);
    const preview = await screen.findByLabelText('Import preview');
    expect(preview).toHaveTextContent(
      'In this file: Your profile, 2 tracked applications, 1 saved AI draft, 1 resume file.',
    );
    // Nothing is written before confirming.
    expect(await target.services.localStore.get(STORAGE_KEYS.applications)).toBeUndefined();
    expect(within(preview).getByRole('radio', { name: /Merge/ })).toBeChecked();
    await userEvent.click(within(preview).getByRole('button', { name: 'Import and merge' }));

    expect(await screen.findByText('Import finished')).toBeInTheDocument();
    expect(screen.getByText(/2 tracked applications/)).toBeInTheDocument();
    expect((await target.services.applications.load()).records).toHaveLength(2);
    expect((await target.services.profile.load()).status).toBe('ok');
    expect(await target.services.resumes.list()).toHaveLength(1);
    expect(await target.services.aiDrafts.list()).toHaveLength(1);
  });

  it('explains damaged and unsupported files and changes nothing', async () => {
    const fake = renderPanel();
    await upload('{"data": {"applypilot.applic');
    expect(await screen.findByText('Could not import this file')).toBeInTheDocument();
    expect(screen.getByText(/not valid JSON/)).toBeInTheDocument();
    await upload(
      JSON.stringify({
        format: 'applypilot-backup',
        formatVersion: 9,
        appVersion: '2.0.0',
        data: {},
      }),
    );
    expect(
      await screen.findByText(/made by a newer version of ApplyPilot \(2\.0\.0\)/),
    ).toBeInTheDocument();
    expect(await fake.services.localStore.getAll()).toEqual({});
  });

  it('lists skipped and unreadable entries', async () => {
    const fake = renderPanel();
    const record = application('Cloud intern');
    await fake.services.localStore.set(STORAGE_KEYS.applications, [record]);
    await upload(
      JSON.stringify({
        exportedAt: '2026-10-20T10:00:00.000Z',
        data: {
          [STORAGE_KEYS.applications]: [record, application('New one', 'Initech'), { id: 1 }],
          [STORAGE_KEYS.aiConnection]: { token: 'x' },
        },
        resumes: [resumeMeta('old', pdfBytes())],
      }),
    );
    const preview = await screen.findByLabelText('Import preview');
    expect(preview).toHaveTextContent('1 tracked application could not be read.');
    expect(preview).toHaveTextContent(/1 resume in this file has no original file/);
    expect(preview).toHaveTextContent(/AI connection/);
    await userEvent.click(within(preview).getByRole('button', { name: 'Import and merge' }));
    const result = await screen.findByText('Import finished');
    const alert = result.closest('[role="status"]')!;
    expect(alert).toHaveTextContent('Restored: 1 tracked application.');
    expect(alert).toHaveTextContent(
      'Skipped: 1 tracked application already here, 1 resume without the original file.',
    );
    expect(alert).toHaveTextContent(
      'Could not be imported: 1 tracked application could not be read.',
    );
  });

  it('downloads a backup before replacing and can undo the import', async () => {
    const downloads = captureDownloads();
    const fake = renderPanel();
    await fillBrowser(fake);
    const before = await fake.services.localStore.get(STORAGE_KEYS.applications);
    await upload(
      JSON.stringify({
        data: { [STORAGE_KEYS.applications]: [application('From file', 'Hooli')] },
      }),
    );
    const preview = await screen.findByLabelText('Import preview');
    await userEvent.click(within(preview).getByRole('radio', { name: /Replace/ }));
    expect(within(preview).getByRole('list', { name: 'Import changes' })).toHaveTextContent(
      '2 tracked applications here, not in the file, removed.',
    );
    await userEvent.click(within(preview).getByRole('button', { name: 'Back up and replace' }));
    expect(await screen.findByText('Import finished')).toBeInTheDocument();
    expect(downloads.map((d) => d.name)).toEqual([
      expect.stringMatching(/^applypilot-before-import-.*\.json$/),
    ]);
    expect(await downloads[0]!.blob.text()).toContain('Cloud intern');
    expect((await fake.services.applications.load()).records.map((r) => r.job.title)).toEqual([
      'From file',
    ]);
    // The profile, drafts and resume were not in the file, so they stay.
    expect((await fake.services.profile.load()).status).toBe('ok');
    expect(await fake.services.resumes.list()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Undo last import/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, undo the import' }));
    expect(await screen.findByText(/The last import was undone/)).toBeInTheDocument();
    expect(await fake.services.localStore.get(STORAGE_KEYS.applications)).toEqual(before);
    expect(screen.queryByRole('button', { name: /Undo last import/ })).not.toBeInTheDocument();
  });
});

describe('Delete all local data', () => {
  it('drops cached page analyses so they do not come back', async () => {
    const fake = renderPanel();
    await fake.services.sessionStore.set('job-analysis:7', jobResult());
    await fake.services.sessionStore.set('job-analysis:12', jobResult());
    await userEvent.click(screen.getByRole('tab', { name: 'Analyze' }));
    expect(
      await screen.findByText('Showing the earlier analysis of this tab.'),
    ).toBeInTheDocument();

    await openSettings();
    await userEvent.click(await screen.findByRole('button', { name: /Delete all local data/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete everything' }));
    expect(await screen.findByText(/along with the cached page analyses/)).toBeInTheDocument();
    expect(await fake.services.sessionStore.getAll()).toEqual({});
    expect(useAnalysis.getState().state.status).toBe('idle');

    await userEvent.click(screen.getByRole('tab', { name: 'Analyze' }));
    // Switching tabs re-asks for a cached analysis; there is none any more.
    act(() => fake.navigateTab(JOB_URL));
    expect(await screen.findByRole('button', { name: /Analyze this page/ })).toBeInTheDocument();
    expect(screen.queryByText('Showing the earlier analysis of this tab.')).not.toBeInTheDocument();
  });

  it('clears what another open page shows when data is deleted there', async () => {
    const fake = renderPanel();
    await fake.services.sessionStore.set('job-analysis:7', jobResult());
    await userEvent.click(screen.getByRole('tab', { name: 'Analyze' }));
    expect(
      await screen.findByText('Showing the earlier analysis of this tab.'),
    ).toBeInTheDocument();

    // The options page deletes everything (it clears the session cache first).
    await fake.services.sessionStore.clear();
    await act(() =>
      fake.services.localStore.set(STORAGE_KEYS.dataReset, {
        at: new Date().toISOString(),
        reason: 'deleted',
        origin: 'options-page',
      }),
    );
    expect(await screen.findByRole('button', { name: /Analyze this page/ })).toBeInTheDocument();
    expect(screen.queryByText('Showing the earlier analysis of this tab.')).not.toBeInTheDocument();
  });
});

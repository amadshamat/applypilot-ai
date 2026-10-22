import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { fillForm, scanForm } from '@applypilot/autofill';
import { extractJob } from '@applypilot/job-extraction';
import {
  STORAGE_KEYS,
  ok,
  type ApplicationRecord,
  type BackgroundRequest,
} from '@applypilot/shared';
import { createApplication, setFollowUp, setStatus } from '@applypilot/tracking';
import { sampleProfile } from '../../../packages/ai-core/test/fixtures';
import { useAnalysis } from '../src/features/analyze/store';
import { useTrackerFocus } from '../src/features/applications/focus-store';
import { useNavigation } from '../src/features/navigation/store';
import { ApplicationsRepository } from '../src/storage/applications-repository';
import { memoryStore } from '../src/storage/storage-area';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { fakeServices } from './fakes';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures');
const user = () => userEvent.setup();

async function render_(
  handler?: (request: BackgroundRequest) => unknown,
  { profile = false }: { profile?: boolean } = {},
) {
  const fake = fakeServices(handler);
  if (profile) await fake.services.profile.save(sampleProfile());
  render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
  return fake;
}

const stored = async (fake: ReturnType<typeof fakeServices>) =>
  (await fake.services.applications.load()).records;

/** Captures what the CSV export would download. */
function captureDownloads() {
  const blobs: Blob[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    },
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return blobs;
}

beforeEach(() => {
  useAnalysis.setState({ state: { status: 'idle' } });
  useNavigation.setState({ view: 'applications' });
  useTrackerFocus.setState({ openId: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('applications repository', () => {
  it('validates records and keeps entries it cannot read instead of dropping them', async () => {
    const store = memoryStore({ [STORAGE_KEYS.applications]: [{ id: 'future', shape: 'v9' }] });
    const repository = new ApplicationsRepository(store);
    const record = createApplication(
      {
        job: {
          title: 'Cloud Intern',
          company: 'Acme',
          location: '',
          url: '',
          jobKey: '',
          platform: 'manual',
          pay: '',
        },
        source: 'manual',
        status: 'saved',
        matchScore: null,
      },
      { now: () => new Date('2026-10-01T10:00:00Z'), newId: () => 'r1' },
    );
    await repository.upsert(record);
    expect(await repository.load()).toEqual({
      records: [record],
      unreadable: [{ id: 'future', shape: 'v9' }],
    });
    await expect(
      repository.upsert({ ...record, status: 'hired' } as unknown as ApplicationRecord),
    ).rejects.toThrow();
    await repository.remove('r1');
    expect(await store.get(STORAGE_KEYS.applications)).toEqual([{ id: 'future', shape: 'v9' }]);
  });
});

describe('Applications tab', () => {
  it('adds an application by hand, tracks status, notes and a follow-up, and survives a reload', async () => {
    const fake = await render_();
    expect(await screen.findByText('Nothing tracked yet')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /^Add$/ }));
    const form = screen.getByRole('form', { name: 'Add an application' });
    await user().click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText('Enter the job title.')).toBeInTheDocument();
    await user().type(within(form).getByLabelText('Job title'), 'Cloud Support Intern');
    await user().type(within(form).getByLabelText('Company'), 'Acme');
    await user().type(within(form).getByLabelText('Posting address (optional)'), 'not a url');
    await user().click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText(/full web address/)).toBeInTheDocument();
    await user().clear(within(form).getByLabelText('Posting address (optional)'));
    await user().type(
      within(form).getByLabelText('Posting address (optional)'),
      'https://jobs.example.com/42',
    );
    await user().click(within(form).getByRole('button', { name: 'Add' }));

    const card = await screen.findByRole('article', { name: 'Cloud Support Intern at Acme' });
    await user().selectOptions(
      within(card).getByLabelText('Status for Cloud Support Intern'),
      'applied',
    );
    await user().type(within(card).getByLabelText('New note'), 'Referred by Sam');
    await user().click(within(card).getByRole('button', { name: 'Add note' }));
    await user().click(within(card).getByRole('button', { name: 'In 1 week' }));

    await waitFor(async () => {
      const [record] = await stored(fake);
      expect(record?.history.map((h) => h.status)).toEqual(['saved', 'applied']);
      expect(record?.notes.map((n) => n.text)).toEqual(['Referred by Sam']);
      expect(record?.followUp?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record?.job.url).toBe('https://jobs.example.com/42');
    });
    expect(within(card).getByRole('link', { name: /Open the posting/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    // Adding the same job again opens the existing record instead of a duplicate.
    await user().click(screen.getByRole('button', { name: /^Add$/ }));
    const again = screen.getByRole('form', { name: 'Add an application' });
    await user().type(within(again).getByLabelText('Job title'), 'cloud support intern');
    await user().type(within(again).getByLabelText('Company'), 'ACME');
    await user().click(within(again).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/You already track Cloud Support Intern/)).toBeInTheDocument();
    expect(await stored(fake)).toHaveLength(1);
  });

  it('filters, reminds about due follow-ups, shows analytics and exports CSV', async () => {
    const fake = fakeServices();
    let n = 0;
    const clock = { now: () => new Date('2026-09-01T12:00:00Z'), newId: () => `r${++n}` };
    const make = (title: string, company: string) =>
      createApplication(
        {
          job: {
            title,
            company,
            location: 'Remote',
            url: '',
            jobKey: '',
            platform: 'indeed',
            pay: '',
          },
          source: 'analyzed',
          status: 'saved',
          matchScore: 70,
        },
        clock,
      );
    const later = new Date('2026-09-03T12:00:00Z');
    const records = [
      setFollowUp(
        setStatus(make('Cloud Intern', 'Acme'), 'applied', later),
        { due: '2020-01-01', note: 'Email Sam' },
        later,
      ),
      setStatus(
        setStatus(make('=HYPERLINK("http://x")', 'Globex'), 'applied', later),
        'interview',
        new Date('2026-09-08T12:00:00Z'),
      ),
      setStatus(make('Data Intern', 'Initech'), 'rejected', later),
    ];
    for (const r of records) await fake.services.applications.upsert(r);
    render(
      <ServicesProvider services={fake.services}>
        <SidePanelApp />
      </ServicesProvider>,
    );

    expect(await screen.findByText('Follow-ups due (1)')).toBeInTheDocument();
    expect(screen.getByText(/Cloud Intern at Acme: Email Sam/)).toBeInTheDocument();

    await user().selectOptions(screen.getByLabelText('Filter by status'), 'active');
    expect(
      screen.queryByRole('article', { name: 'Data Intern at Initech' }),
    ).not.toBeInTheDocument();
    await user().selectOptions(screen.getByLabelText('Filter by status'), 'all');
    await user().type(screen.getByLabelText('Search applications'), 'globex');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user().clear(screen.getByLabelText('Search applications'));
    await user().click(screen.getByLabelText('Follow-up due'));
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Cloud Intern at Acme',
    ]);

    await user().click(screen.getByRole('button', { name: 'Analytics' }));
    const analytics = screen.getByRole('region', { name: 'Analytics' });
    expect(within(analytics).getByText('Response rate').nextSibling).toHaveTextContent('67%');
    expect(within(analytics).getByText('2 of 3 answered')).toBeInTheDocument();
    expect(within(analytics).getByRole('list', { name: 'By status' })).toHaveTextContent(
      'Interview1',
    );

    const blobs = captureDownloads();
    await user().click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(blobs).toHaveLength(1);
    const csv = await blobs[0]?.text();
    expect(csv).toContain('Title,Company,Location,Status');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(screen.getByText('Exported 3 applications as CSV.')).toBeInTheDocument();

    await user().click(screen.getByRole('button', { name: 'List' }));
    await user().click(screen.getByRole('button', { name: 'Mark follow-up done: Cloud Intern' }));
    await waitFor(() => expect(screen.queryByText(/Follow-ups due/)).not.toBeInTheDocument());
  });

  it('saves an analyzed job with its match score, once', async () => {
    const url = 'http://127.0.0.1/jobs/json-ld-cloud-intern.html';
    const doc = new JSDOM(
      readFileSync(resolve(FIXTURES, 'jobs/json-ld-cloud-intern.html'), 'utf8'),
      {
        url,
      },
    ).window.document;
    const result = extractJob(doc, url);
    useNavigation.setState({ view: 'analyze' });
    const fake = await render_(
      (request) => (request.type === 'job/extract-active-tab' ? ok(result) : ok(null)),
      { profile: true },
    );
    await user().click(await screen.findByRole('button', { name: /Analyze this page/ }));
    const tracker = await screen.findByLabelText('Application tracker');
    await user().click(within(tracker).getByRole('button', { name: /Save to tracker/ }));
    await waitFor(() => expect(within(tracker).getByText('In your tracker')).toBeInTheDocument());
    const [record] = await stored(fake);
    expect(record).toMatchObject({
      source: 'analyzed',
      status: 'saved',
      job: { title: 'Cloud Engineering Intern', company: 'Northwind Cloud', platform: 'generic' },
    });
    expect(record?.matchScore).toEqual(expect.any(Number));
    expect(record?.job.pay).toBe('$28 – $34 per hour');

    await user().click(within(tracker).getByRole('button', { name: 'Open' }));
    expect(
      await screen.findByRole('article', { name: 'Cloud Engineering Intern at Northwind Cloud' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details', expanded: true })).toBeInTheDocument();
  });

  it('marks an application as applied after a fill only when the user says so', async () => {
    const formUrl = 'https://careers.northwind.example/apply/42';
    const dom = new JSDOM(
      readFileSync(resolve(FIXTURES, 'applications/generic-application.html'), 'utf8'),
      {
        url: formUrl,
        runScripts: 'dangerously',
        pretendToBeVisual: true,
      },
    );
    const page = dom.window.document;
    useNavigation.setState({ view: 'autofill' });
    const fake = await render_(
      (request) => {
        if (request.type === 'autofill/scan') return ok(scanForm(page));
        if (request.type === 'autofill/fill')
          return fillForm(page, request.instructions, { settleMs: 10 }).then(ok);
        return ok(null);
      },
      { profile: true },
    );
    await user().click(await screen.findByRole('button', { name: 'Scan this form' }));
    await user().click(await screen.findByRole('button', { name: /^Fill \d+ approved fields$/ }));
    const card = await screen.findByLabelText('Track this application');
    expect(await stored(fake)).toEqual([]);
    await user().click(
      within(card).getByRole('button', { name: 'I submitted it: mark as applied' }),
    );
    await waitFor(async () => {
      const [record] = await stored(fake);
      expect(record).toMatchObject({
        source: 'autofill',
        status: 'applied',
        job: { title: 'Apply for Cloud Engineering Intern', url: formUrl },
      });
    });
    expect(within(card).getByText(/is marked Applied in your tracker/)).toBeInTheDocument();
  });
});

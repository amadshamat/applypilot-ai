import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { extractJob } from '@applypilot/job-extraction';
import { ResumeFileError } from '@applypilot/resume-parser/files';
import { emptyProfileContent, ok, type BackgroundRequest } from '@applypilot/shared';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { fakeServices, type FakeOptions } from './fakes';

const ROOT = resolve(import.meta.dirname, '../../../tests/fixtures');
const SAMPLE_RESUME = readFileSync(resolve(ROOT, 'resumes/sample-resume.txt'), 'utf8');

function renderPanel(options: FakeOptions = {}, handler?: (request: BackgroundRequest) => unknown) {
  const fake = fakeServices(handler, options);
  render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
  return fake;
}

const user = () => userEvent.setup({ applyAccept: false });
const pdf = (name = 'jordan-rivera.pdf') =>
  new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' });

async function openResumes(u: ReturnType<typeof user>) {
  await u.click(screen.getByRole('tab', { name: 'Profile' }));
  await u.click(await screen.findByRole('button', { name: 'Resumes' }));
}

beforeEach(() => {
  useAnalysis.setState({ state: { status: 'idle' } });
  useNavigation.setState({ view: 'analyze' });
});

describe('resume upload and review', () => {
  it('parses an uploaded resume, lets the user correct it, and saves only on confirm', async () => {
    const u = user();
    const { services } = renderPanel({ resumeText: SAMPLE_RESUME });
    await u.click(screen.getByRole('tab', { name: 'Profile' }));
    // Empty profile offers both starting points.
    await u.click(await screen.findByRole('button', { name: /Upload a resume/ }));
    await u.upload(screen.getByLabelText('Choose a file'), pdf());

    expect(
      await screen.findByRole('heading', { name: 'Review jordan-rivera.pdf' }),
    ).toBeInTheDocument();
    // Nothing saved yet.
    await expect(services.profile.load()).resolves.toEqual({ status: 'empty' });

    const name = screen.getByLabelText('Full name');
    expect(name).toHaveValue('Jordan Rivera');
    await u.clear(name);
    await u.type(name, 'Jordan A. Rivera');
    expect(screen.getByRole('region', { name: 'Experience' })).toHaveTextContent(
      'Cloud Engineering Intern',
    );
    expect(screen.getByRole('region', { name: 'Skills' })).toHaveTextContent('Terraform');

    await u.click(screen.getByRole('button', { name: 'Save to profile' }));
    expect(await screen.findByText('Your profile was saved from this resume.')).toBeInTheDocument();

    const saved = await services.profile.load();
    expect(saved.status).toBe('ok');
    if (saved.status !== 'ok') return;
    expect(saved.profile.personal.fullName).toBe('Jordan A. Rivera');
    expect(saved.profile.experience.map((e) => e.employer)).toEqual([
      'Northwind Logistics',
      'University of Toronto Libraries',
    ]);
    const [version] = await services.resumes.list();
    expect(version?.appliedAt).not.toBeNull();
  });

  it('adds only new items when merging into an existing profile', async () => {
    const u = user();
    const { services } = renderPanel({ resumeText: SAMPLE_RESUME });
    const existing = emptyProfileContent();
    existing.personal.fullName = 'Typed By Me';
    existing.skills = [{ id: 'k', name: 'Python', category: 'language' }];
    await services.profile.save(existing);

    await openResumes(u);
    await u.upload(screen.getByLabelText('Choose a file'), pdf());
    expect(await screen.findByRole('radio', { name: /Add what's new/ })).toBeChecked();
    await u.click(screen.getByRole('button', { name: 'Save to profile' }));

    expect(await screen.findByText(/Skipped 1 already in your profile/)).toBeInTheDocument();
    const saved = await services.profile.load();
    if (saved.status !== 'ok') throw new Error('expected a saved profile');
    expect(saved.profile.personal.fullName).toBe('Typed By Me');
    expect(saved.profile.skills.filter((s) => s.name === 'Python')).toHaveLength(1);
    expect(saved.profile.skills.length).toBeGreaterThan(5);
  });

  it('rejects unsupported files before reading them', async () => {
    const u = user();
    const { services } = renderPanel({ resumeText: SAMPLE_RESUME });
    await openResumes(u);
    await u.upload(
      screen.getByLabelText('Choose a file'),
      new File(['x'], 'resume.doc', { type: 'application/msword' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Old Word (.doc) files are not supported',
    );
    expect(services.readResumeText).not.toHaveBeenCalled();
  });

  it('shows the reader’s explanation when a file has no text', async () => {
    const u = user();
    renderPanel({
      resumeText: new ResumeFileError(
        'No selectable text was found. This PDF may be a scanned image.',
      ),
    });
    await openResumes(u);
    await u.upload(screen.getByLabelText('Choose a file'), pdf('scan.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('scanned image');
  });

  it('lists uploaded resumes and deletes one only after confirmation', async () => {
    const u = user();
    const { services } = renderPanel({ resumeText: SAMPLE_RESUME });
    await openResumes(u);
    await u.upload(screen.getByLabelText('Choose a file'), pdf('first.pdf'));
    await u.click(await screen.findByRole('button', { name: 'Not now' }));

    const list = await screen.findByRole('region', { name: 'Saved resumes' });
    expect(within(list).getByText('first.pdf')).toBeInTheDocument();
    expect(within(list).getByText('Not applied')).toBeInTheDocument();
    await u.click(within(list).getByRole('button', { name: 'Delete first.pdf' }));
    expect(await services.resumes.list()).toHaveLength(1);
    await u.click(within(list).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await services.resumes.list()).toHaveLength(0));
  });
});

describe('profile editor', () => {
  it('opens the saved profile, follows saves from other pages, and keeps unsaved edits', async () => {
    const u = user();
    const { services } = renderPanel();
    const saved = emptyProfileContent();
    saved.personal.fullName = 'Saved Name';
    saved.skills = [{ id: 'a', name: 'Go', category: 'language' }];
    await services.profile.save(saved);

    await u.click(screen.getByRole('tab', { name: 'Profile' }));
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Saved Name'));

    // Saved from the options page while nothing is edited here: the editor follows.
    await services.profile.save({ ...saved, summary: 'Updated elsewhere' });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Updated elsewhere'),
    );

    // With unsaved edits, an outside save does not overwrite what the user typed.
    await u.type(screen.getByLabelText('Location'), 'Toronto, ON');
    await services.profile.save({ ...saved, summary: 'Another outside save' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText('Location')).toHaveValue('Toronto, ON');
  });

  it('adds, validates, saves and deletes entries', async () => {
    const u = user();
    const { services } = renderPanel();
    await u.click(screen.getByRole('tab', { name: 'Profile' }));
    await u.click(await screen.findByRole('button', { name: /Fill in by hand/ }));

    const experience = screen.getByRole('region', { name: 'Experience' });
    await u.click(within(experience).getByRole('button', { name: 'Add' }));
    await u.type(within(experience).getByLabelText('Position'), 'IT Support Assistant');
    await u.type(within(experience).getByLabelText('Start'), 'Sept 2023');
    await u.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(
      await screen.findByText('Use YYYY or YYYY-MM, for example 2024-05.'),
    ).toBeInTheDocument();
    await expect(services.profile.load()).resolves.toEqual({ status: 'empty' });

    await u.clear(within(experience).getByLabelText('Start'));
    await u.type(within(experience).getByLabelText('Start'), '2023-09');
    await u.click(within(experience).getByLabelText('I currently work here'));
    await u.type(
      within(experience).getByLabelText('What you did'),
      'Resolved tickets{Enter}Wrote guides',
    );

    const skills = screen.getByRole('region', { name: 'Skills' });
    await u.type(within(skills).getByLabelText('New skill'), 'k8s{Enter}');
    expect(within(skills).getByLabelText('Category for k8s')).toHaveValue('devops');

    await u.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    const saved = await services.profile.load();
    if (saved.status !== 'ok') throw new Error('expected a saved profile');
    expect(saved.profile.experience[0]).toMatchObject({
      position: 'IT Support Assistant',
      startDate: '2023-09',
      current: true,
      bullets: ['Resolved tickets', 'Wrote guides'],
    });

    await u.click(within(experience).getByRole('button', { name: 'Delete IT Support Assistant' }));
    await u.click(within(experience).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(within(experience).getByText('IT Support Assistant')).toBeInTheDocument();
  });
});

describe('match card', () => {
  it('scores an analyzed job against the saved profile with evidence and suggestions', async () => {
    const u = user();
    const url = 'http://127.0.0.1/jobs/json-ld-cloud-intern.html';
    const doc = new JSDOM(readFileSync(resolve(ROOT, 'jobs/json-ld-cloud-intern.html'), 'utf8'), {
      url,
    }).window.document;
    const result = extractJob(doc, url);
    const { services } = renderPanel({}, (request) =>
      request.type === 'job/extract-active-tab' ? ok(result) : ok(null),
    );
    const profile = emptyProfileContent();
    profile.skills = [
      { id: '1', name: 'Python', category: 'language' },
      { id: '2', name: 'Linux', category: 'devops' },
    ];
    await services.profile.save(profile);

    await u.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    const card = await screen.findByRole('region', { name: 'Match score' });
    const score = await within(card).findByLabelText(/Match score \d+ out of 100/);
    expect(score).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Score breakdown' })).toHaveTextContent(
      'Required skills',
    );
    expect(within(card).getAllByText('Linux')[0]?.closest('[title]')).toHaveAttribute(
      'title',
      'You have this. Found in: Skills list',
    );
    expect(within(card).getAllByText('Git')[0]?.closest('[title]')).toHaveAttribute(
      'title',
      'Not in your profile',
    );
    expect(within(card).getByText(/Not in your profile: /)).toBeInTheDocument();
    expect(
      within(card).getByText(/not a prediction of whether you will be hired/),
    ).toBeInTheDocument();
  });
});

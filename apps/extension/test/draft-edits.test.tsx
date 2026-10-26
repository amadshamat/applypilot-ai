import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { writeBuffered } from '../src/features/ai/edit-buffer';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { JOB_URL, analyzedJob, renderAi } from './ai-harness';

const user = () => userEvent.setup();
const SAVED = { timeout: 3000 };
const letterBox = () =>
  screen.findByLabelText<HTMLTextAreaElement>('Cover letter (edit before you use it)');
const storedLetter = async (services: Awaited<ReturnType<typeof renderAi>>['services']) =>
  (await services.aiDrafts.find('cover-letter', JOB_URL))?.edits?.letter;

async function generateLetter(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole('button', { name: 'Cover letter' }));
  await u.click(screen.getByRole('button', { name: 'Generate cover letter' }));
  return letterBox();
}

/** Closes the panel and opens it again on the same job, as reopening the side panel does. */
function reopen(fake: Awaited<ReturnType<typeof renderAi>>) {
  fake.view.unmount();
  useAnalysis.setState({ state: { status: 'success', result: analyzedJob(), fromCache: true } });
  useNavigation.setState({ view: 'tailor' });
  return render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useAnalysis.setState({ state: { status: 'idle' } });
  useNavigation.setState({ view: 'analyze' });
});

describe('editing AI drafts', () => {
  it('saves edits automatically and shows them again after reopening', async () => {
    const u = user();
    const fake = await renderAi();
    const letter = await generateLetter(u);
    const generated = letter.value;
    expect(screen.getByText('Edits are saved automatically')).toBeInTheDocument();

    await u.type(letter, ' Thank you.');
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(await screen.findByText('All changes saved', {}, SAVED)).toBeInTheDocument();
    expect(await storedLetter(fake.services)).toBe(`${generated} Thank you.`);
    // The generated text is still stored beside the edit.
    const stored = await fake.services.aiDrafts.find('cover-letter', JOB_URL);
    expect(stored?.response.output.closing).toBeDefined();

    reopen(fake);
    await u.click(await screen.findByRole('button', { name: 'Cover letter' }));
    expect((await letterBox()).value).toBe(`${generated} Thank you.`);
    expect(screen.getByText(/Edited ·/)).toBeInTheDocument();
  });

  it('keeps an edit typed just before the panel closes', async () => {
    const u = user();
    const fake = await renderAi();
    const letter = await generateLetter(u);
    await u.type(letter, '!');
    // Closed before the save delay passed: the pending change is stored on close.
    fake.view.unmount();
    await waitFor(async () => expect(await storedLetter(fake.services)).toMatch(/!$/));
  });

  it('recovers a change that never reached storage', async () => {
    const u = user();
    const fake = await renderAi();
    const letter = await generateLetter(u);
    const generatedAt = (await fake.services.aiDrafts.find('cover-letter', JOB_URL))!.response
      .generatedAt;
    // As if the browser closed before chrome.storage finished the write.
    writeBuffered(
      { task: 'cover-letter', jobKey: JOB_URL, generatedAt, part: 'letter' },
      `${letter.value} Unsaved`,
    );
    reopen(fake);
    await u.click(await screen.findByRole('button', { name: 'Cover letter' }));
    expect((await letterBox()).value).toMatch(/ Unsaved$/);
    expect(await screen.findByText('All changes saved', {}, SAVED)).toBeInTheDocument();
    expect(await storedLetter(fake.services)).toMatch(/ Unsaved$/);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('reverts to the generated text only after confirming', async () => {
    const u = user();
    const fake = await renderAi();
    const letter = await generateLetter(u);
    const generated = letter.value;
    await u.type(letter, ' Extra');
    await screen.findByText('All changes saved', {}, SAVED);

    await u.click(screen.getByRole('button', { name: /Revert to generated text/ }));
    expect(screen.getByText(/Discard your edits to this text/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Keep my edits' }));
    expect(letter.value).toBe(`${generated} Extra`);

    await u.click(screen.getByRole('button', { name: /Revert to generated text/ }));
    await u.click(screen.getByRole('button', { name: 'Yes, discard my edits' }));
    expect(letter.value).toBe(generated);
    await waitFor(async () => expect(await storedLetter(fake.services)).toBeUndefined());
    expect(
      screen.queryByRole('button', { name: /Revert to generated text/ }),
    ).not.toBeInTheDocument();
  });

  it('asks before generating over edits and keeps the edited version to restore', async () => {
    const u = user();
    const fake = await renderAi();
    const letter = await generateLetter(u);
    await u.type(letter, ' Mine');
    await screen.findByText('All changes saved', {}, SAVED);

    await u.click(screen.getByRole('button', { name: 'Generate again' }));
    expect(screen.getByText(/You edited this draft/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Keep my edited draft' }));
    expect(letter.value).toMatch(/ Mine$/);

    await u.click(screen.getByRole('button', { name: 'Generate again' }));
    await u.click(screen.getByRole('button', { name: 'Generate a new draft' }));
    expect(await screen.findByText('Your edited version is kept')).toBeInTheDocument();
    expect((await letterBox()).value).not.toMatch(/ Mine$/);

    await u.click(screen.getByRole('button', { name: /Restore my edited version/ }));
    await waitFor(async () => expect((await letterBox()).value).toMatch(/ Mine$/));
    expect(await storedLetter(fake.services)).toMatch(/ Mine$/);
  });

  it('asks before discarding an edited draft', async () => {
    const u = user();
    const fake = await renderAi();
    const letter = await generateLetter(u);
    await u.type(letter, ' Mine');
    await screen.findByText('All changes saved', {}, SAVED);
    await u.click(screen.getByRole('button', { name: /Discard draft/ }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await fake.services.aiDrafts.list()).toHaveLength(1);
    await u.click(screen.getByRole('button', { name: /Discard draft/ }));
    await u.click(screen.getByRole('button', { name: 'Yes, discard' }));
    await waitFor(async () => expect(await fake.services.aiDrafts.list()).toEqual([]));
  });

  it('saves each screening answer separately', async () => {
    const u = user();
    const fake = await renderAi();
    await u.click(await screen.findByRole('button', { name: 'Questions' }));
    await u.type(
      screen.getByLabelText('Questions'),
      'Describe your experience with AWS.\nDescribe a project you are proud of.',
    );
    await u.click(screen.getByRole('button', { name: 'Draft 2 answers' }));
    const boxes = await screen.findAllByLabelText<HTMLTextAreaElement>(
      'Draft answer (edit before you use it)',
    );
    expect(boxes).toHaveLength(2);
    await u.type(boxes[1]!, ' Second.');
    await u.type(boxes[0]!, ' First.');
    await waitFor(async () => {
      const edits = (await fake.services.aiDrafts.find('screening-answers', JOB_URL))?.edits;
      expect(edits?.Q1).toMatch(/ First\.$/);
      expect(edits?.Q2).toMatch(/ Second\.$/);
    }, SAVED);
  });

  it('makes the tailored resume editable and keeps the edits per job', async () => {
    const u = user();
    const fake = await renderAi();
    await u.click(await screen.findByRole('button', { name: 'Generate tailored resume' }));
    const box = await screen.findByLabelText<HTMLTextAreaElement>(
      'Tailored resume text (edit before you use it)',
    );
    await u.type(box, '\nCertified Cloud Practitioner (in progress)');
    await screen.findByText('All changes saved', {}, SAVED);
    const drafts = await fake.services.aiDrafts.list();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ task: 'tailor-resume', jobKey: JOB_URL });
    expect(drafts[0]?.edits?.resume).toMatch(/in progress\)$/);
    // Another job has no draft and no edits.
    expect(
      await fake.services.aiDrafts.find('tailor-resume', 'https://jobs.example/other'),
    ).toBeNull();
    const card = box.closest('div')!;
    expect(within(card.parentElement!).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { fillForm, formChanges, scanForm } from '@applypilot/autofill';
import { fail, ok, type BackgroundRequest, type FillInstruction } from '@applypilot/shared';
import { sampleProfile } from '../../../packages/ai-core/test/fixtures';
import { createApi } from '../../../services/api/src/app';
import { createMockProvider } from '../../../services/api/src/providers/mock';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { createAiClient } from '../src/services/ai-client';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { DEFAULT_API_URL } from '../src/storage/ai-connection-repository';
import { STATUS_POLL_MS } from '../src/features/autofill/use-autofill';
import { fakeServices } from './fakes';

const TOKEN = 'local-test-token-abcdefghijklmnop';
const APPLICATIONS = resolve(import.meta.dirname, '../../../tests/fixtures/applications');
const FORM_URL = 'https://careers.northwind.example/apply/42';

function loadForm(name = 'generic-application.html', url = FORM_URL) {
  const dom = new JSDOM(readFileSync(resolve(APPLICATIONS, name), 'utf8'), {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  return { dom, doc: dom.window.document, win: dom.window as unknown as { submitCount: number } };
}

/** The real API with the mock provider, behind a fake fetch. */
function localApi() {
  const handle = createApi({
    config: {
      version: '0.1.0',
      host: '127.0.0.1',
      port: 8787,
      token: TOKEN,
      provider: 'mock',
      anthropicApiKey: null,
      model: 'claude-opus-5-5',
      effort: 'medium',
      dailyLimit: 25,
      allowedOrigins: [],
      maxBodyBytes: 300_000,
    },
    provider: createMockProvider(),
  });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const res = await handle({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: {
        authorization: headers.get('authorization') ?? undefined,
        'content-type': headers.get('content-type') ?? undefined,
      },
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(JSON.stringify(res.body), { status: res.status });
  });
  return { client: createAiClient(fetchImpl), fetchImpl };
}

/** A background that scans and fills a real sample page, as the content script would. */
function pageBackground(doc: Document, filled: FillInstruction[][]) {
  return async (request: BackgroundRequest) => {
    if (request.type === 'autofill/scan')
      return ok(scanForm(doc, { keepRefs: request.keepRefs === true }));
    if (request.type === 'autofill/fill') {
      filled.push(request.instructions);
      return ok(await fillForm(doc, request.instructions, { settleMs: 10 }));
    }
    if (request.type === 'autofill/status')
      return ok({ samePage: true, reachable: true, ...formChanges(doc) });
    return ok(null);
  };
}

async function renderAutofill(
  handler: (request: BackgroundRequest) => unknown,
  { profile = true, ai = false }: { profile?: boolean; ai?: boolean } = {},
) {
  const api = localApi();
  const fake = fakeServices(handler, { ai: api.client });
  if (profile) await fake.services.profile.save(sampleProfile());
  if (ai) {
    await fake.services.settings.update({ allowAiProcessing: true });
    await fake.services.aiConnection.save({ apiUrl: DEFAULT_API_URL, token: TOKEN });
  }
  useNavigation.setState({ view: 'autofill' });
  render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
  return { ...fake, ...api };
}

const user = () => userEvent.setup();

beforeEach(() => {
  useAnalysis.setState({ state: { status: 'idle' } });
});

describe('Autofill tab', () => {
  it('asks for a profile before anything else', async () => {
    await renderAutofill(() => ok(null), { profile: false });
    expect(await screen.findByText('Build your profile first')).toBeInTheDocument();
  });

  it('scans, shows proposals with sources, keeps sensitive fields locked, and fills only approved fields', async () => {
    const { doc, win } = loadForm();
    const filled: FillInstruction[][] = [];
    await renderAutofill(pageBackground(doc, filled));
    await user().click(await screen.findByRole('button', { name: 'Scan this form' }));

    expect(await screen.findByText('Apply for Cloud Engineering Intern')).toBeInTheDocument();
    expect(screen.getByText('Experimental')).toBeInTheDocument();
    const ready = screen.getByRole('region', { name: 'Ready to fill' });
    expect(within(ready).getByLabelText('Value for Email')).toHaveValue('avery@example.com');
    expect(within(ready).getAllByText(/Profile · Email/)[0]).toBeInTheDocument();
    expect(within(ready).getByRole('checkbox', { name: 'Fill Email' })).toBeChecked();

    // Sensitive and personal questions have no value and no way to approve them.
    const manual = screen.getByRole('region', { name: 'You answer these on the page' });
    for (const label of [
      'Gender',
      'Veteran status',
      'Desired salary',
      'Are you legally authorized to work in the United States?',
    ]) {
      expect(within(manual).getByText(label)).toBeInTheDocument();
      expect(
        within(manual).queryByRole('checkbox', { name: `Fill ${label}` }),
      ).not.toBeInTheDocument();
    }

    // The user deselects one field and types a missing one.
    await user().click(within(ready).getByRole('checkbox', { name: 'Fill Phone' }));
    const missing = screen.getByRole('region', { name: 'Missing from your profile' });
    await user().type(within(missing).getByLabelText('Value for Cover letter'), 'Dear team');

    const fillButton = screen.getByRole('button', { name: /^Fill \d+ approved fields$/ });
    await user().click(fillButton);
    expect(await screen.findByRole('status', { name: 'Fill results' })).toHaveTextContent(
      /Filled \d+ fields/,
    );

    const labels = filled[0]?.map((i) => i.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(['First name', 'Email', 'Cover letter']));
    expect(labels).not.toContain('Phone');
    for (const sensitive of [
      'Gender',
      'Veteran status',
      'Desired salary',
      'I agree to the privacy policy',
    ]) {
      expect(labels).not.toContain(sensitive);
    }
    expect((doc.querySelector('#email') as HTMLInputElement).value).toBe('avery@example.com');
    expect((doc.querySelector('#phone') as HTMLInputElement).value).toBe('');
    expect(win.submitCount).toBe(0);
    expect(screen.getByText(/Nothing was submitted/)).toBeInTheDocument();
  });

  it('reports scan errors and refuses to fill a page that changed', async () => {
    const { doc } = loadForm();
    let scans = 0;
    await renderAutofill((request) => {
      if (request.type === 'autofill/scan') {
        scans += 1;
        return scans === 1
          ? fail('PERMISSION_REQUIRED', 'ApplyPilot needs your permission to read this page.')
          : ok(scanForm(doc));
      }
      if (request.type === 'autofill/fill')
        return fail('PAGE_CHANGED', 'This tab now shows a different page. Scan the form again.');
      return ok(null);
    });
    await user().click(await screen.findByRole('button', { name: 'Scan this form' }));
    expect(await screen.findByText('The form could not be scanned')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Scan this form' }));
    await user().click(await screen.findByRole('button', { name: /^Fill \d+ approved fields$/ }));
    expect(await screen.findByText(/This tab now shows a different page/)).toBeInTheDocument();
  });

  it('uses AI only on request, sending field labels and no profile data', async () => {
    const doc = new JSDOM(
      `<form><label for="a">Email</label><input id="a" type="email"><label for="b">Handle on the code hosting site</label><input id="b"></form>`,
      { url: FORM_URL, pretendToBeVisual: true },
    ).window.document;
    const { fetchImpl } = await renderAutofill(pageBackground(doc, []), { ai: true });
    await user().click(await screen.findByRole('button', { name: 'Scan this form' }));
    const other = await screen.findByRole('region', { name: 'Not recognised or not supported' });
    expect(within(other).getByText('Handle on the code hosting site')).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();

    await user().click(screen.getByRole('button', { name: 'Match fields with AI' }));
    const review = await screen.findByRole('region', { name: 'Check these' });
    expect(within(review).getByLabelText('Value for Handle on the code hosting site')).toHaveValue(
      'https://github.com/avery',
    );
    expect(
      within(review).getByRole('checkbox', { name: 'Fill Handle on the code hosting site' }),
    ).not.toBeChecked();
    expect(within(review).getByText(/AI-matched/)).toBeInTheDocument();

    const body = fetchImpl.mock.calls.find(([url]) =>
      (url instanceof Request ? url.url : url.toString()).endsWith('/v1/map-fields'),
    )?.[1]?.body as string;
    expect(JSON.parse(body)).toEqual({
      fields: [
        {
          id: 'F1',
          label: 'Handle on the code hosting site',
          hint: '',
          section: '',
          control: 'text',
          options: [],
        },
      ],
    });
    expect(body).not.toMatch(/avery|example\.com|github\.com/i);
  });

  it('hides the AI step when AI processing is off', async () => {
    const doc = new JSDOM(
      `<form><label for="b">Handle on the code hosting site</label><input id="b"><input aria-label="Email" type="email"></form>`,
      {
        url: FORM_URL,
        pretendToBeVisual: true,
      },
    ).window.document;
    await renderAutofill(pageBackground(doc, []));
    await user().click(await screen.findByRole('button', { name: 'Scan this form' }));
    await waitFor(() =>
      expect(screen.getByText('Handle on the code hosting site')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Match fields with AI' })).not.toBeInTheDocument();
  });

  describe('conditional questions', () => {
    const CONDITIONAL_URL = 'https://careers.contoso.example/apply/7';
    type PageCounts = { nextCount: number; submitCount: number; formSubmits: number };

    it('re-scans after a fill, keeps reviewed answers, and fills new questions only once ticked', async () => {
      const { dom, doc } = loadForm('conditional-application.html', CONDITIONAL_URL);
      const page = dom.window as unknown as PageCounts;
      const filled: FillInstruction[][] = [];
      await renderAutofill(pageBackground(doc, filled));
      await user().click(await screen.findByRole('button', { name: 'Scan this form' }));

      // Yes/No buttons: work authorization and sponsorship stay locked.
      const manual = await screen.findByRole('region', { name: 'You answer these on the page' });
      for (const label of [
        'Are you legally authorized to work in the United States?',
        'Will you now or in the future require visa sponsorship?',
        'What are your salary expectations?',
        'Gender',
      ]) {
        expect(within(manual).getByText(label)).toBeInTheDocument();
        expect(within(manual).queryByRole('checkbox', { name: `Fill ${label}` })).toBeNull();
      }
      // The profile has a GitHub link, so Yes is proposed, but not ticked.
      const review = screen.getByRole('region', { name: 'Check these' });
      const github = 'Do you have a public GitHub profile?';
      expect(within(review).getByLabelText(`Value for ${github}`)).toHaveValue('yes');
      const githubTick = within(review).getByRole('checkbox', { name: `Fill ${github}` });
      expect(githubTick).not.toBeChecked();
      await user().click(githubTick);
      // The user answers the AWS question with its Yes button.
      const other = screen.getByRole('region', { name: 'Not recognised or not supported' });
      await user().selectOptions(
        within(other).getByLabelText('Value for Have you used AWS in a project or job?'),
        'Yes',
      );
      // And unticks Email, which must stay unticked after the re-scan.
      await user().click(screen.getByRole('checkbox', { name: 'Fill Email' }));

      await user().click(screen.getByRole('button', { name: 'Fill 3 approved fields' }));
      expect(filled[0]?.map((i) => i.label)).toEqual([
        'Full name',
        'Have you used AWS in a project or job?',
        github,
      ]);
      expect(await screen.findByText('3 new questions found')).toBeInTheDocument();
      const rows = () => screen.getAllByTestId('autofill-row');
      const newRows = () => rows().filter((r) => r.dataset.new === 'true');
      expect(
        newRows()
          .map((r) => within(r).getAllByText(/./)[0]?.textContent)
          .sort(),
      ).toEqual([
        'Describe a project where you used AWS.',
        'GitHub URL',
        'Highest level of education',
      ]);
      // Revealed fields map to the profile, but none is ticked.
      const githubUrl = screen.getByLabelText('Value for GitHub URL');
      expect(githubUrl).toHaveValue('https://github.com/avery');
      expect(screen.getByRole('checkbox', { name: 'Fill GitHub URL' })).not.toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: 'Fill Highest level of education' }),
      ).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Fill Email' })).not.toBeChecked();
      // Answers already on the page are not sent again.
      expect(screen.getByRole('button', { name: /^Fill 0 approved field/ })).toBeDisabled();

      await user().click(screen.getByRole('checkbox', { name: 'Fill GitHub URL' }));
      await user().click(screen.getByRole('checkbox', { name: 'Fill Highest level of education' }));
      await user().click(screen.getByRole('button', { name: 'Fill 2 approved fields' }));
      await waitFor(() => expect(filled).toHaveLength(2));
      expect(filled[1]?.map((i) => i.label)).toEqual(['Highest level of education', 'GitHub URL']);
      expect((doc.getElementById('github') as HTMLInputElement).value).toBe(
        'https://github.com/avery',
      );
      expect(doc.getElementById('degree')?.textContent.trim()).toBe("Bachelor's Degree");
      expect((doc.getElementById('email') as HTMLInputElement).value).toBe('');
      expect(doc.querySelector('.choices [aria-checked="true"]')).toBeNull();
      expect(page.nextCount + page.submitCount + page.formSubmits).toBe(0);
    });

    it(
      'notices questions that appear later and scans for them on request',
      async () => {
        const { doc } = loadForm('conditional-application.html', CONDITIONAL_URL);
        const filled: FillInstruction[][] = [];
        await renderAutofill(pageBackground(doc, filled));
        await user().click(await screen.findByRole('button', { name: 'Scan this form' }));
        await user().click(await screen.findByRole('checkbox', { name: 'Fill Full name' }));
        const other = await screen.findByRole('region', {
          name: 'Not recognised or not supported',
        });
        await user().selectOptions(
          within(other).getByLabelText(
            'Value for Are you open to working from one of our offices?',
          ),
          'Yes',
        );
        await user().click(screen.getByRole('button', { name: /^Fill 2 approved fields$/ }));
        await screen.findByRole('status', { name: 'Fill results' });
        // The office question loads after the fill; the panel's check finds it.
        expect(
          await screen.findByText(
            'New questions appeared on the page',
            {},
            { timeout: STATUS_POLL_MS * 2 },
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText('Which team interests you most?')).toBeNull();
        const alert = screen.getByText('New questions appeared on the page').closest('[role]')!;
        await user().click(
          within(alert as HTMLElement).getByRole('button', { name: 'Scan for new questions' }),
        );
        expect(await screen.findByText('Which team interests you most?')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Fill Email' })).toBeChecked();
        expect(filled).toHaveLength(1);
      },
      STATUS_POLL_MS * 4,
    );
  });
});

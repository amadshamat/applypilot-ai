import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobExtractionResultSchema, type ExtractedField } from '@applypilot/shared';
import { extractFromText, extractJob, outlinePage } from '../src';
import { htmlDocument, loadFixture } from './helpers';

/**
 * Regression for the fourth real-world test (2026-10-20). On an Indeed search
 * page with "Server / Bartender" at PaperMoon Springfield open on the right,
 * the analyzer reported "Untitled position", no company, location or salary,
 * and "No job is open on this Indeed page."
 *
 * The details were in a frame the page could not read: its document belongs
 * to another Indeed address, so from the page `contentDocument` is null and
 * the frame looked empty. The content script now also runs inside the frame
 * (when Chrome allows it) and reads the job there; when Chrome does not allow
 * it, the result names the blocked frame so the side panel can ask for access
 * or offer to paste the job instead.
 */

const NOW = () => new Date('2026-10-20T12:00:00.000Z');
const PAPERMOON = 'e1f2a3b4c5d6e7f8';
const SEARCH = `https://www.indeed.com/jobs?q=server+bartender&l=Springfield%2C+VA&vjk=${PAPERMOON}`;
const FRAME = `https://jobs.indeed.com/viewjob?jk=${PAPERMOON}&viewtype=embedded`;

/** Text that belongs to the other result card and must never be used. */
const OTHER_CARD = ['Brookfield Tavern', 'Burke', '22015', '$14', 'Full-time'];

function value<T>(field: ExtractedField<T>): T | undefined {
  return field.status === 'found' ? field.value : undefined;
}

function fixtureBody(name: string): string {
  const html = readFileSync(
    resolve(import.meta.dirname, '../../../tests/fixtures/jobs', name),
    'utf8',
  );
  return /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
}

/** The search page, with the details frame pointing at another origin it cannot read. */
function blockedFramePage(): Document {
  const doc = loadFixture('indeed-search-papermoon.html', SEARCH);
  const frame = doc.querySelector('iframe')!;
  frame.setAttribute('src', FRAME);
  // This is what Chrome gives the page for a frame on another origin.
  Object.defineProperty(frame, 'contentDocument', { get: () => null });
  return doc;
}

function expectPaperMoon(result: ReturnType<typeof extractJob>) {
  expect(result.isJobPosting).toBe(true);
  expect(value(result.job.title)).toBe('Server / Bartender');
  expect(value(result.job.company)).toBe('PaperMoon Springfield');
  expect(value(result.job.location)).toBe('6315 Amherst Avenue, Springfield, VA 22150');
  expect(value(result.job.salary)).toMatchObject({ min: 15.54, max: 17.29, period: 'hour' });
  expect(value(result.job.employmentType)).toEqual(['part-time']);
  expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
  const text = JSON.stringify(result.job);
  for (const other of OTHER_CARD) expect(text).not.toContain(other);
}

describe('Indeed: details frame on another origin (PaperMoon report)', () => {
  it('reports the blocked frame instead of guessing from the search page', () => {
    const result = extractJob(blockedFramePage(), SEARCH, { now: NOW });
    expect(result.isJobPosting).toBe(false);
    for (const field of ['title', 'company', 'location', 'salary', 'description'] as const) {
      expect(result.job[field]).toEqual({ status: 'missing' });
    }
    expect(result.diagnostics?.selectedJobId).toBe(PAPERMOON);
    expect(result.diagnostics?.blockedFrameOrigins).toEqual(['https://jobs.indeed.com']);
    // The job is open; the old "No job is open" message was wrong here.
    expect(result.warnings).toEqual([
      'Chrome keeps this job’s details in a separate Indeed frame that ApplyPilot cannot read yet. Allow access below, or paste the job instead.',
    ]);
    expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
  });

  it('records a content-free outline of the page for bug reports', () => {
    const { diagnostics } = extractJob(blockedFramePage(), SEARCH, { now: NOW });
    const outline = diagnostics?.outline ?? '';
    expect(outline).toContain('iframe#vjs-container-iframe');
    expect(outline).toContain('https://jobs.indeed.com/viewjob');
    expect(outline).toMatch(/not readable/);
    // The selected card's public job key is kept so the selection can be traced.
    expect(outline).toContain(`[jk=${PAPERMOON}] [aria-current]`);
    // Structure only: no job text and no search terms.
    for (const text of ['PaperMoon', 'Server', 'Bartender', 'Brookfield', '$15', 'Springfield']) {
      expect(outline).not.toContain(text);
    }
  });

  it('reads the selected job from inside the frame', () => {
    const frame = loadFixture('indeed-embedded-papermoon.html', FRAME);
    const result = extractJob(frame, FRAME, { now: NOW, embedded: true });
    expectPaperMoon(result);
    expect(value(result.job.jobId)).toBe(PAPERMOON);
    expect(result.diagnostics?.via).toBe('frame');
    expect(result.warnings).not.toContain('No job is open on this Indeed page.');
  });

  it('takes the currency from the country site that holds the frame', () => {
    const frame = loadFixture('indeed-embedded-papermoon.html', FRAME);
    expect(value(extractJob(frame, FRAME, { now: NOW, embedded: true }).job.salary)?.currency).toBe(
      null,
    );
    // Chrome tells a frame which origins contain it (never their content).
    const origins = ['https://www.indeed.com'];
    Object.defineProperty(frame.defaultView!.location, 'ancestorOrigins', {
      value: { length: origins.length, item: (i: number) => origins[i] ?? null },
    });
    expect(value(extractJob(frame, FRAME, { now: NOW, embedded: true }).job.salary)?.currency).toBe(
      'USD',
    );
  });

  it('does not treat a frame filled in by script as still loading', () => {
    // Some layouts write the details into an about:blank frame instead of loading an address.
    const doc = loadFixture('indeed-search-papermoon.html', SEARCH);
    const frameDoc = doc.querySelector('iframe')!.contentDocument!;
    expect(frameDoc.URL).toBe('about:blank');
    frameDoc.body.innerHTML = fixtureBody('indeed-embedded-papermoon.html');
    expectPaperMoon(extractJob(doc, SEARCH, { now: NOW }));
  });

  it('finds an unhooked details panel by its description', () => {
    // No known panel or title hooks: only the description id that Indeed keeps.
    const doc = htmlDocument(
      `<ul><li><div data-jk="4d5e6f708192a3b4"><h2><a href="/rc/clk?jk=4d5e6f708192a3b4">Bartender</a></h2><span>Brookfield Tavern</span></div></li>
       <li><div data-jk="${PAPERMOON}" aria-current="true"><h2><a href="/rc/clk?jk=${PAPERMOON}">Server / Bartender</a></h2><span>PaperMoon Springfield</span></div></li></ul>
       <section><div><h2>Server / Bartender</h2><a href="/cmp/Papermoon">PaperMoon Springfield</a>
       <div id="jobDescriptionText">${/<div id="jobDescriptionText"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(fixtureBody('indeed-embedded-papermoon.html'))?.[1] ?? ''}</div></div></section>`,
      SEARCH,
    );
    const result = extractJob(doc, SEARCH, { now: NOW });
    expect(result.isJobPosting).toBe(true);
    expect(value(result.job.title)).toBe('Server / Bartender');
    expect(value(result.job.description)).toContain('family restaurant');
    expect(JSON.stringify(result.job)).not.toContain('Brookfield');
  });

  it('outlines open shadow roots and masks numbers in names', () => {
    const doc = htmlDocument(
      '<div id="pane-1234"><h2 data-testid="title-99">Secret title</h2></div>',
    );
    const host = doc.body.appendChild(doc.createElement('job-panel'));
    host.attachShadow({ mode: 'open' }).innerHTML = '<h1>Shadow job</h1>';
    const outline = outlinePage(doc, doc.URL);
    expect(outline).toContain('div#pane-####');
    expect(outline).toMatch(/shadow/);
    expect(outline).not.toContain('Secret title');
    expect(outline).not.toContain('Shadow job');
    expect(outline).not.toContain('1234');
  });
});

describe('pasted job text (fallback when the page cannot be read)', () => {
  const text = [
    'PaperMoon Springfield is a family restaurant looking for a friendly server and bartender.',
    '',
    'Requirements',
    '- Must be 21 or older to serve alcohol',
    '- Restaurant or bar experience preferred',
    '',
    'Job Type: Part-time',
    'Pay: $15.54 - $17.29 per hour',
  ].join('\n');

  it('analyzes the pasted description with the details the user entered', () => {
    const result = extractFromText(
      htmlDocument(''),
      {
        title: 'Server / Bartender',
        company: 'PaperMoon Springfield',
        location: '6315 Amherst Avenue, Springfield, VA 22150',
        text,
        pageUrl: SEARCH,
      },
      { now: NOW },
    );
    expect(result.isJobPosting).toBe(true);
    expect(result.job.title).toMatchObject({ value: 'Server / Bartender', source: 'user' });
    expect(result.job.company).toMatchObject({ value: 'PaperMoon Springfield', source: 'user' });
    expect(value(result.job.salary)).toMatchObject({ min: 15.54, max: 17.29, period: 'hour' });
    expect(value(result.job.employmentType)).toEqual(['part-time']);
    expect(value(result.job.description)).toContain('Must be 21 or older');
    expect(result.pageUrl).toBe(SEARCH);
    expect(result.diagnostics?.via).toBe('pasted');
    expect(result.warnings[0]).toMatch(/pasted/);
    expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
  });

  it('leaves out what the user did not enter instead of guessing', () => {
    const result = extractFromText(
      htmlDocument('<h1>Brookfield Tavern</h1>'),
      { title: 'Server / Bartender', text, pageUrl: 'https://applypilot.invalid/pasted-job' },
      { now: NOW },
    );
    expect(result.job.company).toEqual({ status: 'missing' });
    expect(result.job.location).toEqual({ status: 'missing' });
    expect(JSON.stringify(result.job)).not.toContain('Brookfield');
  });
});

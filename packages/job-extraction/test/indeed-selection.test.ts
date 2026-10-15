import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobExtractionResultSchema, type ExtractedField } from '@applypilot/shared';
import { extractJob, waitForJobContent } from '../src';
import { isGenericPageTitle } from '../src/text';
import { sameJobTitle } from '../src/adapters/indeed';
import { loadFixture, loadFixtureWithFrames, waitForFrames } from './helpers';

/**
 * Regression for the second real-world test (2026-10-15). On an Indeed search
 * page the analyzer reported:
 *   title "Job Search | Indeed", company not found, the location of a different
 *   result card ("Alexandria, VA 22314" from Z S Connections), partial salary,
 *   and a "no job is selected" warning,
 * while the selected job was "FT Unarmed Security Officer – $20.89/hr" at
 * Sunstates Security, Alexandria, VA, $20.89/hour, full-time.
 *
 * Cause: the selected job's details were not found where the adapter looked
 * (here, in a same-origin frame), and the extractor then fell back to reading
 * the whole search page, mixing the page title and other result cards.
 */

const NOW = () => new Date('2026-10-15T12:00:00.000Z');
const SUNSTATES = 'b5e7a1c3d9f20486';
const ZS = '3c9d2e8f71a04b65';
const searchUrl = (key: string) =>
  `https://www.indeed.com/jobs?q=security+officer&l=Alexandria%2C+VA&vjk=${key}`;

const OTHER_CARDS = [
  'Z S Connections',
  'Unarmed Security Guard',
  'Alexandria, VA 22314',
  'Harborline',
  'Concierge',
  'Arlington',
  '$18',
  '$22',
  'Part-time',
  'part-time',
];

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

/** The search page with the details panel rendered inline instead of in a frame. */
function inlinePanelPage(key: string, panelFixture: string): Document {
  const doc = loadFixture('indeed-search-frame-panel.html', searchUrl(key));
  doc.querySelector('.jobsearch-RightPane')!.innerHTML =
    `<div id="jobsearch-ViewjobPaneWrapper">${fixtureBody(panelFixture)}</div>`;
  return doc;
}

/** Moves the search page to another job, the way Indeed does when a card is clicked. */
function selectCard(doc: Document, key: string) {
  doc.defaultView!.history.pushState({}, '', searchUrl(key));
  for (const card of doc.querySelectorAll('.job_seen_beacon')) {
    const selected = card.getAttribute('data-jk') === key;
    card.classList.toggle('vjs-highlight', selected);
    if (selected) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
  }
}

function expectSunstates(result: ReturnType<typeof extractJob>) {
  expect(result.job.title).toEqual({
    status: 'found',
    value: 'FT Unarmed Security Officer – $20.89/hr',
    source: 'adapter',
    confidence: 'high',
  });
  expect(result.job.company).toMatchObject({ value: 'Sunstates Security', source: 'adapter' });
  expect(result.job.location).toMatchObject({ value: 'Alexandria, VA', source: 'adapter' });
  expect(value(result.job.salary)).toEqual({
    min: 20.89,
    max: 20.89,
    currency: 'USD',
    period: 'hour',
  });
  expect(value(result.job.employmentType)).toEqual(['full-time']);
  expect(value(result.job.jobId)).toBe(SUNSTATES);
  expect(value(result.job.url)).toBe(`https://www.indeed.com/viewjob?jk=${SUNSTATES}`);
  expect(result.isJobPosting).toBe(true);
  expect(result.warnings).toEqual([]);
  const text = JSON.stringify(result.job);
  expect(text).not.toContain('Job Search');
  expect(text).not.toContain('Hello, Jordan');
  for (const other of OTHER_CARDS) expect(text).not.toContain(other);
}

describe('Indeed: selected job in a details frame (Sunstates Security report)', () => {
  it('reads only the selected job from the frame', async () => {
    const { doc } = await loadFixtureWithFrames(
      'indeed-search-frame-panel.html',
      searchUrl(SUNSTATES),
    );
    const result = extractJob(doc, searchUrl(SUNSTATES), { now: NOW });
    expectSunstates(result);
    expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
    expect(value(result.job.requiredQualifications)).toEqual([
      'Valid Virginia DCJS unarmed security officer registration',
      'High school diploma or GED',
      'Able to stand and walk for long periods',
    ]);
  });

  it('explains how the job was read', async () => {
    const { doc } = await loadFixtureWithFrames(
      'indeed-search-frame-panel.html',
      searchUrl(SUNSTATES),
    );
    const { diagnostics } = extractJob(doc, searchUrl(SUNSTATES), { now: NOW });
    expect(diagnostics?.scope).toBe('selected-job');
    expect(diagnostics?.selectedJobId).toBe(SUNSTATES);
    expect(diagnostics?.checks.map((c) => [c.id, c.status])).toEqual([
      ['selected-job', 'pass'],
      ['details-panel', 'pass'],
      ['panel-match', 'pass'],
      ['title', 'pass'],
      ['company', 'pass'],
      ['description', 'pass'],
    ]);
    expect(diagnostics?.checks[1]?.message).toMatch(/embedded frame/);
  });

  it('never falls back to the search page while the frame is still empty', () => {
    // The frame has no document yet: nothing from the page may be used instead.
    const doc = loadFixture('indeed-search-frame-panel.html', searchUrl(SUNSTATES));
    const result = extractJob(doc, searchUrl(SUNSTATES), { now: NOW });
    expect(result.isJobPosting).toBe(false);
    expect(result.job.title).toEqual({ status: 'missing' });
    expect(result.job.company).toEqual({ status: 'missing' });
    expect(result.job.location).toEqual({ status: 'missing' });
    expect(result.job.salary).toEqual({ status: 'missing' });
    expect(result.job.employmentType).toEqual({ status: 'missing' });
    expect(result.job.description).toEqual({ status: 'missing' });
    expect(result.warnings).toEqual([
      'The selected job’s details are still loading. Wait until they appear on the right, then analyze again.',
    ]);
    expect(
      result.diagnostics?.checks.filter((c) => c.id === 'details-panel').map((c) => c.status),
    ).toEqual(['warn', 'fail']);
  });

  it('switches to the newly selected job only once its frame has loaded', async () => {
    const { doc } = await loadFixtureWithFrames(
      'indeed-search-frame-panel.html',
      searchUrl(SUNSTATES),
    );
    expectSunstates(extractJob(doc, doc.URL, { now: NOW }));

    // The user clicks the Z S Connections card. The address changes first.
    selectCard(doc, ZS);
    const during = extractJob(doc, doc.URL, { now: NOW });
    expect(during.isJobPosting).toBe(false);
    expect(during.job.title).toEqual({ status: 'missing' });
    expect(during.warnings[0]).toMatch(/still showing a different job/);
    expect(JSON.stringify(during.job)).not.toContain('Sunstates');

    const frame = doc.querySelector<HTMLIFrameElement>('#vjs-container-iframe')!;
    const ready = waitForJobContent(doc, { timeoutMs: 3000, checkIntervalMs: 10, url: doc.URL });
    frame.src = `/jobs/indeed-embedded-zs-connections.html?jk=${ZS}&viewtype=embedded`;
    await waitForFrames(doc);
    await expect(ready).resolves.toBe(true);

    const after = extractJob(doc, doc.URL, { now: NOW });
    expect(value(after.job.title)).toBe('Unarmed Security Guard – Weekends');
    expect(value(after.job.company)).toBe('Z S Connections');
    expect(value(after.job.location)).toBe('Alexandria, VA 22314');
    expect(value(after.job.salary)).toEqual({ min: 18, max: 19, currency: 'USD', period: 'hour' });
    expect(value(after.job.employmentType)).toEqual(['part-time']);
    expect(value(after.job.jobId)).toBe(ZS);
    const text = JSON.stringify(after.job);
    for (const old of [
      'Sunstates',
      '20.89',
      'Full-time',
      'full-time',
      'DCJS unarmed security officer',
    ])
      expect(text).not.toContain(old);
  });
});

describe('Indeed: selected job in an inline details panel', () => {
  it('reads the same values when the panel is part of the page', () => {
    const doc = inlinePanelPage(SUNSTATES, 'indeed-embedded-sunstates.html');
    const result = extractJob(doc, searchUrl(SUNSTATES), { now: NOW });
    expectSunstates(result);
    expect(result.diagnostics?.checks[1]?.message).not.toMatch(/frame/);
  });

  it('waits for the panel when switching jobs, and never mixes the two', async () => {
    const doc = inlinePanelPage(SUNSTATES, 'indeed-embedded-sunstates.html');
    expectSunstates(extractJob(doc, doc.URL, { now: NOW }));

    selectCard(doc, ZS);
    const during = extractJob(doc, doc.URL, { now: NOW });
    expect(during.job.title).toEqual({ status: 'missing' });
    expect(during.diagnostics?.checks.find((c) => c.id === 'panel-match')).toMatchObject({
      status: 'fail',
      message:
        'The details panel shows "FT Unarmed Security Officer – $20.89/hr", but the selected result is "Unarmed Security Guard – Weekends".',
    });

    const ready = waitForJobContent(doc, { timeoutMs: 3000, checkIntervalMs: 10, url: doc.URL });
    setTimeout(() => {
      doc.querySelector('#jobsearch-ViewjobPaneWrapper')!.innerHTML = fixtureBody(
        'indeed-embedded-zs-connections.html',
      );
    }, 30);
    await expect(ready).resolves.toBe(true);

    const after = extractJob(doc, doc.URL, { now: NOW });
    expect(value(after.job.title)).toBe('Unarmed Security Guard – Weekends');
    expect(value(after.job.company)).toBe('Z S Connections');
    expect(JSON.stringify(after.job)).not.toContain('Sunstates');
  });

  it('times out with a clear message when the panel never catches up', async () => {
    const doc = inlinePanelPage(SUNSTATES, 'indeed-embedded-sunstates.html');
    selectCard(doc, ZS);
    await expect(
      waitForJobContent(doc, { timeoutMs: 50, checkIntervalMs: 10, url: doc.URL }),
    ).resolves.toBe(false);
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.isJobPosting).toBe(false);
    expect(result.warnings).toEqual([
      'The job details panel is still showing a different job from the one you selected. Wait for the panel to finish loading, then analyze again.',
    ]);
  });

  it('uses the highlighted card when the address names no job', () => {
    const doc = inlinePanelPage(SUNSTATES, 'indeed-embedded-sunstates.html');
    doc.defaultView!.history.replaceState({}, '', 'https://www.indeed.com/jobs?q=security+officer');
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(value(result.job.title)).toBe('FT Unarmed Security Officer – $20.89/hr');
    expect(result.diagnostics?.selectedJobId).toBe(SUNSTATES);
    expect(result.diagnostics?.checks[0]?.message).toMatch(/highlighted search result/);
  });

  it('flags a panel it cannot match to any selection, at lower confidence', () => {
    const doc = inlinePanelPage(SUNSTATES, 'indeed-embedded-sunstates.html');
    doc.defaultView!.history.replaceState({}, '', 'https://www.indeed.com/jobs?q=security+officer');
    for (const card of doc.querySelectorAll('.vjs-highlight, [aria-current]')) {
      card.classList.remove('vjs-highlight');
      card.removeAttribute('aria-current');
    }
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.job.title).toMatchObject({
      value: 'FT Unarmed Security Officer – $20.89/hr',
      confidence: 'medium',
    });
    expect(result.warnings[0]).toMatch(/could not confirm/);
    expect(result.diagnostics?.checks.find((c) => c.id === 'panel-match')?.status).toBe('warn');
  });

  it('ignores a panel title that is the search page heading', () => {
    const doc = inlinePanelPage(SUNSTATES, 'indeed-embedded-sunstates.html');
    doc.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]')!.textContent =
      'Job Search | Indeed';
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.job.title).toEqual({ status: 'missing' });
    expect(result.isJobPosting).toBe(false);
  });
});

describe('generic page titles', () => {
  it.each([
    'Job Search | Indeed',
    'Jobs, Employment | Indeed.com',
    'Security officer jobs in Alexandria, VA',
    '1,204 security jobs',
    'Search results',
  ])('treats "%s" as a page title, not a job title', (title) => {
    expect(isGenericPageTitle(title)).toBe(true);
  });

  it.each([
    'FT Unarmed Security Officer – $20.89/hr',
    'Cloud Engineering Intern',
    'Jobs Coordinator',
  ])('keeps "%s" as a job title', (title) => {
    expect(isGenericPageTitle(title)).toBe(false);
  });

  it('never uses the document or og:title of a search page on generic sites', () => {
    const doc = loadFixture('indeed-search-frame-panel.html', 'https://jobs.example.com/search');
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(JSON.stringify(result.job.title)).not.toContain('Job Search');
  });
});

describe('card and panel title matching', () => {
  it('tolerates shortened card titles', () => {
    expect(
      sameJobTitle('FT Unarmed Security Officer – $20.89/hr', 'FT Unarmed Security Officer'),
    ).toBe(true);
    expect(
      sameJobTitle(
        'FT Unarmed Security Officer – $20.89/hr',
        'FT Unarmed Security Officer - $20.89/hr',
      ),
    ).toBe(true);
  });

  it('tells different jobs apart', () => {
    expect(
      sameJobTitle('FT Unarmed Security Officer – $20.89/hr', 'Unarmed Security Guard – Weekends'),
    ).toBe(false);
  });
});

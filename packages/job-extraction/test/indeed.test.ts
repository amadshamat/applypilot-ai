import { describe, expect, it } from 'vitest';
import { jobExtractionResultSchema, type ExtractedField } from '@applypilot/shared';
import { extractJob, waitForJobContent } from '../src';
import { htmlDocument, loadFixture } from './helpers';

const NOW = () => new Date('2026-10-14T12:00:00.000Z');
const SEARCH_URL =
  'https://www.indeed.com/jobs?q=fundraiser&l=Arlington%2C+VA&vjk=7c1e5f0a2b3d4e6f';
const VIEWJOB_URL = 'https://www.indeed.com/viewjob?jk=9d8c7b6a5f4e3d2c&from=serp';

function value<T>(field: ExtractedField<T>): T | undefined {
  return field.status === 'found' ? field.value : undefined;
}

/**
 * Regression for the first real-world test (2026-10-14): on an Indeed search page
 * the analyzer returned the account greeting as the title ("Hello, …"), no
 * company, the wrong location, no salary and a single job type.
 */
describe('Indeed: selected job on a search results page', () => {
  const result = extractJob(
    loadFixture('indeed-search-selected-job.html', SEARCH_URL),
    SEARCH_URL,
    {
      now: NOW,
    },
  );

  it('uses the Indeed adapter and produces a valid result', () => {
    expect(result.platform).toBe('indeed');
    expect(result.strategies[0]).toBe('adapter');
    expect(result.isJobPosting).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
  });

  it('reads the title from the selected job, not the account greeting', () => {
    expect(result.job.title).toEqual({
      status: 'found',
      value: 'Fundraiser – $20/hr Guaranteed – Great for Students & Creatives',
      source: 'adapter',
      confidence: 'high',
    });
  });

  it('reads company and location as separate fields', () => {
    expect(result.job.company).toMatchObject({
      value: 'Public Outreach Consultancy Inc',
      source: 'adapter',
    });
    expect(result.job.location).toMatchObject({ value: 'Arlington, VA', source: 'adapter' });
  });

  it('reads a "From" salary as a minimum with no invented maximum', () => {
    expect(result.job.salary).toMatchObject({
      source: 'adapter',
      value: { min: 20, max: null, currency: 'USD', period: 'hour' },
    });
  });

  it('keeps every listed job type', () => {
    expect(result.job.employmentType).toMatchObject({
      value: ['part-time', 'full-time'],
      source: 'adapter',
    });
  });

  it('identifies the selected job and gives it a stable address', () => {
    expect(value(result.job.jobId)).toBe('7c1e5f0a2b3d4e6f');
    expect(value(result.job.url)).toBe('https://www.indeed.com/viewjob?jk=7c1e5f0a2b3d4e6f');
  });

  it('never takes values from other result cards', () => {
    const text = JSON.stringify(result.job);
    for (const other of [
      'Riverbend Arts Council',
      'Civic Reach Partners',
      'Development Associate',
      '52,000',
      'Washington, DC',
    ]) {
      expect(text).not.toContain(other);
    }
  });

  it('analyzes the selected description', () => {
    expect(value(result.job.requiredQualifications)).toEqual([
      'Must be at least 18 years old',
      'Comfortable talking with people outdoors in all weather',
      'Available at least three shifts per week',
    ]);
    expect(value(result.job.description)).toMatch(/^Fundraiser – Paid Weekly/);
  });
});

describe('Indeed: standalone job page', () => {
  const result = extractJob(loadFixture('indeed-viewjob.html', VIEWJOB_URL), VIEWJOB_URL, {
    now: NOW,
  });

  it('extracts header fields and splits location from work arrangement', () => {
    expect(value(result.job.title)).toBe('Junior Cloud Support Associate');
    expect(value(result.job.company)).toBe('Tidewater Systems');
    expect(value(result.job.location)).toBe('Arlington, VA 22201');
    expect(result.job.workArrangement).toMatchObject({ value: 'hybrid', source: 'adapter' });
  });

  it('reads pay and job type from the header line', () => {
    expect(value(result.job.salary)).toEqual({
      min: 55000,
      max: 65000,
      currency: 'USD',
      period: 'year',
    });
    expect(value(result.job.employmentType)).toEqual(['full-time']);
    expect(value(result.job.jobId)).toBe('9d8c7b6a5f4e3d2c');
  });

  it('still analyzes the description', () => {
    expect(value(result.job.skills)).toEqual(['AWS', 'Linux']);
    expect(value(result.job.yearsOfExperience)).toEqual({ min: 1, max: null });
  });
});

describe('Indeed: edge cases', () => {
  const pane = (inner: string) => `
    <header><h1>Hello, Jordan</h1></header>
    <main><div id="jobsearch-ViewjobPaneWrapper">${inner}</div></main>`;

  it('asks the user to select a job when none is open', () => {
    const doc = htmlDocument(
      `<header><h1>Hello, Jordan</h1></header><main><div class="job_seen_beacon"><h2 class="jobTitle">Barista</h2></div></main>`,
      'https://www.indeed.com/jobs?q=barista',
    );
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.platform).toBe('indeed');
    expect(result.job.title).toEqual({ status: 'missing' });
    expect(result.isJobPosting).toBe(false);
    expect(result.warnings).toEqual([
      'No job is open on this Indeed page. Click a job in the results so its details appear on the right, then analyze again.',
    ]);
  });

  it('ignores search-page JSON-LD, which does not describe the selected job', () => {
    const doc = htmlDocument(
      pane(`<h2 data-testid="jobsearch-JobInfoHeader-title">Line Cook</h2>
            <div id="jobDescriptionText"><p>Prep and cook.</p></div>`),
      'https://www.indeed.com/jobs?q=cook&vjk=abcdef0123456789',
    );
    const script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@type': 'JobPosting',
      title: 'Sous Chef',
      hiringOrganization: { name: 'Other Co' },
    });
    doc.head.append(script);
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.job.title).toMatchObject({ value: 'Line Cook', source: 'adapter' });
    // Not even fields the adapter lacks: they would belong to another job.
    expect(result.job.company).toEqual({ status: 'missing' });
    expect(result.strategies).toEqual(['adapter', 'dom']);
  });

  it('removes ratings and screen-reader text from the company and strips it from location', () => {
    const doc = htmlDocument(
      pane(`<h2 data-testid="jobsearch-JobInfoHeader-title"><span>Cashier<span> - job post</span></span></h2>
            <div data-testid="inlineHeader-companyName"><a href="/cmp/x">Harbor Market 4.1 out of 5 stars</a></div>
            <div data-testid="inlineHeader-companyLocation">Harbor Market, Norfolk, VA</div>
            <div id="jobDescriptionText"><p>Run the register.</p></div>`),
      'https://ca.indeed.com/jobs?q=cashier&vjk=0123456789abcdef',
    );
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(value(result.job.title)).toBe('Cashier');
    expect(value(result.job.company)).toBe('Harbor Market');
    expect(value(result.job.location)).toBe('Norfolk, VA');
  });

  it('uses the country site currency only for amounts with a bare "$"', () => {
    const doc = htmlDocument(
      pane(`<h2 data-testid="jobsearch-JobInfoHeader-title">Server</h2>
            <div id="salaryInfoAndJobType"><span>$18 - $21 an hour</span><span> - Part-time</span></div>
            <div id="jobDescriptionText"><p>Serve guests.</p></div>`),
      'https://ca.indeed.com/jobs?q=server&vjk=0123456789abcdef',
    );
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(value(result.job.salary)).toEqual({ min: 18, max: 21, currency: 'CAD', period: 'hour' });
    expect(value(result.job.employmentType)).toEqual(['part-time']);
  });

  it('leaves salary and job type missing when Indeed shows none', () => {
    const doc = htmlDocument(
      pane(`<h2 data-testid="jobsearch-JobInfoHeader-title">Volunteer Coordinator</h2>
            <div id="jobDescriptionText"><p>Coordinate volunteers for weekend events.</p></div>`),
      'https://www.indeed.com/viewjob?jk=0123456789abcdef',
    );
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.job.salary).toEqual({ status: 'missing' });
    expect(result.job.employmentType).toEqual({ status: 'missing' });
    expect(result.job.company).toEqual({ status: 'missing' });
  });

  it('waits for the selected job pane to load', async () => {
    const doc = htmlDocument(pane('<div class="skeleton"></div>'), SEARCH_URL);
    const pending = waitForJobContent(doc, {
      timeoutMs: 2000,
      checkIntervalMs: 10,
      url: SEARCH_URL,
    });
    setTimeout(() => {
      doc.getElementById('jobsearch-ViewjobPaneWrapper')!.innerHTML = `
        <h2 data-testid="jobsearch-JobInfoHeader-title">Fundraiser</h2>
        <div id="jobDescriptionText"><p>Talk with the public about causes.</p></div>`;
    }, 30);
    await expect(pending).resolves.toBe(true);
    expect(value(extractJob(doc, SEARCH_URL, { now: NOW }).job.title)).toBe('Fundraiser');
  });
});

describe('generic pages: account greetings are not job titles', () => {
  it('skips a greeting h1 in the site header', () => {
    const doc = htmlDocument(
      `<header><h1>Hello, Jordan</h1></header><main><h1>Data Analyst Intern</h1><p>Work with SQL.</p></main>`,
    );
    expect(value(extractJob(doc, doc.URL, { now: NOW }).job.title)).toBe('Data Analyst Intern');
  });

  it('keeps a title inside an article header', () => {
    const doc = htmlDocument(
      `<article><header><h1>Network Technician</h1></header><p>Cable things.</p></article>`,
    );
    expect(value(extractJob(doc, doc.URL, { now: NOW }).job.title)).toBe('Network Technician');
  });
});

import { describe, expect, it } from 'vitest';
import { jobExtractionResultSchema, type ExtractedField } from '@applypilot/shared';
import { extractJob } from '../src';
import { htmlDocument, loadFixture } from './helpers';

const NOW = () => new Date('2026-10-14T12:00:00.000Z');

function value<T>(field: ExtractedField<T>): T | undefined {
  return field.status === 'found' ? field.value : undefined;
}

describe('extractJob: JSON-LD careers page', () => {
  const url = 'http://127.0.0.1/jobs/json-ld-cloud-intern.html';
  const result = extractJob(loadFixture('json-ld-cloud-intern.html', url), url, { now: NOW });

  it('produces a result that satisfies the shared schema', () => {
    expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
    expect(result.isJobPosting).toBe(true);
    expect(result.strategies).toContain('json-ld');
    expect(result.extractedAt).toBe('2026-10-14T12:00:00.000Z');
  });

  it('takes core fields from structured data with high confidence', () => {
    expect(result.job.title).toEqual({
      status: 'found',
      value: 'Cloud Engineering Intern',
      source: 'json-ld',
      confidence: 'high',
    });
    expect(value(result.job.company)).toBe('Northwind Cloud');
    expect(value(result.job.location)).toBe('Seattle, WA, US');
    expect(value(result.job.employmentType)).toEqual(['internship', 'full-time']);
    expect(value(result.job.jobId)).toBe('NWC-2026-117');
    expect(value(result.job.applicationDeadline)).toBe('2026-11-15');
  });

  it('maps the salary without inventing a currency or period', () => {
    expect(value(result.job.salary)).toEqual({ min: 28, max: 34, currency: 'USD', period: 'hour' });
  });

  it('splits requirements and nice-to-haves from the description', () => {
    const required = value(result.job.requiredQualifications) ?? [];
    const preferred = value(result.job.preferredQualifications) ?? [];
    expect(required).toHaveLength(4);
    expect(required[0]).toMatch(/^Currently pursuing a Bachelor's degree/);
    expect(preferred).toEqual([
      'Experience with Terraform or AWS CDK',
      'Exposure to CI/CD pipelines such as GitHub Actions',
      'AWS Certified Cloud Practitioner',
    ]);
    expect(result.job.preferredQualifications).toMatchObject({ source: 'dom' });
  });

  it('finds technologies named in the posting', () => {
    expect(value(result.job.skills)).toEqual(
      expect.arrayContaining([
        'Python',
        'TypeScript',
        'AWS',
        'AWS Lambda',
        'Amazon EC2',
        'Amazon S3',
        'Linux',
        'Bash',
        'Git',
        'Terraform',
        'AWS CDK',
        'CI/CD',
        'GitHub Actions',
      ]),
    );
  });

  it('reads the hybrid arrangement from the description', () => {
    expect(value(result.job.workArrangement)).toBe('hybrid');
  });

  it('prefers the education credential from structured data', () => {
    expect(result.job.education).toMatchObject({
      status: 'found',
      source: 'json-ld',
      value: ['bachelor degree'],
    });
  });

  it('reports what it could not find as missing', () => {
    expect(result.job.yearsOfExperience).toEqual({ status: 'missing' });
  });
});

describe('extractJob: Greenhouse adapter', () => {
  const url = 'https://job-boards.greenhouse.io/lumenrobotics/jobs/4012345007';
  const result = extractJob(loadFixture('greenhouse-software-intern.html', url), url, { now: NOW });

  it('uses the Greenhouse adapter', () => {
    expect(result.platform).toBe('greenhouse');
    expect(result.strategies).toEqual(['adapter', 'dom']);
    expect(result.isJobPosting).toBe(true);
    expect(jobExtractionResultSchema.safeParse(result).success).toBe(true);
  });

  it('extracts the header fields', () => {
    expect(result.job.title).toMatchObject({
      value: 'Software Engineering Intern, Summer 2027',
      source: 'adapter',
      confidence: 'high',
    });
    expect(result.job.company).toMatchObject({ value: 'Lumen Robotics', confidence: 'medium' });
    expect(value(result.job.location)).toBe('Pittsburgh, PA');
    expect(value(result.job.jobId)).toBe('4012345007');
    expect(result.job.hasApplicationForm).toMatchObject({ value: true, confidence: 'high' });
  });

  it('parses bold lead-in sections', () => {
    expect(value(result.job.requiredQualifications)).toHaveLength(4);
    expect(value(result.job.preferredQualifications)).toEqual([
      'Experience with Docker or Kubernetes',
      'Previous internship or significant project work involving PostgreSQL',
    ]);
    expect(value(result.job.education)?.[0]).toMatch(/^Pursuing a BS or MS in Computer Science/);
  });

  it('derives employment type from the title and arrangement from the text', () => {
    expect(result.job.employmentType).toMatchObject({ value: ['internship'], confidence: 'high' });
    expect(value(result.job.workArrangement)).toBe('on-site');
  });

  it('keeps an ambiguous "$" currency unknown', () => {
    expect(value(result.job.salary)).toEqual({ min: 40, max: 48, currency: null, period: 'hour' });
  });

  it('does not treat the word "go" in prose as the Go language, but does match "Go"', () => {
    expect(value(result.job.skills)).toEqual(
      expect.arrayContaining([
        'Python',
        'Go',
        'Java',
        'C++',
        'Git',
        'Linux',
        'Docker',
        'Kubernetes',
        'PostgreSQL',
        'REST APIs',
        'Unit Testing',
      ]),
    );
    expect(value(result.job.skills)).not.toContain('JavaScript');
  });
});

describe('extractJob: generic page without structured data', () => {
  const url = 'https://harborline.example/careers/junior-devops-engineer';
  const result = extractJob(loadFixture('generic-devops-role.html', url), url, { now: NOW });

  it('recognises the posting from page signals and says so', () => {
    expect(result.isJobPosting).toBe(true);
    expect(result.strategies).toEqual(['dom']);
    expect(result.warnings.join(' ')).toMatch(/No structured job data/);
  });

  it('extracts fields with lower confidence', () => {
    expect(result.job.title).toMatchObject({
      value: 'Junior DevOps Engineer',
      source: 'dom',
      confidence: 'medium',
    });
    expect(result.job.company).toMatchObject({ value: 'Harborline Health', confidence: 'low' });
    expect(value(result.job.location)).toBe('Remote (United States)');
    expect(value(result.job.workArrangement)).toBe('remote');
    expect(value(result.job.employmentType)).toEqual(['full-time']);
  });

  it('reads experience, salary, education and deadline from the text', () => {
    expect(value(result.job.yearsOfExperience)).toEqual({ min: 1, max: 3 });
    expect(value(result.job.salary)).toEqual({
      min: 78000,
      max: 92000,
      currency: 'USD',
      period: 'year',
    });
    expect(value(result.job.education)).toEqual([
      "Bachelor's degree in Information Technology or equivalent practical experience",
    ]);
    expect(value(result.job.applicationDeadline)).toBe('2026-11-30');
    expect(value(result.job.preferredQualifications)).toEqual([
      'Azure or AWS certification',
      'Experience in a HIPAA-regulated environment',
    ]);
  });

  it('falls back to the page URL', () => {
    expect(result.job.url).toMatchObject({ value: url, source: 'url' });
  });
});

describe('extractJob: unfamiliar markup on an unknown host', () => {
  // Regression: Greenhouse-style markup served from another host (for example a
  // company's own domain) found no description because "job__description"
  // matched none of the generic selectors.
  const url = 'http://127.0.0.1:4173/jobs/greenhouse-software-intern.html';
  const result = extractJob(loadFixture('greenhouse-software-intern.html', url), url, { now: NOW });

  it('still finds the description and its sections without an adapter', () => {
    expect(result.platform).toBe('generic');
    expect(result.isJobPosting).toBe(true);
    expect(result.job.description).toMatchObject({
      status: 'found',
      source: 'dom',
      confidence: 'low',
    });
    expect(value(result.job.requiredQualifications)).toHaveLength(4);
    expect(value(result.job.skills)).toContain('Kubernetes');
  });
});

describe('extractJob: negative and edge cases', () => {
  it('does not call a blog post a job posting', () => {
    const url = 'https://harborline.example/blog/lambda-migration';
    const result = extractJob(loadFixture('not-a-job.html', url), url, { now: NOW });
    expect(result.isJobPosting).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/does not look like a single job posting/);
  });

  it('survives malformed JSON-LD and keeps going', () => {
    const doc = htmlDocument('<h1>Data Analyst</h1>');
    const script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = '{ "@type": "JobPosting", "title": ';
    doc.head.append(script);
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.strategies).toEqual(['dom']);
    expect(value(result.job.title)).toBe('Data Analyst');
  });

  it('reports invalid structured values as missing instead of passing them through', () => {
    const doc = htmlDocument('');
    const script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@type': 'JobPosting',
      title: 'Support Engineer',
      validThrough: 'not a date',
      baseSalary: { currency: 'USD', value: { minValue: 90, maxValue: 50, unitText: 'HOUR' } },
    });
    doc.head.append(script);
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(result.job.applicationDeadline).toEqual({ status: 'missing' });
    expect(result.job.salary).toEqual({ status: 'missing' });
  });

  it('flags known platforms that lack an adapter', () => {
    const doc = htmlDocument('<h1>Backend Intern</h1>');
    const result = extractJob(doc, 'https://jobs.lever.co/acme/1234', { now: NOW });
    expect(result.platform).toBe('lever');
    expect(result.warnings.join(' ')).toMatch(/lever, which does not have a dedicated adapter/);
  });

  it('never executes scripts embedded in a JSON-LD description', () => {
    const doc = htmlDocument('');
    const win = doc.defaultView as unknown as { pwned?: boolean };
    const script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@type': 'JobPosting',
      title: 'QA Intern',
      description:
        '<p>Hello</p><img src=x onerror="window.pwned=true"><script>window.pwned=true</script>',
    });
    doc.head.append(script);
    const result = extractJob(doc, doc.URL, { now: NOW });
    expect(value(result.job.description)).toBe('Hello');
    expect(win.pwned).toBeUndefined();
  });
});

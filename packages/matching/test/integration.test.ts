// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractJob } from '@applypilot/job-extraction';
import { parseResumeText } from '@applypilot/resume-parser';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { matchJob } from '../src';
import { NOW, WEIGHTS } from './helpers';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures');

function extracted(name: string) {
  const url = 'https://careers.example.com/jobs/1';
  const html = readFileSync(resolve(FIXTURES, 'jobs', name), 'utf8');
  return extractJob(new JSDOM(html, { url }).window.document, url).job;
}

let n = 0;
const resume = parseResumeText(
  readFileSync(resolve(FIXTURES, 'resumes/sample-resume.txt'), 'utf8'),
  {
    newId: () => `id-${String(++n)}`,
  },
).draft;

describe('parsed resume against extracted postings', () => {
  it('cloud internship: strong match with every claim traced to the resume', () => {
    const result = matchJob(extracted('json-ld-cloud-intern.html'), resume, WEIGHTS, { now: NOW });
    expect(result.score).toBeGreaterThanOrEqual(80);
    const required = Object.fromEntries(result.requiredSkills.map((m) => [m.skill, m.status]));
    expect(required).toMatchObject({
      AWS: 'matched',
      'AWS Lambda': 'matched',
      'Amazon S3': 'matched',
      'Amazon EC2': 'related',
      Linux: 'matched',
      Bash: 'matched',
      Git: 'matched',
    });
    for (const match of [...result.requiredSkills, ...result.preferredSkills]) {
      if (match.status !== 'missing') expect(match.evidence.length).toBeGreaterThan(0);
    }
    expect(result.components.find((c) => c.key === 'education')?.score).toBe(1);
  });

  it('DevOps role asking for 1–3 years: experience is the visible gap', () => {
    const result = matchJob(extracted('generic-devops-role.html'), resume, WEIGHTS, { now: NOW });
    const experience = result.components.find((c) => c.key === 'experience');
    // Two roles, Sep 2023 – Aug 2025 with overlap counted once.
    expect(experience?.score).toBe(1);
    expect(result.toConfirm).toContain('Experience in a HIPAA-regulated environment');
    expect(result.score).not.toBeNull();
  });

  it('software internship: "one of Python, Go, Java or C++" is met by Python', () => {
    const result = matchJob(extracted('greenhouse-software-intern.html'), resume, WEIGHTS, {
      now: NOW,
    });
    const group = result.requiredSkills.find((m) => m.alternatives);
    expect(group).toMatchObject({ skill: 'Python', status: 'matched' });
  });
});

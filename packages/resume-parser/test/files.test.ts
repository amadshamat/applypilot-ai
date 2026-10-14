// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { RESUME_MIME_TYPES } from '@applypilot/shared';
import { describe, expect, it } from 'vitest';
import {
  ResumeFileError,
  detectResumeType,
  docxHtmlToText,
  extractResumeText,
  pdfItemsToLines,
  validateResumeFile,
} from '../src/files';
import { parseResumeText } from '../src';
import { fixtureBytes, sequentialIds } from './helpers';

const require = createRequire(import.meta.url);
const pdfWorkerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

describe('validateResumeFile', () => {
  it('accepts PDF and DOCX by type or extension', () => {
    expect(validateResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 1000 })).toBeNull();
    expect(validateResumeFile({ name: 'cv.docx', type: '', size: 1000 })).toBeNull();
    expect(detectResumeType('cv.PDF', '')).toBe(RESUME_MIME_TYPES.pdf);
  });

  it('explains why other files are rejected', () => {
    expect(validateResumeFile({ name: 'cv.doc', type: 'application/msword', size: 10 })).toMatch(
      /\.doc/,
    );
    expect(validateResumeFile({ name: 'cv.png', type: 'image/png', size: 10 })).toMatch(/Only PDF/);
    expect(validateResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 0 })).toMatch(
      /empty/,
    );
    expect(
      validateResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 }),
    ).toMatch(/5 MB/);
  });
});

describe('docxHtmlToText', () => {
  it('keeps list items as bullets and decodes entities', () => {
    const html =
      '<h1>Skills</h1><p>R&amp;D &lt;team&gt;</p><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table>';
    expect(docxHtmlToText(html).split('\n')).toEqual([
      'Skills',
      'R&D <team>',
      '',
      '• One',
      '• Two',
      'A   B',
    ]);
  });
});

describe('pdfItemsToLines', () => {
  const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({
    str,
    transform: [1, 0, 0, 1, x, y],
    width,
    hasEOL,
  });

  it('breaks lines on vertical movement and adds spaces between separate runs', () => {
    const lines = pdfItemsToLines([
      item('Cloud', 10, 700, 20),
      item('Intern', 33, 700, 20),
      item('May 2025', 200, 700, 30),
      item('Next line', 10, 688, 30),
    ]);
    expect(lines).toEqual(['Cloud Intern   May 2025', 'Next line']);
  });

  it('honours explicit end-of-line markers', () => {
    expect(pdfItemsToLines([item('A', 0, 10, 5, true), item('B', 0, 10, 5)])).toEqual(['A', 'B']);
  });
});

describe('extractResumeText', () => {
  it('reads a real PDF and the parser finds every section', async () => {
    const text = await extractResumeText(fixtureBytes('sample-resume.pdf'), RESUME_MIME_TYPES.pdf, {
      pdfWorkerSrc,
    });
    expect(text).toContain('Cloud Engineering Intern');
    expect(text).toContain('• Automated deployment');

    const parsed = parseResumeText(text, { newId: sequentialIds() });
    expect(parsed.sections).toEqual([
      'SUMMARY',
      'EDUCATION',
      'EXPERIENCE',
      'PROJECTS',
      'SKILLS',
      'CERTIFICATIONS',
    ]);
    expect(parsed.draft.personal.fullName).toBe('Jordan Rivera');
    expect(parsed.draft.experience.map((e) => e.employer)).toEqual([
      'Northwind Logistics',
      'University of Toronto Libraries',
    ]);
    expect(parsed.draft.skills.map((s) => s.name)).toContain('Terraform');
  });

  it('reads a real DOCX, turning Word list items into bullets', async () => {
    const text = await extractResumeText(
      fixtureBytes('sample-resume.docx'),
      RESUME_MIME_TYPES.docx,
    );
    expect(text).toContain('• Automated deployment of three internal services');

    const parsed = parseResumeText(text, { newId: sequentialIds() });
    expect(parsed.draft.experience[0]?.bullets).toHaveLength(2);
    expect(parsed.draft.projects.map((p) => p.name)).toEqual([
      'Serverless Job Tracker',
      'Home Lab Kubernetes Cluster',
    ]);
    expect(parsed.draft.certifications.map((c) => c.name)).toEqual([
      'AWS Certified Cloud Practitioner',
      'CompTIA A+',
    ]);
  });

  it('gives a clear error for damaged files', async () => {
    const junk = new TextEncoder().encode('not really a document at all').buffer;
    await expect(extractResumeText(junk, RESUME_MIME_TYPES.docx)).rejects.toBeInstanceOf(
      ResumeFileError,
    );
    await expect(extractResumeText(junk, RESUME_MIME_TYPES.pdf, { pdfWorkerSrc })).rejects.toThrow(
      /could not be read/,
    );
  });

  it('rejects a PDF with no text layer instead of returning an empty profile', async () => {
    const empty = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
    ).buffer;
    await expect(extractResumeText(empty, RESUME_MIME_TYPES.pdf, { pdfWorkerSrc })).rejects.toThrow(
      /scanned image/,
    );
  });
});

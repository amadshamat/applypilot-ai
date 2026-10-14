import { describe, expect, it } from 'vitest';
import { parsedResumeSchema } from '@applypilot/shared';
import { parseResumeText } from '../src';
import { fixtureText, sequentialIds } from './helpers';

const parse = (text: string) => parseResumeText(text, { newId: sequentialIds() });

describe('parseResumeText on a complete resume', () => {
  const text = fixtureText('sample-resume.txt');
  const result = parse(text);
  const { draft } = result;

  it('produces a draft that satisfies the profile schema, with no warnings', () => {
    expect(parsedResumeSchema.safeParse(result).success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('reads contact details from the header', () => {
    expect(draft.personal).toEqual({
      fullName: 'Jordan Rivera',
      email: 'jordan.rivera@example.com',
      phone: '(416) 555-0142',
      location: 'Toronto, ON',
      portfolioUrl: '',
      linkedinUrl: 'https://linkedin.com/in/jordan-rivera-dev',
      githubUrl: 'https://github.com/jrivera-dev',
    });
    expect(draft.summary).toMatch(/^Computer science student/);
  });

  it('reads education with degree, field, dates, GPA and coursework', () => {
    expect(draft.education).toEqual([
      {
        id: 'id-1',
        institution: 'University of Toronto',
        degree: 'Bachelor of Science',
        field: 'Computer Science',
        startDate: '2022-09',
        endDate: '2026-05',
        current: true,
        gpa: '3.7/4.0',
        coursework: ['Data Structures', 'Operating Systems', 'Computer Networks', 'Databases'],
      },
    ]);
  });

  it('separates jobs, roles, employers, locations, dates and bullets', () => {
    expect(draft.experience).toHaveLength(2);
    expect(draft.experience[0]).toMatchObject({
      position: 'Cloud Engineering Intern',
      employer: 'Northwind Logistics',
      location: 'Toronto, ON',
      startDate: '2025-05',
      endDate: '2025-08',
      current: false,
    });
    expect(draft.experience[0]?.bullets).toHaveLength(2);
    expect(draft.experience[0]?.technologies).toEqual(
      expect.arrayContaining(['AWS Lambda', 'Terraform', 'GitHub Actions', 'Python']),
    );
    expect(draft.experience[1]).toMatchObject({
      position: 'IT Support Assistant',
      employer: 'University of Toronto Libraries',
      startDate: '2023-09',
      endDate: '2025-04',
    });
  });

  it('categorises skills by taxonomy first and by label otherwise', () => {
    const byName = Object.fromEntries(draft.skills.map((skill) => [skill.name, skill.category]));
    expect(byName).toMatchObject({
      Python: 'language',
      AWS: 'cloud',
      Terraform: 'devops',
      Git: 'tool',
      Jira: 'tool',
      English: 'spoken-language',
    });
  });

  it('reads projects with technologies and links', () => {
    expect(draft.projects[0]).toMatchObject({
      name: 'Serverless Job Tracker',
      technologies: ['TypeScript', 'React', 'DynamoDB'],
      url: 'https://github.com/jrivera-dev/job-tracker',
    });
  });

  it('reads certifications with issuers and dates', () => {
    expect(draft.certifications.map(({ name, issuer, date }) => ({ name, issuer, date }))).toEqual([
      { name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', date: '2024-03' },
      { name: 'CompTIA A+', issuer: 'CompTIA', date: '2023' },
    ]);
  });

  it('never invents content: every parsed value appears in the source text', () => {
    const source = text.toLowerCase();
    const values = [
      ...draft.experience.flatMap((e) => [e.employer, e.position, ...e.bullets]),
      ...draft.education.flatMap((e) => [e.institution, e.degree, e.field, ...e.coursework]),
      ...draft.skills.map((s) => s.name),
      ...draft.projects.flatMap((p) => [p.name, ...p.technologies, ...p.bullets]),
      ...draft.certifications.map((c) => c.name),
    ].filter(Boolean);
    for (const value of values) expect(source).toContain(value.toLowerCase());
  });

  it('is deterministic', () => {
    expect(parse(text)).toEqual(result);
  });
});

describe('parseResumeText on other layouts', () => {
  it('handles employer-first headers, dates on their own line and "Present"', () => {
    const { draft, warnings } = parse(`Sam Lee
sam@example.org

Work Experience
Contoso Ltd., Seattle, WA
Junior DevOps Engineer
Jan 2024 - Present
- Maintained Jenkins pipelines for 12 microservices
- Migrated logging to a managed Elasticsearch cluster, reducing on-call pages

Education
B.Sc. Computer Engineering, Simon Fraser University, 2023`);
    expect(draft.experience).toEqual([
      expect.objectContaining({
        employer: 'Contoso Ltd.',
        position: 'Junior DevOps Engineer',
        location: 'Seattle, WA',
        startDate: '2024-01',
        endDate: '',
        current: true,
        technologies: ['Jenkins'],
      }),
    ]);
    expect(draft.experience[0]?.bullets).toHaveLength(2);
    expect(draft.education[0]).toMatchObject({
      institution: 'Simon Fraser University',
      degree: 'B.Sc.',
      field: 'Computer Engineering',
      endDate: '2023',
    });
    expect(warnings).toContain('No skills section was found.');
  });

  it('splits "Role at Company" headers', () => {
    const { draft } = parse(
      `Experience\nSoftware Developer at Fabrikam | 2022 – 2023\n• Built internal tools in C# and .NET`,
    );
    expect(draft.experience[0]).toMatchObject({
      position: 'Software Developer',
      employer: 'Fabrikam',
    });
    expect(draft.experience[0]?.technologies).toEqual(['C#', '.NET']);
  });

  it('flags headers where the role cannot be told apart from the employer', () => {
    const { draft, warnings } = parse(`Experience\nBlue Harbor | Northwind\n• Did things`);
    expect(draft.experience[0]).toMatchObject({ position: 'Blue Harbor', employer: 'Northwind' });
    expect(warnings.some((warning) => warning.includes('hard to tell apart'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('No dates'))).toBe(true);
  });

  it('recognises spaced-out and colon headings', () => {
    const { sections, draft } = parse(
      `ALEX KIM\n\nS K I L L S\nPython, Go\n\nCertifications:\nCKA, 2024`,
    );
    expect(sections).toEqual(['S K I L L S', 'Certifications']);
    expect(draft.skills.map((s) => s.name)).toEqual(['Python', 'Go']);
    expect(draft.personal.fullName).toBe('Alex Kim');
    expect(draft.certifications[0]).toMatchObject({
      name: 'CKA',
      issuer: 'The Linux Foundation',
      date: '2024',
    });
  });

  it('strips proficiency notes and de-duplicates skills across lines', () => {
    const { draft } = parse(
      `Skills\nPython (advanced), JavaScript; k8s\nKubernetes, python, Excel`,
    );
    expect(draft.skills.map((s) => s.name)).toEqual(['Python', 'JavaScript', 'k8s', 'Excel']);
  });

  it('only fills contact details when no sections are recognised', () => {
    const { draft, warnings } = parse(
      `Taylor Morgan\ntaylor@example.com\nI like building cloud things with AWS.`,
    );
    expect(draft.personal).toMatchObject({
      fullName: 'Taylor Morgan',
      email: 'taylor@example.com',
    });
    expect(draft.skills).toEqual([]);
    expect(warnings[0]).toMatch(/No section headings/);
  });

  it('warns about a missing name instead of guessing', () => {
    const { draft, warnings } = parse(
      `curriculum vitae\nemail: someone@example.com\n\nSkills\nSQL`,
    );
    expect(draft.personal.fullName).toBe('');
    expect(warnings).toContain('Could not find your name at the top of the resume. Please add it.');
  });

  it('returns an empty draft for empty text', () => {
    const result = parse('   \n  ');
    expect(result.sections).toEqual([]);
    expect(result.warnings).toEqual(['The resume did not contain any readable text.']);
  });

  it('joins bullets that wrapped onto a second line', () => {
    const { draft } = parse(
      `Projects\nPortfolio Site\n• Designed and deployed a static portfolio site on Amazon S3 with CloudFront and a custom\ndomain managed in Route 53`,
    );
    expect(draft.projects[0]?.bullets).toEqual([
      'Designed and deployed a static portfolio site on Amazon S3 with CloudFront and a custom domain managed in Route 53',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { matchJob } from '../src';
import { NOW, WEIGHTS, job, profile, skill } from './helpers';

const kinds = (result: ReturnType<typeof matchJob>) => result.suggestions.map((s) => s.kind);

describe('suggestions', () => {
  it('suggests listing a skill the experience already proves', () => {
    const result = matchJob(
      job({ skills: ['Terraform'] }),
      profile({
        summary: 'Student',
        experience: [
          {
            id: 'x',
            employer: 'Northwind',
            position: 'Intern',
            location: '',
            startDate: '2025-05',
            endDate: '2025-08',
            current: false,
            bullets: ['Wrote Terraform modules for 3 services'],
            technologies: [],
          },
        ],
      }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.suggestions[0]).toMatchObject({
      kind: 'add-to-skills',
      title: 'Add Terraform to your skills list',
    });
    expect(result.suggestions[0]?.detail).toContain('Experience: Northwind');
  });

  it('asks for context, not new claims, when a skill is only listed', () => {
    const result = matchJob(
      job({ skills: ['Docker'] }),
      profile({ summary: 'x', skills: [skill('Docker')] }),
      WEIGHTS,
      { now: NOW },
    );
    expect(kinds(result)).toEqual(['show-skill-in-context']);
    expect(result.suggestions[0]?.detail).toMatch(/If you have not used them yet, leave/);
  });

  it('frames missing skills as "only if true", never as something to add', () => {
    const result = matchJob(
      job({ skills: ['Kubernetes', 'Go'] }),
      profile({ summary: 'x' }),
      WEIGHTS,
      { now: NOW },
    );
    const missing = result.suggestions.find((s) => s.kind === 'missing-skill');
    expect(missing?.title).toBe('Not in your profile: Kubernetes and Go');
    expect(missing?.detail).toMatch(/only if you genuinely have them/);
    expect(missing?.detail).toMatch(/do not claim them/);
  });

  it('suggests reordering when requested skills sit low in a long list', () => {
    const names = [
      'Excel',
      'Word',
      'PowerPoint',
      'Photoshop',
      'Figma',
      'Slack',
      'Notion',
      'Trello',
      'Python',
    ];
    const result = matchJob(
      job({ skills: ['Python'] }),
      profile({
        summary: 'x',
        skills: names.map(skill),
        projects: [
          {
            id: 'p',
            name: 'Bot',
            description: 'A Python bot',
            technologies: [],
            url: '',
            bullets: [],
          },
        ],
      }),
      WEIGHTS,
      { now: NOW },
    );
    expect(kinds(result)).toContain('reorder-skills');
    expect(kinds(result)).toContain('highlight-project');
  });

  it('asks for real metrics without proposing any numbers', () => {
    const result = matchJob(
      job({ skills: ['Python'] }),
      profile({
        experience: [
          {
            id: 'x',
            employer: 'A',
            position: 'Intern',
            location: '',
            startDate: '2025-01',
            endDate: '2025-04',
            current: false,
            bullets: ['Helped the team with scripts', 'Supported 40 users'],
            technologies: [],
          },
        ],
      }),
      WEIGHTS,
      { now: NOW },
    );
    const metrics = result.suggestions.find((s) => s.kind === 'add-metrics');
    expect(metrics?.title).toBe('Add real numbers to 1 experience bullet');
    expect(metrics?.detail).toMatch(/Only use numbers you can back up/);
    expect(metrics?.detail).not.toMatch(/\d/);
  });

  it('suggests a graduation date for internships when it is missing', () => {
    const result = matchJob(
      job({ employmentType: ['internship'], skills: ['Python'] }),
      profile({
        summary: 'x',
        education: [
          {
            id: 'e',
            institution: 'UofT',
            degree: 'BSc',
            field: '',
            startDate: '2023',
            endDate: '',
            current: true,
            gpa: '',
            coursework: [],
          },
        ],
      }),
      WEIGHTS,
      { now: NOW },
    );
    expect(kinds(result)).toContain('graduation-date');
  });

  it('orders suggestions by priority', () => {
    const result = matchJob(job({ skills: ['Kubernetes'] }), profile(), WEIGHTS, { now: NOW });
    const priorities = result.suggestions.map((s) => s.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });
});

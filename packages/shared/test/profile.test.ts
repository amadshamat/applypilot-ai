import { describe, expect, it } from 'vitest';
import {
  emptyProfileContent,
  findSkillMentions,
  isProfileEmpty,
  lookupSkill,
  normalizeSkillName,
  profileSchema,
  PROFILE_VERSION,
  skillFamily,
} from '../src';

describe('profile schema', () => {
  const valid = {
    ...emptyProfileContent(),
    version: PROFILE_VERSION,
    updatedAt: '2026-10-14T00:00:00.000Z',
  };

  it('accepts an empty profile and reports it as empty', () => {
    expect(profileSchema.safeParse(valid).success).toBe(true);
    expect(isProfileEmpty(valid)).toBe(true);
  });

  it('rejects malformed dates, links and emails', () => {
    const education = {
      id: 'e',
      institution: 'U',
      degree: '',
      field: '',
      startDate: 'May 2024',
      endDate: '',
      current: false,
      gpa: '',
      coursework: [],
    };
    expect(profileSchema.safeParse({ ...valid, education: [education] }).success).toBe(false);
    expect(
      profileSchema.safeParse({
        ...valid,
        personal: { ...valid.personal, githubUrl: 'javascript:alert(1)' },
      }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({ ...valid, personal: { ...valid.personal, email: 'nope' } }).success,
    ).toBe(false);
  });

  it('requires an employer or a position for experience', () => {
    const job = {
      id: 'x',
      employer: '',
      position: '',
      location: '',
      startDate: '',
      endDate: '',
      current: false,
      bullets: [],
      technologies: [],
    };
    expect(profileSchema.safeParse({ ...valid, experience: [job] }).success).toBe(false);
    expect(
      profileSchema.safeParse({ ...valid, experience: [{ ...job, position: 'Intern' }] }).success,
    ).toBe(true);
  });
});

describe('skill helpers', () => {
  it('looks up typed names and aliases', () => {
    expect(lookupSkill('k8s')?.name).toBe('Kubernetes');
    expect(lookupSkill('ReactJS')?.name).toBe('React');
    expect(lookupSkill('Underwater basket weaving')).toBeNull();
  });

  it('normalises names so variants compare equal', () => {
    expect(normalizeSkillName('Node.js')).toBe(normalizeSkillName('nodejs'));
    expect(normalizeSkillName('Power BI')).toBe(normalizeSkillName('power-bi'));
  });

  it('knows skill families', () => {
    expect(skillFamily('AWS Lambda')).toBe('AWS');
    expect(skillFamily('GitHub Actions')).toBe('CI/CD');
    expect(skillFamily('Python')).toBeNull();
  });

  it('reports mentions in reading order', () => {
    expect(findSkillMentions('Go, then Python and Terraform').map((m) => m.name)).toEqual([
      'Go',
      'Python',
      'Terraform',
    ]);
  });
});

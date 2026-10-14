import { describe, expect, it } from 'vitest';
import {
  classifyHeading,
  findEmploymentType,
  findSalary,
  findSkills,
  findWorkArrangement,
  findYearsOfExperience,
} from '../src';

describe('findSkills', () => {
  it('matches on token boundaries', () => {
    expect(findSkills('We use JavaScript and GitHub daily')).toEqual(['JavaScript']);
    expect(findSkills('Strong Java and C# skills')).toEqual(['Java', 'C#']);
    expect(findSkills('Modern C++ and .NET services')).toEqual(['C++', '.NET']);
  });

  it('only matches ambiguous words in their technical capitalization', () => {
    expect(findSkills('Take a rest, then go on a swift spring walk')).toEqual([]);
    expect(findSkills('Build REST services in Go and Swift')).toEqual(['Go', 'Swift', 'REST APIs']);
  });
});

describe('findYearsOfExperience', () => {
  it.each([
    ['3+ years of experience with Python', { min: 3, max: null }],
    ['2-4 years of professional software experience', { min: 2, max: 4 }],
    ['two years of relevant experience', { min: 2, max: null }],
  ])('%s', (text, expected) => {
    expect(findYearsOfExperience(text)?.value).toEqual(expected);
  });

  it('ignores years unrelated to experience', () => {
    expect(findYearsOfExperience('We have been in business for 25 years.')).toBeNull();
  });
});

describe('findSalary', () => {
  it('parses thousands shorthand and keeps "$" currency unknown', () => {
    expect(findSalary('Pay: $120K–$150K a year')?.value).toEqual({
      min: 120000,
      max: 150000,
      currency: null,
      period: 'year',
    });
  });

  it('accepts unambiguous symbols and explicit codes', () => {
    expect(findSalary('€45,000 to €55,000 per year')?.value).toMatchObject({
      currency: 'EUR',
      min: 45000,
    });
    expect(findSalary('CAD $30 - $35 per hour')?.value).toMatchObject({
      currency: 'CAD',
      period: 'hour',
    });
  });

  it('rejects inverted ranges', () => {
    expect(findSalary('$90 - $50 per hour')).toBeNull();
  });
});

describe('arrangement and employment type', () => {
  it('detects arrangements and avoids guessing on conflicts', () => {
    expect(findWorkArrangement('This is a fully remote role')?.value).toBe('remote');
    expect(findWorkArrangement('Hybrid: two days on-site')?.value).toBe('hybrid');
    expect(findWorkArrangement('Remote work is possible but on-site is preferred')).toBeNull();
    expect(findWorkArrangement('A great team')).toBeNull();
  });

  it('detects internships before generic full-time wording', () => {
    expect(findEmploymentType('Full-time summer internship')?.value).toBe('internship');
    expect(findEmploymentType('Part-time support role')?.value).toBe('part-time');
  });
});

describe('classifyHeading', () => {
  it.each([
    ['Requirements', 'required'],
    ['Minimum Qualifications', 'required'],
    ["What you'll need", 'required'],
    ['Preferred Qualifications', 'preferred'],
    ['Nice to have', 'preferred'],
    ["What you'll do", 'responsibilities'],
    ['Benefits', 'benefits'],
    ['About us', 'other'],
  ])('%s → %s', (heading, kind) => {
    expect(classifyHeading(heading)).toBe(kind);
  });
});

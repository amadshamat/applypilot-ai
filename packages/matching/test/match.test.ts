import { describe, expect, it } from 'vitest';
import { matchJob, totalExperience } from '../src';
import { NOW, WEIGHTS, job, profile, skill } from './helpers';

const role = (startDate: string, endDate: string, current = false) => ({
  id: `r-${startDate}`,
  employer: 'Acme',
  position: 'Intern',
  location: '',
  startDate,
  endDate,
  current,
  bullets: [],
  technologies: [],
});

describe('matchJob scoring', () => {
  it('returns no score when nothing in the posting can be compared', () => {
    const result = matchJob(job({ title: 'Intern' }), profile(), WEIGHTS, { now: NOW });
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
  });

  it('scores only the parts it can judge and reports coverage', () => {
    const posting = job({ skills: ['Python', 'AWS'] });
    const result = matchJob(posting, profile({ skills: [skill('Python')] }), WEIGHTS, { now: NOW });
    // Only required skills (weight 35) are known: 1 of 2 matched.
    expect(result.score).toBe(50);
    expect(result.coverage).toBeCloseTo(0.35);
    expect(result.components.find((c) => c.key === 'experience')?.score).toBeNull();
  });

  it('gives 100 when every judged requirement is met', () => {
    const posting = job({
      requiredQualifications: ['Experience with Python', "Bachelor's degree in Computer Science"],
      skills: ['Python'],
      education: ["Bachelor's degree in Computer Science"],
      yearsOfExperience: { min: 1, max: null },
    });
    const result = matchJob(
      posting,
      profile({
        skills: [skill('Python')],
        experience: [role('2024-01', '2025-06')],
        education: [
          {
            id: 'e',
            institution: 'U',
            degree: 'Bachelor of Science',
            field: 'CS',
            startDate: '',
            endDate: '2024',
            current: false,
            gpa: '',
            coursework: [],
          },
        ],
      }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.score).toBe(100);
    expect(result.gaps).toEqual([]);
  });

  it('never counts an unknown or missing skill as a match', () => {
    const result = matchJob(
      job({ skills: ['Kubernetes'] }),
      profile({ skills: [skill('Docker')] }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.requiredSkills).toEqual([
      { skill: 'Kubernetes', status: 'missing', evidence: [] },
    ]);
    expect(result.score).toBe(0);
  });

  it('is monotonic: adding a required skill to the profile never lowers the score', () => {
    const posting = job({ skills: ['Python', 'Terraform', 'Docker'] });
    let current = profile();
    let previous = matchJob(posting, current, WEIGHTS, { now: NOW }).score ?? 0;
    for (const name of ['Python', 'Terraform', 'Docker']) {
      current = { ...current, skills: [...current.skills, skill(name)] };
      const next = matchJob(posting, current, WEIGHTS, { now: NOW }).score ?? 0;
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(previous).toBe(100);
  });

  it('respects the user’s weights', () => {
    const posting = job({ skills: ['Python'], yearsOfExperience: { min: 2, max: null } });
    const candidate = profile({ skills: [skill('Python')] });
    const skillsHeavy = matchJob(
      posting,
      candidate,
      { ...WEIGHTS, requiredSkills: 90, experience: 10 },
      { now: NOW },
    );
    const experienceHeavy = matchJob(
      posting,
      candidate,
      { ...WEIGHTS, requiredSkills: 10, experience: 90 },
      { now: NOW },
    );
    expect(skillsHeavy.score).toBe(90);
    expect(experienceHeavy.score).toBe(10);
  });

  it('handles all-zero weights without dividing by zero', () => {
    const zero = {
      requiredSkills: 0,
      experience: 0,
      education: 0,
      preferredSkills: 0,
      otherRequirements: 0,
    };
    const result = matchJob(job({ skills: ['Python'] }), profile(), zero, { now: NOW });
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
  });

  it('is deterministic for the same inputs', () => {
    const posting = job({ skills: ['Python', 'AWS'], location: 'Toronto, ON' });
    const candidate = profile({
      skills: [skill('AWS')],
      personal: { ...profile().personal, location: 'Toronto, ON' },
    });
    expect(matchJob(posting, candidate, WEIGHTS, { now: NOW })).toEqual(
      matchJob(posting, candidate, WEIGHTS, { now: NOW }),
    );
  });
});

describe('skill evidence', () => {
  it('finds skills in experience and projects, not only the skills list', () => {
    const result = matchJob(
      job({ skills: ['Terraform', 'React'] }),
      profile({
        experience: [
          {
            ...role('2024-01', '2024-06'),
            employer: 'Northwind',
            bullets: ['Provisioned VPCs with Terraform'],
          },
        ],
        projects: [
          {
            id: 'p',
            name: 'Tracker',
            description: '',
            technologies: ['React'],
            url: '',
            bullets: [],
          },
        ],
      }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.requiredSkills).toEqual([
      { skill: 'Terraform', status: 'matched', evidence: ['Experience: Northwind'] },
      { skill: 'React', status: 'matched', evidence: ['Project: Tracker'] },
    ]);
  });

  it('counts a specific service as the general platform, and siblings as related only', () => {
    const result = matchJob(
      job({ skills: ['AWS', 'Amazon EC2'] }),
      profile({ skills: [skill('AWS Lambda')] }),
      WEIGHTS,
      {
        now: NOW,
      },
    );
    expect(result.requiredSkills[0]).toMatchObject({ skill: 'AWS', status: 'matched' });
    expect(result.requiredSkills[1]).toMatchObject({
      skill: 'Amazon EC2',
      status: 'related',
      relatedVia: 'AWS',
    });
    // 1 + 0.5 of 2
    expect(result.score).toBe(75);
  });

  it('treats "one of A, B or C" as a single requirement met by any of them', () => {
    const result = matchJob(
      job({
        requiredQualifications: [
          'Proficiency in at least one of Python, Go, Java, or C++',
          'Comfortable with Linux and Bash',
        ],
        skills: ['Python', 'Go', 'Java', 'C++', 'Linux', 'Bash'],
      }),
      profile({ skills: [skill('Java'), skill('Linux')] }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.requiredSkills.map((m) => [m.skill, m.status])).toEqual([
      ['Linux', 'matched'],
      ['Bash', 'missing'],
      ['Java', 'matched'],
    ]);
    expect(result.requiredSkills[2]?.alternatives).toEqual(['Python', 'Go', 'Java', 'C++']);
  });

  it('still requires every skill when "or" comes before the skills', () => {
    const result = matchJob(
      job({
        requiredQualifications: ['Coursework or project experience with AWS (EC2, S3)'],
        skills: ['AWS'],
      }),
      profile(),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.requiredSkills.map((m) => m.skill)).toEqual(['AWS', 'Amazon EC2', 'Amazon S3']);
  });

  it('puts description-only skills in preferred and keeps each skill once', () => {
    const result = matchJob(
      job({
        requiredQualifications: ['Experience with Python'],
        preferredQualifications: ['Docker or Kubernetes'],
        skills: ['Python', 'Docker', 'Kubernetes', 'Git'],
      }),
      profile({ skills: [skill('Kubernetes')] }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.requiredSkills.map((m) => m.skill)).toEqual(['Python']);
    expect(result.preferredSkills.map((m) => [m.skill, m.status])).toEqual([
      ['Kubernetes', 'matched'],
      ['Git', 'missing'],
    ]);
  });
});

describe('experience, education and preferences', () => {
  it('merges overlapping roles and counts current roles up to today', () => {
    expect(
      totalExperience([role('2024-01', '2024-12'), role('2024-06', '2025-05')], NOW).years,
    ).toBe(1.4);
    expect(totalExperience([role('2025-10', '', true)], NOW).years).toBe(1.1);
    expect(totalExperience([role('', '2024-01')], NOW)).toEqual({ years: 0, undatedRoles: 1 });
  });

  it('reads year-only dates conservatively', () => {
    // Dec 2022 to Jan 2023 counts as two months, never as two years.
    expect(totalExperience([role('2022', '2023')], NOW).years).toBe(0.2);
  });

  it('gives partial experience credit and explains it', () => {
    const result = matchJob(
      job({ yearsOfExperience: { min: 2, max: null } }),
      profile({ experience: [role('2025-01', '2025-12')] }),
      WEIGHTS,
      { now: NOW },
    );
    const experience = result.components.find((c) => c.key === 'experience');
    expect(experience?.score).toBe(0.5);
    expect(experience?.detail).toBe(
      'The posting asks for 2 years; your dated roles add up to 1 year.',
    );
  });

  const student = {
    id: 'e',
    institution: 'University of Toronto',
    degree: 'Bachelor of Science',
    field: 'Computer Science',
    startDate: '2022-09' as const,
    endDate: '2026-05' as const,
    current: true,
    gpa: '',
    coursework: [],
  };

  it('accepts a degree in progress for student roles', () => {
    const result = matchJob(
      job({ education: ["Currently pursuing a Bachelor's degree"] }),
      profile({ education: [student] }),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.components.find((c) => c.key === 'education')?.score).toBe(1);
  });

  it('gives partial credit for an unfinished degree on a non-student role, and for a lower degree', () => {
    const inProgress = matchJob(
      job({ education: ["Bachelor's degree required"] }),
      profile({ education: [student] }),
      WEIGHTS,
      {
        now: NOW,
      },
    );
    expect(inProgress.components.find((c) => c.key === 'education')?.score).toBe(0.8);
    const lower = matchJob(
      job({ education: ["Master's degree"] }),
      profile({ education: [{ ...student, current: false }] }),
      WEIGHTS,
      {
        now: NOW,
      },
    );
    expect(lower.components.find((c) => c.key === 'education')?.score).toBe(0.5);
  });

  it('compares work arrangement, type and location with the user’s preferences', () => {
    const posting = job({
      workArrangement: 'on-site',
      employmentType: ['internship'],
      location: 'Pittsburgh, PA',
    });
    const candidate = profile({
      preferences: {
        ...profile().preferences,
        workArrangements: ['remote', 'hybrid'],
        employmentTypes: ['internship'],
        locations: ['Toronto, ON'],
      },
    });
    const result = matchJob(posting, candidate, WEIGHTS, { now: NOW });
    expect(result.components.find((c) => c.key === 'otherRequirements')?.score).toBeCloseTo(1 / 3);
    expect(result.gaps).toContain('This role is on-site; you prefer remote or hybrid');
  });

  it('lists non-skill requirements for the user to confirm, without judging them', () => {
    const result = matchJob(
      job({
        requiredQualifications: [
          'Must be legally authorized to work in Canada',
          'Experience with Python',
          'Strong communication skills',
        ],
      }),
      profile(),
      WEIGHTS,
      { now: NOW },
    );
    expect(result.toConfirm).toEqual([
      'Must be legally authorized to work in Canada',
      'Strong communication skills',
    ]);
  });
});

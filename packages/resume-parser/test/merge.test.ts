import { emptyProfileContent, type ProfileContent } from '@applypilot/shared';
import { describe, expect, it } from 'vitest';
import { mergeProfiles } from '../src';

function profile(overrides: Partial<ProfileContent>): ProfileContent {
  return { ...emptyProfileContent(), ...overrides };
}

const skill = (id: string, name: string) => ({ id, name, category: 'other' as const });

describe('mergeProfiles', () => {
  const existing = profile({
    personal: { ...emptyProfileContent().personal, fullName: 'Typed Name', email: '' },
    summary: 'My own summary',
    skills: [skill('a', 'Python'), skill('b', 'Kubernetes')],
    preferences: { ...emptyProfileContent().preferences, desiredRoles: ['Cloud Intern'] },
  });
  const draft = profile({
    personal: {
      ...emptyProfileContent().personal,
      fullName: 'Parsed Name',
      email: 'me@example.com',
    },
    summary: 'Parsed summary',
    skills: [skill('c', 'python'), skill('d', 'k8s'), skill('e', 'Terraform')],
  });

  it('merge adds only new items and never overwrites what the user typed', () => {
    const { profile: merged, summary } = mergeProfiles(existing, draft, 'merge');
    expect(merged.personal.fullName).toBe('Typed Name');
    expect(merged.personal.email).toBe('me@example.com');
    expect(merged.summary).toBe('My own summary');
    expect(merged.skills.map((s) => s.name)).toEqual(['Python', 'Kubernetes', 'Terraform']);
    expect(summary).toEqual({
      added: { education: 0, experience: 0, skills: 1, certifications: 0, projects: 0 },
      skippedDuplicates: 2,
    });
  });

  it('replace swaps resume sections but keeps job preferences', () => {
    const { profile: replaced } = mergeProfiles(existing, draft, 'replace');
    expect(replaced.personal.fullName).toBe('Parsed Name');
    expect(replaced.skills).toEqual(draft.skills);
    expect(replaced.preferences.desiredRoles).toEqual(['Cloud Intern']);
  });

  it('does not mutate its inputs', () => {
    const before = structuredClone(existing);
    mergeProfiles(existing, draft, 'merge');
    expect(existing).toEqual(before);
  });
});

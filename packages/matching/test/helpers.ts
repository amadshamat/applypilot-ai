import {
  DEFAULT_MATCH_WEIGHTS,
  emptyProfileContent,
  type JobPosting,
  type MatchWeights,
  type ProfileContent,
} from '@applypilot/shared';

type FieldValues = {
  [K in keyof JobPosting]?: Extract<JobPosting[K], { status: 'found' }>['value'];
};

/** A posting with only the given fields found; everything else is missing. */
export function job(values: FieldValues): JobPosting {
  const keys: Array<keyof JobPosting> = [
    'title',
    'company',
    'description',
    'location',
    'workArrangement',
    'salary',
    'employmentType',
    'requiredQualifications',
    'preferredQualifications',
    'skills',
    'yearsOfExperience',
    'education',
    'applicationDeadline',
    'url',
    'jobId',
    'hasApplicationForm',
  ];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      values[key] === undefined
        ? { status: 'missing' }
        : { status: 'found', value: values[key], source: 'dom', confidence: 'high' },
    ]),
  ) as JobPosting;
}

export function profile(overrides: Partial<ProfileContent> = {}): ProfileContent {
  return { ...emptyProfileContent(), ...overrides };
}

let counter = 0;
export const skill = (name: string) => ({
  id: `s${String(++counter)}`,
  name,
  category: 'other' as const,
});

export const WEIGHTS: MatchWeights = { ...DEFAULT_MATCH_WEIGHTS };
export const NOW = new Date('2026-10-14T00:00:00Z');

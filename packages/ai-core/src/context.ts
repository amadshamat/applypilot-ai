import type { JobPosting, ProfileContent } from '@applypilot/shared';
import type { CandidateContext, JobContext } from './contracts';

/**
 * Builds the minimum data each AI task needs. Contact details (email, phone,
 * location, links), GPA, job preferences and salary expectations are never
 * included. The name is included only when a task asks for it.
 */

export interface CandidateContextOptions {
  includeName: boolean;
}

export interface RefTarget {
  kind: 'experience' | 'project' | 'education' | 'certification';
  id: string;
  label: string;
}

export interface BuiltCandidateContext {
  context: CandidateContext;
  /** Ref ("E1") → the profile entry it stands for. Stays in the browser. */
  refs: Map<string, RefTarget>;
}

const MAX_DESCRIPTION = 20_000;

function end(date: string, current: boolean): string {
  return current ? 'present' : date;
}

export function buildCandidateContext(
  profile: ProfileContent,
  { includeName }: CandidateContextOptions,
): BuiltCandidateContext {
  const refs = new Map<string, RefTarget>();
  const ref = (prefix: string, index: number, target: RefTarget) => {
    const key = `${prefix}${index + 1}`;
    refs.set(key, target);
    return key;
  };

  const context: CandidateContext = {
    name: includeName ? profile.personal.fullName : '',
    summary: profile.summary,
    experience: profile.experience.map((e, i) => ({
      ref: ref('E', i, {
        kind: 'experience',
        id: e.id,
        label: [e.position, e.employer].filter(Boolean).join(' at '),
      }),
      position: e.position,
      employer: e.employer,
      start: e.startDate,
      end: end(e.endDate, e.current),
      bullets: e.bullets,
      technologies: e.technologies,
    })),
    projects: profile.projects.map((p, i) => ({
      ref: ref('P', i, { kind: 'project', id: p.id, label: p.name }),
      name: p.name,
      description: p.description,
      technologies: p.technologies,
      bullets: p.bullets,
    })),
    education: profile.education.map((d, i) => ({
      ref: ref('D', i, {
        kind: 'education',
        id: d.id,
        label: [d.degree, d.institution].filter(Boolean).join(', '),
      }),
      degree: d.degree,
      field: d.field,
      institution: d.institution,
      start: d.startDate,
      end: d.endDate,
      inProgress: d.current,
      coursework: d.coursework,
    })),
    certifications: profile.certifications.map((c, i) => ({
      ref: ref('C', i, { kind: 'certification', id: c.id, label: c.name }),
      name: c.name,
      issuer: c.issuer,
      date: c.date,
    })),
    skills: profile.skills.map((s) => s.name),
  };
  return { context, refs };
}

function value<T>(field: JobPosting[keyof JobPosting], fallback: T): T {
  return field.status === 'found' ? (field.value as T) : fallback;
}

export function buildJobContext(job: JobPosting): JobContext {
  const description = value<string>(job.description, '');
  return {
    title: value(job.title, ''),
    company: value(job.company, ''),
    location: value(job.location, ''),
    description:
      description.length > MAX_DESCRIPTION ? description.slice(0, MAX_DESCRIPTION) : description,
    requiredQualifications: value<string[]>(job.requiredQualifications, []).slice(0, 60),
    preferredQualifications: value<string[]>(job.preferredQualifications, []).slice(0, 60),
    skills: value<string[]>(job.skills, []).slice(0, 100),
  };
}

/** Every piece of candidate-supplied text, for grounding checks. */
export function candidateText(candidate: CandidateContext, notes = ''): string {
  return [
    candidate.summary,
    ...candidate.experience.flatMap((e) => [
      e.position,
      e.employer,
      e.start,
      e.end,
      ...e.bullets,
      ...e.technologies,
    ]),
    ...candidate.projects.flatMap((p) => [p.name, p.description, ...p.technologies, ...p.bullets]),
    ...candidate.education.flatMap((d) => [
      d.degree,
      d.field,
      d.institution,
      d.start,
      d.end,
      ...d.coursework,
    ]),
    ...candidate.certifications.flatMap((c) => [c.name, c.issuer, c.date]),
    ...candidate.skills,
    notes,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

export function jobText(job: JobContext): string {
  return [
    job.title,
    job.company,
    job.location,
    job.description,
    ...job.requiredQualifications,
    ...job.preferredQualifications,
    ...job.skills,
  ].join('\n');
}

export function hasUsableJob(job: JobContext): boolean {
  return (
    job.description.length > 0 ||
    job.requiredQualifications.length > 0 ||
    job.preferredQualifications.length > 0
  );
}

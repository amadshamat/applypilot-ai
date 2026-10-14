import { normalizeSkillName, type ProfileContent } from '@applypilot/shared';

/**
 * Applies a reviewed resume draft to the saved profile. "replace" swaps the
 * resume-derived sections and keeps job preferences; "merge" only adds what is
 * new and fills empty contact fields, so nothing the user typed is overwritten.
 */

export type MergeMode = 'replace' | 'merge';

export interface MergeSummary {
  added: Record<'education' | 'experience' | 'skills' | 'certifications' | 'projects', number>;
  skippedDuplicates: number;
}

const key = (...parts: string[]) =>
  parts
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^a-z0-9+#]+/g, ' ')
        .trim(),
    )
    .join('|');

function addNew<T>(existing: readonly T[], incoming: readonly T[], keyOf: (item: T) => string) {
  const seen = new Set(existing.map(keyOf));
  const added: T[] = [];
  for (const item of incoming) {
    const itemKey = keyOf(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    added.push(item);
  }
  return {
    items: [...existing, ...added],
    added: added.length,
    skipped: incoming.length - added.length,
  };
}

export function mergeProfiles(
  existing: ProfileContent,
  draft: ProfileContent,
  mode: MergeMode,
): { profile: ProfileContent; summary: MergeSummary } {
  if (mode === 'replace') {
    return {
      profile: { ...draft, preferences: existing.preferences },
      summary: {
        added: {
          education: draft.education.length,
          experience: draft.experience.length,
          skills: draft.skills.length,
          certifications: draft.certifications.length,
          projects: draft.projects.length,
        },
        skippedDuplicates: 0,
      },
    };
  }

  const education = addNew(existing.education, draft.education, (e) =>
    key(e.institution, e.degree),
  );
  const experience = addNew(existing.experience, draft.experience, (e) =>
    key(e.employer, e.position),
  );
  const skills = addNew(existing.skills, draft.skills, (s) => normalizeSkillName(s.name));
  const certifications = addNew(existing.certifications, draft.certifications, (c) => key(c.name));
  const projects = addNew(existing.projects, draft.projects, (p) => key(p.name));

  const personal = { ...existing.personal };
  for (const field of Object.keys(personal) as Array<keyof typeof personal>) {
    if (personal[field] === '' && draft.personal[field] !== '')
      personal[field] = draft.personal[field];
  }

  return {
    profile: {
      ...existing,
      personal,
      summary: existing.summary || draft.summary,
      education: education.items,
      experience: experience.items,
      skills: skills.items,
      certifications: certifications.items,
      projects: projects.items,
    },
    summary: {
      added: {
        education: education.added,
        experience: experience.added,
        skills: skills.added,
        certifications: certifications.added,
        projects: projects.added,
      },
      skippedDuplicates:
        education.skipped +
        experience.skipped +
        skills.skipped +
        certifications.skipped +
        projects.skipped,
    },
  };
}

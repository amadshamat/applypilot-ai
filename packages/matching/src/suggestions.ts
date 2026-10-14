import {
  findSkills,
  normalizeSkillName,
  type JobPosting,
  type ProfileContent,
} from '@applypilot/shared';
import type { SkillEvidenceIndex } from './evidence';
import type { SkillMatch, Suggestion } from './types';

/**
 * Resume suggestions that stay truthful: each one either points at something
 * the profile already says, or asks the user to add a fact only if it is true.
 */

interface SuggestionInput {
  job: JobPosting;
  profile: ProfileContent;
  evidence: SkillEvidenceIndex;
  requiredSkills: readonly SkillMatch[];
  preferredSkills: readonly SkillMatch[];
  enrolledWanted: boolean;
  isInternship: boolean;
}

const joinNames = (names: readonly string[]) =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;

const HAS_NUMBER =
  /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|dozens?)\b/i;

export function buildSuggestions(input: SuggestionInput): Suggestion[] {
  const { job, profile, evidence, requiredSkills, preferredSkills } = input;
  const suggestions: Suggestion[] = [];
  const all = [...requiredSkills, ...preferredSkills];
  const matched = all.filter((m) => m.status === 'matched');
  const key = (name: string) => normalizeSkillName(name);

  // Shown in experience or projects but not in the Skills list.
  const notListed = matched.filter(
    (m) => !evidence.listed.includes(key(m.skill)) && evidence.inContext.has(key(m.skill)),
  );
  if (notListed.length > 0) {
    suggestions.push({
      id: 'add-to-skills',
      kind: 'add-to-skills',
      title: `Add ${joinNames(notListed.map((m) => m.skill))} to your skills list`,
      detail: `The posting asks for ${notListed.length === 1 ? 'it' : 'them'}, and your profile already shows ${notListed.length === 1 ? 'it' : 'them'} (${notListed.map((m) => `${m.skill}: ${m.evidence[0]?.replace(/ \(.*\)$/, '') ?? ''}`).join('; ')}). Listing ${notListed.length === 1 ? 'it' : 'them'} helps keyword screening.`,
      priority: 90,
    });
  }

  // Listed as a skill but never shown in use.
  const listedOnly = requiredSkills.filter(
    (m) =>
      m.status === 'matched' &&
      evidence.listed.includes(key(m.skill)) &&
      !evidence.inContext.has(key(m.skill)),
  );
  if (listedOnly.length > 0) {
    suggestions.push({
      id: 'show-skill-in-context',
      kind: 'show-skill-in-context',
      title: `Show where you used ${joinNames(listedOnly.map((m) => m.skill))}`,
      detail:
        'These required skills appear only in your skills list. If you used them in a job, course or project, say so in that entry so a reviewer can see real use. If you have not used them yet, leave the entries as they are.',
      priority: 80,
    });
  }

  // Matched skills buried low in the list.
  const topCount = Math.max(5, Math.min(8, evidence.listed.length));
  const buried = matched.filter((m) => {
    const position = evidence.listed.indexOf(key(m.skill));
    return position >= topCount;
  });
  if (buried.length > 0) {
    suggestions.push({
      id: 'reorder-skills',
      kind: 'reorder-skills',
      title: `Move ${joinNames(buried.map((m) => m.skill))} toward the top of your skills`,
      detail:
        'Reviewers skim the first few skills. Put the ones this posting asks for first in the resume you send.',
      priority: 60,
    });
  }

  // Related, not exact.
  for (const match of all.filter((m) => m.status === 'related')) {
    suggestions.push({
      id: `related-${key(match.skill)}`,
      kind: 'related-skill',
      title: `${match.skill}: you show related ${match.relatedVia ?? ''} experience`,
      detail: `If you have used ${match.skill} itself, name it in the entry where you used it. If not, describe your ${match.relatedVia ?? 'related'} work accurately; it may still be relevant.`,
      priority: 55,
    });
  }

  // Required and missing.
  const missing = requiredSkills.filter((m) => m.status === 'missing');
  if (missing.length > 0) {
    suggestions.push({
      id: 'missing-skills',
      kind: 'missing-skill',
      title: `Not in your profile: ${joinNames(missing.map((m) => m.skill))}`,
      detail:
        'Add these only if you genuinely have them (from work, courses, certifications or projects) and they are just missing from your profile. Otherwise, do not claim them; mention related strengths, or treat them as things to learn.',
      priority: 70,
    });
  }

  // Project with the most overlap.
  const wanted = new Set(all.map((m) => key(m.skill)));
  const ranked = profile.projects
    .map((project) => {
      const used = [
        ...new Set([
          ...project.technologies,
          ...findSkills([project.description, ...project.bullets].join('\n')),
        ]),
      ].filter((name) => wanted.has(key(name)));
      return { project, used };
    })
    .filter((entry) => entry.used.length > 0)
    .sort((a, b) => b.used.length - a.used.length);
  const best = ranked[0];
  if (best) {
    suggestions.push({
      id: `highlight-project-${best.project.id}`,
      kind: 'highlight-project',
      title: `Lead with your "${best.project.name}" project`,
      detail: `It uses ${joinNames(best.used)}, which this posting asks for. Place it near the top of your projects for this application.`,
      priority: 50,
    });
  }

  // Bullets without numbers.
  const unquantified = profile.experience
    .flatMap((role) => role.bullets)
    .filter((bullet) => !HAS_NUMBER.test(bullet));
  if (unquantified.length > 0) {
    suggestions.push({
      id: 'add-metrics',
      kind: 'add-metrics',
      title: `Add real numbers to ${String(unquantified.length)} experience bullet${unquantified.length === 1 ? '' : 's'}`,
      detail:
        'Where you know them, add measurable results such as users served, tickets resolved or time saved. Only use numbers you can back up; leave a bullet as it is if you do not know the figure.',
      priority: 30,
    });
  }

  // Summary.
  const title = job.title.status === 'found' ? job.title.value : '';
  if (!profile.summary) {
    suggestions.push({
      id: 'summary',
      kind: 'summary',
      title: 'Add a short summary',
      detail: `Two sentences on what you study or do and the kind of role you want${title ? ` (for example, roles like "${title}")` : ''}, using only facts from your profile.`,
      priority: 20,
    });
  }

  // Graduation date for student roles.
  const studying = profile.education.find((entry) => entry.current);
  if ((input.enrolledWanted || input.isInternship) && studying && !studying.endDate) {
    suggestions.push({
      id: 'graduation-date',
      kind: 'graduation-date',
      title: 'Add your expected graduation date',
      detail: `Student roles usually filter on graduation date. Add it to your ${studying.institution || 'current'} education entry.`,
      priority: 65,
    });
  }

  return suggestions.sort((a, b) => b.priority - a.priority);
}

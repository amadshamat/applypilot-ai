import {
  findSkillMentions,
  findSkills,
  type JobPosting,
  type MatchWeights,
  type ProfileContent,
} from '@applypilot/shared';
import {
  degreeLevels,
  highestDegree,
  rank,
  requiredLevel,
  wantsEnrolledStudents,
} from './education';
import { buildEvidence, matchSkill, skillScore, type SkillEvidenceIndex } from './evidence';
import { totalExperience } from './experience';
import { buildSuggestions } from './suggestions';
import type { ComponentKey, MatchComponent, MatchResult, SkillMatch } from './types';

/**
 * Deterministic, explainable job matching. The score is a weighted average of
 * the parts that could actually be judged; parts the posting does not mention
 * are left out of both the numerator and the denominator and reported through
 * `coverage`, so a missing field never counts for or against the user.
 *
 * Nothing here reads anything but the posting and the user's own profile.
 */

export interface MatchOptions {
  /** "Today", for roles marked as current. Injectable for tests. */
  now?: Date;
}

const LABELS: Record<ComponentKey, string> = {
  requiredSkills: 'Required skills',
  preferredSkills: 'Preferred skills',
  experience: 'Experience',
  education: 'Education',
  otherRequirements: 'Job preferences',
};

const listOf = <T>(field: { status: 'found'; value: T[] } | { status: 'missing' }): T[] =>
  field.status === 'found' ? field.value : [];

interface SkillRequirement {
  skills: string[];
  /** True when any one of the skills satisfies the requirement. */
  anyOf: boolean;
}

const ALTERNATIVE_WORDS = /\b(one of|any of|either|at least one)\b/i;

/**
 * Reads one qualification line. "Proficiency in one of Python, Go or Java" is
 * a single requirement satisfied by any of them; "Linux and Bash" needs both.
 * An "or" only makes alternatives when it comes after the first skill, so
 * "Coursework or project experience with AWS" still requires AWS.
 */
function requirementsIn(line: string): SkillRequirement[] {
  // "AWS CDK" also mentions "AWS"; keep only the longer name at the same position.
  const mentions = findSkillMentions(line).filter(
    (mention, _, all) =>
      !all.some(
        (other) =>
          other !== mention &&
          other.index === mention.index &&
          other.name.length > mention.name.length,
      ),
  );
  if (mentions.length === 0) return [];
  const first = mentions[0]?.index ?? 0;
  const anyOf =
    mentions.length > 1 && (ALTERNATIVE_WORDS.test(line) || /\bor\b/i.test(line.slice(first)));
  const skills = mentions.map((mention) => mention.name);
  return anyOf
    ? [{ skills, anyOf: true }]
    : skills.map((skill) => ({ skills: [skill], anyOf: false }));
}

/** Splits the posting's skills into required and preferred requirements, each skill counted once. */
function jobRequirements(job: JobPosting): {
  required: SkillRequirement[];
  preferred: SkillRequirement[];
} {
  const all = listOf(job.skills);
  const requiredLines = listOf(job.requiredQualifications);
  const preferredLines = listOf(job.preferredQualifications);
  if (requiredLines.length === 0 && preferredLines.length === 0) {
    return { required: all.map((skill) => ({ skills: [skill], anyOf: false })), preferred: [] };
  }
  const seen = new Set<string>();
  const take = (requirements: SkillRequirement[]) =>
    requirements
      // A skill required on its own elsewhere wins over an "or" group.
      .sort((a, b) => Number(a.anyOf) - Number(b.anyOf))
      .flatMap((requirement) => {
        const fresh = requirement.skills.filter((skill) => !seen.has(skill));
        // An "or" group with a member already counted elsewhere is covered by that member.
        if (fresh.length === 0 || (requirement.anyOf && fresh.length !== requirement.skills.length))
          return [];
        for (const skill of fresh) seen.add(skill);
        return [{ ...requirement, skills: fresh }];
      });
  const required = take(requiredLines.flatMap(requirementsIn));
  const preferred = [
    ...take(preferredLines.flatMap(requirementsIn)),
    // Skills only mentioned in the description count as preferred.
    ...take(all.map((skill) => ({ skills: [skill], anyOf: false }))),
  ];
  return { required, preferred };
}

const STATUS_RANK = { matched: 2, related: 1, missing: 0 } as const;

function matchRequirement(requirement: SkillRequirement, evidence: SkillEvidenceIndex): SkillMatch {
  const matches = requirement.skills.map((skill) => matchSkill(skill, evidence));
  if (!requirement.anyOf) return matches[0] ?? { skill: '', status: 'missing', evidence: [] };
  const best = matches.reduce((a, b) => (STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b : a));
  return {
    ...best,
    skill: best.status === 'missing' ? requirement.skills.join(' / ') : best.skill,
    alternatives: requirement.skills,
  };
}

function describeSkills(matches: readonly SkillMatch[], kind: string): string {
  if (matches.length === 0) return `The posting does not list ${kind} skills we recognise.`;
  const matched = matches.filter((m) => m.status === 'matched').length;
  const related = matches.filter((m) => m.status === 'related').length;
  return `You show ${String(matched)} of ${String(matches.length)} ${kind} skills${related > 0 ? `, plus ${String(related)} related` : ''}.`;
}

const pluralYears = (years: number) => `${String(years)} year${years === 1 ? '' : 's'}`;

function locationFits(jobLocation: string, wanted: readonly string[]): boolean {
  const job = jobLocation.toLowerCase();
  return wanted.some((place) => {
    const city = place.split(',')[0]?.trim().toLowerCase() ?? '';
    return city.length >= 3 && job.includes(city);
  });
}

/** Lines that are not about skills, years or degrees: a person has to judge these. */
function linesToConfirm(job: JobPosting): string[] {
  return [...listOf(job.requiredQualifications), ...listOf(job.preferredQualifications)].filter(
    (line) =>
      findSkills(line).length === 0 &&
      degreeLevels(line).length === 0 &&
      !/\b\d+\+?\s*(?:years?|yrs?)\b/i.test(line) &&
      line.length <= 300,
  );
}

export function matchJob(
  job: JobPosting,
  profile: ProfileContent,
  weights: MatchWeights,
  options: MatchOptions = {},
): MatchResult {
  const now = options.now ?? new Date();
  const evidence = buildEvidence(profile);
  const strengths: string[] = [];
  const gaps: string[] = [];

  // Skills
  const requirements = jobRequirements(job);
  const requiredSkills = requirements.required.map((r) => matchRequirement(r, evidence));
  const preferredSkills = requirements.preferred.map((r) => matchRequirement(r, evidence));
  // Matched skills are shown with their evidence elsewhere; strengths and gaps summarise.
  const matchedRequired = requiredSkills.filter((m) => m.status === 'matched');
  if (requiredSkills.length > 0 && matchedRequired.length === requiredSkills.length) {
    strengths.push('You show every required skill the posting lists');
  }
  for (const match of requiredSkills) {
    if (match.status === 'related') {
      gaps.push(
        `${match.skill} is required; you show related ${match.relatedVia ?? ''} experience`,
      );
    } else if (match.status === 'missing') {
      gaps.push(`${match.skill} is required and not in your profile`);
    }
  }

  // Experience
  let experienceScore: number | null = null;
  let experienceDetail = 'The posting does not state a number of years.';
  if (job.yearsOfExperience.status === 'found') {
    const needed = job.yearsOfExperience.value.min;
    const { years, undatedRoles } = totalExperience(profile.experience, now);
    experienceScore = needed === 0 ? 1 : Math.min(1, years / needed);
    experienceDetail = `The posting asks for ${pluralYears(needed)}; your dated roles add up to ${pluralYears(years)}${undatedRoles > 0 ? ` (${String(undatedRoles)} role${undatedRoles === 1 ? '' : 's'} without dates not counted)` : ''}.`;
    if (years >= needed)
      strengths.push(`${pluralYears(years)} of experience (asks for ${pluralYears(needed)})`);
    else
      gaps.push(
        `Asks for ${pluralYears(needed)} of experience; your profile shows ${pluralYears(years)}`,
      );
  }

  // Education
  let educationScore: number | null = null;
  let educationDetail = 'The posting does not state a degree requirement.';
  const educationLines = listOf(job.education);
  const needed = requiredLevel(educationLines);
  const isInternship =
    job.employmentType.status === 'found' && job.employmentType.value.includes('internship');
  const enrolledWanted =
    wantsEnrolledStudents(educationLines) ||
    wantsEnrolledStudents(listOf(job.requiredQualifications));
  const best = highestDegree(profile.education);
  if (needed || enrolledWanted) {
    if (!best) {
      educationScore = 0;
      educationDetail =
        'The posting mentions a degree, but your profile has no education entries with a recognised degree.';
      gaps.push(`Education: ${educationLines[0] ?? 'a degree is requested'}`);
    } else {
      const meetsLevel = !needed || rank(best.level) >= rank(needed);
      const studentOk = !best.entry.current || enrolledWanted || isInternship;
      if (meetsLevel && studentOk) {
        educationScore = 1;
        strengths.push(
          `${best.entry.degree}${best.entry.current ? ' (in progress)' : ''} meets the education requirement`,
        );
      } else if (meetsLevel) {
        educationScore = 0.8;
        gaps.push('Your degree is still in progress; the posting may expect it completed');
      } else {
        educationScore = rank(best.level) === rank(needed) - 1 ? 0.5 : 0.25;
        gaps.push(`Asks for a ${needed} degree; your highest is ${best.level}`);
      }
      educationDetail = meetsLevel
        ? `Your ${best.entry.degree || best.level}${best.entry.current ? ' (in progress)' : ''} meets the ${needed ?? 'student'} requirement.`
        : `The posting asks for a ${needed} degree; your highest is ${best.level}.`;
    }
  } else if (educationLines.length > 0) {
    educationDetail =
      'The education requirement could not be read automatically; check it yourself.';
  }

  // Job preferences
  const preferenceScores: number[] = [];
  const preferenceNotes: string[] = [];
  const prefs = profile.preferences;
  if (job.workArrangement.status === 'found' && prefs.workArrangements.length > 0) {
    const fits = prefs.workArrangements.includes(job.workArrangement.value);
    preferenceScores.push(fits ? 1 : 0);
    preferenceNotes.push(
      `${job.workArrangement.value} ${fits ? 'fits' : 'does not fit'} your preference`,
    );
    if (!fits)
      gaps.push(
        `This role is ${job.workArrangement.value}; you prefer ${prefs.workArrangements.join(' or ')}`,
      );
  }
  if (job.employmentType.status === 'found' && prefs.employmentTypes.length > 0) {
    const fits = job.employmentType.value.some((type) => prefs.employmentTypes.includes(type));
    preferenceScores.push(fits ? 1 : 0);
    preferenceNotes.push(`${job.employmentType.value.join('/')} ${fits ? 'fits' : 'does not fit'}`);
    if (!fits)
      gaps.push(
        `This role is ${job.employmentType.value.join(' or ')}; you are looking for ${prefs.employmentTypes.join(' or ')}`,
      );
  }
  // Only compared when the user lists preferred locations; where they live today is not a preference.
  const wantedPlaces = prefs.locations;
  const isRemote = job.workArrangement.status === 'found' && job.workArrangement.value === 'remote';
  if (job.location.status === 'found' && wantedPlaces.length > 0) {
    const fits = isRemote || locationFits(job.location.value, wantedPlaces);
    preferenceScores.push(fits ? 1 : 0);
    preferenceNotes.push(`location ${fits ? 'fits' : 'is outside your listed locations'}`);
    if (fits) strengths.push(`Location: ${job.location.value}${isRemote ? ' (remote)' : ''}`);
    else gaps.push(`Located in ${job.location.value}, outside ${wantedPlaces.join(', ')}`);
  }
  const otherScore =
    preferenceScores.length > 0
      ? preferenceScores.reduce((a, b) => a + b, 0) / preferenceScores.length
      : null;

  const requiredScore = skillScore(requiredSkills);
  const preferredScore = skillScore(preferredSkills);
  const components: MatchComponent[] = [
    {
      key: 'requiredSkills',
      label: LABELS.requiredSkills,
      weight: weights.requiredSkills,
      score: requiredScore,
      detail: describeSkills(requiredSkills, 'required'),
    },
    {
      key: 'experience',
      label: LABELS.experience,
      weight: weights.experience,
      score: experienceScore,
      detail: experienceDetail,
    },
    {
      key: 'education',
      label: LABELS.education,
      weight: weights.education,
      score: educationScore,
      detail: educationDetail,
    },
    {
      key: 'preferredSkills',
      label: LABELS.preferredSkills,
      weight: weights.preferredSkills,
      score: preferredScore,
      detail: describeSkills(preferredSkills, 'preferred'),
    },
    {
      key: 'otherRequirements',
      label: LABELS.otherRequirements,
      weight: weights.otherRequirements,
      score: otherScore,
      detail:
        preferenceNotes.length > 0
          ? `${preferenceNotes.join('; ')}.`.replace(/^./, (c) => c.toUpperCase())
          : 'Add job preferences (work arrangement, type, locations) to your profile to compare them.',
    },
  ];

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const known = components.filter((c) => c.score !== null && c.weight > 0);
  const knownWeight = known.reduce((sum, c) => sum + c.weight, 0);
  const score =
    knownWeight === 0
      ? null
      : Math.round(
          (100 * known.reduce((sum, c) => sum + c.weight * (c.score ?? 0), 0)) / knownWeight,
        );

  return {
    score,
    coverage: totalWeight === 0 ? 0 : knownWeight / totalWeight,
    components,
    requiredSkills,
    preferredSkills,
    strengths,
    gaps,
    toConfirm: linesToConfirm(job),
    suggestions: buildSuggestions({
      job,
      profile,
      evidence,
      requiredSkills,
      preferredSkills,
      enrolledWanted,
      isInternship,
    }),
  };
}

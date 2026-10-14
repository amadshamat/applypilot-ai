import type { Education } from '@applypilot/shared';

/** Degree levels, lowest to highest. */
export const DEGREE_LEVELS = [
  'high school',
  'associate',
  'bachelor',
  'master',
  'doctorate',
] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

const LEVEL_PATTERNS: ReadonlyArray<[RegExp, DegreeLevel]> = [
  [/\b(ph\.?\s?d|doctor(ate|al)?)\b/i, 'doctorate'],
  [/\b(master'?s?|m\.?\s?sc?\b|m\.?\s?eng|mba|m\.?\s?a\b|graduate degree)/i, 'master'],
  [
    /\b(bachelor'?s?|b\.?\s?sc?\b|b\.?\s?eng|b\.?\s?a\b|bba|b\.?\s?tech|undergraduate degree|4-year degree|four-year degree|university degree)/i,
    'bachelor',
  ],
  [
    /\b(associate'?s?( degree)?|2-year degree|two-year degree|college diploma|diploma)\b/i,
    'associate',
  ],
  [/\b(high school|ged|secondary school)\b/i, 'high school'],
];

/** Every degree level a piece of text mentions. */
export function degreeLevels(text: string): DegreeLevel[] {
  return LEVEL_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, level]) => level);
}

export const rank = (level: DegreeLevel) => DEGREE_LEVELS.indexOf(level);

/**
 * The lowest degree a posting accepts. "Bachelor's or Master's" accepts a
 * bachelor's, so the minimum is used.
 */
export function requiredLevel(lines: readonly string[]): DegreeLevel | null {
  const levels = lines.flatMap(degreeLevels);
  if (levels.length === 0) return null;
  return levels.reduce((lowest, level) => (rank(level) < rank(lowest) ? level : lowest));
}

/** True when the posting is aimed at current students. */
export function wantsEnrolledStudents(lines: readonly string[]): boolean {
  return lines.some((line) =>
    /\b(currently (enrolled|pursuing)|enrolled in|pursuing a|current students?|returning to school|rising (junior|senior))\b/i.test(
      line,
    ),
  );
}

export interface ProfileDegree {
  level: DegreeLevel;
  entry: Education;
}

/** The highest degree in the profile, completed or in progress. */
export function highestDegree(education: readonly Education[]): ProfileDegree | null {
  let best: ProfileDegree | null = null;
  for (const entry of education) {
    const levels = degreeLevels(entry.degree);
    for (const level of levels) {
      if (!best || rank(level) > rank(best.level)) best = { level, entry };
    }
  }
  return best;
}

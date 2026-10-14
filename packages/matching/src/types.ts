import type { MatchWeights } from '@applypilot/shared';

export type ComponentKey = keyof MatchWeights;

/** One weighted part of the score. `score` is null when it could not be judged. */
export interface MatchComponent {
  key: ComponentKey;
  label: string;
  /** Weight from Settings, in percent. */
  weight: number;
  /** 0..1, or null when the posting or profile has nothing to compare. */
  score: number | null;
  /** One sentence explaining the score in plain language. */
  detail: string;
}

export type SkillMatchStatus = 'matched' | 'related' | 'missing';

export interface SkillMatch {
  skill: string;
  status: SkillMatchStatus;
  /** Where the profile shows it ("Skills list", "Experience: Northwind Logistics"). Empty when missing. */
  evidence: string[];
  /** For related matches: the profile skill that is related ("AWS"). */
  relatedVia?: string;
  /**
   * Set when the posting accepts any one of several skills ("one of Python,
   * Go or Java"). The entry is scored on the best of them.
   */
  alternatives?: string[];
}

export type SuggestionKind =
  | 'add-to-skills'
  | 'show-skill-in-context'
  | 'reorder-skills'
  | 'missing-skill'
  | 'related-skill'
  | 'highlight-project'
  | 'add-metrics'
  | 'summary'
  | 'graduation-date';

/**
 * A truthful edit the user could make. Suggestions only point at things the
 * profile already shows, or ask the user to confirm something; none of them
 * tells the user to claim a skill or number they have not stated.
 */
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  detail: string;
  /** Higher first. */
  priority: number;
}

export interface MatchResult {
  /** 0–100, or null when nothing in the posting could be compared with the profile. */
  score: number | null;
  /** Share of the total weight (0..1) that could actually be judged. */
  coverage: number;
  components: MatchComponent[];
  requiredSkills: SkillMatch[];
  preferredSkills: SkillMatch[];
  /** Qualifications the profile clearly meets. */
  strengths: string[];
  /** Requirements the profile does not show. */
  gaps: string[];
  /** Requirement lines that need a human to judge (eligibility, soft skills, etc.). */
  toConfirm: string[];
  suggestions: Suggestion[];
}

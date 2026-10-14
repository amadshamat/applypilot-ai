/**
 * Initial match-score weights (percent). These are configurable heuristics,
 * not universal hiring rules, and users can change them in Settings.
 */
export const DEFAULT_MATCH_WEIGHTS = {
  requiredSkills: 35,
  experience: 25,
  education: 15,
  preferredSkills: 15,
  otherRequirements: 10,
} as const;

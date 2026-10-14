import { z } from 'zod';
import { DEFAULT_MATCH_WEIGHTS } from '../constants/matching';

export const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

const weight = z.number().int().min(0).max(100);

export const matchWeightsSchema = z
  .object({
    requiredSkills: weight,
    experience: weight,
    education: weight,
    preferredSkills: weight,
    otherRequirements: weight,
  })
  .refine(
    (w) => Object.values(w).reduce((sum, n) => sum + n, 0) === 100,
    'Match weights must add up to 100',
  );
export type MatchWeights = z.infer<typeof matchWeightsSchema>;

export const SETTINGS_VERSION = 1;

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  theme: themePreferenceSchema,
  /** Off by default: nothing is sent to an AI provider until the user opts in. */
  allowAiProcessing: z.boolean(),
  /** When on, job analyses are kept per tab for the browser session only. */
  cacheAnalyses: z.boolean(),
  matchWeights: matchWeightsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  theme: 'system',
  allowAiProcessing: false,
  cacheAnalyses: true,
  matchWeights: { ...DEFAULT_MATCH_WEIGHTS },
};

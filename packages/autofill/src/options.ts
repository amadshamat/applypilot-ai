import type { FieldOption } from '@applypilot/shared';
import { normalize } from './text';

/**
 * Picks the option of a select, radio group or dropdown that means the same as
 * a profile value: "VA" and "Virginia", "B.S." and "Bachelor's degree",
 * "03" and "March". When no option clearly matches, nothing is picked.
 */

export const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const COUNTRY_SYNONYMS: string[][] = [
  ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
  ['united kingdom', 'uk', 'u k', 'great britain', 'england'],
  ['canada'],
  ['india'],
  ['germany', 'deutschland'],
];

/** Degree levels, so "B.S. Computer Science" can pick "Bachelor's Degree". */
const DEGREE_LEVELS: [string, RegExp][] = [
  ['doctorate', /\b(ph ?d|doctor(ate)?s?|d phil|ed d)\b/],
  ['master', /\b(masters?|m ?s|m ?a|m ?sc|mba|m eng|meng|ms c)\b/],
  ['bachelor', /\b(bachelors?|b ?s|b ?a|b ?sc|bsc|b eng|beng|undergraduate degree)\b/],
  ['associate', /\b(associates?|a ?a|a ?s|aas)\b/],
  ['high school', /\b(high school|ged|secondary|diploma)\b/],
];

export function degreeLevel(text: string): string | null {
  const n = normalize(text);
  return DEGREE_LEVELS.find(([, pattern]) => pattern.test(n))?.[0] ?? null;
}

function canonical(text: string): string {
  const n = normalize(text);
  for (const group of COUNTRY_SYNONYMS) if (group.includes(n)) return `country:${group[0]}`;
  const state = Object.entries(US_STATES).find(
    ([abbr, name]) => n === abbr.toLowerCase() || n === name.toLowerCase(),
  );
  if (state) return `state:${state[0]}`;
  const monthIndex = MONTHS.findIndex(
    (m) => n === m.toLowerCase() || (n.length >= 3 && n === m.toLowerCase().slice(0, 3)),
  );
  if (monthIndex >= 0) return `month:${monthIndex + 1}`;
  if (/^0?[1-9]$|^1[0-2]$/.test(n)) return `number:${Number(n)}`;
  if (/^(yes|y|true)$/.test(n)) return 'bool:yes';
  if (/^(no|n|false)$/.test(n)) return 'bool:no';
  return n;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function words(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

function overlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.max(wa.size, wb.size);
}

function score(option: FieldOption, wanted: string): number {
  const candidates = [option.label, option.value].filter((t) => t.length > 0);
  let best = 0;
  for (const text of candidates) {
    const a = normalize(text);
    const b = normalize(wanted);
    if (!a || !b) continue;
    if (a === b) return 100;
    const ca = canonical(text);
    const cb = canonical(wanted);
    if (ca === cb) best = Math.max(best, 95);
    // Month numbers ("3") match month names ("March").
    if (ca.startsWith('month:') && cb === `number:${ca.slice(6)}`) best = Math.max(best, 90);
    if (cb.startsWith('month:') && ca === `number:${cb.slice(6)}`) best = Math.max(best, 90);
    const degreeA = degreeLevel(text);
    if (degreeA && degreeA === degreeLevel(wanted)) best = Math.max(best, 85);
    if (b.length >= 4 && new RegExp(`(^| )${escape(b)}( |$)`).test(a)) best = Math.max(best, 75);
    if (a.length >= 4 && new RegExp(`(^| )${escape(a)}( |$)`).test(b)) best = Math.max(best, 70);
    best = Math.max(best, Math.round(overlap(text, wanted) * 65));
  }
  return best;
}

export interface OptionMatch {
  option: FieldOption;
  /** True for an exact or synonym match; false for a looser word match. */
  exact: boolean;
}

/**
 * The option that best matches any of the wanted values, or null when no
 * option clearly matches or two match equally well.
 */
export function matchOption(
  options: readonly FieldOption[],
  wanted: readonly string[],
): OptionMatch | null {
  let best: { option: FieldOption; score: number } | null = null;
  let tie = false;
  for (const option of options) {
    const s = Math.max(0, ...wanted.map((w) => score(option, w)));
    if (!best || s > best.score) {
      best = { option, score: s };
      tie = false;
    } else if (s === best.score && s < 95) {
      tie = true;
    }
  }
  if (!best || best.score < 60 || tie) return null;
  return { option: best.option, exact: best.score >= 85 };
}

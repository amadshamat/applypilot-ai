import {
  SKILL_TAXONOMY,
  type EmploymentType,
  type SalaryRange,
  type WorkArrangement,
} from '@applypilot/shared';
import type { Found } from '../types';

/**
 * Deterministic signals derived from plain job-description text. Each function
 * returns null when the text does not clearly state the attribute; nothing here
 * guesses.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Token boundary that treats "+", "#" and "." inside names (C++, C#, .NET) correctly. */
function tokenPattern(alias: string, flags: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9+#])${escapeRegExp(alias)}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`,
    flags,
  );
}

const compiledSkills = SKILL_TAXONOMY.map((skill) => ({
  name: skill.name,
  patterns: [
    ...skill.aliases.map((alias) => tokenPattern(alias, 'i')),
    ...(skill.exact ?? []).map((alias) => tokenPattern(alias, '')),
  ],
}));

/** Skills from the shared taxonomy mentioned in the text, in taxonomy order. */
export function findSkills(text: string): string[] {
  return compiledSkills
    .filter((skill) => skill.patterns.some((pattern) => pattern.test(text)))
    .map((skill) => skill.name);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function toNumber(token: string): number | null {
  const lower = token.toLowerCase();
  if (lower in NUMBER_WORDS) return NUMBER_WORDS[lower] ?? null;
  const n = Number.parseInt(token, 10);
  return Number.isFinite(n) ? n : null;
}

const YEARS_PATTERN =
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:(?:-|–|—|to)\s*(\d{1,2})\s*)?\+?\s*years?\b(?:\s+of)?(?:[^.\n]{0,40}?)\bexperience\b/i;

/** "3+ years of experience", "2-4 years of professional experience". */
export function findYearsOfExperience(
  text: string,
): Found<{ min: number; max: number | null }> | null {
  const match = YEARS_PATTERN.exec(text);
  if (!match?.[1]) return null;
  const min = toNumber(match[1]);
  if (min === null || min > 40) return null;
  const max = match[2] ? toNumber(match[2]) : null;
  if (max !== null && max < min) return null;
  return { value: { min, max }, confidence: 'medium' };
}

export function findWorkArrangement(text: string): Found<WorkArrangement> | null {
  const lower = text.toLowerCase();
  const hybrid = /\bhybrid\b/.test(lower);
  const remote =
    /\b(fully remote|100% remote|remote[- ]first|remote position|remote role|work from home|remote\b(?! sensing))/.test(
      lower,
    );
  const onSite = /\b(on-?site|in[- ]office|in[- ]person)\b/.test(lower);
  const hits = [hybrid, remote, onSite].filter(Boolean).length;
  if (hits === 0) return null;
  // Several arrangements mentioned usually means hybrid ("2 days on-site, rest remote").
  if (hybrid) return { value: 'hybrid', confidence: hits === 1 ? 'medium' : 'low' };
  if (hits > 1) return null;
  return { value: remote ? 'remote' : 'on-site', confidence: 'medium' };
}

export function findEmploymentType(text: string): Found<EmploymentType> | null {
  const lower = text.toLowerCase();
  if (/\b(internship|intern|co-?op)\b/.test(lower))
    return { value: 'internship', confidence: 'medium' };
  if (/\bpart[- ]time\b/.test(lower)) return { value: 'part-time', confidence: 'medium' };
  if (/\b(contract|contractor|freelance)\b/.test(lower))
    return { value: 'contract', confidence: 'low' };
  if (/\btemporary\b/.test(lower)) return { value: 'temporary', confidence: 'low' };
  if (/\bfull[- ]time\b/.test(lower)) return { value: 'full-time', confidence: 'medium' };
  return null;
}

const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR' };
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\s*([kK])?`;
const SALARY_PATTERN = new RegExp(
  String.raw`(USD|CAD|AUD|EUR|GBP)?\s*([$€£¥₹])\s*${AMOUNT}\s*(?:-|–|—|to)\s*(?:USD|CAD|AUD|EUR|GBP)?\s*[$€£¥₹]?\s*${AMOUNT}\s*(USD|CAD|AUD|EUR|GBP)?(?:\s*(?:\/|per|an|a)\s*(hour|hr|day|week|month|year|yr|annum))?`,
  'i',
);

function parseAmount(raw: string, thousands: string | undefined): number {
  const n = Number.parseFloat(raw.replace(/,/g, ''));
  return thousands ? n * 1000 : n;
}

const PERIODS: Record<string, SalaryRange['period']> = {
  hour: 'hour',
  hr: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
  yr: 'year',
  annum: 'year',
};

/**
 * "$25 - $32 per hour", "$120K–$150K", "€45,000 to €55,000 a year".
 * A bare "$" is ambiguous (USD, CAD, AUD…), so currency stays null unless the
 * text names it explicitly or uses an unambiguous symbol.
 */
export function findSalary(text: string): Found<SalaryRange> | null {
  const m = SALARY_PATTERN.exec(text);
  if (!m) return null;
  const [, codeBefore, symbol, minRaw, minK, maxRaw, maxK, codeAfter, periodRaw] = m;
  if (!minRaw || !maxRaw || !symbol) return null;
  const min = parseAmount(minRaw, minK);
  const max = parseAmount(maxRaw, maxK ?? minK);
  if (!(min > 0) || max < min) return null;
  const currency = (codeBefore ?? codeAfter)?.toUpperCase() ?? CURRENCY_SYMBOLS[symbol] ?? null;
  const period = periodRaw ? (PERIODS[periodRaw.toLowerCase()] ?? null) : null;
  return {
    value: { min, max, currency, period },
    confidence: currency && period ? 'high' : 'medium',
  };
}

const DEGREE_PATTERN =
  /\b(bachelor'?s?|master'?s?|ph\.?\s?d|doctorate|associate'?s? degree|degree|diploma|b\.?s\.?|m\.?s\.?|b\.?sc|m\.?sc|currently (?:enrolled|pursuing))\b/i;

/** Requirement lines that talk about degrees or enrollment. */
export function findEducationLines(lines: readonly string[]): string[] {
  return lines.filter((line) => DEGREE_PATTERN.test(line) && line.length <= 300);
}

const DATE_PATTERN =
  /\b(?:apply by|application deadline|applications? (?:close|due)|deadline)[:\s]+(?:on\s+)?([A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/i;

/** An explicitly labelled deadline, returned as an ISO date (YYYY-MM-DD). */
export function findDeadline(text: string): Found<string> | null {
  const m = DATE_PATTERN.exec(text);
  if (!m?.[1]) return null;
  const iso = toIsoDate(m[1]);
  return iso ? { value: iso, confidence: 'medium' } : null;
}

export function toIsoDate(raw: string): string | null {
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(`${raw} 12:00:00 UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

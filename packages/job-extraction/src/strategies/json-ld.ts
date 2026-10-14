import type { EmploymentType, SalaryRange, WorkArrangement } from '@applypilot/shared';
import { htmlToText, nonEmpty, uniqueStrings } from '../text';
import type { PartialJob } from '../types';
import { toIsoDate } from './text-signals';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: Json | undefined): Json[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasType(node: JsonObject, type: string): boolean {
  return asArray(node['@type']).some(
    (t) => typeof t === 'string' && t.toLowerCase() === type.toLowerCase(),
  );
}

function str(value: Json | undefined): string | null {
  if (typeof value === 'string') return nonEmpty(value);
  if (typeof value === 'number') return String(value);
  return null;
}

/** Finds every JobPosting node in the page's JSON-LD blocks, including @graph containers. */
export function findJobPostingNodes(doc: Document): JsonObject[] {
  const found: JsonObject[] = [];
  const visit = (node: Json, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, depth + 1));
    } else if (isObject(node)) {
      if (hasType(node, 'JobPosting')) found.push(node);
      if (node['@graph'] !== undefined) visit(node['@graph'], depth + 1);
    }
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent) as Json, 0);
    } catch {
      // Malformed JSON-LD is common in the wild; skip the block rather than fail.
    }
  }
  return found;
}

const EMPLOYMENT_TYPES: Record<string, EmploymentType> = {
  FULL_TIME: 'full-time',
  PART_TIME: 'part-time',
  CONTRACTOR: 'contract',
  CONTRACT: 'contract',
  TEMPORARY: 'temporary',
  INTERN: 'internship',
  INTERNSHIP: 'internship',
  VOLUNTEER: 'volunteer',
  PER_DIEM: 'other',
  OTHER: 'other',
};

function mapEmploymentType(value: Json | undefined): EmploymentType | null {
  const types = asArray(value)
    .map((v) =>
      typeof v === 'string'
        ? EMPLOYMENT_TYPES[v.trim().toUpperCase().replace(/[\s-]/g, '_')]
        : undefined,
    )
    .filter((v): v is EmploymentType => v !== undefined);
  // Internship is the most specific signal for this product's audience.
  if (types.includes('internship')) return 'internship';
  return types[0] ?? null;
}

function formatAddress(place: Json): string | null {
  if (!isObject(place)) return str(place);
  const address = place['address'];
  if (!isObject(address)) return str(address) ?? str(place['name']);
  const country = address['addressCountry'];
  const parts = [
    str(address['addressLocality']),
    str(address['addressRegion']),
    isObject(country) ? str(country['name']) : str(country),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? uniqueStrings(parts).join(', ') : null;
}

const UNIT_TO_PERIOD: Record<string, SalaryRange['period']> = {
  HOUR: 'hour',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
};

function num(value: Json | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapSalary(value: Json | undefined): SalaryRange | null {
  const amount = asArray(value).find(isObject);
  if (!amount) return null;
  const currencyRaw = str(amount['currency']);
  const currency =
    currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : null;
  const quantity = amount['value'];
  const single = isObject(quantity) ? num(quantity['value']) : num(quantity);
  const min = isObject(quantity) ? (num(quantity['minValue']) ?? single) : single;
  const max = isObject(quantity) ? (num(quantity['maxValue']) ?? single) : single;
  const unit = (isObject(quantity) ? str(quantity['unitText']) : null) ?? str(amount['unitText']);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) return null;
  return { min, max, currency, period: unit ? (UNIT_TO_PERIOD[unit.toUpperCase()] ?? null) : null };
}

function textList(value: Json | undefined, doc: Document): string[] | null {
  const items = asArray(value).flatMap((v) => {
    if (typeof v === 'string') {
      // Values are often HTML lists or newline/semicolon separated text.
      const text = /<[a-z]/i.test(v) ? htmlToText(v, doc) : v;
      return text.split(/\n|;|•/).map((s) => nonEmpty(s.replace(/^[-*]\s*/, '')));
    }
    if (isObject(v)) return [str(v['name']) ?? str(v['credentialCategory'])];
    return [];
  });
  const clean = uniqueStrings(items.filter((s): s is string => s !== null));
  return clean.length > 0 ? clean : null;
}

function mapExperience(value: Json | undefined): { min: number; max: number | null } | null {
  for (const v of asArray(value)) {
    if (isObject(v)) {
      const months = num(v['monthsOfExperience']);
      if (months !== null) return { min: Math.round((months / 12) * 10) / 10, max: null };
    }
  }
  return null;
}

/**
 * Structured metadata strategy. Employers publish schema.org JobPosting data for
 * search engines, which makes it the most reliable source when present.
 */
export function extractFromJsonLd(doc: Document): PartialJob | null {
  const node = findJobPostingNodes(doc)[0];
  if (!node) return null;
  const out: PartialJob = {};
  const title = str(node['title']);
  if (title) out.title = { value: title, confidence: 'high' };

  const org = asArray(node['hiringOrganization'])[0];
  const company = isObject(org) ? str(org['name']) : str(org);
  if (company) out.company = { value: company, confidence: 'high' };

  const descriptionHtml = str(node['description']);
  if (descriptionHtml) {
    const description = nonEmpty(htmlToText(descriptionHtml, doc).replace(/ ?\n ?/g, '\n'));
    if (description) out.description = { value: description, confidence: 'high' };
  }

  const locations = uniqueStrings(
    asArray(node['jobLocation'])
      .map(formatAddress)
      .filter((l): l is string => l !== null),
  );
  if (locations.length > 0) out.location = { value: locations.join(' · '), confidence: 'high' };

  const locationType = str(node['jobLocationType']);
  let arrangement: WorkArrangement | null = null;
  if (locationType?.toUpperCase() === 'TELECOMMUTE')
    arrangement = locations.length > 0 ? 'hybrid' : 'remote';
  if (arrangement) {
    // schema.org has no "hybrid" value; TELECOMMUTE plus a physical location is ambiguous.
    out.workArrangement = {
      value: arrangement,
      confidence: arrangement === 'remote' ? 'high' : 'low',
    };
  }

  const salary = mapSalary(node['baseSalary'] ?? node['estimatedSalary']);
  if (salary)
    out.salary = {
      value: salary,
      confidence: salary.currency && salary.period ? 'high' : 'medium',
    };

  const employmentType = mapEmploymentType(node['employmentType']);
  if (employmentType) out.employmentType = { value: employmentType, confidence: 'high' };

  const qualifications = textList(node['qualifications'], doc);
  if (qualifications) out.requiredQualifications = { value: qualifications, confidence: 'medium' };

  const skills = textList(node['skills'], doc);
  if (skills) out.skills = { value: skills, confidence: 'high' };

  const experience = mapExperience(node['experienceRequirements']);
  if (experience) out.yearsOfExperience = { value: experience, confidence: 'high' };

  const education = textList(node['educationRequirements'], doc);
  if (education) out.education = { value: education, confidence: 'high' };

  const validThrough = str(node['validThrough']);
  const deadline = validThrough ? toIsoDate(validThrough) : null;
  if (deadline) out.applicationDeadline = { value: deadline, confidence: 'medium' };

  const url = str(node['url']);
  if (url && /^https?:\/\//i.test(url)) out.url = { value: url, confidence: 'high' };

  const identifier = asArray(node['identifier'])[0];
  const jobId = isObject(identifier) ? str(identifier['value']) : str(identifier);
  if (jobId) out.jobId = { value: jobId, confidence: 'high' };

  if (node['directApply'] === true) out.hasApplicationForm = { value: true, confidence: 'medium' };

  return out;
}

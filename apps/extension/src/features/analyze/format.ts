import type {
  Confidence,
  EmploymentType,
  ExtractionSource,
  Platform,
  SalaryRange,
  WorkArrangement,
} from '@applypilot/shared';

export const SOURCE_LABELS: Record<ExtractionSource, string> = {
  'json-ld': 'Structured data',
  adapter: 'Site adapter',
  dom: 'Page content',
  url: 'Page address',
  ai: 'AI',
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  greenhouse: 'Greenhouse',
  indeed: 'Indeed',
  lever: 'Lever',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  ashby: 'Ashby',
  generic: 'Web page',
};

export const ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  'on-site': 'On-site',
};

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
  volunteer: 'Volunteer',
  other: 'Other',
};

const PERIOD_LABELS: Record<NonNullable<SalaryRange['period']>, string> = {
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

function formatAmount(value: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }).format(value);
    } catch {
      // Unknown currency code: fall through to a plain number.
    }
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

/** "$28 – $34 per hour", "From $20 per hour", "Up to $30 per hour". */
export function formatSalary(salary: SalaryRange): string {
  const { min, max } = salary;
  const fmt = (n: number) => formatAmount(n, salary.currency);
  let range: string;
  if (min !== null && max !== null) range = min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
  else if (min !== null) range = `From ${fmt(min)}`;
  else if (max !== null) range = `Up to ${fmt(max)}`;
  else range = '';
  const currency = salary.currency ? '' : ' (currency not stated)';
  const period = salary.period ? ` per ${PERIOD_LABELS[salary.period]}` : '';
  return `${range}${currency}${period}`;
}

export function formatEmploymentTypes(types: readonly EmploymentType[]): string {
  return types.map((t) => EMPLOYMENT_LABELS[t]).join(', ');
}

export function formatExperience(value: { min: number; max: number | null }): string {
  if (value.max === null) return `${value.min}+ years`;
  return `${value.min}–${value.max} years`;
}

export function formatDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

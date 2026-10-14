import type { SalaryRange, WorkArrangement } from '@applypilot/shared';
import type { PartialJob, SiteAdapter } from '../types';
import { elementToText, nonEmpty, normalizeWhitespace } from '../text';
import { findSalary, parseEmploymentTypeLabels } from '../strategies/text-signals';

/**
 * Indeed (www.indeed.com and country subdomains such as ca.indeed.com).
 *
 * Indeed shows a job in two layouts:
 * - search results, where the selected job opens in a right-hand pane next to a
 *   list of other jobs (`/jobs?q=…&vjk=<id>`), and
 * - the standalone job page (`/viewjob?jk=<id>`).
 *
 * Every lookup is scoped to the selected job's container, so the account
 * greeting in the header ("Hello, …") and the other result cards are never read.
 * Selectors use Indeed's `data-testid` and id hooks, with class fallbacks.
 */

const HOST = /(^|\.)indeed\.com$/i;

/** Containers that hold exactly one job's details, most specific first. */
const JOB_CONTAINERS = [
  '#jobsearch-ViewjobPaneWrapper',
  '[data-testid="jobsearch-ViewjobPaneWrapper"]',
  '.jobsearch-RightPane',
  '#viewJobSSRRoot',
  '.jobsearch-ViewJobLayout',
];

const TITLE = [
  '[data-testid="jobsearch-JobInfoHeader-title"]',
  '.jobsearch-JobInfoHeader-title',
  '[data-testid="simpler-jobTitle"]',
];
const COMPANY = [
  '[data-testid="inlineHeader-companyName"]',
  '[data-company-name="true"]',
  '.jobsearch-CompanyInfoContainer a[href*="/cmp/"]',
];
const LOCATION = [
  '[data-testid="inlineHeader-companyLocation"]',
  '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
  '[data-testid="job-location"]',
  '#jobLocationText',
];
const DESCRIPTION = ['#jobDescriptionText', '[data-testid="jobsearch-JobComponent-description"]'];

/** Indeed localises pay to the country site, so the subdomain identifies the currency. */
const SITE_CURRENCY: Record<string, string> = {
  www: 'USD',
  ca: 'CAD',
  uk: 'GBP',
  au: 'AUD',
  nz: 'NZD',
  in: 'INR',
  ie: 'EUR',
  de: 'EUR',
  fr: 'EUR',
  nl: 'EUR',
  es: 'EUR',
  it: 'EUR',
  sg: 'SGD',
};

function first(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el && nonEmpty(el.textContent)) return el;
  }
  return null;
}

/** The container for the job currently shown, or null when none is open. */
export function selectedJobRoot(doc: Document): Element | null {
  for (const selector of JOB_CONTAINERS) {
    const el = doc.querySelector(selector);
    if (el && first(el, TITLE)) return el;
  }
  // Fallback for layout changes: a job header outside any result card.
  const title = first(doc, TITLE);
  if (title && !title.closest('.job_seen_beacon, [data-testid="slider_item"]')) {
    return title.closest('main') ?? doc.body;
  }
  return null;
}

/** Title text without Indeed's screen-reader suffix ("- job post"). */
function cleanTitle(el: Element): string | null {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('span').forEach((span) => {
    if (/^\s*-\s*job post\s*$/i.test(span.textContent)) span.remove();
  });
  return nonEmpty(normalizeWhitespace(clone.textContent).replace(/\s*-\s*job post$/i, ''));
}

function cleanCompany(el: Element): string | null {
  const link = el.querySelector('a');
  const raw = link?.getAttribute('aria-label') ?? link?.textContent ?? el.textContent;
  return nonEmpty(
    normalizeWhitespace(raw)
      .replace(/\s*\(opens in a new tab\)\s*$/i, '')
      .replace(/\s*\d(?:\.\d)?\s*out of 5 stars.*$/i, ''),
  );
}

const ARRANGEMENT_LABELS: ReadonlyArray<[RegExp, WorkArrangement]> = [
  [/^remote$/i, 'remote'],
  [/^(fully )?remote( work)?$/i, 'remote'],
  [/^hybrid( work| remote)?$/i, 'hybrid'],
  [/^(in[- ]person|on[- ]?site)$/i, 'on-site'],
];

/**
 * Splits the header location ("Arlington, VA 22201 • Hybrid work") into the
 * place and the work arrangement, and drops the company name if a layout puts
 * it in the same block.
 */
function parseLocation(
  el: Element,
  company: string | null,
): { location: string | null; arrangement: WorkArrangement | null } {
  const parts = (
    el.children.length > 0 ? [...el.children].map((c) => c.textContent) : [el.textContent]
  )
    .flatMap((t) => t.split('•'))
    .map((t) => normalizeWhitespace(t))
    .filter((t) => t.length > 0);
  let arrangement: WorkArrangement | null = null;
  const places: string[] = [];
  for (const part of parts) {
    const match = ARRANGEMENT_LABELS.find(([pattern]) => pattern.test(part));
    if (match) {
      arrangement = match[1];
      if (match[1] === 'remote' && places.length === 0) places.push(part);
      continue;
    }
    let place = part;
    if (company && place.toLowerCase().startsWith(company.toLowerCase())) {
      place = place.slice(company.length).replace(/^[\s,–—-]+/, '');
    }
    if (place.length > 0) places.push(place);
  }
  return { location: places.length > 0 ? places.join(' · ') : null, arrangement };
}

/** Texts listed under a "Job details" group such as Pay or Job type. */
function detailGroup(root: Element, label: RegExp): string[] {
  const section = root.querySelector('#jobDetailsSection, [data-testid="jobDetailsSection"]');
  if (!section) return [];
  const groups = [
    ...[...section.querySelectorAll('[role="group"][aria-label]')].map((g) => ({
      name: g.getAttribute('aria-label') ?? '',
      el: g,
    })),
    ...[...section.querySelectorAll('h3')].map((h) => ({
      name: h.textContent,
      el: h.parentElement,
    })),
  ];
  for (const { name, el } of groups) {
    if (!el || !label.test(normalizeWhitespace(name))) continue;
    return [...el.querySelectorAll('li')]
      .map((li) => normalizeWhitespace(li.textContent))
      .filter((t) => t.length > 0);
  }
  return [];
}

function siteCurrency(url: URL): string | null {
  const sub = url.hostname.toLowerCase().replace(/\.?indeed\.com$/, '') || 'www';
  return SITE_CURRENCY[sub] ?? null;
}

export const indeedAdapter: SiteAdapter = {
  platform: 'indeed',
  preferOverStructuredData: true,
  noJobMessage:
    'No job is open on this Indeed page. Click a job in the results so its details appear on the right, then analyze again.',

  matches(url) {
    return HOST.test(url.hostname);
  },

  isReady(doc) {
    const root = selectedJobRoot(doc);
    return root !== null && first(root, DESCRIPTION) !== null;
  },

  descriptionElement(doc) {
    const root = selectedJobRoot(doc);
    return root ? first(root, DESCRIPTION) : null;
  },

  extract(doc, url) {
    const root = selectedJobRoot(doc);
    if (!root) return null;
    const out: PartialJob = {};

    const titleEl = first(root, TITLE);
    const title = titleEl ? cleanTitle(titleEl) : null;
    if (title) out.title = { value: title, confidence: 'high' };

    const companyEl = first(root, COMPANY);
    const company = companyEl ? cleanCompany(companyEl) : null;
    if (company) out.company = { value: company, confidence: 'high' };

    const locationEl = first(root, LOCATION);
    if (locationEl) {
      const { location, arrangement } = parseLocation(locationEl, company);
      if (location) out.location = { value: location, confidence: 'high' };
      if (arrangement) out.workArrangement = { value: arrangement, confidence: 'high' };
    }

    // Pay and job type: the "Job details" section first, then the header line
    // ("From $20 an hour - Part-time, Full-time").
    const header = root.querySelector('#salaryInfoAndJobType');
    const headerParts = header
      ? [...header.children].map((c) => normalizeWhitespace(c.textContent)).filter(Boolean)
      : [];
    const payTexts = [
      ...detailGroup(root, /^pay$/i),
      ...headerParts.filter((t) => /[$€£¥₹]/.test(t)),
    ];
    for (const text of payTexts) {
      const salary = findSalary(text);
      if (salary) {
        const currency: SalaryRange['currency'] = salary.value.currency ?? siteCurrency(url);
        out.salary = { value: { ...salary.value, currency }, confidence: 'high' };
        break;
      }
    }

    const typeLabels = detailGroup(root, /^job types?$/i);
    const headerTypes = headerParts
      .filter((t) => !/[$€£¥₹]/.test(t))
      .map((t) => t.replace(/^[-–\s]+/, ''));
    const types = parseEmploymentTypeLabels(typeLabels.length > 0 ? typeLabels : headerTypes);
    if (types.length > 0) out.employmentType = { value: types, confidence: 'high' };

    const description = first(root, DESCRIPTION);
    const descriptionText = description ? nonEmpty(elementToText(description)) : null;
    if (descriptionText) out.description = { value: descriptionText, confidence: 'high' };

    const jobKey = url.searchParams.get('vjk') ?? url.searchParams.get('jk');
    if (jobKey && /^[a-f0-9]{8,32}$/i.test(jobKey)) {
      out.jobId = { value: jobKey, confidence: 'high' };
      // A stable address for this job, even when it was opened from search results.
      out.url = { value: `${url.origin}/viewjob?jk=${jobKey}`, confidence: 'high' };
    }

    return out;
  },
};

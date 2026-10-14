import type { Confidence } from '@applypilot/shared';
import type { Found, PartialJob } from '../types';
import { elementToText, nonEmpty, normalizeWhitespace } from '../text';
import { findWorkArrangement } from './text-signals';

const MIN_DESCRIPTION_CHARS = 200;

const DESCRIPTION_SELECTORS: ReadonlyArray<[string, Confidence]> = [
  ['[itemprop="description"]', 'medium'],
  ['#job-description, #jobDescription, #job_description', 'medium'],
  ['.job-description, .jobDescription, .job_description, .posting-description', 'medium'],
  [
    '[data-testid*="description" i], [class*="job-description" i], [class*="jobdescription" i]',
    'medium',
  ],
  ['[class*="description" i], [id*="description" i]', 'low'],
  ['article', 'low'],
  ['main, [role="main"]', 'low'],
];

/** Finds the element most likely to hold the job description. */
export function findDescriptionElement(doc: Document): Found<Element> | null {
  for (const [selector, confidence] of DESCRIPTION_SELECTORS) {
    for (const el of doc.querySelectorAll(selector)) {
      if (elementToText(el).length >= MIN_DESCRIPTION_CHARS) return { value: el, confidence };
    }
  }
  const densest = densestTextContainer(doc);
  return densest ? { value: densest, confidence: 'low' } : null;
}

/**
 * Last resort for unconventional markup: the element whose direct paragraph and
 * list children hold the most text. Forms and navigation are ignored.
 */
function densestTextContainer(doc: Document): Element | null {
  const totals = new Map<Element, number>();
  for (const block of doc.body.querySelectorAll('p, ul, ol')) {
    const parent = block.parentElement;
    if (!parent || block.closest('form, nav, header, footer')) continue;
    totals.set(parent, (totals.get(parent) ?? 0) + normalizeWhitespace(block.textContent).length);
  }
  let best: Element | null = null;
  let bestLength = MIN_DESCRIPTION_CHARS - 1;
  for (const [el, length] of totals) {
    if (length > bestLength) {
      best = el;
      bestLength = length;
    }
  }
  return best;
}

function meta(doc: Document, property: string): string | null {
  const el = doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return nonEmpty(el?.getAttribute('content'));
}

/**
 * Site chrome (account menus, navigation) never describes the job. A <header>
 * inside an article or main region is content ("article > header > h1"), so
 * only page-level headers count.
 */
function isSiteChrome(el: Element): boolean {
  if (el.closest('nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]'))
    return true;
  const header = el.closest('header');
  return header !== null && header.closest('article, main') === null;
}

/** Account greetings that some sites render as the page's first heading. */
const GREETING = /^(hello|hi|hey|welcome( back)?|good (morning|afternoon|evening))\b/i;

function firstText(doc: Document, selector: string, maxLength: number): string | null {
  for (const el of doc.querySelectorAll(selector)) {
    if (isSiteChrome(el)) continue;
    const text = nonEmpty(el.textContent);
    if (text && GREETING.test(text)) continue;
    if (text && text.length <= maxLength) return text;
  }
  return null;
}

/** "Software Engineer Intern at Acme" or "Software Engineer Intern - Acme Careers". */
function companyFromTitle(title: string): string | null {
  const at = /\bat\s+([^|–—-]{2,60})(?:[|–—-]|$)/i.exec(title);
  return at?.[1] ? normalizeWhitespace(at[1]) : null;
}

/** Whether the page shows an application form the user could fill in. */
export function detectApplicationForm(doc: Document): Found<boolean> | null {
  for (const form of doc.querySelectorAll('form')) {
    const hasResumeUpload = form.querySelector('input[type="file"]') !== null;
    const hasContactFields =
      form.querySelector(
        'input[type="email"], input[autocomplete="email"], input[name*="email" i]',
      ) !== null &&
      form.querySelector(
        'input[autocomplete="given-name"], input[autocomplete="name"], input[name*="name" i]',
      ) !== null;
    if (hasResumeUpload && hasContactFields) return { value: true, confidence: 'high' };
    if (hasResumeUpload || hasContactFields) return { value: true, confidence: 'medium' };
  }
  return null;
}

/**
 * Semantic DOM strategy: page-level signals that work without structured data
 * or a site adapter. Values are lower confidence because layouts vary widely.
 */
export function extractFromDom(doc: Document): PartialJob {
  const out: PartialJob = {};

  const itempropTitle = firstText(doc, '[itemprop="title"]', 150);
  const h1 = firstText(doc, 'h1', 150);
  const ogTitle = meta(doc, 'og:title');
  if (itempropTitle) out.title = { value: itempropTitle, confidence: 'medium' };
  else if (h1) out.title = { value: h1, confidence: 'medium' };
  else if (ogTitle) out.title = { value: ogTitle, confidence: 'low' };

  const company =
    firstText(doc, '[itemprop="hiringOrganization"] [itemprop="name"]', 100) ??
    meta(doc, 'og:site_name');
  if (company) out.company = { value: company, confidence: 'medium' };
  else {
    const fromTitle = companyFromTitle(ogTitle ?? doc.title);
    if (fromTitle) out.company = { value: fromTitle, confidence: 'low' };
  }

  const location = firstText(
    doc,
    '[itemprop="jobLocation"], [data-testid*="location" i], [class*="job-location" i], [class*="location" i]',
    100,
  );
  if (location) {
    out.location = { value: location, confidence: 'low' };
    const arrangement = findWorkArrangement(location);
    if (arrangement) out.workArrangement = { ...arrangement, confidence: 'medium' };
  }

  const description = findDescriptionElement(doc);
  if (description) {
    out.description = {
      value: elementToText(description.value),
      confidence: description.confidence,
    };
  }

  const form = detectApplicationForm(doc);
  if (form) out.hasApplicationForm = form;

  return out;
}

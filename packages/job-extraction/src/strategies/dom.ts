import type { Confidence } from '@applypilot/shared';
import type { Found, PartialJob } from '../types';
import { elementToText, isGenericPageTitle, nonEmpty, normalizeWhitespace } from '../text';
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

/** Finds the element most likely to hold the job description, inside `root` when given. */
export function findDescriptionElement(
  doc: Document,
  root: ParentNode = doc,
): Found<Element> | null {
  for (const [selector, confidence] of DESCRIPTION_SELECTORS) {
    for (const el of root.querySelectorAll(selector)) {
      if (elementToText(el).length >= MIN_DESCRIPTION_CHARS) return { value: el, confidence };
    }
  }
  const densest = densestTextContainer(root === doc ? doc.body : root);
  return densest ? { value: densest, confidence: 'low' } : null;
}

/**
 * Last resort for unconventional markup: the element whose direct paragraph and
 * list children hold the most text. Forms and navigation are ignored.
 */
function densestTextContainer(root: ParentNode): Element | null {
  const totals = new Map<Element, number>();
  for (const block of root.querySelectorAll('p, ul, ol')) {
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

function firstText(root: ParentNode, selector: string, maxLength: number): string | null {
  for (const el of root.querySelectorAll(selector)) {
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
export function detectApplicationForm(root: ParentNode): Found<boolean> | null {
  for (const form of root.querySelectorAll('form')) {
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

export interface DomOptions {
  /**
   * Confines every lookup to one job's container. Page-wide signals (meta
   * tags, the document title) are skipped because they describe the page,
   * which may list many jobs.
   */
  scope?: Element;
}

/**
 * Semantic DOM strategy: page-level signals that work without structured data
 * or a site adapter. Values are lower confidence because layouts vary widely.
 */
export function extractFromDom(doc: Document, options: DomOptions = {}): PartialJob {
  const out: PartialJob = {};
  const root: ParentNode = options.scope ?? doc;
  const pageSignals = options.scope === undefined;
  const usable = (title: string | null) => (title && !isGenericPageTitle(title) ? title : null);

  const itempropTitle = usable(firstText(root, '[itemprop="title"]', 150));
  const h1 = usable(firstText(root, 'h1', 150));
  const ogTitle = pageSignals ? meta(doc, 'og:title') : null;
  if (itempropTitle) out.title = { value: itempropTitle, confidence: 'medium' };
  else if (h1) out.title = { value: h1, confidence: 'medium' };
  else if (usable(ogTitle)) out.title = { value: ogTitle as string, confidence: 'low' };

  const company =
    firstText(root, '[itemprop="hiringOrganization"] [itemprop="name"]', 100) ??
    (pageSignals ? meta(doc, 'og:site_name') : null);
  if (company) out.company = { value: company, confidence: 'medium' };
  else if (pageSignals) {
    const fromTitle = companyFromTitle(ogTitle ?? doc.title);
    if (fromTitle) out.company = { value: fromTitle, confidence: 'low' };
  }

  const location = firstText(
    root,
    '[itemprop="jobLocation"], [data-testid*="location" i], [class*="job-location" i], [class*="location" i]',
    100,
  );
  if (location) {
    out.location = { value: location, confidence: 'low' };
    const arrangement = findWorkArrangement(location);
    if (arrangement) out.workArrangement = { ...arrangement, confidence: 'medium' };
  }

  const description = findDescriptionElement(doc, root);
  if (description) {
    out.description = {
      value: elementToText(description.value),
      confidence: description.confidence,
    };
  }

  const form = detectApplicationForm(root);
  if (form) out.hasApplicationForm = form;

  return out;
}

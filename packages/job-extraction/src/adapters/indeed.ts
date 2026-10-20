import {
  indeedJobKey,
  type Confidence,
  type ExtractionCheck,
  type SalaryRange,
  type WorkArrangement,
} from '@applypilot/shared';
import type { JobScope, LocateOptions, LocateResult, PartialJob, SiteAdapter } from '../types';
import { elementToText, isGenericPageTitle, nonEmpty, normalizeWhitespace } from '../text';
import { findDescriptionElement } from '../strategies/dom';
import { findSalary, parseEmploymentTypeLabels } from '../strategies/text-signals';

/**
 * Indeed (www.indeed.com and country subdomains such as ca.indeed.com).
 *
 * Indeed shows a job in three layouts:
 * - search results, where the selected job opens in a right-hand details panel
 *   next to a list of other jobs (`/jobs?q=…&vjk=<id>`),
 * - the same, with the details panel rendered in a same-origin frame
 *   (`iframe#vjs-container-iframe` loading `/viewjob?…&jk=<id>`), and
 * - the standalone job page (`/viewjob?jk=<id>`).
 *
 * `locate` finds the one container that shows the selected job and checks it
 * against the selection (the `vjk` id in the address and the highlighted result
 * card). Everything is then read from that container only, so the account
 * greeting, the page title ("Job Search | Indeed") and the other result cards
 * are never read. While Indeed is still swapping the panel to a newly selected
 * job, `locate` reports the mismatch instead of reading the previous job.
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
  '[data-testid*="JobInfoHeader-title"]',
  '.jobsearch-JobInfoHeader-title-container h1, .jobsearch-JobInfoHeader-title-container h2',
  'h1[class*="JobInfoHeader"], h2[class*="JobInfoHeader"]',
];

/** Result cards in the search list. Nothing inside one is ever read as job details. */
const RESULT_CARD =
  '.job_seen_beacon, [data-testid="slider_item"], .cardOutline, .tapItem, li[data-jk], div.result[data-jk], [data-testid="job-card"]';
/** The frame some Indeed layouts use for the details panel. */
const DETAILS_FRAME =
  'iframe#vjs-container-iframe, iframe[name="vjs-container-iframe"], iframe[src*="/viewjob"], iframe[src*="jk="]';
/** Anything that names a job by its key: card hooks and links to a job. */
const JOB_REFERENCE = '[data-jk], a[href*="jk="]';
/** Headings a details panel may use for the job title when Indeed's hooks are absent. */
const HEADINGS = 'h1, h2, h3, [role="heading"]';
/** How Indeed marks the result card that is currently open. */
const HIGHLIGHTED_CARD =
  '.vjs-highlight, [aria-current="true"][data-jk], [aria-selected="true"][data-jk], [data-testid="slider_item"][aria-current="true"]';
const CARD_TITLE = ['[id^="jobTitle-"]', '.jobTitle [title]', '.jobTitle', 'a[data-jk] span'];
const COMPANY = [
  '[data-testid="inlineHeader-companyName"]',
  '[data-company-name="true"]',
  '.jobsearch-CompanyInfoContainer a[href*="/cmp/"]',
  'a[href*="/cmp/"]',
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

/** Indeed's description hook, or the densest text block inside the panel. */
function descriptionIn(root: Element): Element | null {
  return (
    first(root, DESCRIPTION) ?? findDescriptionElement(root.ownerDocument, root)?.value ?? null
  );
}

function insideCard(el: Element): boolean {
  return el.closest(RESULT_CARD) !== null;
}

/** The first title element in `root` that is not part of a result card. */
function titleElement(root: ParentNode, singleJobDocument: boolean): Element | null {
  const selectors = singleJobDocument ? [...TITLE, 'h1'] : TITLE;
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      if (insideCard(el)) continue;
      const text = cleanTitle(el);
      if (text && !isGenericPageTitle(text)) return el;
    }
  }
  return null;
}

/**
 * The largest ancestor of `el` that holds no result card: the details panel
 * around a job header, even when Indeed's container hooks change.
 */
function panelAround(el: Element, limit: Element): Element {
  let panel = el;
  while (panel.parentElement && panel !== limit) {
    const parent = panel.parentElement;
    if (parent.querySelector(RESULT_CARD) || parent.tagName === 'BODY') break;
    panel = parent;
  }
  return panel;
}

interface PanelCandidate {
  doc: Document;
  root: Element;
  title: Element;
  /** The job id the panel itself declares (its frame address or a data-jk attribute). */
  jobKey: string | null;
  frame: boolean;
}

function panelIn(doc: Document, frame: boolean, singleJobDocument: boolean): PanelCandidate | null {
  for (const selector of JOB_CONTAINERS) {
    for (const container of doc.querySelectorAll(selector)) {
      if (insideCard(container)) continue;
      const title = titleElement(container, singleJobDocument);
      if (!title) continue;
      // A container that also wraps the result list is too wide; narrow it to the panel.
      const root = container.querySelector(RESULT_CARD) ? panelAround(title, container) : container;
      return { doc, root, title, jobKey: declaredKey(root), frame };
    }
  }
  // Fallback for layout changes: a job header outside any result card.
  const title = titleElement(doc, singleJobDocument) ?? titleNearDescription(doc);
  if (!title) return null;
  const root = singleJobDocument
    ? (title.closest('main') ?? doc.body)
    : panelAround(title, doc.body);
  return { doc, root, title, jobKey: declaredKey(root), frame };
}

/**
 * Fallback when the title hooks change but the description keeps its id: the
 * first heading in the block around the one description outside the cards.
 */
function titleNearDescription(doc: Document): Element | null {
  const descriptions = [...doc.querySelectorAll(DESCRIPTION.join(', '))].filter(
    (el) => !insideCard(el),
  );
  if (descriptions.length !== 1 || !descriptions[0]) return null;
  const panel = panelAround(descriptions[0], doc.body);
  for (const heading of panel.querySelectorAll(HEADINGS)) {
    if (descriptions[0].contains(heading)) continue;
    const text = cleanTitle(heading);
    if (text && !isGenericPageTitle(text) && !/^job details$/i.test(text)) return heading;
  }
  return null;
}

function declaredKey(root: Element): string | null {
  const key = root.closest('[data-jk]')?.getAttribute('data-jk');
  return key && /^[a-f0-9]{8,32}$/i.test(key) ? key.toLowerCase() : null;
}

function frameOrigin(frame: HTMLIFrameElement, url: URL): string | null {
  const src = frame.getAttribute('src');
  if (!src) return null;
  try {
    const origin = new URL(src, url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function frameDocuments(doc: Document): { frame: HTMLIFrameElement; doc: Document | null }[] {
  return [...doc.querySelectorAll<HTMLIFrameElement>(DETAILS_FRAME)].map((frame) => {
    try {
      return { frame, doc: frame.contentDocument };
    } catch {
      return { frame, doc: null };
    }
  });
}

function keyFromAddress(address: string | null | undefined, base: string): string | null {
  if (!address) return null;
  try {
    return indeedJobKey(new URL(address, base));
  } catch {
    return null;
  }
}

function cardTitle(card: Element): string | null {
  for (const selector of [...CARD_TITLE, HEADINGS]) {
    const el = card.querySelector(selector);
    const text = nonEmpty(el?.getAttribute('title') ?? el?.textContent);
    if (text) return text.replace(/\s*-\s*job post$/i, '');
  }
  return null;
}

/** The job keys an element refers to: its own and its descendants' `data-jk` and job links. */
function jobKeysIn(el: Element, base: string): Set<string> {
  const keys = new Set<string>();
  const add = (node: Element) => {
    const key =
      declaredOwnKey(node) ??
      (node.tagName === 'A' ? keyFromAddress(node.getAttribute('href'), base) : null);
    if (key) keys.add(key);
  };
  if (el.matches(JOB_REFERENCE)) add(el);
  for (const node of el.querySelectorAll(JOB_REFERENCE)) add(node);
  return keys;
}

function declaredOwnKey(el: Element): string | null {
  const key = el.getAttribute('data-jk');
  return key && /^[a-f0-9]{8,32}$/i.test(key) ? key.toLowerCase() : null;
}

/**
 * The card around a job reference when Indeed's card classes are unknown (for
 * example the homepage feed): the largest ancestor that refers to no other job.
 */
function cardAround(el: Element, key: string, base: string): Element {
  let card = el;
  while (card.parentElement && card.parentElement.tagName !== 'BODY') {
    const keys = jobKeysIn(card.parentElement, base);
    if (keys.size > 1 || (keys.size === 1 && !keys.has(key))) break;
    card = card.parentElement;
  }
  return card;
}

function selectedCard(doc: Document, key: string | null): Element | null {
  const marked = key
    ? (doc.querySelector(`[data-jk="${key}"]`) ??
      [...doc.querySelectorAll('a[href*="jk="]')].find(
        (a) => keyFromAddress(a.getAttribute('href'), doc.URL) === key,
      ) ??
      null)
    : doc.querySelector(HIGHLIGHTED_CARD);
  if (!marked) return null;
  const known = marked.closest(RESULT_CARD);
  if (known) return known;
  const markedKey = key ?? declaredOwnKey(marked);
  return markedKey ? cardAround(marked, markedKey, doc.URL) : marked;
}

/**
 * Fallback for layouts without Indeed's details hooks (such as the homepage
 * feed): the heading outside every card whose text is the selected card's
 * title. The panel is the largest block around it that does not reach the
 * selected card, so the list is never included.
 */
function panelByTitle(
  doc: Document,
  card: Element | null,
  key: string | null,
): PanelCandidate | null {
  const wanted = card ? cardTitle(card) : null;
  if (!card || !wanted) return null;
  for (const heading of doc.querySelectorAll(HEADINGS)) {
    if (card.contains(heading) || insideCard(heading) || heading.closest(JOB_REFERENCE)) continue;
    const text = cleanTitle(heading);
    if (!text || isGenericPageTitle(text) || !sameJobTitle(text, wanted)) continue;
    let root = heading;
    while (
      root.parentElement &&
      root.parentElement.tagName !== 'BODY' &&
      !root.parentElement.contains(card)
    ) {
      root = root.parentElement;
    }
    if (root === heading) continue;
    // Another card with the same title (two "Police Officer" openings) is not the panel.
    const keys = jobKeysIn(root, doc.URL);
    const otherCard = keys.size === 1 && key !== null && !keys.has(key);
    if (otherCard && normalizeWhitespace(root.textContent).length < 1500) continue;
    return { doc, root, title: heading, jobKey: null, frame: false };
  }
  return null;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9$.]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Card titles can be shortened, so this tolerates truncation and small differences. */
export function sameJobTitle(a: string, b: string): boolean {
  const x = words(a).join(' ');
  const y = words(b).join(' ');
  if (!x || !y) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  const setX = new Set(words(a));
  const setY = new Set(words(b));
  const shared = [...setX].filter((w) => setY.has(w)).length;
  return shared / new Set([...setX, ...setY]).size >= 0.75;
}

function isJobPage(url: URL): boolean {
  return /^\/(m\/)?viewjob\b/i.test(url.pathname);
}

/**
 * A content-free summary of the page's structure for bug reports, so an
 * unrecognised Indeed layout can be diagnosed without the page itself.
 */
function describeStructure(doc: Document, card: Element | null): string {
  const keys = jobKeysIn(doc.body, doc.URL).size;
  const frames = frameDocuments(doc);
  const readable = frames.filter((f) => f.doc?.body).length;
  const allFrames = doc.querySelectorAll('iframe').length;
  const hooks = TITLE.reduce((n, selector) => n + doc.querySelectorAll(selector).length, 0);
  const title = card ? cardTitle(card) : null;
  const matching = title
    ? [...doc.querySelectorAll(HEADINGS)].filter(
        (h) => !card?.contains(h) && sameJobTitle(normalizeWhitespace(h.textContent), title),
      ).length
    : 0;
  return (
    [
      `Page structure: ${keys} job links`,
      card
        ? 'the selected job was found in the list'
        : 'the selected job was not found in the list',
      title ? `${matching} heading(s) outside it match its title` : 'its title was not found',
      `${allFrames} frame(s), ${frames.length} job frame(s), ${readable} readable`,
      `${hooks} Indeed title hook(s)`,
    ].join('; ') + '.'
  );
}

/**
 * Finds the details panel for the selected job and checks that it really shows
 * that job. See the file comment for the layouts it handles.
 */
export function locateSelectedJob(
  doc: Document,
  url: URL,
  options: LocateOptions = {},
): LocateResult {
  const checks: ExtractionCheck[] = [];
  const keyInAddress = indeedJobKey(url);
  // Inside a details frame the document shows one job, whatever its address.
  const jobPage = isJobPage(url) || options.embedded === true;
  const card = jobPage ? null : selectedCard(doc, keyInAddress);
  const selectedKey = keyInAddress ?? (card ? declaredKey(card) : null);
  const selectedTitle = card ? cardTitle(card) : null;

  if (keyInAddress) {
    checks.push({
      id: 'selected-job',
      status: 'pass',
      message: `Selected job ${keyInAddress}, from the page address.`,
    });
  } else if (card) {
    checks.push({
      id: 'selected-job',
      status: 'pass',
      message: 'Selected job taken from the highlighted search result.',
    });
  } else if (!jobPage) {
    checks.push({
      id: 'selected-job',
      status: 'warn',
      message: 'The page address names no selected job, and no search result is highlighted.',
    });
  }

  // 1. A details frame (its own document), 2. a panel in this page, 3. this job page.
  let panel: PanelCandidate | null = null;
  let frameLoading = false;
  const blockedFrameOrigins = new Set<string>();
  for (const { frame, doc: frameDoc } of frameDocuments(doc)) {
    // A frame filled by script (srcdoc or about:blank plus writes) has content but no address.
    const empty =
      !frameDoc?.body || (frameDoc.URL === 'about:blank' && !frameDoc.body.firstElementChild);
    if (!frameDoc) {
      const origin = frameOrigin(frame, url);
      if (origin) blockedFrameOrigins.add(origin);
    }
    if (empty) {
      frameLoading ||= frameDoc !== null;
      checks.push({
        id: 'details-panel',
        status: 'warn',
        message: frameDoc
          ? 'The job details frame has not loaded yet.'
          : 'The job details frame could not be read.',
      });
      continue;
    }
    const found = panelIn(frameDoc, true, true);
    if (found) {
      panel = {
        ...found,
        jobKey: keyFromAddress(frameDoc.URL, url.href) ?? keyFromAddress(frame.src, url.href),
      };
      break;
    }
  }
  panel ??= panelIn(doc, false, jobPage);
  panel ??= jobPage ? null : panelByTitle(doc, card, selectedKey);

  if (!panel) {
    checks.push({
      id: 'details-panel',
      status: 'fail',
      message: 'No job details panel with a job title was found.',
    });
    checks.push({ id: 'page-structure', status: 'warn', message: describeStructure(doc, card) });
    return {
      scope: null,
      selectedJobId: selectedKey,
      checks,
      message: frameLoading
        ? 'The selected job’s details are still loading. Wait until they appear on the right, then analyze again.'
        : blockedFrameOrigins.size > 0
          ? 'Chrome keeps this job’s details in a separate Indeed frame that ApplyPilot cannot read yet. Allow access below, or paste the job instead.'
          : 'No job is open on this Indeed page. Click a job in the results so its details appear on the right, then analyze again.',
      ...(blockedFrameOrigins.size > 0 ? { blockedFrameOrigins: [...blockedFrameOrigins] } : {}),
    };
  }

  checks.push({
    id: 'details-panel',
    status: 'pass',
    message: panel.frame
      ? 'Read from the job details panel (an embedded frame). Other results were ignored.'
      : jobPage
        ? 'Read from the job page.'
        : 'Read from the job details panel. Other results were ignored.',
  });

  const panelTitle = cleanTitle(panel.title) ?? '';
  let confirmed = false;
  let mismatch = false;
  if (selectedKey && panel.jobKey) {
    confirmed = panel.jobKey === selectedKey;
    mismatch = !confirmed;
  } else if (selectedTitle && panelTitle) {
    confirmed = sameJobTitle(selectedTitle, panelTitle);
    mismatch = !confirmed;
  } else if (jobPage) {
    confirmed = true;
  }

  if (mismatch) {
    checks.push({
      id: 'panel-match',
      status: 'fail',
      message: selectedTitle
        ? `The details panel shows "${panelTitle}", but the selected result is "${selectedTitle}".`
        : `The details panel shows job ${panel.jobKey ?? 'unknown'}, not the selected job ${selectedKey ?? ''}.`.trim(),
    });
    return {
      scope: null,
      selectedJobId: selectedKey,
      checks,
      message:
        'The job details panel is still showing a different job from the one you selected. Wait for the panel to finish loading, then analyze again.',
    };
  }
  checks.push(
    confirmed
      ? {
          id: 'panel-match',
          status: 'pass',
          message: jobPage
            ? 'The page shows a single job.'
            : panel.jobKey
              ? 'The details panel declares the selected job id.'
              : 'The details panel title matches the selected result.',
        }
      : {
          id: 'panel-match',
          status: 'warn',
          message:
            'Could not confirm that the details panel matches the selected result. Check the title before using the analysis.',
        },
  );

  return {
    scope: {
      doc: panel.doc,
      root: panel.root,
      title: panel.title,
      singleJobDocument: panel.frame || jobPage,
      confirmed,
    },
    selectedJobId: selectedKey ?? panel.jobKey,
    checks,
  };
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

const PLACE = /^(remote|[\p{L} .'-]{2,40},\s*[A-Z]{2}(\s+\d{5})?)$/u;

/**
 * Reads the "Company • City, ST 12345 • $pay a year" line that sits next to the
 * company link when the panel has no location or pay hooks.
 */
function bulletLine(
  companyEl: Element | null,
  company: string | null,
): { location: string | null; pay: string | null } | null {
  let block = companyEl?.parentElement ?? null;
  for (let depth = 0; block && depth < 3; depth += 1, block = block.parentElement) {
    const text = normalizeWhitespace(block.textContent);
    if (!text.includes('•')) continue;
    const parts = text
      .split('•')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part !== company);
    return {
      location: parts.find((part) => PLACE.test(part)) ?? null,
      pay: parts.find((part) => /[$€£¥₹]\s?\d/.test(part)) ?? null,
    };
  }
  return null;
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

function hostCurrency(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (!/(^|\.)indeed\.com$/.test(host)) return null;
  const sub = host.replace(/\.?indeed\.com$/, '') || 'www';
  return SITE_CURRENCY[sub] ?? null;
}

/**
 * The country site's currency. An embedded details frame lives on a shared
 * subdomain (jobs.indeed.com), so the page that holds it decides; Chrome
 * exposes only the ancestor origins, never their addresses or content.
 */
function siteCurrency(url: URL, doc: Document): string | null {
  const own = hostCurrency(url.hostname);
  if (own) return own;
  const ancestors = doc.defaultView?.location.ancestorOrigins;
  if (!ancestors) return null;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    try {
      const currency = hostCurrency(new URL(ancestors.item(i) ?? '').hostname);
      if (currency) return currency;
    } catch {
      // not an address; ignore
    }
  }
  return null;
}

function scopeFor(doc: Document, url: URL, scope?: JobScope): JobScope | null {
  return scope ?? locateSelectedJob(doc, url).scope;
}

export const indeedAdapter: SiteAdapter = {
  platform: 'indeed',
  preferOverStructuredData: true,
  noJobMessage:
    'No job is open on this Indeed page. Click a job in the results so its details appear on the right, then analyze again.',

  matches(url) {
    return HOST.test(url.hostname);
  },

  locate: locateSelectedJob,

  isReady(doc, url) {
    const scope = locateSelectedJob(doc, url).scope;
    return scope !== null && descriptionIn(scope.root) !== null;
  },

  watchedDocuments(doc) {
    return frameDocuments(doc)
      .map((f) => f.doc)
      .filter((d): d is Document => d !== null);
  },

  descriptionElement(_doc, scope) {
    return scope ? descriptionIn(scope.root) : null;
  },

  extract(doc, url, given) {
    const scope = scopeFor(doc, url, given);
    if (!scope) return null;
    const { root } = scope;
    const confidence: Confidence = scope.confirmed ? 'high' : 'medium';
    const out: PartialJob = {};

    const titleEl = scope.title ?? titleElement(root, scope.singleJobDocument);
    const title = titleEl ? cleanTitle(titleEl) : null;
    if (title) out.title = { value: title, confidence };

    const companyEl = first(root, COMPANY);
    const company = companyEl ? cleanCompany(companyEl) : null;
    if (company) out.company = { value: company, confidence };

    const locationEl = first(root, LOCATION);
    // Layouts without Indeed's hooks put "Company • City, ST 12345 • $pay" on one line.
    const line = locationEl ? null : bulletLine(companyEl, company);
    if (locationEl) {
      const { location, arrangement } = parseLocation(locationEl, company);
      if (location) out.location = { value: location, confidence };
      if (arrangement) out.workArrangement = { value: arrangement, confidence };
    } else if (line?.location) {
      out.location = { value: line.location, confidence: 'medium' };
      const arrangement = ARRANGEMENT_LABELS.find(([pattern]) => pattern.test(line.location ?? ''));
      if (arrangement) out.workArrangement = { value: arrangement[1], confidence: 'medium' };
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
      ...(line?.pay ? [line.pay] : []),
    ];
    for (const text of payTexts) {
      const salary = findSalary(text);
      if (salary) {
        const currency: SalaryRange['currency'] =
          salary.value.currency ?? siteCurrency(url, root.ownerDocument);
        out.salary = { value: { ...salary.value, currency }, confidence };
        break;
      }
    }

    const typeLabels = detailGroup(root, /^job types?$/i);
    const headerTypes = headerParts
      .filter((t) => !/[$€£¥₹]/.test(t))
      .map((t) => t.replace(/^[-–\s]+/, ''));
    const types = parseEmploymentTypeLabels(typeLabels.length > 0 ? typeLabels : headerTypes);
    if (types.length > 0) out.employmentType = { value: types, confidence };

    const description = descriptionIn(root);
    const descriptionText = description ? nonEmpty(elementToText(description)) : null;
    if (descriptionText) out.description = { value: descriptionText, confidence };

    const jobKey =
      indeedJobKey(url) ?? (scope.doc !== doc ? keyFromAddress(scope.doc.URL, url.href) : null);
    if (jobKey) {
      out.jobId = { value: jobKey, confidence: 'high' };
      // A stable address for this job, even when it was opened from search results.
      out.url = { value: `${url.origin}/viewjob?jk=${jobKey}`, confidence: 'high' };
    }

    return out;
  },
};

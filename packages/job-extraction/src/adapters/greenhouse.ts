import type { SiteAdapter, PartialJob } from '../types';
import { elementToText, nonEmpty } from '../text';
import { detectApplicationForm } from '../strategies/dom';

const HOSTS = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'boards.eu.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);

/** Matches /{board}/jobs/{numeric id} on Greenhouse-hosted job boards. */
const JOB_PATH = /^\/[\w-]+\/jobs\/(\d+)/;

/** First non-empty text among selectors tried in priority order (not document order). */
function text(doc: Document, ...selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = nonEmpty(doc.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return null;
}

/**
 * Greenhouse-hosted job boards. Supports both the classic board layout
 * (#header .app-title, .company-name, #content) and the newer layout
 * (.job__title, .job__location, .job__description). Boards embedded on an
 * employer's own site load Greenhouse in a cross-origin iframe, which this
 * adapter deliberately does not reach into.
 */
export const greenhouseAdapter: SiteAdapter = {
  platform: 'greenhouse',
  matches(url) {
    return HOSTS.has(url.hostname);
  },
  extract(doc, url) {
    const idMatch = JOB_PATH.exec(url.pathname);
    if (!idMatch?.[1]) return null;
    const out: PartialJob = { jobId: { value: idMatch[1], confidence: 'high' } };

    const title = text(doc, '.job__title h1', '.app-title', 'h1');
    if (title) out.title = { value: title, confidence: 'high' };

    const companyLine = text(doc, '.company-name');
    const fromTitleTag = /\bat\s+(.+)$/i.exec(doc.title.trim())?.[1];
    const company = companyLine?.replace(/^at\s+/i, '') ?? nonEmpty(fromTitleTag);
    if (company) out.company = { value: company, confidence: companyLine ? 'high' : 'medium' };

    const location = text(doc, '.job__location', '.location');
    if (location) out.location = { value: location, confidence: 'high' };

    const description = doc.querySelector('.job__description, #content');
    const descriptionText = description ? nonEmpty(elementToText(description)) : null;
    if (descriptionText) out.description = { value: descriptionText, confidence: 'high' };

    const form = doc.querySelector('#application-form, #application_form, form#application');
    if (form) out.hasApplicationForm = { value: true, confidence: 'high' };
    else {
      const detected = detectApplicationForm(doc);
      if (detected) out.hasApplicationForm = detected;
    }
    return out;
  },
  descriptionElement(doc) {
    return doc.querySelector('.job__description, #content');
  },
};

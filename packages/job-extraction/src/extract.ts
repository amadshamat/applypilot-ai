import {
  jobPostingSchema,
  type ExtractionSource,
  type JobExtractionResult,
  type JobPosting,
  type JobPostingField,
} from '@applypilot/shared';
import { SITE_ADAPTERS, detectPlatform } from './adapters';
import { analyzeDescription } from './strategies/description';
import { extractFromDom, findDescriptionElement } from './strategies/dom';
import { extractFromJsonLd, findJobPostingNodes } from './strategies/json-ld';
import { extractFromUrl } from './strategies/url';
import { parseHtmlFragment } from './text';
import type { SiteAdapter, StrategyOutput } from './types';

export interface ExtractOptions {
  adapters?: readonly SiteAdapter[];
  now?: () => Date;
}

const FIELDS = Object.keys(jobPostingSchema.shape) as JobPostingField[];

/** Description text below this length is too thin to call the page a posting. */
const MIN_POSTING_DESCRIPTION = 300;

/**
 * Layered, deterministic job extraction. Strategies run in trust order and the
 * first strategy to find a field wins:
 *
 *   1. schema.org JobPosting JSON-LD
 *   2. a site adapter for the hosting platform
 *   3. analysis of the description content (sections, skills, salary, …)
 *   4. generic page signals (headings, meta tags, URL)
 *
 * Every value is validated against the shared schema; anything that fails
 * validation is reported as missing rather than passed through.
 */
export function extractJob(
  doc: Document,
  pageUrl: string,
  options: ExtractOptions = {},
): JobExtractionResult {
  const url = new URL(pageUrl);
  const platform = detectPlatform(url);
  const adapters = options.adapters ?? SITE_ADAPTERS;
  const warnings: string[] = [];
  const strategies: JobExtractionResult['strategies'] = [];
  const outputs: StrategyOutput[] = [];

  const jsonLd = extractFromJsonLd(doc);
  const adapter = adapters.find((a) => a.matches(url, doc));
  const adapterFields = adapter?.extract(doc, url) ?? null;

  const jsonLdOutput: StrategyOutput | null = jsonLd ? { source: 'json-ld', fields: jsonLd } : null;
  const adapterOutput: StrategyOutput | null = adapterFields
    ? { source: 'adapter', fields: adapterFields }
    : null;
  const ordered = adapter?.preferOverStructuredData
    ? [adapterOutput, jsonLdOutput]
    : [jsonLdOutput, adapterOutput];
  for (const output of ordered) {
    if (!output) continue;
    strategies.push(output.source === 'json-ld' ? 'json-ld' : 'adapter');
    outputs.push(output);
  }

  if (adapter && !adapterFields && adapter.noJobMessage) {
    warnings.push(adapter.noJobMessage);
  } else if (platform !== 'generic' && !adapter) {
    warnings.push(
      `This page is hosted on ${platform}, which does not have a dedicated adapter yet. Results come from general page analysis.`,
    );
  }

  const dom = extractFromDom(doc);
  const title = jsonLd?.title?.value ?? adapterFields?.title?.value ?? dom.title?.value ?? null;
  const descriptionRoot = selectDescriptionRoot(doc, adapter, findJobPostingNodes(doc)[0]);
  if (descriptionRoot)
    outputs.push({ source: 'dom', fields: analyzeDescription(descriptionRoot, title) });
  outputs.push({ source: 'dom', fields: dom });
  outputs.push({ source: 'url', fields: extractFromUrl(doc, url) });
  strategies.push('dom');

  const job = mergeFields(outputs, warnings);
  const isJobPosting = looksLikeJobPosting(job, jsonLd !== null, adapterFields !== null);
  const adapterExplained =
    adapter !== undefined && !adapterFields && adapter.noJobMessage !== undefined;
  if (!isJobPosting && !adapterExplained) {
    warnings.push(
      'This page does not look like a single job posting. Open a specific job listing and try again.',
    );
  } else if (isJobPosting && !jsonLd && !adapterFields) {
    warnings.push(
      'No structured job data was found, so values come from the page layout and may be incomplete.',
    );
  }

  return {
    isJobPosting,
    platform,
    pageUrl: url.href,
    extractedAt: (options.now?.() ?? new Date()).toISOString(),
    strategies,
    job,
    warnings,
  };
}

function selectDescriptionRoot(
  doc: Document,
  adapter: SiteAdapter | undefined,
  jsonLdNode: Record<string, unknown> | undefined,
): Element | null {
  const fromAdapter = adapter?.descriptionElement(doc);
  if (fromAdapter) return fromAdapter;
  const html = jsonLdNode?.['description'];
  if (typeof html === 'string' && html.trim().length > 0) {
    const inert = parseHtmlFragment(html, doc);
    // Double-encoded HTML ("&lt;ul&gt;") arrives as text; parse it once more.
    return inert.body.querySelector('*')
      ? inert.body
      : parseHtmlFragment(inert.body.textContent, doc).body;
  }
  return findDescriptionElement(doc)?.value ?? null;
}

function mergeFields(outputs: readonly StrategyOutput[], warnings: string[]): JobPosting {
  const job: Record<string, unknown> = {};
  for (const field of FIELDS) {
    job[field] = { status: 'missing' };
    for (const { source, fields } of outputs) {
      const found = fields[field];
      if (!found) continue;
      const candidate = {
        status: 'found',
        value: found.value,
        source,
        confidence: found.confidence,
      };
      if (jobPostingSchema.shape[field].safeParse(candidate).success) {
        job[field] = candidate;
        break;
      }
      warnings.push(`Ignored an invalid ${field} value from ${describeSource(source)}.`);
    }
  }
  return jobPostingSchema.parse(job);
}

function describeSource(source: ExtractionSource): string {
  switch (source) {
    case 'json-ld':
      return 'structured data';
    case 'adapter':
      return 'the site adapter';
    case 'url':
      return 'the page address';
    case 'ai':
      return 'AI extraction';
    case 'dom':
      return 'page content';
  }
}

function looksLikeJobPosting(job: JobPosting, hasJsonLd: boolean, hasAdapter: boolean): boolean {
  if (hasJsonLd || hasAdapter) return true;
  if (job.title.status !== 'found' || job.description.status !== 'found') return false;
  if (job.description.value.length < MIN_POSTING_DESCRIPTION) return false;
  const signals = [
    job.requiredQualifications.status === 'found',
    job.preferredQualifications.status === 'found',
    job.employmentType.status === 'found',
    job.yearsOfExperience.status === 'found',
    job.salary.status === 'found',
    job.hasApplicationForm.status === 'found',
  ].filter(Boolean).length;
  return signals >= 2;
}

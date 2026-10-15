import {
  jobPostingSchema,
  type ExtractionCheck,
  type ExtractionDiagnostics,
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
import type { JobScope, LocateResult, SiteAdapter, StrategyOutput } from './types';

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
  const extractedAt = (options.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  const strategies: JobExtractionResult['strategies'] = [];
  const outputs: StrategyOutput[] = [];

  const adapter = adapters.find((a) => a.matches(url, doc));
  // Pages that can show many jobs: confine everything to the selected one.
  const located: LocateResult | null = adapter?.locate?.(doc, url) ?? null;
  if (located && !located.scope) {
    return noSelectedJob(url, platform, extractedAt, located, adapter?.noJobMessage);
  }
  const scope: JobScope | undefined = located?.scope ?? undefined;
  const jobDoc = scope?.doc ?? doc;
  // Structured data describes the document it is in; a search page's does not
  // describe the selected job, so it is only read from single-job documents.
  const structuredDataApplies = !scope || scope.singleJobDocument;

  const jsonLd = structuredDataApplies ? extractFromJsonLd(jobDoc) : null;
  const adapterFields = adapter?.extract(doc, url, scope) ?? null;

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
  if (scope && !scope.confirmed) {
    warnings.push(
      'ApplyPilot could not confirm that the job details panel matches the job you selected. Check the title and company before using this analysis.',
    );
  }

  const dom = extractFromDom(jobDoc, scope ? { scope: scope.root } : {});
  const title = jsonLd?.title?.value ?? adapterFields?.title?.value ?? dom.title?.value ?? null;
  const jsonLdNode = structuredDataApplies ? findJobPostingNodes(jobDoc)[0] : undefined;
  const descriptionRoot = selectDescriptionRoot(jobDoc, adapter, scope, jsonLdNode);
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
    extractedAt,
    strategies,
    job,
    warnings,
    diagnostics: {
      scope: scope ? 'selected-job' : 'page',
      selectedJobId: located?.selectedJobId ?? null,
      checks: [...(located?.checks ?? []), ...fieldChecks(job)],
    },
  };
}

/** The result for a multi-job page where no single selected job could be read. */
function noSelectedJob(
  url: URL,
  platform: JobExtractionResult['platform'],
  extractedAt: string,
  located: LocateResult,
  fallbackMessage: string | undefined,
): JobExtractionResult {
  const message = located.message ?? fallbackMessage ?? 'No single job is selected on this page.';
  const diagnostics: ExtractionDiagnostics = {
    scope: 'selected-job',
    selectedJobId: located.selectedJobId,
    checks: located.checks,
  };
  return {
    isJobPosting: false,
    platform,
    pageUrl: url.href,
    extractedAt,
    strategies: ['adapter'],
    // Nothing is read from the rest of the page: it lists other jobs.
    job: mergeFields(
      [{ source: 'url', fields: { url: { value: url.href, confidence: 'high' } } }],
      [],
    ),
    warnings: [message],
    diagnostics,
  };
}

const SHORT_DESCRIPTION = MIN_POSTING_DESCRIPTION;

/** Plain-language self-checks on the merged result. */
function fieldChecks(job: JobPosting): ExtractionCheck[] {
  const checks: ExtractionCheck[] = [];
  checks.push(
    job.title.status === 'found'
      ? {
          id: 'title',
          status: job.title.confidence === 'low' ? 'warn' : 'pass',
          message: `Title read from ${describeSource(job.title.source)}.`,
        }
      : { id: 'title', status: 'fail', message: 'No job title was found.' },
  );
  checks.push(
    job.company.status === 'found'
      ? {
          id: 'company',
          status: job.company.confidence === 'low' ? 'warn' : 'pass',
          message: `Company read from ${describeSource(job.company.source)}.`,
        }
      : { id: 'company', status: 'warn', message: 'No company name was found.' },
  );
  if (job.description.status !== 'found') {
    checks.push({ id: 'description', status: 'fail', message: 'No job description was found.' });
  } else if (job.description.value.length < SHORT_DESCRIPTION) {
    checks.push({
      id: 'description',
      status: 'warn',
      message: `The description is short (${job.description.value.length} characters). The page may not have finished loading.`,
    });
  } else {
    checks.push({
      id: 'description',
      status: 'pass',
      message: `Description read from ${describeSource(job.description.source)} (${job.description.value.length} characters).`,
    });
  }
  return checks;
}

function selectDescriptionRoot(
  doc: Document,
  adapter: SiteAdapter | undefined,
  scope: JobScope | undefined,
  jsonLdNode: Record<string, unknown> | undefined,
): Element | null {
  const fromAdapter = adapter?.descriptionElement(doc, scope);
  if (fromAdapter) return fromAdapter;
  const html = jsonLdNode?.['description'];
  if (typeof html === 'string' && html.trim().length > 0) {
    const inert = parseHtmlFragment(html, doc);
    // Double-encoded HTML ("&lt;ul&gt;") arrives as text; parse it once more.
    return inert.body.querySelector('*')
      ? inert.body
      : parseHtmlFragment(inert.body.textContent, doc).body;
  }
  return findDescriptionElement(doc, scope?.root)?.value ?? null;
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

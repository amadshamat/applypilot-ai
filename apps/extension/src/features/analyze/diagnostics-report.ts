import type { JobExtractionResult, JobPostingField } from '@applypilot/shared';

/**
 * A troubleshooting summary for bug reports: where each field came from and
 * the self-checks, without the job text or anything from the user's profile.
 */
export function diagnosticsReport(result: JobExtractionResult): string {
  const fields = Object.fromEntries(
    (Object.keys(result.job) as JobPostingField[]).map((name) => {
      const field = result.job[name];
      return [name, field.status === 'found' ? `${field.source}/${field.confidence}` : 'missing'];
    }),
  );
  return JSON.stringify(
    {
      platform: result.platform,
      pageUrl: result.pageUrl,
      extractedAt: result.extractedAt,
      isJobPosting: result.isJobPosting,
      strategies: result.strategies,
      diagnostics: result.diagnostics ?? null,
      fields,
      warnings: result.warnings,
    },
    null,
    2,
  );
}

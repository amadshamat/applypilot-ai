import type { PartialJob } from '../types';

const JOB_ID_PARAMS = ['gh_jid', 'jobId', 'job_id', 'jobid', 'jid', 'reqId', 'requisitionId'];

/** Signals available from the address alone: canonical URL and job identifiers. */
export function extractFromUrl(doc: Document, url: URL): PartialJob {
  const out: PartialJob = {};
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  let resolved: URL | null = null;
  if (canonical) {
    try {
      resolved = new URL(canonical, url);
    } catch {
      resolved = null;
    }
  }
  // A canonical link on another site is not trusted as this posting's address.
  if (resolved && resolved.protocol.startsWith('http') && resolved.hostname === url.hostname) {
    out.url = { value: resolved.href, confidence: 'high' };
  } else {
    out.url = { value: url.href, confidence: 'high' };
  }

  for (const param of JOB_ID_PARAMS) {
    const value = url.searchParams.get(param)?.trim();
    if (value && /^[\w-]{1,64}$/.test(value)) {
      out.jobId = { value, confidence: 'medium' };
      break;
    }
  }
  return out;
}

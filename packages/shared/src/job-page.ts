/**
 * A stable identity for "the job this page shows", used to tell whether an
 * earlier analysis still describes what is on screen.
 *
 * Most sites give each job its own address, so the address (without its hash)
 * is the identity. Indeed search pages keep one address per search and switch
 * jobs by changing the `vjk` parameter, so the job key is the identity there.
 */
const INDEED_HOST = /(^|\.)indeed\.com$/i;
const INDEED_JOB_KEY = /^[a-f0-9]{8,32}$/i;

export function indeedJobKey(url: URL): string | null {
  if (!INDEED_HOST.test(url.hostname)) return null;
  const key = url.searchParams.get('vjk') ?? url.searchParams.get('jk');
  return key && INDEED_JOB_KEY.test(key) ? key.toLowerCase() : null;
}

export function jobPageIdentity(pageUrl: string): string {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return pageUrl;
  }
  const indeedKey = indeedJobKey(url);
  if (indeedKey) return `indeed:${indeedKey}`;
  url.hash = '';
  return url.toString();
}

/** True when both addresses show the same job. */
export function isSameJobPage(a: string, b: string): boolean {
  return jobPageIdentity(a) === jobPageIdentity(b);
}

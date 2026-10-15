/** Collapses runs of whitespace (including non-breaking spaces) and trims. */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Returns the trimmed text or null when it is empty. */
export function nonEmpty(input: string | null | undefined): string | null {
  if (input == null) return null;
  const text = normalizeWhitespace(input);
  return text.length > 0 ? text : null;
}

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BR',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME']);

/**
 * Converts an element into readable text, keeping paragraph and list breaks.
 * Unlike `innerText` this works in jsdom and never triggers layout.
 */
export function elementToText(root: Node): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIPPED_TAGS.has(el.tagName.toUpperCase())) return;
    if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return;
    const block = BLOCK_TAGS.has(el.tagName.toUpperCase());
    if (block) parts.push('\n');
    if (el.tagName.toUpperCase() === 'LI') parts.push('• ');
    el.childNodes.forEach(walk);
    if (block) parts.push('\n');
  };
  walk(root);
  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Parses an untrusted HTML fragment (for example a JSON-LD description) into an
 * inert document. Inert documents never execute scripts or load resources.
 */
export function parseHtmlFragment(html: string, doc: Document): Document {
  const inert = doc.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  return inert;
}

export function htmlToText(html: string, doc: Document): string {
  // JSON-LD descriptions are sometimes double-encoded ("&lt;p&gt;").
  const decoded = /&lt;\/?[a-z]/i.test(html) ? decodeEntities(html, doc) : html;
  return elementToText(parseHtmlFragment(decoded, doc).body);
}

function decodeEntities(html: string, doc: Document): string {
  const inert = doc.implementation.createHTMLDocument('');
  const textarea = inert.createElement('textarea');
  textarea.innerHTML = html;
  return textarea.value;
}

export function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Headings and document titles that name a search page or a site rather than a
 * job ("Job Search | Indeed", "Fundraiser jobs in Arlington, VA", "1,204 jobs").
 * They are never used as a job title.
 */
const GENERIC_PAGE_TITLES: readonly RegExp[] = [
  /^job search\b/i,
  /[|–—-]\s*indeed(\.com)?$/i,
  /^indeed(\.com)?$/i,
  /^(find|search|browse)\s+(jobs?|careers?)\b/i,
  /\bjobs?,\s*employment\b/i,
  /^[\d,.]+\+?\s+(\S+\s+){0,6}jobs?\b/i,
  /^(\S+\s+){0,5}jobs\s+(in|near)\s/i,
  /^(search results?|jobs|careers|job board|all jobs)$/i,
];

export function isGenericPageTitle(text: string): boolean {
  const title = normalizeWhitespace(text);
  return GENERIC_PAGE_TITLES.some((pattern) => pattern.test(title));
}

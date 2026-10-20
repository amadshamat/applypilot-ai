/**
 * A content-free outline of a page's element structure, for bug reports about
 * layouts ApplyPilot does not recognise. It records tags, ids, test hooks,
 * meaningful class names, job keys and frames, and never any text, so it can
 * be shared without exposing the job or the user. Digits in names are masked
 * (Indeed puts pay amounts in some test ids) except in job keys.
 */

const MAX_LINES = 400;
const MAX_DEPTH = 40;
const MAX_CHARS = 38_000;
const INTERESTING =
  'h1, h2, h3, iframe, [id], [data-testid], [data-jk], [role="main"], main, [aria-current]';

function mask(value: string): string {
  return value
    .replace(/\d/g, '#')
    .replace(/[^\w#:.-]/g, '_')
    .slice(0, 60);
}

/** Generated class names (css-1a2b3c, e1tiznh50) say nothing about the layout. */
function meaningfulClasses(el: Element): string[] {
  return [...el.classList]
    .filter((c) => !/^(css-|e[0-9a-z]{6,}$)|^[a-z]{1,3}\d/i.test(c) && /[a-z]{3}/i.test(c))
    .slice(0, 3)
    .map(mask);
}

function describe(el: Element, pageUrl: string): string {
  let line = el.localName;
  if (el.id) line += `#${mask(el.id)}`;
  for (const c of meaningfulClasses(el)) line += `.${c}`;
  const testid = el.getAttribute('data-testid');
  if (testid) line += ` [testid=${mask(testid)}]`;
  const jk = el.getAttribute('data-jk');
  if (jk && /^[a-f0-9]{8,32}$/i.test(jk)) line += ` [jk=${jk}]`;
  if (el.getAttribute('aria-current')) line += ' [aria-current]';
  if (el.localName === 'iframe') {
    const src = el.getAttribute('src');
    let where = src ? 'src' : el.hasAttribute('srcdoc') ? 'srcdoc' : 'no-src';
    if (src) {
      try {
        const u = new URL(src, pageUrl);
        where = `${u.origin}${u.pathname}`;
      } catch {
        where = 'bad-src';
      }
    }
    let readable: boolean;
    try {
      readable = (el as HTMLIFrameElement).contentDocument?.body != null;
    } catch {
      readable = false;
    }
    line += ` [frame ${where}, ${readable ? 'readable' : 'not readable'}]`;
  }
  if (el.shadowRoot) line += ' [open shadow root]';
  return line;
}

export function outlinePage(doc: Document, pageUrl = doc.URL): string {
  const lines: string[] = [];
  // Ancestors of interesting elements are kept so the outline shows nesting.
  const keep = new Set<Element>();
  const hooks = [...doc.querySelectorAll(INTERESTING)];
  // Shadow hosts matter too: content inside them is invisible to the adapters.
  for (const el of doc.querySelectorAll('body *')) if (el.shadowRoot) hooks.push(el);
  for (const el of hooks) {
    let node: Element | null = el;
    while (node && !keep.has(node)) {
      keep.add(node);
      node = node.parentElement;
    }
  }
  const walk = (el: Element, depth: number) => {
    if (lines.length >= MAX_LINES || depth > MAX_DEPTH) return;
    if (el.localName === 'script' || el.localName === 'style' || el.localName === 'svg') return;
    lines.push(`${'  '.repeat(depth)}${describe(el, pageUrl)}`);
    for (const child of el.children) if (keep.has(child)) walk(child, depth + 1);
  };
  // Typed as always present, but a document without a body is possible.
  const body = doc.body as HTMLElement | null;
  if (body) walk(body, 0);
  if (lines.length >= MAX_LINES) lines.push(`… cut at ${MAX_LINES} lines`);
  return lines.join('\n').slice(0, MAX_CHARS);
}

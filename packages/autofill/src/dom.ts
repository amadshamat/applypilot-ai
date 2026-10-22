import { clean, cleanLabel } from './text';

/** Marks each detected field so the fill step finds the same element again. */
export const REF_ATTRIBUTE = 'data-applypilot-ref';

/*
 * Element checks by tag name rather than instanceof: a same-origin frame has
 * its own HTMLInputElement class, so instanceof against this window's class
 * would miss every field inside it.
 */
export function isInput(el: Element | null | undefined): el is HTMLInputElement {
  return el?.tagName === 'INPUT';
}
export function isSelect(el: Element | null | undefined): el is HTMLSelectElement {
  return el?.tagName === 'SELECT';
}
export function isTextArea(el: Element | null | undefined): el is HTMLTextAreaElement {
  return el?.tagName === 'TEXTAREA';
}
export function isButton(el: Element | null | undefined): el is HTMLButtonElement {
  return el?.tagName === 'BUTTON';
}
function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && 'host' in node;
}

/**
 * Every element matching `selector` under `root`, including inside open
 * shadow roots (some application forms are built from web components).
 */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [];
  const visit = (node: ParentNode) => {
    for (const el of node.querySelectorAll('*')) {
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return out;
}

/** The page and the frames inside it that this document may read (same origin). */
export function readableDocuments(doc: Document, depth = 2): Document[] {
  const docs = [doc];
  if (depth === 0) return docs;
  for (const frame of doc.querySelectorAll('iframe')) {
    let inner: Document | null;
    try {
      inner = frame.contentDocument;
    } catch {
      inner = null;
    }
    const body = inner?.body as HTMLElement | null | undefined;
    if (inner && body?.firstElementChild) docs.push(...readableDocuments(inner, depth - 1));
  }
  return docs;
}

/**
 * Whether the user can see the element. Uses Chrome's checkVisibility when
 * available and falls back to styles and the hidden attribute (jsdom).
 */
export function isVisible(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], template')) return false;
  const target = el as Element & { checkVisibility?: (this: Element, o?: object) => boolean };
  if (typeof target.checkVisibility === 'function') {
    return target.checkVisibility({ visibilityProperty: true, opacityProperty: false });
  }
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

const CONTROL_SELECTOR =
  'input, select, textarea, button, [role="button"], a:not([href]), [role="listbox"], [role="option"]';

/** Visible text of an element, leaving out the text of form controls inside it. */
export function textWithoutControls(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(`${CONTROL_SELECTOR}, script, style, svg`).forEach((c) => c.remove());
  return clean(clone.textContent);
}

function byIds(doc: Document | ShadowRoot, ids: string | null): string {
  if (!ids) return '';
  return clean(
    ids
      .split(/\s+/)
      .map((id) => {
        const el = doc.getElementById(id);
        return el ? textWithoutControls(el) : '';
      })
      .join(' '),
  );
}

function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return isShadowRoot(root) ? root : el.ownerDocument;
}

/** Short text right before the element (a label-like sibling), within a few ancestors. */
function nearbyText(el: Element): string {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches('input, select, textarea')) break;
      if (sib.querySelector('input, select, textarea')) break;
      const text = textWithoutControls(sib);
      if (text.length > 0 && text.length <= 300) return text;
      if (text.length > 300) break;
    }
  }
  return '';
}

/**
 * The text that names a control, in the order assistive technology uses:
 * aria-labelledby, <label>, aria-label, then a title or nearby text.
 */
export function labelFor(el: Element): string {
  const root = rootOf(el);
  const labelledBy = byIds(root, el.getAttribute('aria-labelledby'));
  if (labelledBy) return labelledBy;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const text = clean([...labels].map((l) => textWithoutControls(l)).join(' '));
    if (text) return text;
  }
  const id = el.getAttribute('id');
  if (id && !labels) {
    const label = [...root.querySelectorAll('label[for]')].find(
      (l) => l.getAttribute('for') === id,
    );
    if (label) return textWithoutControls(label);
  }
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const title = clean(el.getAttribute('title'));
  if (title) return title;
  return nearbyText(el);
}

/** The name of a group of radios or checkboxes: legend, group label, or nearby text. */
export function groupLabel(container: Element): string {
  const root = rootOf(container);
  const labelledBy = byIds(root, container.getAttribute('aria-labelledby'));
  if (labelledBy) return labelledBy;
  const aria = clean(container.getAttribute('aria-label'));
  if (aria) return aria;
  const legend = container.matches('fieldset')
    ? container.querySelector(':scope > legend')
    : container.closest('fieldset')?.querySelector(':scope > legend');
  if (legend) return textWithoutControls(legend);
  return nearbyText(container);
}

export function describedBy(el: Element): string {
  return byIds(rootOf(el), el.getAttribute('aria-describedby'));
}

const HEADING = 'h1, h2, h3, h4, legend, [role="heading"]';

/** The nearest heading before the element inside `limit`: the section it belongs to. */
export function sectionFor(el: Element, limit: Element): string {
  // Inside a web component, `anchor` is the field's stand-in in the outer tree: its host.
  let anchor = el;
  let node: Element | null = el.parentElement;
  const climb = () => {
    const root = (node ?? anchor).getRootNode();
    if (!isShadowRoot(root)) return null;
    anchor = root.host;
    return root.host.parentElement;
  };
  if (!node) node = climb();
  while (node) {
    const here = anchor;
    const headings = [...node.querySelectorAll(HEADING)].filter(
      (h) =>
        !h.contains(here) &&
        (h.compareDocumentPosition(here) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        // A legend names only its own fieldset, not the fields after it.
        (h.tagName !== 'LEGEND' || h.parentElement?.contains(here) === true),
    );
    const last = headings.at(-1);
    if (last) {
      const text = cleanLabel(textWithoutControls(last));
      if (text) return text.slice(0, 200);
    }
    if (node === limit) break;
    node = node.parentElement ?? climb();
  }
  return '';
}

const ADVANCE_TEXT =
  /^(submit|apply|send|next|continue|review|finish|done|save (?:and|&) continue|save and next|proceed|complete)\b/i;

/**
 * Buttons that submit or advance an application. ApplyPilot never clicks
 * these, and the fill step refuses any click that would reach one.
 */
export function isSubmitLike(el: Element): boolean {
  const control = el.closest('button, input, a, [role="button"], [role="link"]');
  if (!control) return false;
  if (isInput(control)) {
    return ['submit', 'image'].includes(control.type);
  }
  // A button without a type submits its form; outside a form only its text tells.
  if (isButton(control) && control.type === 'submit' && control.form) {
    return true;
  }
  const text = clean(control.textContent || control.getAttribute('aria-label'));
  return ADVANCE_TEXT.test(text);
}

export function buttonText(el: Element): string {
  if (isInput(el)) return clean(el.value || el.getAttribute('aria-label'));
  return clean(el.textContent || el.getAttribute('aria-label')).slice(0, 80);
}

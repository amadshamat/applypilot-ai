import { elementToText, normalizeWhitespace } from '../text';

export type SectionKind =
  'required' | 'preferred' | 'responsibilities' | 'education' | 'benefits' | 'other';

export type DescriptionSections = Record<SectionKind, string[]>;

const APOS = `['’]`;
const SECTION_RULES: ReadonlyArray<[SectionKind, RegExp]> = [
  // Order matters: "Preferred qualifications" must not be read as required.
  [
    'preferred',
    new RegExp(
      `\\b(preferred|nice[- ]to[- ]have|bonus|pluses|a plus|desirable|ideally|stand out)`,
      'i',
    ),
  ],
  ['education', /\beducation\b/i],
  ['benefits', /\b(benefits|perks|we offer|what we provide|compensation)\b/i],
  [
    'responsibilities',
    new RegExp(
      `\\b(responsibilit|what you${APOS}?ll do|what you will do|duties|day[- ]to[- ]day|in this role|the role)`,
      'i',
    ),
  ],
  [
    'required',
    new RegExp(
      `\\b(requirements?|qualifications|what you${APOS}?ll need|what you will need|what we${APOS}?re looking for|must[- ]haves?|minimum|basic qualifications|who you are|you have|you bring|skills)`,
      'i',
    ),
  ],
];

export function classifyHeading(text: string): SectionKind {
  for (const [kind, pattern] of SECTION_RULES) {
    if (pattern.test(text)) return kind;
  }
  return 'other';
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DT']);
const BLOCK_SELECTOR = 'p, div, ul, ol, li, h1, h2, h3, h4, h5, h6, table, section';

function isHeadingLike(el: Element): boolean {
  if (el.closest('li')) return false;
  const tag = el.tagName.toUpperCase();
  const text = normalizeWhitespace(el.textContent);
  if (text.length < 3 || text.length > 80) return false;
  if (HEADING_TAGS.has(tag)) return true;
  if (el.querySelector(BLOCK_SELECTOR)) return false;
  if (tag === 'STRONG' || tag === 'B') {
    // A bold run counts only when it is the whole paragraph, not inline emphasis.
    const parent = el.parentElement;
    return !!parent && normalizeWhitespace(parent.textContent) === text;
  }
  if (tag === 'P' || tag === 'DIV' || tag === 'SPAN') {
    return (
      text.endsWith(':') ||
      (el.children.length === 1 && /^(STRONG|B)$/i.test(el.children[0]?.tagName ?? ''))
    );
  }
  return false;
}

function listItemText(li: Element): string {
  const clone = li.cloneNode(true) as Element;
  clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
  return normalizeWhitespace(elementToText(clone).replace(/^•\s*/, ''));
}

/**
 * Groups list items in a job description under the nearest preceding heading
 * ("Requirements", "Nice to have", …). Works on any markup that uses headings or
 * bold lead-ins followed by lists, which covers most ATS-rendered descriptions.
 */
export function parseSections(container: Element): DescriptionSections {
  const sections: DescriptionSections = {
    required: [],
    preferred: [],
    responsibilities: [],
    education: [],
    benefits: [],
    other: [],
  };
  let current: SectionKind = 'other';
  const candidates = container.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, dt, p, div, span, strong, b, li',
  );
  for (const el of candidates) {
    if (el.tagName.toUpperCase() === 'LI') {
      if (el.parentElement?.closest('li')) continue;
      const text = listItemText(el);
      if (text.length > 0) sections[current].push(text);
    } else if (isHeadingLike(el)) {
      current = classifyHeading(normalizeWhitespace(el.textContent).replace(/:$/, ''));
    }
  }
  return sections;
}

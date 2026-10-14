/**
 * Line-level helpers: normalisation, bullets, headings and contact details.
 */

const BULLET_PREFIX = /^\s*(?:[•●○◦▪▫■□►▸‣⁃∙·*]|[-–—](?=\s)|\d{1,2}[.)](?=\s))\s*/;

export interface Line {
  text: string;
  bullet: boolean;
}

/** Splits extracted text into trimmed, non-empty lines and marks bullet points. */
export function toLines(text: string): Line[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b\ufeff]/g, '')
    .split('\n')
    .map((raw) => {
      const bullet = BULLET_PREFIX.test(raw);
      const textValue = raw.replace(BULLET_PREFIX, '').replace(/\s+/g, ' ').trim();
      return { text: textValue, bullet };
    })
    .filter((line) => line.text.length > 0);
}

export type SectionKind =
  'summary' | 'education' | 'experience' | 'skills' | 'projects' | 'certifications' | 'other';

const HEADINGS: ReadonlyArray<[RegExp, SectionKind]> = [
  [/^(professional |career )?(summary|profile|objective|about( me)?)$/, 'summary'],
  [/^(education|academic background|academics|education (and|&) training)$/, 'education'],
  [
    /^((work|professional|relevant|employment|industry|technical|internship) )?(experience|history|employment)( history)?$|^(work|employment) history$|^internships?$/,
    'experience',
  ],
  [
    /^((technical|core|key|relevant) )?(skills|competencies|technologies|skills (and|&) (tools|technologies|interests)|tools (and|&) technologies)$/,
    'skills',
  ],
  [/^((personal|academic|selected|technical|key|relevant|side) )?projects$/, 'projects'],
  [
    /^(certifications?|licenses?( (and|&) certifications?)?|certifications? (and|&) (licenses?|training|awards))$/,
    'certifications',
  ],
  [
    /^(awards?|honou?rs?( (and|&) awards)?|activities|extracurricular( activities)?|volunteer( experience)?|volunteering|leadership( (and|&) activities)?|interests|hobbies|publications|references|languages|achievements)$/,
    'other',
  ],
];

/** The section a heading line introduces, or null when the line is not a heading. */
export function classifyHeading(line: Line): SectionKind | null {
  if (line.bullet || line.text.length > 50) return null;
  const key = line.text
    .replace(/[:|]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // Spaced-out headings ("E D U C A T I O N") come out of some PDF templates.
  const compact = /^([a-z] )+[a-z]$/.test(key) ? key.replace(/ /g, '') : key;
  for (const [pattern, kind] of HEADINGS) {
    if (pattern.test(compact)) return kind;
  }
  return null;
}

/** The original heading text, cleaned for display. */
export function headingLabel(line: Line): string {
  return line.text.replace(/[:|]+\s*$/, '').trim();
}

export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const URL_PATTERN =
  /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|org|net|app|ca|co|ai|tech|site|page|xyz|us|uk)(?:\/[^\s|,;)]*)?/gi;

/** Adds https:// to bare URLs; returns '' for anything that is not a usable http(s) URL. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;:)]+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function findEmail(text: string): string {
  return EMAIL_PATTERN.exec(text)?.[0] ?? '';
}

export function findPhone(text: string): string {
  return PHONE_PATTERN.exec(text)?.[0].trim() ?? '';
}

/** URLs in the text, excluding the domain part of email addresses. */
export function findUrls(text: string): string[] {
  const withoutEmails = text.replace(new RegExp(EMAIL_PATTERN.source, 'g'), ' ');
  return [...withoutEmails.matchAll(URL_PATTERN)]
    .map((match) => normalizeUrl(match[0]))
    .filter(Boolean);
}

/** Pieces of a header line separated by visual dividers ("Acme | Toronto | 2024"). */
export function splitPieces(text: string): string[] {
  return text
    .split(/\s+[|•·◦▪–—]\s+|\s{3,}|\s+-\s+|\t/)
    .map((piece) => piece.trim().replace(/^[,|]\s*|\s*[,|]$/g, ''))
    .filter((piece) => piece.length > 0);
}

const LOCATION_PATTERN =
  /^(?:[A-Z][A-Za-z.' -]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)*)(?:,\s*[A-Z][A-Za-z ]+)?|remote|hybrid)$/i;

/** True for "Toronto, ON", "Austin, Texas", "London, UK", "Remote". */
export function looksLikeLocation(text: string): boolean {
  return text.length <= 60 && LOCATION_PATTERN.test(text.trim()) && !/\d/.test(text);
}

/** A person's name: 2–4 capitalised words, letters only. */
export function looksLikeName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((word) => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]*$/.test(word) || /^[A-Z]\.?$/.test(word))
  );
}

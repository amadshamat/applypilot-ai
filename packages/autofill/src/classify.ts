import { classifyQuestion } from '@applypilot/ai-core';
import type { ControlKind, DetectedField } from '@applypilot/shared';
import { normalize } from './text';

/**
 * Decides what each detected field asks for, using only deterministic rules:
 * the autocomplete attribute, the label, the field's name and id, and the
 * section it sits in. Questions about legal status, eligibility, demographics,
 * pay, availability and attestations are recognised first and are never
 * filled. Anything the rules cannot place is "unknown" and stays blank.
 */

export const FIELD_KINDS = [
  'name.full',
  'name.first',
  'name.last',
  'email',
  'phone',
  'location.full',
  'location.city',
  'location.state',
  'location.country',
  'location.postal',
  'link.linkedin',
  'link.github',
  'link.portfolio',
  'current.employer',
  'current.title',
  'experience.employer',
  'experience.title',
  'experience.location',
  'experience.start',
  'experience.end',
  'experience.current',
  'experience.description',
  'education.school',
  'education.degree',
  'education.field',
  'education.gpa',
  'education.start',
  'education.end',
  'skills',
  'certifications',
  'summary',
  'document.resume',
  'document.resume-text',
  'document.cover-letter-file',
  'document.cover-letter-text',
  /** An open question ApplyPilot may draft with AI from the profile. */
  'question',
  /** Legal status, eligibility, demographics, attestations: always the user's. */
  'manual.sensitive',
  /** Pay, availability, relocation, referrals: facts only the user knows. */
  'manual.personal',
  /** Asked for, but not something ApplyPilot stores (street address, middle name). */
  'not-stored',
  'unknown',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export type DatePart = 'full' | 'month' | 'year';

export interface Classification {
  kind: FieldKind;
  confidence: 'high' | 'medium' | 'low';
  /** What decided it, shown in the review ("label", "autocomplete=email"). */
  reason: string;
  /** For manual fields: what the question is about ("work authorization"). */
  topic: string;
  /** For date fields: which part of the date the field takes. */
  datePart: DatePart | null;
  source: 'rules' | 'ai';
}

type Section = 'experience' | 'education' | null;

interface Rule {
  kind: FieldKind;
  /** Matched against the normalized label. */
  label?: RegExp;
  /** Matched against the field's name and id words. */
  name?: RegExp;
  controls?: readonly ControlKind[];
  /** Only inside (or outside, with null) this kind of section. */
  section?: Section | 'any';
}

const TEXTUAL: readonly ControlKind[] = ['text', 'email', 'tel', 'url', 'textarea', 'combobox'];
const CHOICE_OR_TEXT: readonly ControlKind[] = [
  'text',
  'select',
  'combobox',
  'listbox-button',
  'radio-group',
];
const DATE_CONTROLS: readonly ControlKind[] = [
  'text',
  'date',
  'month',
  'number',
  'select',
  'combobox',
  'listbox-button',
];

const AUTOCOMPLETE: Record<string, FieldKind> = {
  name: 'name.full',
  'given-name': 'name.first',
  'family-name': 'name.last',
  'additional-name': 'not-stored',
  nickname: 'not-stored',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'address-level2': 'location.city',
  'address-level1': 'location.state',
  country: 'location.country',
  'country-name': 'location.country',
  'postal-code': 'location.postal',
  'street-address': 'not-stored',
  'address-line1': 'not-stored',
  'address-line2': 'not-stored',
  organization: 'current.employer',
  'organization-title': 'current.title',
};

/** Rules in priority order; the first match wins. */
const RULES: readonly Rule[] = [
  { kind: 'not-stored', label: /\b(preferred|middle|nick) ?name\b|\bpronunciation\b/ },
  {
    kind: 'name.first',
    label: /^(legal )?first( name)?$|^given name|^forename/,
    name: /\b(first ?name|fname|given ?name)\b/,
  },
  {
    kind: 'name.last',
    label: /^(legal )?(last|family) name|^surname|^last$/,
    name: /\b(last ?name|lname|surname|family ?name)\b/,
  },
  {
    kind: 'name.full',
    label: /^((your|full|legal|candidate) )*name$|^full legal name$/,
    name: /^(full ?name|name|candidate name|applicant name)$/,
  },
  { kind: 'email', label: /\be ?mail\b/, name: /\be ?mail\b/, controls: ['text', 'email'] },
  {
    kind: 'phone',
    label: /\b(phone|mobile|cell|telephone)\b(?!.*\b(type|device|extension|code)\b)/,
    name: /\bphone( number)?$|\bmobile\b/,
    controls: ['text', 'tel', 'number'],
  },
  {
    kind: 'link.linkedin',
    label: /\blinked ?in\b/,
    name: /\blinkedin\b/,
    controls: ['text', 'url'],
  },
  { kind: 'link.github', label: /\bgit ?hub\b/, name: /\bgithub\b/, controls: ['text', 'url'] },
  {
    kind: 'link.portfolio',
    label: /\b(portfolio|personal (web ?)?site|website|personal url|blog)\b/,
    name: /\b(portfolio|website)\b/,
    controls: ['text', 'url'],
  },
  {
    kind: 'not-stored',
    label: /\b(street|address line|mailing address|home address)\b|^address( 1| line 1)?$/,
  },
  // Work experience entries.
  {
    kind: 'experience.current',
    label: /\b(current(ly)?|present|still)\b.*\b(work|role|job|employ)|i (currently )?work here/,
    controls: ['checkbox'],
    section: 'experience',
  },
  {
    kind: 'experience.description',
    label: /\b(description|responsibilit|duties|achievements|summary|role description)/,
    controls: ['textarea', 'text'],
    section: 'experience',
  },
  {
    kind: 'experience.title',
    label: /\b(job )?title\b|\bposition\b|\brole\b/,
    controls: TEXTUAL,
    section: 'experience',
  },
  {
    kind: 'experience.employer',
    label: /\b(company|employer|organi[sz]ation)\b/,
    controls: CHOICE_OR_TEXT,
    section: 'experience',
  },
  {
    kind: 'experience.location',
    label: /\b(location|city)\b/,
    controls: CHOICE_OR_TEXT,
    section: 'experience',
  },
  {
    kind: 'experience.start',
    label: /\b(start|from|began|begin)\b/,
    controls: DATE_CONTROLS,
    section: 'experience',
  },
  {
    kind: 'experience.end',
    label: /\b(end|to|until|finish(ed)?)\b/,
    controls: DATE_CONTROLS,
    section: 'experience',
  },
  // Education entries; the distinctive labels also count outside a section.
  {
    kind: 'education.school',
    label: /\b(school|university|college|institution)\b/,
    controls: CHOICE_OR_TEXT,
    section: 'any',
  },
  {
    kind: 'education.degree',
    label: /\b(degree|level of education|highest education|diploma|qualification)\b/,
    controls: CHOICE_OR_TEXT,
    section: 'any',
  },
  {
    kind: 'education.field',
    label: /\b(major|field of study|discipline|area of study|concentration|program of study)\b/,
    controls: CHOICE_OR_TEXT,
    section: 'any',
  },
  {
    kind: 'education.gpa',
    label: /\b(c?gpa|grade point)\b/,
    controls: ['text', 'number', 'select'],
    section: 'any',
  },
  {
    kind: 'education.end',
    label: /\b(graduation|expected graduation|graduated|completion)\b/,
    controls: DATE_CONTROLS,
    section: 'any',
  },
  {
    kind: 'education.start',
    label: /\b(start|from|began|begin)\b/,
    controls: DATE_CONTROLS,
    section: 'education',
  },
  {
    kind: 'education.end',
    label: /\b(end|to|until)\b/,
    controls: DATE_CONTROLS,
    section: 'education',
  },
  // Location and the current job, outside repeated sections.
  {
    kind: 'location.postal',
    label: /\b(zip|postal|post) ?code\b|^zip$/,
    name: /\b(zip|postal)\b/,
    controls: ['text', 'number'],
  },
  {
    kind: 'location.country',
    label: /^country\b(?!.*\b(phone|code)\b)|country of residence|country region/,
    controls: CHOICE_OR_TEXT,
  },
  {
    kind: 'location.state',
    label: /^(state|province|region)\b|state province/,
    controls: CHOICE_OR_TEXT,
  },
  {
    kind: 'location.full',
    label:
      /^(current )?location( city( and)?( state)?( country)?)?$|^city (and|&)? ?state|^where are you (currently )?(located|based)|^your location/,
    name: /^location$/,
    controls: CHOICE_OR_TEXT,
  },
  { kind: 'location.city', label: /^(city|town)\b/, name: /\bcity\b/, controls: CHOICE_OR_TEXT },
  {
    kind: 'current.employer',
    label: /^(current )?(company|employer)( name)?$|^current (company|employer)|^organi[sz]ation$/,
    name: /^(org|current company)$/,
    controls: CHOICE_OR_TEXT,
    section: null,
  },
  {
    kind: 'current.title',
    label: /^(current )?(job )?title$|^current (position|role|job title)/,
    controls: TEXTUAL,
    section: null,
  },
  // Profile text.
  {
    kind: 'skills',
    label: /^(technical |key |relevant )?skills\b|list (your|any) skills/,
    controls: TEXTUAL,
  },
  {
    kind: 'certifications',
    label: /\b(certifications?|licen[cs]es (and|&) certifications?)\b/,
    controls: TEXTUAL,
  },
  {
    kind: 'summary',
    label:
      /^(professional )?summary$|^about (me|you|yourself)$|^bio$|^introduce yourself|^tell us about yourself/,
    controls: ['textarea', 'text'],
  },
  // Documents.
  {
    kind: 'document.resume',
    label: /\b(resume|résumé|cv|curriculum)\b/,
    name: /\b(resume|cv)\b/,
    controls: ['file'],
  },
  { kind: 'document.cover-letter-file', label: /\bcover\b/, name: /\bcover\b/, controls: ['file'] },
  {
    kind: 'document.cover-letter-text',
    label: /\bcover letter\b/,
    name: /\bcover letter\b/,
    controls: ['textarea'],
  },
  { kind: 'document.resume-text', label: /\b(resume|cv)\b/, controls: ['textarea'] },
];

const EXPERIENCE = /\b(experience|employment|work history|job history|employer|positions? held)\b/;
const EDUCATION = /\b(education|school|university|academic|degree)\b/;

function sectionOf(field: DetectedField): Section {
  const section = normalize(field.section);
  const name = field.name;
  if (EXPERIENCE.test(section) || /\b(experience|employment|work history)\b/.test(name)) {
    return 'experience';
  }
  if (EDUCATION.test(section) || /\b(education|school)\b/.test(name)) return 'education';
  return null;
}

const MONTH_NAMES = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function datePart(field: DetectedField): DatePart {
  if (field.control === 'date' || field.control === 'month') return 'full';
  const words = `${normalize(field.label)} ${field.name} ${normalize(field.hint)}`;
  const month = /\bmonth\b|\bmm\b/.test(words);
  const year = /\b(year|yyyy)\b/.test(words);
  if (month && !year) return 'month';
  if (year && !month) return 'year';
  if (field.options.length > 0) {
    if (field.options.filter((o) => MONTH_NAMES.test(o.label)).length >= 6) return 'month';
    if (field.options.every((o) => /^\d{4}$/.test(o.label.trim()))) return 'year';
  }
  return 'full';
}

/** A label written as a question rather than a field name. */
export function isQuestionLike(label: string): boolean {
  return (
    /\?\s*$/.test(label) ||
    /^(why|what|how|describe|tell|explain|share|please (describe|explain|tell|share)|give an example|in your own words)\b/i.test(
      label,
    ) ||
    label.split(/\s+/).length > 10
  );
}

function result(
  kind: FieldKind,
  confidence: Classification['confidence'],
  reason: string,
  field: DetectedField,
  topic = '',
): Classification {
  const isDate = kind.endsWith('.start') || kind.endsWith('.end');
  return {
    kind,
    confidence,
    reason,
    topic,
    datePart: isDate ? datePart(field) : null,
    source: 'rules',
  };
}

export function classifyField(field: DetectedField): Classification {
  const label = normalize(field.label);
  // Help text is left out unless there is no label: "you consent to texts" under a phone field
  // must not turn the phone field into an attestation.
  const words = field.label || field.hint;
  const choiceText =
    ['select', 'radio-group', 'checkbox-group', 'listbox-button'].includes(field.control) &&
    field.options.length <= 12
      ? field.options.map((o) => o.label).join(' ')
      : '';

  // 1. Sensitive questions first: nothing else may claim them.
  const screening = classifyQuestion(`${words} ${choiceText}`);
  if (
    screening.category === 'sensitive' ||
    /\b(social security|ssn|date of birth|birth ?date)\b/i.test(words)
  ) {
    return result(
      'manual.sensitive',
      'high',
      'question topic',
      field,
      screening.topic || 'personal identification',
    );
  }

  // 2. The page's own autocomplete hint.
  for (const token of field.autocomplete.split(/\s+/)) {
    const kind = AUTOCOMPLETE[token];
    if (kind) return result(kind, 'high', `autocomplete=${token}`, field);
  }
  if (/\bbday\b|\bsex\b/.test(field.autocomplete)) {
    return result('manual.sensitive', 'high', 'autocomplete', field, 'personal identification');
  }

  // 3. Profile fields by label, then by name. Long question-style labels are not field names.
  const section = sectionOf(field);
  const questionLike = isQuestionLike(field.label);
  if (/\byears? of (professional |relevant |work )?experience\b/.test(label)) {
    return result('manual.personal', 'high', 'label', field, 'years of experience');
  }
  for (const rule of RULES) {
    if (rule.controls && !rule.controls.includes(field.control)) continue;
    if (rule.section !== undefined && rule.section !== 'any' && rule.section !== section) continue;
    const byLabel =
      rule.label &&
      label.length > 0 &&
      (!questionLike || rule.kind === 'summary') &&
      rule.label.test(label);
    if (byLabel) {
      const confidence = rule.kind === 'summary' && questionLike ? 'medium' : 'high';
      return result(rule.kind, confidence, 'label', field);
    }
    const byName = rule.name && (label.length === 0 || !questionLike) && rule.name.test(field.name);
    if (byName && (label.length === 0 || !RULES.some((r) => r.label?.test(label)))) {
      return result(rule.kind, 'medium', 'field name', field);
    }
  }

  // 4. Facts only the user knows.
  if (screening.category === 'personal') {
    return result('manual.personal', 'high', 'question topic', field, screening.topic);
  }

  // 5. Open questions ApplyPilot may draft.
  if (field.control === 'textarea' || (field.control === 'text' && questionLike)) {
    if (label.length > 0) return result('question', 'medium', 'open question', field);
  }

  return result('unknown', 'low', 'not recognised', field);
}

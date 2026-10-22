import type {
  DetectedField,
  FillAction,
  FillInstruction,
  FormScan,
  ProfileContent,
} from '@applypilot/shared';
import { classifyField, type Classification, type DatePart, type FieldKind } from './classify';
import { MONTHS, US_STATES, degreeLevel, matchOption } from './options';
import { clean, normalize } from './text';

/**
 * Turns a scan into proposed answers. Every value comes from the user's saved
 * profile, their uploaded resume, a draft they generated, or what they type in
 * the review; nothing is guessed. Each proposal says where its value came from
 * and whether it is ready, needs a look, or is the user's to answer.
 */

export type ProposalStatus =
  /** A profile value for a recognised field; selected for filling by default. */
  | 'ready'
  /** A value exists but should be checked first (looser match, AI mapping, replaces page text). */
  | 'review'
  /** A recognised field the profile has no value for. */
  | 'missing'
  /** Sensitive or personal: the user answers it on the page. */
  | 'manual'
  /** An open question; empty until drafted or typed. */
  | 'question'
  /** Not recognised; the user may type a value. */
  | 'unknown'
  /** A control ApplyPilot cannot fill (for example a cover letter file). */
  | 'unsupported'
  /** The page already shows this value. */
  | 'done';

export type ProposedValue =
  | { type: 'text'; text: string }
  | { type: 'choose'; value: string; label: string }
  | { type: 'choose-many'; values: string[]; labels: string[] }
  | { type: 'check'; checked: boolean }
  | { type: 'file'; resumeId: string; fileName: string };

export interface Proposal {
  field: DetectedField;
  classification: Classification;
  status: ProposalStatus;
  value: ProposedValue | null;
  /** Where the value comes from, shown next to it ("Profile · Email"). */
  source: string;
  /** One sentence the user may need: why it needs review, what is missing. */
  note: string;
  /** Selected for filling by default. Only 'ready' proposals start selected. */
  approved: boolean;
}

export interface ResumeFileInfo {
  id: string;
  fileName: string;
  /** Text extracted from the file, for "paste your resume" boxes. */
  text: string;
}

export interface ProposeContext {
  profile: ProfileContent;
  resume: ResumeFileInfo | null;
  /** The saved cover letter draft for this job, if the user made one. */
  coverLetter: string | null;
  /** Answers drafted with AI Tailor (or typed), keyed by field ref. */
  answers?: Readonly<Record<string, { text: string; source: string }>>;
  /** Classifications suggested by AI for fields the rules left unknown. */
  aiClassifications?: Readonly<Record<string, Classification>>;
}

interface Found {
  /** Candidate texts, best first; choice controls try each against their options. */
  texts: string[];
  source: string;
  /** Lowers the status to 'review' and explains why. */
  caution?: string;
}

type Missing = { missing: string };
type Lookup = Found | Missing | { unsupported: string };

function isFound(l: Lookup): l is Found {
  return 'texts' in l;
}

// ---- Profile values ----------------------------------------------------------

function splitName(full: string): { first: string; last: string; middle: boolean } {
  const parts = clean(full).split(' ').filter(Boolean);
  return {
    first: parts[0] ?? '',
    last: parts.length > 1 ? (parts.at(-1) ?? '') : '',
    middle: parts.length > 2,
  };
}

interface Place {
  city: string;
  state: string;
  stateName: string;
  country: string;
  postal: string;
  countryInferred: boolean;
}

/** "Springfield, VA 22150", "Toronto, ON, Canada", "Austin, Texas". */
export function parseLocation(location: string): Place | null {
  const parts = clean(location)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const postal = /\b(\d{5})(?:-\d{4})?\b/.exec(location)?.[1] ?? '';
  const city = parts[0] ?? '';
  const stateRaw = (parts[1] ?? '').replace(/\b\d{5}(?:-\d{4})?\b/, '').trim();
  const abbr = Object.entries(US_STATES).find(
    ([a, name]) =>
      a.toLowerCase() === stateRaw.toLowerCase() || name.toLowerCase() === stateRaw.toLowerCase(),
  );
  const country = parts[2] ?? '';
  return {
    city,
    state: abbr ? abbr[0] : stateRaw,
    stateName: abbr ? abbr[1] : stateRaw,
    country: country || (abbr ? 'United States' : ''),
    postal,
    countryInferred: !country && abbr !== undefined,
  };
}

const CHOICE_CONTROLS: readonly string[] = ['select', 'radio-group', 'listbox-button', 'combobox'];

function dateTexts(date: string, part: DatePart, field: DetectedField): Found | Missing {
  const [year, month] = date.split('-');
  if (!year) return { missing: 'This date is not in your profile.' };
  const monthIndex = month ? Number(month) : null;
  if (part === 'year') return { texts: [year], source: '' };
  if (part === 'month') {
    if (!monthIndex) return { missing: 'Your profile has the year only, not the month.' };
    const name = MONTHS[monthIndex - 1] ?? '';
    const mm = String(monthIndex).padStart(2, '0');
    // Dropdowns try each spelling against their options; a text box gets "06".
    return CHOICE_CONTROLS.includes(field.control)
      ? { texts: [name, name.slice(0, 3), String(monthIndex), mm], source: '' }
      : { texts: [mm], source: '' };
  }
  if (field.control === 'month') {
    return monthIndex
      ? { texts: [`${year}-${month}`], source: '' }
      : { missing: 'Your profile has the year only; this field needs a month.' };
  }
  if (field.control === 'date') {
    return {
      texts: [`${year}-${month ?? '01'}-01`],
      source: '',
      caution: 'Your profile has no day, so the 1st is used. Check it.',
    };
  }
  const hint = normalize(`${field.hint} ${field.label}`);
  const mm = month ?? '';
  if (/mm dd yyyy/.test(hint)) {
    return monthIndex
      ? {
          texts: [`${mm}/01/${year}`],
          source: '',
          caution: 'Your profile has no day, so the 1st is used. Check it.',
        }
      : { missing: 'Your profile has the year only; this field needs a full date.' };
  }
  if (/yyyy mm/.test(hint)) return { texts: [monthIndex ? `${year}-${mm}` : year], source: '' };
  return { texts: [monthIndex ? `${mm}/${year}` : year], source: '' };
}

function entryIndex(field: DetectedField, ordinal: number): number {
  return field.repeatIndex ?? ordinal;
}

function lookup(
  kind: FieldKind,
  field: DetectedField,
  classification: Classification,
  ordinal: number,
  context: ProposeContext,
): Lookup {
  const { profile } = context;
  const p = profile.personal;
  const place = parseLocation(p.location);
  const text = (value: string, source: string, caution?: string): Found | Missing =>
    value.trim()
      ? { texts: [value.trim()], source, ...(caution ? { caution } : {}) }
      : { missing: `Not in your profile. Add it under Profile, or type it here.` };

  switch (kind) {
    case 'name.full':
      return text(p.fullName, 'Profile · Name');
    case 'name.first': {
      const { first, middle } = splitName(p.fullName);
      return text(
        first,
        'Profile · Name',
        middle ? 'Taken from your full name. Check it.' : undefined,
      );
    }
    case 'name.last': {
      const { last, middle } = splitName(p.fullName);
      return text(
        last,
        'Profile · Name',
        middle ? 'Taken from your full name. Check it.' : undefined,
      );
    }
    case 'email':
      return text(p.email, 'Profile · Email');
    case 'phone':
      return text(p.phone, 'Profile · Phone');
    case 'location.full': {
      // Typeaheads list places as "City, ST" or "City, State"; offer those spellings too.
      const found = text(p.location, 'Profile · Location');
      if (!isFound(found) || !place?.city || !place.state) return found;
      const short = [`${place.city}, ${place.state}`, `${place.city}, ${place.stateName}`];
      // A "City, State" box gets just that; anything else gets the whole location first.
      const cityState =
        /\bcity\b/.test(normalize(field.label)) && !/\b(zip|postal)\b/.test(normalize(field.label));
      const texts = cityState ? [...short, ...found.texts] : [...found.texts, ...short];
      return { ...found, texts: [...new Set(texts)] };
    }
    case 'location.city':
      return text(place?.city ?? '', 'Profile · Location');
    case 'location.state':
      return place?.state
        ? { texts: [place.state, place.stateName], source: 'Profile · Location' }
        : { missing: 'Your profile location has no state or region.' };
    case 'location.country':
      return place?.country
        ? {
            texts: [place.country],
            source: 'Profile · Location',
            ...(place.countryInferred
              ? { caution: 'Inferred from the US state in your location.' }
              : {}),
          }
        : { missing: 'Your profile location has no country.' };
    case 'location.postal':
      return text(place?.postal ?? '', 'Profile · Location');
    case 'link.linkedin':
      return text(p.linkedinUrl, 'Profile · LinkedIn');
    case 'link.github':
      return text(p.githubUrl, 'Profile · GitHub');
    case 'link.portfolio':
      return text(p.portfolioUrl, 'Profile · Portfolio');
    case 'current.employer':
    case 'current.title': {
      const current = profile.experience.find((e) => e.current);
      if (!current)
        return { missing: 'Your profile has no current job. Leave it blank or type one.' };
      return kind === 'current.employer'
        ? text(current.employer, 'Profile · Current job')
        : text(current.position, 'Profile · Current job');
    }
    case 'experience.employer':
    case 'experience.title':
    case 'experience.location':
    case 'experience.start':
    case 'experience.end':
    case 'experience.current':
    case 'experience.description': {
      const index = entryIndex(field, ordinal);
      const entry = profile.experience[index];
      if (!entry) {
        return {
          missing: `Your profile has ${profile.experience.length} job${profile.experience.length === 1 ? '' : 's'}; this is job ${index + 1}.`,
        };
      }
      const source = `Profile · ${entry.position || entry.employer || `Job ${index + 1}`}`;
      if (kind === 'experience.employer') return text(entry.employer, source);
      if (kind === 'experience.title') return text(entry.position, source);
      if (kind === 'experience.location') return text(entry.location, source);
      if (kind === 'experience.current') return { texts: [entry.current ? 'yes' : 'no'], source };
      if (kind === 'experience.description') {
        return text(entry.bullets.map((b) => `- ${b}`).join('\n'), source);
      }
      if (kind === 'experience.end' && entry.current) {
        return {
          missing: 'You work here now. Leave the end date empty, or tick "currently work here".',
        };
      }
      const date = kind === 'experience.start' ? entry.startDate : entry.endDate;
      const found = dateTexts(date, classification.datePart ?? 'full', field);
      return isFound(found) ? { ...found, source } : found;
    }
    case 'education.school':
    case 'education.degree':
    case 'education.field':
    case 'education.gpa':
    case 'education.start':
    case 'education.end': {
      const index = entryIndex(field, ordinal);
      const entry = profile.education[index];
      if (!entry) {
        return {
          missing: `Your profile has ${profile.education.length} education entr${profile.education.length === 1 ? 'y' : 'ies'}; this is entry ${index + 1}.`,
        };
      }
      const source = `Profile · ${entry.institution || entry.degree}`;
      if (kind === 'education.school') return text(entry.institution, source);
      if (kind === 'education.degree') {
        const level = degreeLevel(entry.degree);
        const levelName: Record<string, string> = {
          bachelor: "Bachelor's Degree",
          master: "Master's Degree",
          doctorate: 'Doctorate',
          associate: "Associate's Degree",
          'high school': 'High School',
        };
        return entry.degree
          ? { texts: [entry.degree, ...(level ? [levelName[level] ?? level] : [])], source }
          : { missing: 'This education entry has no degree.' };
      }
      if (kind === 'education.field') return text(entry.field, source);
      if (kind === 'education.gpa') return text(entry.gpa, source);
      const date = kind === 'education.start' ? entry.startDate : entry.endDate;
      const found = dateTexts(date, classification.datePart ?? 'full', field);
      return isFound(found)
        ? {
            ...found,
            source,
            ...(entry.current && kind === 'education.end' && !found.caution
              ? { caution: 'Expected graduation date.' }
              : {}),
          }
        : found;
    }
    case 'skills':
      return text(profile.skills.map((s) => s.name).join(', '), 'Profile · Skills');
    case 'certifications':
      return text(
        profile.certifications
          .map((c) =>
            [c.name, [c.issuer, c.date.slice(0, 4)].filter(Boolean).join(', ')]
              .filter(Boolean)
              .join(' – '),
          )
          .join('; '),
        'Profile · Certifications',
      );
    case 'summary':
      return text(
        profile.summary,
        'Profile · Summary',
        classification.confidence === 'high'
          ? undefined
          : 'Your profile summary, for an open question. Check that it answers it.',
      );
    case 'document.resume':
      return context.resume
        ? { texts: [context.resume.fileName], source: 'Resume file' }
        : { missing: 'Upload your resume under Profile first, or attach it on the page.' };
    case 'document.resume-text':
      return context.resume?.text
        ? {
            texts: [context.resume.text],
            source: 'Resume text',
            caution: 'The text extracted from your resume file. Check the layout.',
          }
        : { missing: 'Upload your resume under Profile first.' };
    case 'document.cover-letter-text':
      return context.coverLetter
        ? {
            texts: [context.coverLetter],
            source: 'AI Tailor cover letter',
            caution: 'Your saved cover letter draft. Review it before you send.',
          }
        : { missing: 'Draft a cover letter in AI Tailor first, or write one here.' };
    case 'document.cover-letter-file':
      return { unsupported: 'Attach a cover letter file on the page yourself.' };
    default:
      return { missing: '' };
  }
}

// ---- Choosing a value for the control ------------------------------------------

function toValue(
  field: DetectedField,
  kind: FieldKind,
  found: Found,
): { value: ProposedValue; loose: boolean } | null {
  switch (field.control) {
    case 'checkbox': {
      const yes = found.texts[0] === 'yes';
      return { value: { type: 'check', checked: yes }, loose: false };
    }
    case 'select':
    case 'radio-group':
    case 'listbox-button':
    case 'combobox': {
      if (field.options.length === 0) {
        // Options load only when the list opens: the fill step types and picks the match.
        return field.control === 'combobox' || field.control === 'listbox-button'
          ? {
              value: {
                type: 'choose',
                value: found.texts[0] ?? '',
                label: found.texts[1] ?? found.texts[0] ?? '',
              },
              loose: true,
            }
          : null;
      }
      const match = matchOption(field.options, found.texts);
      if (!match) return null;
      return {
        value: { type: 'choose', value: match.option.value, label: match.option.label },
        loose: !match.exact,
      };
    }
    case 'checkbox-group': {
      if (kind !== 'skills') return null;
      const chosen = field.options.filter(
        (o) => matchOption([o], found.texts[0]?.split(', ') ?? [])?.exact,
      );
      return chosen.length > 0
        ? {
            value: {
              type: 'choose-many',
              values: chosen.map((o) => o.value),
              labels: chosen.map((o) => o.label),
            },
            loose: true,
          }
        : null;
    }
    case 'file':
      return null;
    default: {
      let text = found.texts[0] ?? '';
      if (field.maxLength && text.length > field.maxLength) return null;
      if (field.control === 'number') text = text.replace(/[^\d.]/g, '');
      return { value: { type: 'text', text }, loose: false };
    }
  }
}

function sameAsPage(field: DetectedField, value: ProposedValue): boolean {
  const current = normalize(field.currentValue);
  if (!current) return false;
  switch (value.type) {
    case 'text':
      return current === normalize(value.text);
    case 'choose':
      return current === normalize(value.label) || current === normalize(value.value);
    case 'check':
      return (field.currentValue === 'checked') === value.checked;
    default:
      return false;
  }
}

/** Whether the page shows something the user typed (not a placeholder like "Select One"). */
function pageHasValue(field: DetectedField): boolean {
  if (!field.currentValue) return false;
  if (field.control === 'listbox-button' || field.control === 'select') {
    return !/^(select|choose|please select|--)/i.test(field.currentValue);
  }
  return field.control !== 'checkbox' || field.currentValue === 'checked';
}

function describeManual(c: Classification): string {
  return c.kind === 'manual.sensitive'
    ? `This asks about ${c.topic}. Answer it yourself on the page; ApplyPilot never fills it.`
    : `This asks about ${c.topic}, which only you know. Answer it yourself on the page.`;
}

export function proposeField(
  field: DetectedField,
  ordinal: number,
  context: ProposeContext,
  classification: Classification = classifyField(field),
): Proposal {
  const base = { field, classification, value: null, source: '', approved: false };
  const { kind } = classification;

  if (kind === 'manual.sensitive' || kind === 'manual.personal') {
    return { ...base, status: 'manual', note: describeManual(classification) };
  }
  const answer = context.answers?.[field.ref];
  if (answer && answer.text.trim()) {
    const value = toValue(field, kind, { texts: [answer.text], source: answer.source });
    if (value) {
      return {
        ...base,
        status: 'review',
        value: value.value,
        source: answer.source,
        note: 'Review this answer before you fill it.',
      };
    }
  }
  if (kind === 'question') {
    return {
      ...base,
      status: 'question',
      note: 'An open question. Draft it with AI Tailor below, or type your answer.',
    };
  }
  if (kind === 'unknown') {
    return {
      ...base,
      status: 'unknown',
      note: 'Not recognised. Type a value to fill it, or answer it on the page.',
    };
  }
  if (kind === 'not-stored') {
    return {
      ...base,
      status: 'missing',
      note: 'ApplyPilot does not store this. Type it here or on the page.',
    };
  }
  if (field.control === 'file' && kind !== 'document.resume') {
    return { ...base, status: 'unsupported', note: 'Attach this file on the page yourself.' };
  }

  const found = lookup(kind, field, classification, ordinal, context);
  if ('unsupported' in found) return { ...base, status: 'unsupported', note: found.unsupported };
  if (!isFound(found))
    return { ...base, status: 'missing', note: found.missing || 'Not in your profile.' };

  if (kind === 'document.resume') {
    const resume = context.resume;
    if (!resume)
      return { ...base, status: 'missing', note: 'Upload your resume under Profile first.' };
    return {
      ...base,
      status: 'ready',
      value: { type: 'file', resumeId: resume.id, fileName: resume.fileName },
      source: 'Resume file',
      note: 'Your uploaded resume file is attached as is.',
      approved: !pageHasValue(field),
    };
  }

  const chosen = toValue(field, kind, found);
  if (!chosen) {
    return {
      ...base,
      status: 'review',
      source: found.source,
      note:
        field.options.length > 0
          ? `Your profile says "${found.texts[0] ?? ''}", but no option clearly matches. Pick one yourself.`
          : `Your profile value does not fit this field.`,
    };
  }
  if (sameAsPage(field, chosen.value)) {
    return {
      ...base,
      status: 'done',
      value: chosen.value,
      source: found.source,
      note: 'The page already shows this value.',
    };
  }
  const replacing = pageHasValue(field);
  const cautions = [
    found.caution,
    chosen.loose ? 'Closest matching option; check it.' : undefined,
    classification.source === 'ai' ? 'AI suggested what this field asks for; check it.' : undefined,
    classification.confidence === 'low' ? 'Low confidence match.' : undefined,
    replacing
      ? `The page already shows "${field.currentValue.slice(0, 60)}"; filling replaces it.`
      : undefined,
  ].filter(Boolean);
  const review = cautions.length > 0 || classification.confidence !== 'high';
  return {
    ...base,
    status: review ? 'review' : 'ready',
    value: chosen.value,
    source: found.source,
    note: cautions.join(' '),
    approved: !review,
  };
}

/** Kinds that refer to one repeated entry (job 1, school 2) and need an index. */
const REPEATED: readonly string[] = ['experience.', 'education.'];

export function proposeAnswers(scan: FormScan, context: ProposeContext): Proposal[] {
  const seen = new Map<string, number>();
  return scan.fields.map((field) => {
    const rules = classifyField(field);
    const suggested = rules.kind === 'unknown' ? context.aiClassifications?.[field.ref] : undefined;
    const classification = suggested ?? rules;
    // Without a repeated block, the n-th "Company" field is job n.
    const key = `${classification.kind}|${classification.datePart ?? ''}`;
    const ordinal = REPEATED.some((p) => classification.kind.startsWith(p))
      ? (seen.get(key) ?? 0)
      : 0;
    seen.set(key, ordinal + 1);
    return proposeField(field, ordinal, context, classification);
  });
}

// ---- To the page ----------------------------------------------------------------

export function toFillAction(
  value: ProposedValue,
  file?: { mimeType: string; base64: string },
): FillAction | null {
  switch (value.type) {
    case 'text':
      return { type: 'text', value: value.text };
    case 'choose':
      return { type: 'choose', value: value.value, label: value.label };
    case 'choose-many':
      return { type: 'choose-many', values: value.values };
    case 'check':
      return { type: 'check', checked: value.checked };
    case 'file':
      return file
        ? { type: 'file', fileName: value.fileName, mimeType: file.mimeType, base64: file.base64 }
        : null;
  }
}

export function toInstruction(field: DetectedField, action: FillAction): FillInstruction {
  return { ref: field.ref, control: field.control, label: field.label, action };
}

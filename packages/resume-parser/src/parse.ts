import {
  certificationSchema,
  educationSchema,
  emptyProfileContent,
  experienceSchema,
  findSkills,
  lookupSkill,
  newId,
  normalizeSkillName,
  parsedResumeSchema,
  personalInfoSchema,
  projectSchema,
  skillSchema,
  type Certification,
  type Education,
  type Experience,
  type ParsedResume,
  type PersonalInfo,
  type Project,
  type Skill,
  type SkillCategory,
} from '@applypilot/shared';
import { findDateRange, hasDateRange } from './dates';
import {
  classifyHeading,
  findEmail,
  findPhone,
  findUrls,
  headingLabel,
  looksLikeLocation,
  looksLikeName,
  splitPieces,
  toLines,
  type Line,
  type SectionKind,
} from './lines';

/**
 * Deterministic resume parsing: plain text in, a reviewable profile draft out.
 *
 * The parser only copies what the document says. It never invents employers,
 * dates or skills, and anything it is unsure about becomes a warning the user
 * sees during review. Nothing is saved until the user confirms.
 */

export interface ParseOptions {
  /** Id generator; injectable so tests are deterministic. */
  newId?: () => string;
}

interface Section {
  kind: SectionKind | 'header';
  label: string;
  lines: Line[];
}

function splitSections(lines: readonly Line[]): Section[] {
  const sections: Section[] = [{ kind: 'header', label: '', lines: [] }];
  for (const line of lines) {
    const kind = classifyHeading(line);
    if (kind) {
      sections.push({ kind, label: headingLabel(line), lines: [] });
    } else {
      sections.at(-1)?.lines.push(line);
    }
  }
  return sections;
}

const clip = (value: string, max: number) =>
  value.length > max ? value.slice(0, max).trim() : value;

function titleCaseIfShouting(value: string): string {
  if (value !== value.toUpperCase() || !/[A-Z]/.test(value)) return value;
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, lead: string, char: string) => lead + char.toUpperCase());
}

// ---------------------------------------------------------------- header

function parsePersonal(
  header: readonly Line[],
  allText: string,
): { personal: PersonalInfo; warnings: string[] } {
  const warnings: string[] = [];
  const headerText = header.map((line) => line.text).join('\n');
  const contactSource = headerText.length > 0 ? headerText : allText;

  const email = findEmail(contactSource) || findEmail(allText);
  const phone = findPhone(contactSource);
  const urls = findUrls(contactSource);
  const linkedinUrl = urls.find((url) => /linkedin\.com/i.test(url)) ?? '';
  const githubUrl = urls.find((url) => /github\.com/i.test(url)) ?? '';
  const portfolioUrl = urls.find((url) => url !== linkedinUrl && url !== githubUrl) ?? '';

  let fullName = '';
  let location = '';
  for (const line of header.slice(0, 6)) {
    for (const piece of splitPieces(line.text)) {
      if (!fullName && looksLikeName(piece) && !looksLikeLocation(piece))
        fullName = titleCaseIfShouting(piece);
      else if (!location && looksLikeLocation(piece)) location = piece;
    }
  }
  if (!fullName) warnings.push('Could not find your name at the top of the resume. Please add it.');

  const candidate = {
    fullName: clip(fullName, 120),
    email,
    phone: clip(phone, 40),
    location: clip(location, 120),
    portfolioUrl,
    linkedinUrl,
    githubUrl,
  };
  const parsed = personalInfoSchema.safeParse(candidate);
  if (parsed.success) return { personal: parsed.data, warnings };
  // Drop only the fields that failed validation.
  const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
  for (const key of bad) {
    (candidate as Record<string, string>)[key] = '';
    warnings.push(
      `Ignored an unreadable ${key === 'email' ? 'email address' : key.replace(/Url$/, ' link')}.`,
    );
  }
  return { personal: personalInfoSchema.parse(candidate), warnings };
}

// ---------------------------------------------------------------- blocks

interface Block {
  header: string[];
  bullets: string[];
}

/**
 * Groups a section into entries: one or more header lines followed by bullet
 * points. A non-bullet line after bullets starts a new entry, as does a second
 * date range in the header.
 */
function toBlocks(lines: readonly Line[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of lines) {
    const previousBullet = current?.bullets.at(-1);
    // A line that starts in lower case right after a bullet is that bullet wrapping.
    const continuesBullet =
      !line.bullet && previousBullet !== undefined && /^[a-z(]/.test(line.text);
    // Long sentences without a bullet glyph are still bullets in many PDFs.
    const isBullet =
      line.bullet ||
      continuesBullet ||
      (current !== null &&
        current.header.length > 0 &&
        line.text.length > 90 &&
        !hasDateRange(line.text));
    if (isBullet) {
      if (!current) {
        current = { header: [], bullets: [] };
        blocks.push(current);
      }
      if (continuesBullet) {
        current.bullets[current.bullets.length - 1] = `${previousBullet} ${line.text}`;
      } else {
        current.bullets.push(line.text);
      }
      continue;
    }
    const startsNew =
      !current ||
      current.bullets.length > 0 ||
      (hasDateRange(line.text) && current.header.some((text) => hasDateRange(text))) ||
      current.header.length >= 4;
    if (startsNew) {
      current = { header: [], bullets: [] };
      blocks.push(current);
    }
    current?.header.push(line.text);
  }
  return blocks;
}

interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function validItems<T>(
  schema: SafeParser<T>,
  candidates: readonly unknown[],
  label: string,
  warnings: string[],
): T[] {
  const items: T[] = [];
  for (const candidate of candidates) {
    const result = schema.safeParse(candidate);
    if (result.success) items.push(result.data);
    else warnings.push(`Skipped a ${label} entry that could not be read clearly.`);
  }
  return items;
}

// ---------------------------------------------------------------- education

const INSTITUTION =
  /\b(university|college|institute|school|academy|polytechnic|universit[éeà]|cegep|conservatory)\b/i;
const DEGREE =
  /\b(bachelor'?s?|master'?s?|associate'?s?|doctor(?:ate)?|ph\.?\s?d\.?|diploma|certificate|b\.?\s?sc?\.?|m\.?\s?sc?\.?|b\.?\s?a\.?|m\.?\s?a\.?|b\.?\s?eng\.?|m\.?\s?eng\.?|mba|b\.?\s?tech|m\.?\s?tech|bba|high school diploma|ged)(?![a-z])/i;
const GPA =
  /\b(?:c?gpa|grade point average)\s*[:-]?\s*(\d(?:\.\d{1,2})?(?:\s*\/\s*\d(?:\.\d{1,2})?)?)/i;
const COURSEWORK = /^(?:relevant |selected |key )?(?:coursework|courses)\s*[:-]\s*(.+)$/i;

function splitDegree(text: string): { degree: string; field: string } {
  const ofScience =
    /^((?:bachelor|master|doctor|associate)'?s?\s+of\s+(?:applied\s+)?(?:science|arts|engineering|technology|business administration|computer science|commerce|education|fine arts|philosophy))(?:\s*(?:,|\bin\b|-|–)\s*(.+))?$/i.exec(
      text,
    );
  if (ofScience?.[1]) return { degree: ofScience[1].trim(), field: (ofScience[2] ?? '').trim() };
  const inField = /^(.+?)\s+in\s+(.+)$/i.exec(text);
  if (inField?.[1] && inField[2]) return { degree: inField[1].trim(), field: inField[2].trim() };
  const comma = /^([^,]+),\s*(.+)$/.exec(text);
  if (comma?.[1] && comma[2] && DEGREE.test(comma[1]))
    return { degree: comma[1].trim(), field: comma[2].trim() };
  const abbreviated = /^((?:b|m)\.?\s?(?:sc?|a|eng|tech)\.?|ph\.?\s?d\.?|mba|bba)\s+(.+)$/i.exec(
    text,
  );
  if (abbreviated?.[1] && abbreviated[2])
    return { degree: abbreviated[1].trim(), field: abbreviated[2].trim() };
  return { degree: text.trim(), field: '' };
}

function parseEducation(lines: readonly Line[], id: () => string, warnings: string[]): Education[] {
  const entries: Array<Omit<Education, 'id'>> = [];
  let current: Omit<Education, 'id'> | null = null;
  const fresh = (): Omit<Education, 'id'> => ({
    institution: '',
    degree: '',
    field: '',
    startDate: '',
    endDate: '',
    current: false,
    gpa: '',
    coursework: [],
  });

  for (const line of lines) {
    const coursework = COURSEWORK.exec(line.text);
    if (coursework?.[1]) {
      current ??= fresh();
      if (!entries.includes(current)) entries.push(current);
      current.coursework.push(
        ...coursework[1]
          .split(/[,;•|]/)
          .map((course) => course.trim().replace(/\.$/, ''))
          .filter((course) => course.length > 0 && course.length <= 120),
      );
      continue;
    }

    let rest = line.text;
    const gpa = GPA.exec(rest);
    const dates = findDateRange(rest);
    if (dates) rest = rest.replace(dates.matched, ' ');
    if (gpa) rest = rest.replace(gpa[0], ' ');

    // "B.Sc. Computer Engineering, Simon Fraser University" puts both on one line.
    const pieces = splitPieces(rest.replace(/\(\s*\)/g, ' ')).flatMap((piece) =>
      INSTITUTION.test(piece) && DEGREE.test(piece) && piece.includes(',')
        ? piece.split(/,\s*/).filter(Boolean)
        : [piece],
    );
    const institutionPiece = pieces.find(
      (piece) => INSTITUTION.test(piece) && !DEGREE.test(piece.split(/\s+/)[0] ?? ''),
    );
    const degreePiece = pieces.find((piece) => piece !== institutionPiece && DEGREE.test(piece));

    const needsNew =
      !current ||
      (institutionPiece !== undefined && current.institution.length > 0) ||
      (degreePiece !== undefined &&
        current.degree.length > 0 &&
        institutionPiece === undefined &&
        current.institution.length > 0 &&
        entries.length > 0 &&
        current.coursework.length > 0);
    if (needsNew && (institutionPiece || degreePiece)) {
      current = fresh();
      entries.push(current);
    }
    if (!current) continue;

    if (institutionPiece && !current.institution)
      current.institution = clip(institutionPiece.replace(/,\s*$/, ''), 200);
    if (degreePiece && !current.degree) {
      const { degree, field } = splitDegree(degreePiece);
      current.degree = clip(degree, 200);
      current.field = clip(field, 200);
    }
    if (dates && !current.endDate && !current.startDate) {
      current.startDate = dates.startDate;
      current.endDate = dates.endDate;
      current.current = dates.current;
    }
    if (gpa?.[1] && !current.gpa) current.gpa = gpa[1].replace(/\s+/g, '');
  }

  const valid = validItems(
    educationSchema,
    entries.map((entry) => ({ ...entry, id: id(), coursework: entry.coursework.slice(0, 50) })),
    'education',
    warnings,
  );
  for (const entry of valid) {
    if (!entry.institution || !entry.degree) {
      warnings.push(
        `Check the education entry "${entry.institution || entry.degree}": part of it was not recognised.`,
      );
    }
  }
  return valid;
}

// ---------------------------------------------------------------- experience

const ROLE =
  /\b(intern(ship)?|engineer|developer|programmer|analyst|assistant|manager|specialist|technician|administrator|admin|consultant|associate|lead|architect|scientist|designer|coordinator|representative|tutor|teacher|teaching|researcher|research|officer|director|head|support|operator|agent|clerk|cashier|server|volunteer|co-?op|trainee|apprentice|fellow|president|founder|member|instructor|mentor|ambassador|sales|advisor|owner)\b/i;

interface HeaderParts {
  title: string;
  organization: string;
  location: string;
  startDate: Education['startDate'];
  endDate: Education['endDate'];
  current: boolean;
  extra: string[];
  ambiguous: boolean;
}

/** Splits an entry's header lines into role, organisation, location and dates. */
function parseHeader(header: readonly string[]): HeaderParts {
  const parts: HeaderParts = {
    title: '',
    organization: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    extra: [],
    ambiguous: false,
  };
  const pieces: string[] = [];
  for (const text of header) {
    let rest = text;
    const dates = findDateRange(rest);
    if (dates && !parts.startDate && !parts.endDate) {
      parts.startDate = dates.startDate;
      parts.endDate = dates.endDate;
      parts.current = dates.current;
      rest = rest.replace(dates.matched, ' ');
    }
    // "Engineer at Acme" and "Acme, Engineer" are both common.
    for (const piece of splitPieces(rest.replace(/\(\s*\)/g, ' '))) {
      const at = /^(.+?)\s+(?:at|@)\s+(.+)$/.exec(piece);
      if (at?.[1] && at[2] && ROLE.test(at[1])) pieces.push(at[1], at[2]);
      else pieces.push(piece);
    }
  }

  const unassigned: string[] = [];
  for (const piece of pieces) {
    // "Acme Corp, Toronto, ON" carries the location after the first comma.
    const commaLocation = /^([^,]+),\s*(.+)$/.exec(piece);
    if (
      !parts.location &&
      commaLocation?.[1] &&
      commaLocation[2] &&
      looksLikeLocation(commaLocation[2])
    ) {
      parts.location = commaLocation[2];
      unassigned.push(commaLocation[1]);
    } else if (!parts.location && looksLikeLocation(piece)) {
      parts.location = piece;
    } else {
      unassigned.push(piece);
    }
  }
  const roleIndex = unassigned.findIndex((piece) => ROLE.test(piece));
  if (roleIndex >= 0) {
    parts.title = unassigned[roleIndex] ?? '';
    const others = unassigned.filter((_, index) => index !== roleIndex);
    parts.organization = others[0] ?? '';
    parts.extra = others.slice(1);
  } else {
    // Nothing names a role; keep document order (title first is the most common layout).
    parts.title = unassigned.length >= 2 ? (unassigned[0] ?? '') : '';
    parts.organization = unassigned.length >= 2 ? (unassigned[1] ?? '') : (unassigned[0] ?? '');
    parts.extra = unassigned.slice(2);
    parts.ambiguous = unassigned.length > 0;
  }
  return parts;
}

function parseExperience(
  lines: readonly Line[],
  id: () => string,
  warnings: string[],
): Experience[] {
  const candidates = toBlocks(lines)
    .filter((block) => block.header.length > 0)
    .map((block) => {
      const header = parseHeader(block.header);
      const label = header.organization || header.title;
      if (header.ambiguous)
        warnings.push(`Check the role and employer for "${label}"; they were hard to tell apart.`);
      if (!header.startDate && !header.endDate && !header.current)
        warnings.push(`No dates were found for "${label}".`);
      const bullets = [...header.extra.filter((text) => text.length > 40), ...block.bullets]
        .map((text) => clip(text, 600))
        .slice(0, 30);
      return {
        id: id(),
        employer: clip(header.organization, 200),
        position: clip(header.title, 200),
        location: clip(header.location, 120),
        startDate: header.startDate,
        endDate: header.endDate,
        current: header.current,
        bullets,
        technologies: findSkills([...block.header, ...block.bullets].join('\n')),
      };
    });
  return validItems(experienceSchema, candidates, 'experience', warnings);
}

// ---------------------------------------------------------------- projects

function parseProjects(lines: readonly Line[], id: () => string, warnings: string[]): Project[] {
  const candidates = toBlocks(lines)
    .filter((block) => block.header.length > 0 || block.bullets.length > 0)
    .map((block) => {
      const headerText = block.header.join(' | ');
      const url = findUrls(headerText)[0] ?? findUrls(block.bullets.join(' '))[0] ?? '';
      const withoutDates = block.header.map((text) => {
        const dates = findDateRange(text);
        return dates ? text.replace(dates.matched, ' ') : text;
      });
      const pieces = withoutDates
        .flatMap((text) => splitPieces(text))
        .filter((piece) => findUrls(piece).length === 0);
      const [first = '', ...others] = pieces;
      // "Name: description" or "Name (React, Node.js)".
      const named = /^([^:(]{2,80})(?:[:(]\s*(.+?)\)?)?$/.exec(first);
      const name = (named?.[1] ?? first).trim() || (block.bullets[0] ?? '').slice(0, 80);
      const description = [
        named?.[2] ?? '',
        ...others.filter(
          (piece) => findSkills(piece).length === 0 || piece.split(/\s+/).length > 8,
        ),
      ]
        .filter(Boolean)
        .join(' ');
      const techLine = others.find(
        (piece) =>
          /^(tech(nologies|stack)?|built with|tools)\s*:/i.test(piece) ||
          findSkills(piece).length > 0,
      );
      const technologies = techLine
        ? techLine
            .replace(/^[^:]+:\s*/, '')
            .split(/[,;/|]/)
            .map((tech) => tech.trim())
            .filter((tech) => tech.length > 0 && tech.length <= 60)
        : findSkills([...block.header, ...block.bullets].join('\n'));
      return {
        id: id(),
        name: clip(name, 200),
        description: clip(description, 1000),
        technologies: [...new Set(technologies)].slice(0, 50),
        url,
        bullets: block.bullets.map((text) => clip(text, 600)).slice(0, 30),
      };
    });
  return validItems(projectSchema, candidates, 'project', warnings);
}

// ---------------------------------------------------------------- skills

const LABEL_CATEGORIES: ReadonlyArray<[RegExp, SkillCategory]> = [
  [/spoken|human languages|languages spoken/i, 'spoken-language'],
  [/language/i, 'language'],
  [/framework|librar/i, 'framework'],
  [/cloud|aws|azure|gcp/i, 'cloud'],
  [/devops|infrastructure|ci\/cd|containers/i, 'devops'],
  [/data|database/i, 'data'],
  [/tool|software|platform|technolog/i, 'tool'],
  [/soft|interpersonal|professional|personal/i, 'professional'],
  [/practice|method|concept/i, 'practice'],
];

function categoryFor(name: string, label: string): SkillCategory {
  const known = lookupSkill(name);
  if (known) return known.category;
  for (const [pattern, category] of LABEL_CATEGORIES) {
    if (pattern.test(label)) return category;
  }
  return 'other';
}

function parseSkills(lines: readonly Line[], id: () => string): Skill[] {
  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const line of lines) {
    const labelled = /^([A-Za-z &/-]{2,40}):\s*(.+)$/.exec(line.text);
    const label = labelled?.[1] ?? '';
    const list = labelled?.[2] ?? line.text;
    for (const raw of list.split(/\s*[,;•|·]\s*|\s+\/\s+/)) {
      // "Python (advanced)" → "Python"; keep "C++" and "C#" intact.
      const name = raw
        .replace(
          /\s*\((?:basic|intermediate|advanced|proficient|familiar|expert|beginner|native|fluent)[^)]*\)\s*$/i,
          '',
        )
        .replace(/\.$/, '')
        .trim();
      if (name.length === 0 || name.length > 80 || name.split(/\s+/).length > 6) continue;
      const key = normalizeSkillName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const skill = skillSchema.safeParse({ id: id(), name, category: categoryFor(name, label) });
      if (skill.success) skills.push(skill.data);
    }
  }
  return skills.slice(0, 200);
}

// ---------------------------------------------------------------- certifications

const ISSUERS: ReadonlyArray<[RegExp, string]> = [
  [/\b(aws|amazon web services)\b/i, 'Amazon Web Services'],
  [/\b(microsoft|azure)\b/i, 'Microsoft'],
  [/\b(google|gcp)\b/i, 'Google'],
  [/\bcomptia\b|\b(a\+|network\+|security\+)/i, 'CompTIA'],
  [/\bcisco\b|\bccna\b|\bccnp\b/i, 'Cisco'],
  [/\boracle\b/i, 'Oracle'],
  [/\bhashicorp\b|\bterraform associate\b/i, 'HashiCorp'],
  [/\blinux foundation\b|\bcka\b|\bckad\b/i, 'The Linux Foundation'],
  [/\bred hat\b|\brhc[sea]\b/i, 'Red Hat'],
  [/\(isc\)²|\bcissp\b/i, 'ISC2'],
];

function parseCertifications(
  lines: readonly Line[],
  id: () => string,
  warnings: string[],
): Certification[] {
  const candidates = lines
    .filter((line) => line.text.length >= 3)
    .map((line) => {
      let rest = line.text;
      const dates = findDateRange(rest);
      if (dates) rest = rest.replace(dates.matched, ' ');
      const url = findUrls(rest)[0] ?? '';
      const pieces = splitPieces(rest).filter(
        (piece) =>
          findUrls(piece).length === 0 &&
          !/^(issued|earned|obtained|credential id\b.*)$/i.test(piece),
      );
      const name = (pieces[0] ?? '').replace(/[,–—-]\s*$/, '').trim();
      const statedIssuer = pieces.slice(1).find((piece) => !/credential id/i.test(piece)) ?? '';
      const issuer = statedIssuer || ISSUERS.find(([pattern]) => pattern.test(name))?.[1] || '';
      return {
        id: id(),
        name: clip(name, 200),
        issuer: clip(issuer, 200),
        date: dates ? dates.endDate || dates.startDate : '',
        credentialUrl: url,
      };
    });
  return validItems(certificationSchema, candidates, 'certification', warnings);
}

// ---------------------------------------------------------------- entry point

/** Parses resume text into a draft profile. Pure and deterministic for a given id generator. */
export function parseResumeText(text: string, options: ParseOptions = {}): ParsedResume {
  const id = options.newId ?? newId;
  const lines = toLines(text);
  const warnings: string[] = [];
  const draft = emptyProfileContent();

  if (lines.length === 0) {
    return { draft, sections: [], warnings: ['The resume did not contain any readable text.'] };
  }

  const sections = splitSections(lines);
  const header = sections[0]?.lines ?? [];
  const personal = parsePersonal(header, text);
  draft.personal = personal.personal;
  warnings.push(...personal.warnings);

  const recognised = sections.slice(1);
  for (const section of recognised) {
    switch (section.kind) {
      case 'summary':
        draft.summary = clip(
          [draft.summary, ...section.lines.map((line) => line.text)].filter(Boolean).join(' '),
          2000,
        );
        break;
      case 'education':
        draft.education.push(...parseEducation(section.lines, id, warnings));
        break;
      case 'experience':
        draft.experience.push(...parseExperience(section.lines, id, warnings));
        break;
      case 'skills':
        draft.skills.push(
          ...parseSkills(section.lines, id).filter(
            (skill) =>
              !draft.skills.some(
                (s) => normalizeSkillName(s.name) === normalizeSkillName(skill.name),
              ),
          ),
        );
        break;
      case 'projects':
        draft.projects.push(...parseProjects(section.lines, id, warnings));
        break;
      case 'certifications':
        draft.certifications.push(...parseCertifications(section.lines, id, warnings));
        break;
      case 'other':
      case 'header':
        break;
    }
  }

  if (recognised.length === 0) {
    warnings.push(
      'No section headings (Education, Experience, Skills…) were recognised, so only contact details were filled in. You can add the rest by hand.',
    );
  } else {
    for (const [kind, label] of [
      ['experience', 'experience'],
      ['education', 'education'],
      ['skills', 'skills'],
    ] as const) {
      if (!recognised.some((section) => section.kind === kind))
        warnings.push(`No ${label} section was found.`);
    }
  }

  return parsedResumeSchema.parse({
    draft,
    sections: recognised.map((section) => section.label),
    warnings: [...new Set(warnings)],
  });
}

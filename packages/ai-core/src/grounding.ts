import { findSkills, normalizeSkillName } from '@applypilot/shared';
import type {
  CandidateContext,
  CoverLetter,
  JobContext,
  ScreeningAnswers,
  ScreeningQuestion,
  TailoredResume,
} from './contracts';
import { candidateText, jobText } from './context';
import { classifyQuestion } from './screening';

/**
 * Deterministic checks that run on every AI output before the user sees it.
 * The model is asked to stay truthful; these checks do not take its word for
 * it. Anything that cannot be traced to the candidate's own profile is either
 * removed (when it cannot be traced at all) or flagged for the user to review.
 *
 * Known limits: numbers written as words ("three") and claims that use no
 * number or known skill are not detected. That is why every draft is shown
 * for review and nothing is ever submitted automatically.
 */

export interface Finding {
  severity: 'removed' | 'review';
  message: string;
}

// ---- Primitive checks ----------------------------------------------------------

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Numeric values in the text, normalised ("1,200" → "1200", "40%" → "40"). */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER)) {
    const core = match[0].replace(/,/g, '').replace(/\.0+$/, '');
    found.add(core);
  }
  return found;
}

function unsupportedNumbers(text: string, allowed: string): string[] {
  const allowedNumbers = numbersIn(allowed);
  return [...numbersIn(text)].filter((n) => !allowedNumbers.has(n));
}

function knownSkills(candidate: CandidateContext, extra: string): Set<string> {
  const names = new Set(findSkills(extra));
  for (const name of candidate.skills) names.add(normalizeSkillName(name));
  return new Set([...names].map((n) => normalizeSkillName(n)));
}

function unsupportedSkills(text: string, known: Set<string>): string[] {
  return findSkills(text).filter((skill) => !known.has(normalizeSkillName(skill)));
}

function textFlags(
  text: string,
  allowedText: string,
  known: Set<string>,
  skillHint = 'Keep it only if it is true for you.',
  sourceName = 'your profile',
): string[] {
  const flags: string[] = [];
  const numbers = unsupportedNumbers(text, allowedText);
  if (numbers.length > 0) {
    const list = numbers.map((n) => `"${n}"`).join(', ');
    flags.push(`Uses ${list}, which is not in ${sourceName}. Check the number or remove it.`);
  }
  const skills = unsupportedSkills(text, known);
  if (skills.length > 0) {
    flags.push(`Mentions ${skills.join(', ')}, which ${sourceName} does not show. ${skillHint}`);
  }
  return flags;
}

// ---- Resume tailoring -------------------------------------------------------------

export interface ReviewedBullet {
  text: string;
  /** The original bullets this one was rewritten from. */
  sources: string[];
  flags: string[];
}

export interface ReviewedEntry {
  ref: string;
  label: string;
  bullets: ReviewedBullet[];
}

export interface ReviewedResume {
  summary: { text: string; flags: string[] };
  experience: ReviewedEntry[];
  projects: ReviewedEntry[];
  skillsToFeature: string[];
  changes: string[];
  notShownInProfile: string[];
  findings: Finding[];
}

interface SourceEntry {
  ref: string;
  label: string;
  bullets: string[];
  extra: string;
}

const BULLET_HINT = 'Keep it only if you used it in this role or project.';

function reviewEntries(
  items: TailoredResume['experience'],
  sources: Map<string, SourceEntry>,
  findings: Finding[],
): ReviewedEntry[] {
  const seen = new Set<string>();
  const reviewed: ReviewedEntry[] = [];
  for (const item of items) {
    const source = sources.get(item.ref);
    if (!source) {
      findings.push({
        severity: 'removed',
        message: `Removed a section for "${item.ref}", which is not in your profile.`,
      });
      continue;
    }
    if (seen.has(item.ref)) {
      findings.push({
        severity: 'removed',
        message: `Removed a repeated section for ${source.label}.`,
      });
      continue;
    }
    seen.add(item.ref);
    const bullets: ReviewedBullet[] = [];
    for (const bullet of item.bullets) {
      const text = bullet.text.trim();
      if (text.length === 0) continue;
      const indexes = [...new Set(bullet.basedOn)];
      const valid = indexes.length > 0 && indexes.every((i) => i >= 0 && i < source.bullets.length);
      if (!valid) {
        findings.push({
          severity: 'removed',
          message: `Removed a bullet for ${source.label} that could not be traced to one of your original bullets: "${text}"`,
        });
        continue;
      }
      const originals = indexes.map((i) => source.bullets[i] ?? '');
      const allowed = [...originals, source.extra].join('\n');
      // A bullet may only use skills its own source shows, not ones from elsewhere in the profile.
      const entrySkills = new Set(findSkills(allowed).map((n) => normalizeSkillName(n)));
      bullets.push({
        text,
        sources: originals,
        flags: textFlags(text, allowed, entrySkills, BULLET_HINT, 'the original bullet'),
      });
    }
    reviewed.push({ ref: item.ref, label: source.label, bullets });
  }
  return reviewed;
}

export function reviewTailoredResume(
  output: TailoredResume,
  candidate: CandidateContext,
): ReviewedResume {
  const findings: Finding[] = [];
  const all = candidateText(candidate);
  const known = knownSkills(candidate, all);

  const experienceSources = new Map<string, SourceEntry>(
    candidate.experience.map((e) => [
      e.ref,
      {
        ref: e.ref,
        label: [e.position, e.employer].filter(Boolean).join(' at '),
        bullets: e.bullets,
        extra: [e.position, e.employer, ...e.technologies].join('\n'),
      },
    ]),
  );
  const projectSources = new Map<string, SourceEntry>(
    candidate.projects.map((p) => [
      p.ref,
      {
        ref: p.ref,
        label: p.name,
        bullets: p.bullets,
        extra: [p.name, p.description, ...p.technologies].join('\n'),
      },
    ]),
  );

  const profileSkills = new Map(candidate.skills.map((s) => [normalizeSkillName(s), s]));
  const skillsToFeature: string[] = [];
  for (const skill of output.skillsToFeature) {
    const own = profileSkills.get(normalizeSkillName(skill));
    if (own === undefined) {
      findings.push({
        severity: 'removed',
        message: `Removed "${skill}" from the featured skills because it is not in your skills list.`,
      });
    } else if (!skillsToFeature.includes(own)) {
      skillsToFeature.push(own);
    }
  }

  const summary = output.summary.trim();
  return {
    summary: { text: summary, flags: summary ? textFlags(summary, all, known) : [] },
    experience: reviewEntries(output.experience, experienceSources, findings),
    projects: reviewEntries(output.projects, projectSources, findings),
    skillsToFeature,
    changes: output.changes.map((c) => c.trim()).filter(Boolean),
    notShownInProfile: output.notShownInProfile.map((c) => c.trim()).filter(Boolean),
    findings,
  };
}

// ---- Cover letters --------------------------------------------------------------------

export interface ReviewedCoverLetter {
  greeting: string;
  paragraphs: { text: string; flags: string[] }[];
  closing: string;
  /** Labels of the profile entries the letter draws on. */
  sources: string[];
  findings: Finding[];
}

function refLabels(candidate: CandidateContext): Map<string, string> {
  return new Map<string, string>([
    ...candidate.experience.map(
      (e) => [e.ref, [e.position, e.employer].filter(Boolean).join(' at ')] as const,
    ),
    ...candidate.projects.map((p) => [p.ref, p.name] as const),
    ...candidate.education.map(
      (d) => [d.ref, [d.degree, d.institution].filter(Boolean).join(', ')] as const,
    ),
    ...candidate.certifications.map((c) => [c.ref, c.name] as const),
  ]);
}

const EMPLOYER_HINT =
  'Keep it only if you are describing the employer, or if it is true for you and you add it to your profile.';

export function reviewCoverLetter(
  output: CoverLetter,
  candidate: CandidateContext,
  job: JobContext,
  notes: string,
): ReviewedCoverLetter {
  const findings: Finding[] = [];
  const candidateAll = candidateText(candidate, notes);
  // Numbers may come from the posting ("your 2027 internship"); skills may not.
  const allowedNumbers = `${candidateAll}\n${jobText(job)}`;
  const known = knownSkills(candidate, candidateAll);
  const labels = refLabels(candidate);

  const sources: string[] = [];
  for (const ref of output.sources) {
    const label = labels.get(ref);
    if (label === undefined) {
      findings.push({
        severity: 'review',
        message: `The draft cited "${ref}", which is not in your profile.`,
      });
    } else if (!sources.includes(label)) {
      sources.push(label);
    }
  }

  const paragraphs = output.paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ text, flags: textFlags(text, allowedNumbers, known, EMPLOYER_HINT) }));

  return {
    greeting: output.greeting.trim(),
    paragraphs,
    closing: output.closing.trim(),
    sources,
    findings,
  };
}

// ---- Screening answers -------------------------------------------------------------------

export interface ReviewedAnswer {
  questionId: string;
  question: string;
  answer: string;
  sources: string[];
  needsYourInput: string;
  flags: string[];
}

export interface ReviewedScreening {
  answers: ReviewedAnswer[];
  findings: Finding[];
}

export function reviewScreeningAnswers(
  output: ScreeningAnswers,
  questions: readonly ScreeningQuestion[],
  candidate: CandidateContext,
  job: JobContext,
): ReviewedScreening {
  const findings: Finding[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const candidateAll = candidateText(candidate);
  const allowedNumbers = `${candidateAll}\n${jobText(job)}`;
  const known = knownSkills(candidate, candidateAll);
  const labels = refLabels(candidate);
  const answered = new Set<string>();
  const answers: ReviewedAnswer[] = [];

  for (const item of output.answers) {
    const question = byId.get(item.questionId);
    if (!question) {
      findings.push({
        severity: 'removed',
        message: `Removed an answer to a question that was not asked ("${item.questionId}").`,
      });
      continue;
    }
    if (answered.has(question.id)) continue;
    if (classifyQuestion(question.text).category !== 'draftable') {
      findings.push({
        severity: 'removed',
        message: `Removed a draft for "${question.text}". You must answer that question yourself.`,
      });
      continue;
    }
    answered.add(question.id);
    const answer = item.answer.trim();
    answers.push({
      questionId: question.id,
      question: question.text,
      answer,
      sources: item.sources.flatMap((ref) => {
        const label = labels.get(ref);
        return label === undefined ? [] : [label];
      }),
      needsYourInput: item.needsYourInput.trim(),
      flags: answer ? textFlags(answer, allowedNumbers, known, EMPLOYER_HINT) : [],
    });
  }
  return { answers, findings };
}

import {
  candidateText,
  jobText,
  type AiTask,
  type CandidateContext,
  type CoverLetter,
  type CoverLetterRequest,
  type FieldMappings,
  type MapFieldsRequest,
  type MappableFieldKind,
  type ScreeningAnswers,
  type ScreeningRequest,
  type TailoredResume,
  type TailorResumeRequest,
  type TaskTypes,
} from '@applypilot/ai-core';
import { findSkills, normalizeSkillName } from '@applypilot/shared';
import type { AiProvider, Generated } from './types';

/**
 * A free, offline stand-in for Claude. It produces deterministic drafts built
 * only by reordering and quoting the candidate's own text, so the whole flow
 * (consent, preview, request, grounding review, copy) can be tested without
 * an API key or any cost. Drafts say plainly that they are mock output.
 */

export const MOCK_MODEL = 'mock-drafter';

function relevance(text: string, jobSkills: Set<string>, jobWords: Set<string>): number {
  const skills = findSkills(text).filter((s) => jobSkills.has(normalizeSkillName(s))).length;
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 3 && jobWords.has(w)).length;
  return skills * 3 + words;
}

function jobSignals(text: string) {
  return {
    skills: new Set(findSkills(text).map((s) => normalizeSkillName(s))),
    words: new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter((w) => w.length > 3),
    ),
  };
}

function rankBullets(bullets: string[], signals: ReturnType<typeof jobSignals>) {
  return bullets
    .map((text, index) => ({ text, index, score: relevance(text, signals.skills, signals.words) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ text, index }) => ({ text, basedOn: [index] }));
}

function lowerFirst(text: string): string {
  return text.length > 1 && /^[A-Z][a-z]/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

function strongestEvidence(candidate: CandidateContext, signals: ReturnType<typeof jobSignals>) {
  const options = [
    ...candidate.experience.flatMap((e) =>
      e.bullets.map((b) => ({
        ref: e.ref,
        intro: `As ${e.position} at ${e.employer}, I`,
        text: b,
      })),
    ),
    ...candidate.projects.flatMap((p) =>
      p.bullets.map((b) => ({ ref: p.ref, intro: `In my ${p.name} project, I`, text: b })),
    ),
  ];
  return options
    .map((o) => ({ ...o, score: relevance(o.text, signals.skills, signals.words) }))
    .sort((a, b) => b.score - a.score);
}

function tailor({ candidate, job }: TailorResumeRequest): TailoredResume {
  const signals = jobSignals(jobText(job));
  // Skills the profile shows anywhere, not only in the skills list.
  const own = new Set(
    [...candidate.skills, ...findSkills(candidateText(candidate))].map((s) =>
      normalizeSkillName(s),
    ),
  );
  return {
    summary: candidate.summary,
    experience: candidate.experience
      .filter((e) => e.bullets.length > 0)
      .map((e) => ({ ref: e.ref, bullets: rankBullets(e.bullets, signals) })),
    projects: candidate.projects
      .filter((p) => p.bullets.length > 0)
      .map((p) => ({ ref: p.ref, bullets: rankBullets(p.bullets, signals) })),
    skillsToFeature: [...candidate.skills].sort(
      (a, b) =>
        Number(signals.skills.has(normalizeSkillName(b))) -
        Number(signals.skills.has(normalizeSkillName(a))),
    ),
    changes: [
      'Mock mode: bullets and skills were reordered by how much they overlap with the posting. The wording is unchanged. Connect Claude for real rewriting.',
    ],
    notShownInProfile: job.skills.filter((s) => !own.has(normalizeSkillName(s))),
  };
}

function coverLetter({ candidate, job, options }: CoverLetterRequest): CoverLetter {
  const signals = jobSignals(jobText(job));
  const evidence = strongestEvidence(candidate, signals).slice(
    0,
    options.length === 'short' ? 1 : 2,
  );
  const role = job.title || 'this role';
  const company = job.company || 'your team';
  const paragraphs = [
    `[Mock draft] I am applying for the ${role} position at ${company}.`,
    ...evidence.map((e) => `${e.intro} ${lowerFirst(e.text.replace(/\.$/, ''))}.`),
  ];
  if (options.notes) paragraphs.push(options.notes);
  paragraphs.push('Thank you for considering my application.');
  return {
    greeting: 'Dear Hiring Manager,',
    paragraphs,
    closing: candidate.name ? `Sincerely,\n${candidate.name}` : 'Sincerely,',
    sources: [...new Set(evidence.map((e) => e.ref))],
  };
}

function screening({ candidate, questions }: ScreeningRequest): ScreeningAnswers {
  return {
    answers: questions.map((q) => {
      const best = strongestEvidence(candidate, jobSignals(q.text))[0];
      return {
        questionId: q.id,
        answer: best
          ? `[Mock draft] ${best.intro} ${lowerFirst(best.text.replace(/\.$/, ''))}.`
          : '',
        sources: best ? [best.ref] : [],
        needsYourInput: best
          ? 'Mock mode: this quotes your profile. Rewrite it to answer the question directly.'
          : 'Your profile has nothing for this question yet. Answer it yourself.',
      };
    }),
  };
}

/** Plain keyword matching, so the mapping flow can be tested offline. */
const MOCK_FIELD_WORDS: [RegExp, MappableFieldKind][] = [
  [/\b(github|git hub|code hosting)\b/i, 'link.github'],
  [/\blinked ?in\b/i, 'link.linkedin'],
  [/\b(portfolio|personal site|homepage)\b/i, 'link.portfolio'],
  [/\b(e-?mail|electronic mail)\b/i, 'email'],
  [/\b(mobile|cell|telephone|phone)\b/i, 'phone'],
  [/\b(employer|company you work for|organi[sz]ation you work for)\b/i, 'current.employer'],
  [/\b(university|college|school)\b/i, 'education.school'],
  [/\b(major|field of study|discipline)\b/i, 'education.field'],
];

function mapFields({ fields }: MapFieldsRequest): FieldMappings {
  return {
    mappings: fields.map((f) => {
      const hit = MOCK_FIELD_WORDS.find(([pattern]) => pattern.test(`${f.label} ${f.hint}`));
      return { fieldId: f.id, kind: hit ? hit[1] : 'none', confidence: hit ? 'medium' : 'low' };
    }),
  };
}

export function createMockProvider(): AiProvider {
  return {
    kind: 'mock',
    model: MOCK_MODEL,
    generate<T extends AiTask>(task: T, request: TaskTypes[T]['request']): Promise<Generated<T>> {
      const outputs: { [K in AiTask]: (r: TaskTypes[K]['request']) => TaskTypes[K]['output'] } = {
        'tailor-resume': tailor,
        'cover-letter': coverLetter,
        'screening-answers': screening,
        'map-fields': mapFields,
      };
      const output = (outputs[task] as (r: TaskTypes[T]['request']) => TaskTypes[T]['output'])(
        request,
      );
      return Promise.resolve({ output, model: MOCK_MODEL, usage: null });
    },
  };
}

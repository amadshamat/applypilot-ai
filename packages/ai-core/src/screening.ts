/**
 * Decides which screening questions an AI may draft. Questions about legal
 * status, eligibility, demographics, attestations and personal facts (pay,
 * availability, preferences) are never sent to a model: the candidate answers
 * them. The same rules run in the extension (before anything is sent) and in
 * the API (as a second check).
 */

export type QuestionCategory = 'draftable' | 'sensitive' | 'personal';

export interface QuestionClassification {
  category: QuestionCategory;
  /** Short topic shown to the user, e.g. "work authorization". Empty for draftable questions. */
  topic: string;
}

interface Rule {
  topic: string;
  category: Exclude<QuestionCategory, 'draftable'>;
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  {
    topic: 'work authorization',
    category: 'sensitive',
    pattern:
      /\b(authori[sz]ed to work|work authori[sz]ation|right to work|legally (?:able|eligible|permitted)|eligib(?:le|ility) to work|visa|sponsor(?:ship)?|citizen(?:ship)?|green card|permanent resident|immigration|work permit|h-?1b|opt\b|cpt\b)/i,
  },
  {
    topic: 'criminal history or background check',
    category: 'sensitive',
    pattern:
      /\b(convict(?:ed|ion)|criminal|felony|misdemeanou?r|arrest(?:ed)?|background (?:check|screening)|drug (?:test|screen)|pending charges)/i,
  },
  {
    topic: 'age',
    category: 'sensitive',
    pattern:
      /\b(how old|your age|date of birth|birth ?date|\bdob\b|(?:at least|over|older than|under) (?:the age of )?1[68]\b|1[68] years (?:of age|or older))/i,
  },
  {
    topic: 'demographic information',
    category: 'sensitive',
    pattern:
      /\b(gender|sex\b|male\b|female|non-?binary|pronoun|race\b(?! condition)|racial|ethnic(?:ity)?|hispanic|latin[oax]|veteran|military (?:status|service)|disabilit(?:y|ies)|disabled|sexual orientation|lgbt|transgender|religio(?:n|us)|marital|married|pregnan|national origin|nationality|caste|accommodation)/i,
  },
  {
    topic: 'legal agreement or attestation',
    category: 'sensitive',
    pattern:
      /\b(certify|attest|acknowledge|signature|e-?sign|non-?compete|non-?solicit|non-?disclosure|\bnda\b|agree to (?:the|our)|consent to|terms and conditions|privacy (?:policy|notice)|true and (?:complete|accurate))/i,
  },
  {
    topic: 'previous employment with this employer',
    category: 'personal',
    pattern:
      /\b(previously (?:been )?(?:employed|worked) (?:by|for|at)|former employee|related to (?:anyone|an employee)|relatives? (?:who )?works?)/i,
  },
  {
    topic: 'pay expectations',
    category: 'personal',
    pattern:
      /\b(salary|compensation|pay (?:expectation|requirement|range|rate)|(?:desired|expected|requested) (?:hourly |annual |base )?(?:pay|wage|rate)|hourly (?:pay|rate)|wage)/i,
  },
  {
    topic: 'availability',
    category: 'personal',
    pattern:
      /\b(start date|when can you start|available to start|availability|date available|available date|notice period|earliest (?:start|date)|graduation date|hours per week|work (?:weekends|evenings|nights|shifts)|available (?:on )?weekends|shift (?:work|availability))/i,
  },
  {
    topic: 'location or relocation',
    category: 'personal',
    pattern:
      /\b(relocat(?:e|ion)|commute|willing to travel|travel (?:up to|requirement)|reside in|live in|located in|work (?:on-?site|in (?:the )?office)|hybrid schedule)/i,
  },
  {
    topic: 'references or referral',
    category: 'personal',
    pattern: /\b(references?\b|referr(?:ed|al)|how did you hear|who referred)/i,
  },
  {
    topic: 'contact details',
    category: 'personal',
    pattern:
      /\b(phone number|email address|mailing address|home address|linkedin (?:url|profile))/i,
  },
];

export function classifyQuestion(text: string): QuestionClassification {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return { category: rule.category, topic: rule.topic };
  }
  return { category: 'draftable', topic: '' };
}

export function explainClassification({ category, topic }: QuestionClassification): string {
  switch (category) {
    case 'sensitive':
      return `This asks about ${topic}. Answer it yourself; ApplyPilot never drafts or sends these questions.`;
    case 'personal':
      return `This asks about ${topic}, which only you know. Answer it yourself.`;
    case 'draftable':
      return 'ApplyPilot can draft this from your profile. Review every word before you use it.';
  }
}

/**
 * Splits pasted text into questions: one per line, or blank-line-separated
 * blocks when a question wraps over several lines. Numbering ("1.", "Q2:") is
 * removed.
 */
export function splitQuestions(input: string): string[] {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) return [];
  const blocks = /\n\s*\n/.test(normalized)
    ? normalized.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, ' '))
    : normalized.split('\n');
  return blocks
    .map((q) =>
      q
        .replace(/^\s*(?:q(?:uestion)?\s*)?\d{1,2}\s*[.):-]\s*/i, '')
        .replace(/^\s*[-*•]\s*/, '')
        .trim(),
    )
    .filter((q) => q.length >= 3);
}

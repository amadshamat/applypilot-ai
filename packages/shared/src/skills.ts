import { SKILL_TAXONOMY, type SkillDefinition } from './constants/skills';

/**
 * Deterministic skill recognition over the shared taxonomy. Used by job
 * extraction, resume parsing and matching so all three agree on what counts as
 * the same skill.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Token boundary that treats "+", "#" and "." inside names (C++, C#, .NET) correctly. */
function tokenPattern(alias: string, flags: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9+#])${escapeRegExp(alias)}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`,
    flags,
  );
}

const compiledSkills = SKILL_TAXONOMY.map((skill) => ({
  skill,
  patterns: [
    ...skill.aliases.map((alias) => tokenPattern(alias, 'i')),
    ...(skill.exact ?? []).map((alias) => tokenPattern(alias, '')),
  ],
}));

const byLowerName = new Map<string, SkillDefinition>(
  SKILL_TAXONOMY.flatMap((skill) => [
    [skill.name.toLowerCase(), skill] as const,
    ...skill.aliases.map((alias) => [alias.toLowerCase(), skill] as const),
    ...(skill.exact ?? []).map((alias) => [alias.toLowerCase(), skill] as const),
  ]),
);

/** Skills from the shared taxonomy mentioned in the text, in taxonomy order. */
export function findSkills(text: string): string[] {
  return compiledSkills
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)))
    .map(({ skill }) => skill.name);
}

export interface SkillMention {
  name: string;
  /** Character offset of the first mention. */
  index: number;
}

/** Skills mentioned in the text with the position of their first mention, in reading order. */
export function findSkillMentions(text: string): SkillMention[] {
  const mentions: SkillMention[] = [];
  for (const { skill, patterns } of compiledSkills) {
    const indexes = patterns.map((pattern) => text.search(pattern)).filter((index) => index >= 0);
    if (indexes.length > 0) mentions.push({ name: skill.name, index: Math.min(...indexes) });
  }
  return mentions.sort((a, b) => a.index - b.index);
}

/**
 * The taxonomy entry for a skill name a person typed ("k8s", "ReactJS"), or
 * null when it is not in the taxonomy. Whole-name lookup first, then a mention
 * inside the name ("AWS (EC2, S3)" is not a single skill, so it returns null).
 */
export function lookupSkill(name: string): SkillDefinition | null {
  const key = name.trim().toLowerCase();
  if (key.length === 0) return null;
  const direct = byLowerName.get(key);
  if (direct) return direct;
  const [only, ...rest] = findSkills(name);
  return only !== undefined && rest.length === 0
    ? (byLowerName.get(only.toLowerCase()) ?? null)
    : null;
}

/** Canonical form used to compare free-text skill names that are not in the taxonomy. */
export function normalizeSkillName(name: string): string {
  const known = lookupSkill(name);
  if (known) return known.name.toLowerCase();
  return name
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .trim();
}

/** The broader skill a taxonomy skill belongs to, if any ("AWS Lambda" → "AWS"). */
export function skillFamily(name: string): string | null {
  return lookupSkill(name)?.family ?? null;
}

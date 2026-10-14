import {
  SKILL_TAXONOMY,
  findSkills,
  lookupSkill,
  normalizeSkillName,
  type ProfileContent,
} from '@applypilot/shared';
import type { SkillMatch } from './types';

/**
 * Where each skill shows up in the profile. Built once per match so every
 * claim in the result can point back to the profile entry that supports it.
 */
export interface SkillEvidenceIndex {
  /** Canonical skill key → places it appears. */
  places: Map<string, string[]>;
  /** Canonical keys listed in the Skills section, in the user's order. */
  listed: string[];
  /** Canonical keys mentioned in experience or project entries. */
  inContext: Set<string>;
}

const keyOf = (name: string) => normalizeSkillName(name);

export function buildEvidence(profile: ProfileContent): SkillEvidenceIndex {
  const places = new Map<string, string[]>();
  const inContext = new Set<string>();
  const add = (name: string, place: string, contextual = false) => {
    const key = keyOf(name);
    const list = places.get(key) ?? [];
    if (!list.includes(place)) list.push(place);
    places.set(key, list);
    if (contextual) inContext.add(key);
  };

  const listed: string[] = [];
  for (const skill of profile.skills) {
    add(skill.name, 'Skills list');
    const key = keyOf(skill.name);
    if (!listed.includes(key)) listed.push(key);
    // "AWS (EC2, S3)" lists several taxonomy skills at once.
    for (const found of findSkills(skill.name)) add(found, 'Skills list');
  }
  for (const job of profile.experience) {
    const label = `Experience: ${job.employer || job.position}`;
    for (const tech of job.technologies) add(tech, label, true);
    for (const found of findSkills([job.position, ...job.bullets, ...job.technologies].join('\n')))
      add(found, label, true);
  }
  for (const project of profile.projects) {
    const label = `Project: ${project.name}`;
    for (const tech of project.technologies) add(tech, label, true);
    for (const found of findSkills(
      [project.description, ...project.bullets, ...project.technologies].join('\n'),
    )) {
      add(found, label, true);
    }
  }
  for (const cert of profile.certifications) {
    for (const found of findSkills(cert.name)) add(found, `Certification: ${cert.name}`);
  }
  for (const school of profile.education) {
    const label = `Education: ${school.institution || school.degree}`;
    for (const found of findSkills([school.field, ...school.coursework].join('\n')))
      add(found, label);
  }
  if (profile.summary) {
    for (const found of findSkills(profile.summary)) add(found, 'Summary');
  }
  return { places, listed, inContext };
}

/** Taxonomy skills that belong to a family ("AWS" → AWS Lambda, Amazon S3, …). */
function familyMembers(family: string): string[] {
  return SKILL_TAXONOMY.filter((skill) => skill.family === family).map((skill) => skill.name);
}

/**
 * Compares one required skill with the profile.
 * - matched: the profile names the skill, or a more specific member of it (Lambda counts as AWS).
 * - related: the profile names the skill's family or a sibling (AWS for Amazon EC2). Half credit.
 * - missing: nothing in the profile mentions it. Never inferred.
 */
export function matchSkill(skill: string, index: SkillEvidenceIndex): SkillMatch {
  const direct = index.places.get(keyOf(skill));
  if (direct && direct.length > 0) return { skill, status: 'matched', evidence: direct };

  for (const member of familyMembers(skill)) {
    const places = index.places.get(keyOf(member));
    if (places && places.length > 0) {
      return { skill, status: 'matched', evidence: places.map((place) => `${place} (${member})`) };
    }
  }

  const family = lookupSkill(skill)?.family;
  if (family) {
    for (const relative of [family, ...familyMembers(family)]) {
      if (relative === skill) continue;
      const places = index.places.get(keyOf(relative));
      if (places && places.length > 0) {
        return { skill, status: 'related', evidence: places, relatedVia: relative };
      }
    }
  }
  return { skill, status: 'missing', evidence: [] };
}

/** Share of skills covered, counting related matches as half. Null for an empty list. */
export function skillScore(matches: readonly SkillMatch[]): number | null {
  if (matches.length === 0) return null;
  const credit = matches.reduce(
    (sum, match) => sum + (match.status === 'matched' ? 1 : match.status === 'related' ? 0.5 : 0),
    0,
  );
  return credit / matches.length;
}

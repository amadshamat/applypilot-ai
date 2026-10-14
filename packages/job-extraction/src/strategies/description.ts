import type { PartialJob } from '../types';
import { elementToText, uniqueStrings } from '../text';
import { parseSections } from './sections';
import {
  findDeadline,
  findEducationLines,
  findEmploymentType,
  findSalary,
  findSkills,
  findWorkArrangement,
  findYearsOfExperience,
} from './text-signals';

/**
 * Derives structured attributes from a job description's content: requirement
 * lists by section, skills, experience, salary and so on. The same analysis
 * runs whether the description came from JSON-LD, a site adapter or the page.
 */
export function analyzeDescription(root: Element, title: string | null): PartialJob {
  const out: PartialJob = {};
  const text = elementToText(root);
  if (text.length === 0) return out;

  const sections = parseSections(root);
  if (sections.required.length > 0) {
    out.requiredQualifications = { value: uniqueStrings(sections.required), confidence: 'medium' };
  }
  if (sections.preferred.length > 0) {
    out.preferredQualifications = {
      value: uniqueStrings(sections.preferred),
      confidence: 'medium',
    };
  }

  const education = uniqueStrings([
    ...sections.education,
    ...findEducationLines([...sections.required, ...sections.preferred]),
  ]);
  if (education.length > 0) out.education = { value: education, confidence: 'medium' };

  // Skills come from requirement sections when they exist, so a benefits blurb
  // ("we use Slack and Python internally") does not inflate the list.
  const requirementText = [...sections.required, ...sections.preferred].join('\n');
  const skills = findSkills(requirementText.length > 0 ? `${requirementText}\n${text}` : text);
  if (skills.length > 0) out.skills = { value: skills, confidence: 'medium' };

  const years = findYearsOfExperience(text);
  if (years) out.yearsOfExperience = years;

  const arrangement = findWorkArrangement(text);
  if (arrangement) out.workArrangement = arrangement;

  const fromTitle = title ? findEmploymentType(title) : null;
  const employmentType = fromTitle
    ? { ...fromTitle, confidence: 'high' as const }
    : findEmploymentType(text);
  if (employmentType) out.employmentType = employmentType;

  const salary = findSalary(text);
  if (salary) out.salary = salary;

  const deadline = findDeadline(text);
  if (deadline) out.applicationDeadline = deadline;

  return out;
}

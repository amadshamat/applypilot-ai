import type { ReviewedCoverLetter, ReviewedResume, ReviewedScreening } from './grounding';

/** Plain-text renderings for copying or downloading a reviewed draft. */

export function resumeToText(resume: ReviewedResume): string {
  const out: string[] = [];
  if (resume.summary.text) out.push('SUMMARY', resume.summary.text, '');
  const section = (title: string, entries: ReviewedResume['experience']) => {
    const withBullets = entries.filter((e) => e.bullets.length > 0);
    if (withBullets.length === 0) return;
    out.push(title);
    for (const entry of withBullets) {
      out.push(entry.label, ...entry.bullets.map((b) => `• ${b.text}`), '');
    }
  };
  section('EXPERIENCE', resume.experience);
  section('PROJECTS', resume.projects);
  if (resume.skillsToFeature.length > 0) out.push('SKILLS', resume.skillsToFeature.join(', '), '');
  return out.join('\n').trim();
}

export function coverLetterToText(
  letter: Pick<ReviewedCoverLetter, 'greeting' | 'paragraphs' | 'closing'>,
): string {
  return [letter.greeting, ...letter.paragraphs.map((p) => p.text), letter.closing]
    .filter(Boolean)
    .join('\n\n');
}

export function screeningToText(screening: ReviewedScreening): string {
  return screening.answers
    .map((a) => `${a.question}\n${a.answer || '(answer this yourself)'}`)
    .join('\n\n');
}

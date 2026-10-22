/** Collapses whitespace and trims. */
export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Label text without required markers ("First name *", "Email (required)"). */
export function cleanLabel(text: string | null | undefined): string {
  return clean(text)
    .replace(/\s*\((?:required|optional)\)\s*/gi, ' ')
    .replace(/\s*[*✱]+\s*/g, ' ')
    .replace(/\s*:\s*$/, '')
    .trim();
}

/** True when the page marks the label as required ("Email *", "(required)"). */
export function labelMarksRequired(text: string): boolean {
  return /[*✱]|\(required\)/i.test(text);
}

/**
 * Splits names and ids into words: "legalNameSection_firstName" and
 * "job_application[answers_attributes][0][text_value]" become plain words.
 */
export function nameWords(...parts: (string | null | undefined)[]): string {
  return clean(
    parts
      .filter(Boolean)
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-[\].:/#]+/g, ' ')
      .toLowerCase(),
  );
}

/** Lower-case words for matching: punctuation removed, "e-mail" kept as "e mail". */
export function normalize(text: string): string {
  return clean(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9+#]+/g, ' '),
  );
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

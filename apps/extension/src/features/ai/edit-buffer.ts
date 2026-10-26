/**
 * A synchronous copy of text typed into a draft box that has not reached
 * chrome.storage yet. chrome.storage writes are asynchronous, so closing the
 * side panel straight after typing could drop the last change; this page's
 * localStorage is written on every keystroke and read back the next time the
 * draft is shown. It is cleared as soon as the change is stored, and by
 * Delete all local data.
 */

const PREFIX = 'applypilot.draftEdit:';

export interface EditTarget {
  task: string;
  jobKey: string;
  generatedAt: string;
  part: string;
}

const keyOf = (t: EditTarget) =>
  `${PREFIX}${JSON.stringify([t.task, t.jobKey, t.generatedAt, t.part])}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readBuffered(target: EditTarget): string | null {
  try {
    return storage()?.getItem(keyOf(target)) ?? null;
  } catch {
    return null;
  }
}

export function writeBuffered(target: EditTarget, text: string) {
  try {
    storage()?.setItem(keyOf(target), text);
  } catch {
    // Storage full or blocked: the debounced save still runs.
  }
}

/** Clears the copy, but only if it still holds `text` (a newer keystroke keeps its own). */
export function clearBuffered(target: EditTarget, text?: string) {
  try {
    const s = storage();
    if (!s) return;
    if (text === undefined || s.getItem(keyOf(target)) === text) s.removeItem(keyOf(target));
  } catch {
    // Nothing to clear.
  }
}

/** Removes every unsaved copy (Delete all local data). */
export function clearAllBuffered() {
  try {
    const s = storage();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

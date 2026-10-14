/** Random identifier for profile items and resume versions. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

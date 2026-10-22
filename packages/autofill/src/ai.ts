import type { FieldMapping, MapFieldsRequest, MappableFieldKind } from '@applypilot/ai-core';
import type { DetectedField } from '@applypilot/shared';
import type { Classification, FieldKind } from './classify';
import { classifyField } from './classify';

/**
 * The optional AI step for fields the rules could not place. Only the form's
 * own labels are sent (no profile data), only for fields classified
 * "unknown", and the answer can only name a profile field: every value still
 * comes from the profile and every AI-mapped field is shown for review.
 */

/** Compile-time check: every kind the model may return is a kind the engine knows. */
type Assert<T extends true> = T;
export type MappableKindsAreFieldKinds = Assert<MappableFieldKind extends FieldKind ? true : false>;

export const MAX_AI_FIELDS = 40;

export interface AiMappingRequest {
  request: MapFieldsRequest;
  /** Field id sent ("F1") to the field's ref on the page ("f12"). */
  refs: Record<string, string>;
}

/** The request for fields the rules left unknown, or null when there are none. */
export function buildMappingRequest(fields: readonly DetectedField[]): AiMappingRequest | null {
  const unknown = fields
    .filter(
      (f) => f.label.length > 0 && f.control !== 'file' && classifyField(f).kind === 'unknown',
    )
    .slice(0, MAX_AI_FIELDS);
  if (unknown.length === 0) return null;
  const refs: Record<string, string> = {};
  const request: MapFieldsRequest = {
    fields: unknown.map((f, index) => {
      const id = `F${index + 1}`;
      refs[id] = f.ref;
      return {
        id,
        label: f.label.slice(0, 300),
        hint: f.hint.slice(0, 300),
        section: f.section.slice(0, 200),
        control: f.control,
        options: f.options.slice(0, 20).map((o) => o.label.slice(0, 100)),
      };
    }),
  };
  return { request, refs };
}

/** AI mappings as classifications keyed by field ref, never above medium confidence. */
export function aiClassifications(
  mappings: readonly FieldMapping[],
  refs: Readonly<Record<string, string>>,
): Record<string, Classification> {
  const out: Record<string, Classification> = {};
  for (const m of mappings) {
    const ref = refs[m.fieldId];
    if (!ref) continue;
    out[ref] = {
      kind: m.kind,
      confidence: m.confidence === 'high' ? 'medium' : m.confidence,
      reason: 'AI suggestion',
      topic: '',
      datePart: null,
      source: 'ai',
    };
  }
  return out;
}

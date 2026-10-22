import {
  MAPPABLE_FIELD_KINDS,
  type FieldMappings,
  type MapFieldsRequest,
  type MappableFieldKind,
} from './contracts';
import { classifyQuestion } from './screening';

/**
 * Checks for the field-mapping task, on both sides of the wire.
 *
 * Before sending, fields whose label is a sensitive or personal question are
 * removed, so they are never sent to a model at all. After the answer comes
 * back, only mappings for fields that were sent, to a known kind, survive.
 */

const KINDS = new Set<string>(MAPPABLE_FIELD_KINDS);

export function isMappableKind(kind: string): kind is MappableFieldKind {
  return KINDS.has(kind);
}

export interface FieldMapping {
  fieldId: string;
  kind: MappableFieldKind;
  confidence: 'high' | 'medium' | 'low';
}

/** Splits fields into those that may be sent and those the user must answer. */
export function filterMappableFields(request: MapFieldsRequest) {
  const sendable: MapFieldsRequest['fields'] = [];
  const skipped: { questionId: string; reason: string }[] = [];
  for (const field of request.fields) {
    const category = classifyQuestion(`${field.label} ${field.hint}`).category;
    if (category === 'draftable') sendable.push(field);
    else
      skipped.push({
        questionId: field.id,
        reason: 'This field asks something only you can answer.',
      });
  }
  return { sendable, skipped };
}

/** The model's mappings that refer to a field that was sent and to a known kind, one per field. */
export function groundFieldMappings(
  request: MapFieldsRequest,
  output: FieldMappings,
): FieldMapping[] {
  const sent = new Set(request.fields.map((f) => f.id));
  const seen = new Set<string>();
  const out: FieldMapping[] = [];
  for (const m of output.mappings) {
    if (!sent.has(m.fieldId) || seen.has(m.fieldId) || !isMappableKind(m.kind)) continue;
    seen.add(m.fieldId);
    out.push({ fieldId: m.fieldId, kind: m.kind, confidence: m.confidence });
  }
  return out;
}

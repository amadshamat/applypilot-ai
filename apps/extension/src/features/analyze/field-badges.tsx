import type { Confidence, ExtractionSource } from '@applypilot/shared';
import { Badge } from '../../components/ui/badge';
import { CONFIDENCE_LABELS, SOURCE_LABELS } from './format';

const CONFIDENCE_TONE = { high: 'success', medium: 'primary', low: 'warning' } as const;

export function Provenance({
  source,
  confidence,
}: {
  source: ExtractionSource;
  confidence: Confidence;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={CONFIDENCE_TONE[confidence]} title={CONFIDENCE_LABELS[confidence]}>
        <span className="sr-only">{CONFIDENCE_LABELS[confidence]}</span>
        <span aria-hidden>{confidence}</span>
      </Badge>
      <Badge>{SOURCE_LABELS[source]}</Badge>
    </span>
  );
}

export function MissingBadge() {
  return <Badge className="italic">Not found</Badge>;
}

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, XCircle } from 'lucide-react';
import type { ExtractionCheck, JobExtractionResult } from '@applypilot/shared';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { cn } from '../../lib/cn';
import { diagnosticsReport } from './diagnostics-report';

const STATUS = {
  pass: { icon: CheckCircle2, className: 'text-success', label: 'Passed' },
  warn: { icon: AlertTriangle, className: 'text-warning', label: 'Check' },
  fail: { icon: XCircle, className: 'text-danger', label: 'Failed' },
} as const;

function CheckRow({ check }: { check: ExtractionCheck }) {
  const { icon: Icon, className, label } = STATUS[check.status];
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon aria-hidden className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', className)} />
      <span className="sr-only">{label}:</span>
      <span>{check.message}</span>
    </li>
  );
}

export function ExtractionChecks({ result }: { result: JobExtractionResult }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const checks = result.diagnostics?.checks ?? [];
  const problems = checks.filter((c) => c.status !== 'pass').length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsReport(result));
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <Card>
      <details open={problems > 0}>
        <summary className="cursor-pointer text-sm font-semibold">
          How this was read
          <span className="ml-1 font-normal text-muted">
            {problems > 0 ? `· ${problems} to check` : '· all checks passed'}
          </span>
        </summary>
        <div className="mt-2 space-y-2">
          {result.diagnostics?.scope === 'selected-job' ? (
            <p className="text-xs text-muted">
              Only the selected job was read. Other jobs on the page were ignored.
            </p>
          ) : null}
          {checks.length > 0 ? (
            <ul className="space-y-1" aria-label="Extraction checks">
              {checks.map((check, i) => (
                <CheckRow key={`${check.id}-${i}`} check={check} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No checks were recorded for this analysis.</p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <ClipboardCopy aria-hidden className="h-3.5 w-3.5" /> Copy details for a bug report
            </Button>
            {copied === 'copied' ? (
              <span className="text-xs text-muted" role="status">
                Copied. It has no job text or profile data.
              </span>
            ) : null}
            {copied === 'failed' ? (
              <span className="text-xs text-danger" role="status">
                Could not copy.
              </span>
            ) : null}
          </div>
        </div>
      </details>
    </Card>
  );
}

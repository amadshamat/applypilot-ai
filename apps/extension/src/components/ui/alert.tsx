import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

const TONES = {
  info: {
    icon: Info,
    className: 'border-primary/30 bg-primary/5 text-foreground',
    iconClass: 'text-primary',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-success/30 bg-success-surface',
    iconClass: 'text-success',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-warning/30 bg-warning-surface',
    iconClass: 'text-warning',
  },
  error: {
    icon: XCircle,
    className: 'border-danger/30 bg-danger-surface',
    iconClass: 'text-danger',
  },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { icon: Icon, className, iconClass } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3', className)}
    >
      <Icon aria-hidden className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children ? <div className="text-xs text-muted">{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

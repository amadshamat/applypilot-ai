import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const TONES = {
  neutral: 'bg-surface-muted text-muted',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-warning',
  danger: 'bg-danger-surface text-danger',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONES;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

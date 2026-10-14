import type { ComponentType, ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <div className="rounded-full bg-primary/10 p-3">
        <Icon aria-hidden className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <div className="mx-auto max-w-xs text-xs text-muted">{description}</div>
      </div>
      {action}
    </div>
  );
}

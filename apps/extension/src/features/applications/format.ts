import type { ApplicationStage } from '@applypilot/shared';

export const STAGE_TONES: Record<
  ApplicationStage,
  'neutral' | 'primary' | 'success' | 'warning' | 'danger'
> = {
  saved: 'neutral',
  preparing: 'neutral',
  'ready-to-apply': 'primary',
  applied: 'primary',
  assessment: 'warning',
  interview: 'warning',
  offer: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

export function formatDay(day: string, withYear = true): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

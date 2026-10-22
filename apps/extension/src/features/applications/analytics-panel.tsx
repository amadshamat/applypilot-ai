import { APPLICATION_STAGES, type ApplicationRecord } from '@applypilot/shared';
import { STAGE_LABELS, computeAnalytics } from '@applypilot/tracking';
import { Card, CardDescription } from '../../components/ui/card';
import { formatDay } from './format';
import { dayOf, today } from './use-applications';

const percent = (value: number | null) =>
  value === null ? 'No data' : `${Math.round(value * 100)}%`;

const PLATFORM_NAMES: Record<string, string> = {
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  generic: 'Other sites',
  manual: 'Added by hand',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-base font-semibold">{value}</p>
      {hint ? <p className="text-[10px] text-muted">{hint}</p> : null}
    </div>
  );
}

/** A labelled list with proportional bars; the numbers are in the text, the bars are decoration. */
function Bars({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <ul className="space-y-1" aria-label={title}>
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-[11px]"
          >
            <span className="truncate">{row.label}</span>
            <span aria-hidden className="h-2 rounded bg-surface-muted">
              <span
                className="block h-2 rounded bg-primary"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalyticsPanel({ records }: { records: readonly ApplicationRecord[] }) {
  const stats = computeAnalytics(records, { today: today(), dayOf });
  if (stats.total === 0) {
    return (
      <p className="text-xs text-muted">
        Analytics appear once you track applications. Every number is computed from your own records
        in this browser.
      </p>
    );
  }
  return (
    <section className="space-y-3" aria-label="Analytics">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Tracked" value={String(stats.total)} hint={`${stats.active} still open`} />
        <Stat label="Applied" value={String(stats.applied)} />
        <Stat
          label="Response rate"
          value={percent(stats.responseRate)}
          hint={`${stats.responded} of ${stats.applied} answered`}
        />
        <Stat
          label="Interview rate"
          value={percent(stats.interviewRate)}
          hint={`${stats.interviews} reached an interview`}
        />
        <Stat label="Offers" value={String(stats.offers)} />
        <Stat
          label="Days to first answer"
          value={
            stats.medianDaysToResponse === null ? 'No data' : String(stats.medianDaysToResponse)
          }
          hint="Median"
        />
        <Stat
          label="Average match score"
          value={stats.averageMatchScore === null ? 'No data' : String(stats.averageMatchScore)}
          hint="Of applications sent"
        />
      </div>
      <Card className="space-y-3">
        <Bars
          title="By status"
          rows={APPLICATION_STAGES.map((s) => ({
            label: STAGE_LABELS[s],
            value: stats.byStatus[s],
          }))}
        />
        <Bars
          title="Applications sent per week"
          rows={stats.weekly.map((w) => ({
            label: `Week of ${formatDay(w.weekStart, false)}`,
            value: w.applied,
          }))}
        />
        <Bars
          title="Where the jobs came from"
          rows={stats.byPlatform.map((p) => ({
            label: PLATFORM_NAMES[p.platform] ?? p.platform,
            value: p.count,
          }))}
        />
      </Card>
      <CardDescription>
        Computed from your {stats.total} tracked application{stats.total === 1 ? '' : 's'}. Rates
        count applications marked Applied or later; an answer is any move to Assessment, Interview,
        Offer or Rejected.
      </CardDescription>
    </section>
  );
}

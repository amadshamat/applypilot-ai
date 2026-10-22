import { useState } from 'react';
import { BarChart3, BellRing, Download, ListChecks, Plus } from 'lucide-react';
import { APPLICATION_STAGES } from '@applypilot/shared';
import {
  DEFAULT_FILTER,
  STAGE_LABELS,
  dueFollowUps,
  filterRecords,
  quietApplications,
  setFollowUp,
  toCsv,
  type RecordFilter,
  type SortOrder,
  type StatusFilter,
} from '@applypilot/tracking';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Input, Select } from '../../components/ui/field';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/cn';
import { downloadText } from '../ai/download';
import { AddApplicationForm } from './add-application-form';
import { AnalyticsPanel } from './analytics-panel';
import { ApplicationCard } from './application-card';
import { formatDay } from './format';
import { useTrackerFocus } from './focus-store';
import { clock, dayOf, today, useApplications } from './use-applications';

const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'applied', label: 'Applied date' },
  { value: 'follow-up', label: 'Follow-up date' },
  { value: 'company', label: 'Company' },
];

export function ApplicationsView() {
  const { loading, records, unreadable, error, save, add, remove } = useApplications();
  const [tab, setTab] = useState<'list' | 'analytics'>('list');
  const [filter, setFilter] = useState<RecordFilter>(DEFAULT_FILTER);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const { openId, setOpenId } = useTrackerFocus();

  const day = today();
  const reminders = dueFollowUps(records, day);
  const quiet = quietApplications(records, day, dayOf);
  const shown = filterRecords(records, filter, day);
  const update = (patch: Partial<RecordFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const exportCsv = () => {
    downloadText(
      `applypilot-applications-${day}.csv`,
      toCsv(filterRecords(records, { ...DEFAULT_FILTER, sort: 'applied' }, day), dayOf),
      'text/csv;charset=utf-8',
    );
    setNotice(`Exported ${records.length} application${records.length === 1 ? '' : 's'} as CSV.`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-brand">Applications</h1>
          <p className="text-xs text-muted">
            Tracked in this browser only. Nothing is sent anywhere.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={adding}>
            <Plus aria-hidden className="h-3.5 w-3.5" /> Add
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={exportCsv}
            disabled={records.length === 0}
            aria-label="Export CSV"
          >
            <Download aria-hidden className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      {error ? (
        <Alert tone="error" title="Something went wrong">
          {error}
        </Alert>
      ) : null}
      {unreadable > 0 ? (
        <Alert tone="warning" title="Some saved applications could not be read">
          {unreadable} stored entr{unreadable === 1 ? 'y is' : 'ies are'} not shown because{' '}
          {unreadable === 1 ? 'it does' : 'they do'} not match this version. They are kept as they
          are; use Settings, Export data to get a copy.
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-muted">
          {notice}
        </p>
      ) : null}

      {adding ? (
        <AddApplicationForm
          add={add}
          onDone={(id, message) => {
            setAdding(false);
            setNotice(message);
            if (id) {
              setOpenId(id);
              setFilter(DEFAULT_FILTER);
              setTab('list');
            }
          }}
        />
      ) : null}

      {reminders.length > 0 ? (
        <Alert tone="warning" title={`Follow-ups due (${reminders.length})`}>
          <ul className="mt-1 space-y-1">
            {reminders.map(({ record, overdueDays }) => (
              <li key={record.id} className="flex items-center gap-2">
                <BellRing aria-hidden className="h-3 w-3 shrink-0" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left underline"
                  onClick={() => {
                    setTab('list');
                    setFilter(DEFAULT_FILTER);
                    setOpenId(record.id);
                  }}
                >
                  {record.job.title}
                  {record.job.company ? ` at ${record.job.company}` : ''}
                  {record.followUp?.note ? `: ${record.followUp.note}` : ''}
                </button>
                <span className="shrink-0 text-[11px]">
                  {overdueDays === 0
                    ? 'today'
                    : `${overdueDays} day${overdueDays === 1 ? '' : 's'} late`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Mark follow-up done: ${record.job.title}`}
                  onClick={() => void save(setFollowUp(record, null, clock.now()))}
                >
                  Done
                </Button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {quiet.length > 0 ? (
        <p className="text-xs text-muted">
          {quiet.length} application{quiet.length === 1 ? ' has' : 's have'} had no answer for two
          weeks or more. Open {quiet.length === 1 ? 'it' : 'them'} to set a follow-up reminder if
          you want one.
        </p>
      ) : null}

      <div className="flex gap-1" role="group" aria-label="Tracker view">
        {(
          [
            { id: 'list', label: 'List', icon: ListChecks },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? 'primary' : 'ghost'}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" /> {label}
          </Button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-24" />
      ) : tab === 'analytics' ? (
        <AnalyticsPanel records={records} />
      ) : records.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing tracked yet"
          description="Save a job from the Analyze tab, mark an application as applied after autofill, or add one by hand. Each one gets a status, notes and an optional follow-up reminder."
          action={
            adding ? null : (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden className="h-3.5 w-3.5" /> Add an application
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="space-y-1.5">
            <Input
              type="search"
              aria-label="Search applications"
              placeholder="Search title, company, location or notes"
              value={filter.query}
              onChange={(e) => update({ query: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                aria-label="Filter by status"
                value={filter.status}
                onChange={(e) => update({ status: e.target.value as StatusFilter })}
                className="w-auto"
              >
                <option value="all">All statuses</option>
                <option value="active">Open (not rejected or withdrawn)</option>
                <option value="closed">Closed</option>
                {APPLICATION_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Sort by"
                value={filter.sort}
                onChange={(e) => update({ sort: e.target.value as SortOrder })}
                className="w-auto"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={filter.dueOnly}
                  onChange={(e) => update({ dueOnly: e.target.checked })}
                />
                Follow-up due
              </label>
            </div>
            <p className="text-[11px] text-muted" aria-live="polite">
              Showing {shown.length} of {records.length}
              {filter.dueOnly ? ` due by ${formatDay(day)}` : ''}
            </p>
          </div>
          {shown.length === 0 ? (
            <p className="text-xs text-muted">No applications match these filters.</p>
          ) : (
            <ul className={cn('space-y-2')}>
              {shown.map((record) => (
                <li key={record.id}>
                  <ApplicationCard
                    record={record}
                    open={openId === record.id}
                    onToggle={() => setOpenId(openId === record.id ? null : record.id)}
                    onSave={(next) => void save(next)}
                    onRemove={(id) => {
                      void remove(id).then(() => setNotice(`Deleted ${record.job.title}.`));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

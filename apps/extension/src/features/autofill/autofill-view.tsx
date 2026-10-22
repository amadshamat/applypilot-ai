import { useId, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  ExternalLink,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
} from 'lucide-react';
import { PLATFORMS, type ProposedValue } from '@applypilot/autofill';
import { isProfileEmpty, type FormScan } from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Input, Select, Textarea } from '../../components/ui/field';
import { Skeleton } from '../../components/ui/skeleton';
import { useAiConnection } from '../../hooks/use-ai-connection';
import { useSettings } from '../../hooks/use-settings';
import { MarkAppliedCard } from '../applications/track-buttons';
import { useAnalysis } from '../analyze/store';
import { useNavigation } from '../navigation/store';
import { useProfile } from '../profile/use-profile';
import { groupOf, isLocked, summarize, valueText, type ReviewRow, type RowGroup } from './review';
import { useAutofill } from './use-autofill';

const GROUPS: { id: RowGroup; title: string; description: string }[] = [
  { id: 'ready', title: 'Ready to fill', description: 'Exact matches from your profile.' },
  { id: 'review', title: 'Check these', description: 'A value is proposed, but look at it first.' },
  {
    id: 'questions',
    title: 'Open questions',
    description: 'Type an answer, or draft one with AI.',
  },
  {
    id: 'missing',
    title: 'Missing from your profile',
    description: 'Type a value to fill it, or add it to your profile.',
  },
  {
    id: 'manual',
    title: 'You answer these on the page',
    description: 'Sensitive or personal questions. ApplyPilot never fills them.',
  },
  {
    id: 'other',
    title: 'Not recognised or not supported',
    description: 'Type a value if you like, or handle these on the page.',
  },
];

const STATUS_BADGE: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'primary' }
> = {
  ready: { label: 'Ready', tone: 'success' },
  done: { label: 'Already filled', tone: 'neutral' },
  review: { label: 'Review', tone: 'warning' },
  question: { label: 'Question', tone: 'primary' },
  missing: { label: 'Missing', tone: 'warning' },
  manual: { label: 'You answer', tone: 'danger' },
  unknown: { label: 'Unrecognised', tone: 'neutral' },
  unsupported: { label: 'Not supported', tone: 'neutral' },
};

function Header() {
  return (
    <div>
      <h1 className="text-base font-semibold text-brand">Autofill</h1>
      <p className="text-xs text-muted">
        Fills only the fields you approve, from your profile. ApplyPilot never presses Submit, Next
        or Apply.
      </p>
    </div>
  );
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function ValueEditor({
  row,
  onEdit,
}: {
  row: ReviewRow;
  onEdit: (value: ProposedValue | null) => void;
}) {
  const id = useId();
  const { field } = row.proposal;
  const label = `Value for ${field.label || 'this field'}`;
  if (row.value?.type === 'file') {
    return (
      <p className="text-xs">
        Attaches <span className="font-medium">{row.value.fileName}</span>
      </p>
    );
  }
  if (field.control === 'file') return null;
  if (field.control === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-xs" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={row.value?.type === 'check' && row.value.checked}
          onChange={(e) => onEdit({ type: 'check', checked: e.target.checked })}
        />
        Tick this box
      </label>
    );
  }
  if (field.control === 'checkbox-group') {
    return <p className="text-xs text-muted">{valueText(row.value) || 'No boxes chosen.'}</p>;
  }
  const choice = ['select', 'radio-group', 'listbox-button', 'combobox'].includes(field.control);
  if (choice && field.options.length > 0) {
    const current = row.value?.type === 'choose' ? row.value.value : '';
    return (
      <Select
        aria-label={label}
        value={field.options.some((o) => o.value === current) ? current : ''}
        onChange={(e) => {
          const option = field.options.find((o) => o.value === e.target.value);
          onEdit(option ? { type: 'choose', value: option.value, label: option.label } : null);
        }}
      >
        <option value="">Leave as it is</option>
        {field.options.map((o) => (
          <option key={`${o.value}|${o.label}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  const text = valueText(row.value);
  const toValue = (next: string): ProposedValue =>
    choice ? { type: 'choose', value: next, label: next } : { type: 'text', text: next };
  return field.control === 'textarea' ? (
    <Textarea
      aria-label={label}
      rows={4}
      value={text}
      placeholder="Type an answer"
      onChange={(e) => onEdit(toValue(e.target.value))}
    />
  ) : (
    <Input
      aria-label={label}
      value={text}
      placeholder="Type a value"
      onChange={(e) => onEdit(toValue(e.target.value))}
    />
  );
}

function FieldRow({
  row,
  onEdit,
  onApprove,
}: {
  row: ReviewRow;
  onEdit: (value: ProposedValue | null) => void;
  onApprove: (approved: boolean) => void;
}) {
  const { proposal } = row;
  const { field, classification } = proposal;
  const locked = isLocked(row);
  const badge = STATUS_BADGE[proposal.status] ?? STATUS_BADGE.unknown;
  const name = field.label || 'Unlabeled field';
  const source = row.edited ? 'Typed by you' : proposal.source;
  return (
    <li
      className="space-y-1.5 rounded-lg border border-border px-3 py-2"
      data-testid="autofill-row"
      data-status={proposal.status}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium break-words">
            {name}
            {field.required ? <span className="text-danger"> *</span> : null}
          </p>
          {field.section ? <p className="text-[11px] text-muted">{field.section}</p> : null}
        </div>
        {badge ? (
          <Badge tone={badge.tone} className="shrink-0">
            {badge.label}
          </Badge>
        ) : null}
      </div>
      {locked ? (
        <p className="flex items-start gap-1 text-[11px] text-muted">
          <Lock aria-hidden className="mt-0.5 h-3 w-3 shrink-0" /> {proposal.note}
        </p>
      ) : (
        <>
          <ValueEditor row={row} onEdit={onEdit} />
          {proposal.note && !row.edited ? (
            <p className="text-[11px] text-warning">{proposal.note}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {source ? (
              <span>
                {source}
                {!row.edited && row.value
                  ? ` · ${classification.source === 'ai' ? 'AI-matched' : 'rules'}, ${classification.confidence} confidence`
                  : ''}
              </span>
            ) : null}
            {row.value ? (
              <>
                <label className="flex items-center gap-1 font-medium text-foreground">
                  <input
                    type="checkbox"
                    aria-label={`Fill ${name}`}
                    checked={row.approved}
                    onChange={(e) => onApprove(e.target.checked)}
                  />
                  Fill
                </label>
                {row.value.type !== 'file' ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 hover:text-foreground"
                    onClick={() => copy(valueText(row.value))}
                    aria-label={`Copy answer: ${name}`}
                  >
                    <Copy aria-hidden className="h-3 w-3" /> Copy
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}

function ScanSummary({ scan }: { scan: FormScan }) {
  const platform = PLATFORMS[scan.platform];
  return (
    <div className="space-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
      <p className="font-medium">{scan.title || 'Application form'}</p>
      <p className="flex flex-wrap items-center gap-1 text-muted">
        <Badge tone="neutral">{platform.name}</Badge>
        <Badge tone="warning">{platform.status === 'verified' ? 'Verified' : 'Experimental'}</Badge>
        {scan.step.current ? (
          <span>
            Step {scan.step.current}
            {scan.step.total ? ` of ${scan.step.total}` : ''}
          </span>
        ) : null}
      </p>
      <p className="text-[11px] text-muted">{platform.note}</p>
    </div>
  );
}

function Notices({ scan }: { scan: FormScan }) {
  return (
    <>
      {scan.blockedFrames.length > 0 ? (
        <Alert tone="warning" title="The form is inside a frame from another site">
          Chrome does not let ApplyPilot read it here. Open the form in its own tab, then scan
          again.
          <span className="mt-1 flex flex-col gap-1">
            {scan.blockedFrames.map((f) => (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-primary underline"
              >
                <ExternalLink aria-hidden className="h-3 w-3" /> Open {new URL(f.origin).hostname}
              </a>
            ))}
          </span>
        </Alert>
      ) : null}
      {scan.captcha ? (
        <Alert tone="info" title="This page has a CAPTCHA">
          ApplyPilot does not touch it. Complete it yourself before you submit.
        </Alert>
      ) : null}
      {scan.unsupportedFields.length > 0 ? (
        <Alert tone="warning" title="Questions to answer on the page">
          These use buttons ApplyPilot does not click: {scan.unsupportedFields.join('; ')}.
        </Alert>
      ) : null}
      {scan.step.hasNext ? (
        <Alert tone="info" title="More steps may follow">
          Fill this step, check it, then press the page&apos;s own Next or Continue button. Scan
          again on the next step.
        </Alert>
      ) : null}
    </>
  );
}

export function AutofillView() {
  const setView = useNavigation((s) => s.setView);
  const { settings } = useSettings();
  const { connection } = useAiConnection();
  const { state: profileState } = useProfile();
  const profile = profileState?.status === 'ok' ? profileState.profile : null;
  const autofill = useAutofill(profile, connection, settings?.allowAiProcessing === true);
  const [showLocked, setShowLocked] = useState(true);
  const analysis = useAnalysis((s) => s.state);

  if (!profileState) {
    return (
      <div className="space-y-3">
        <Header />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!profile || isProfileEmpty(profile)) {
    return (
      <div className="space-y-3">
        <Header />
        <EmptyState
          icon={UserRound}
          title="Build your profile first"
          description="Autofill uses only what your profile holds. Upload a resume or add your details."
          action={<Button onClick={() => setView('resume')}>Go to Profile</Button>}
        />
      </div>
    );
  }

  const { scanState, rows, fillState } = autofill;
  const scanning = scanState.status === 'scanning';
  const approvedCount = rows.filter(
    (r) => r.approved && r.value && !isLocked(r) && !(r.proposal.status === 'done' && !r.edited),
  ).length;
  const unknownCount = rows.filter((r) => r.proposal.status === 'unknown').length;
  const questionCount = rows.filter((r) => r.proposal.status === 'question').length;

  return (
    <div className="space-y-3">
      <Header />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void autofill.scan()}
          disabled={scanning || fillState.status === 'filling'}
        >
          <ScanSearch aria-hidden className="h-4 w-4" />
          {scanState.status === 'ready' ? 'Scan again' : 'Scan this form'}
        </Button>
        {autofill.resumes.length > 1 ? (
          <Select
            aria-label="Resume to attach"
            className="w-auto max-w-[12rem]"
            value={autofill.resumeId ?? ''}
            onChange={(e) => autofill.setResumeId(e.target.value || null)}
          >
            {autofill.resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || r.fileName}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {scanState.status === 'idle' ? (
        <EmptyState
          icon={Wand2}
          title="Open an application form"
          description="Go to the application page, then scan it. You will see every field and its proposed answer before anything is filled."
        />
      ) : null}
      {scanning ? <Skeleton className="h-32 w-full" /> : null}
      {scanState.status === 'error' ? (
        <Alert tone="error" title="The form could not be scanned">
          {scanState.error.message}
        </Alert>
      ) : null}

      {scanState.status === 'ready' ? (
        <>
          <ScanSummary scan={scanState.scan} />
          <Notices scan={scanState.scan} />
          {rows.length === 0 ? (
            <Alert tone="info" title="No fields found">
              ApplyPilot found no form fields on this page. If the form opens after a click, open it
              and scan again.
            </Alert>
          ) : null}

          {(unknownCount > 0 || questionCount > 0) && autofill.aiReady ? (
            <Card className="space-y-2">
              <CardTitle className="flex items-center gap-1">
                <Sparkles aria-hidden className="h-4 w-4" /> AI help (optional)
              </CardTitle>
              {unknownCount > 0 ? (
                <div className="space-y-1">
                  <CardDescription>
                    Sends only the labels of the {unknownCount} unrecognised field
                    {unknownCount === 1 ? '' : 's'} (no profile data) to ask which profile field
                    each wants. Values still come from your profile.
                  </CardDescription>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void autofill.mapWithAi()}
                    disabled={autofill.mapping.status === 'loading'}
                  >
                    Match fields with AI
                  </Button>
                  {autofill.mapping.status === 'done' || autofill.mapping.status === 'error' ? (
                    <p
                      className={
                        autofill.mapping.status === 'error'
                          ? 'text-[11px] text-danger'
                          : 'text-[11px] text-muted'
                      }
                    >
                      {autofill.mapping.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {questionCount > 0 ? (
                <div className="space-y-1">
                  <CardDescription>
                    {autofill.canDraft
                      ? `Drafts the ${questionCount} open question${questionCount === 1 ? '' : 's'} with AI Tailor, from your profile and the analyzed job${autofill.jobTitle ? ` (${autofill.jobTitle})` : ''}. Sensitive questions are never sent.`
                      : 'To draft open questions with AI, analyze the job posting first in the Analyze tab.'}
                  </CardDescription>
                  {autofill.canDraft ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void autofill.draftQuestions()}
                      disabled={autofill.drafting.status === 'loading'}
                    >
                      Draft answers with AI Tailor
                    </Button>
                  ) : null}
                  {autofill.drafting.status === 'done' || autofill.drafting.status === 'error' ? (
                    <p
                      className={
                        autofill.drafting.status === 'error'
                          ? 'text-[11px] text-danger'
                          : 'text-[11px] text-muted'
                      }
                    >
                      {autofill.drafting.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}

          {GROUPS.map((group) => {
            const inGroup = rows.filter((r) => groupOf(r) === group.id);
            if (inGroup.length === 0) return null;
            const collapsible = group.id === 'manual';
            return (
              <section key={group.id} className="space-y-1.5" aria-label={group.title}>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-xs font-semibold">
                    {group.title} <span className="font-normal text-muted">({inGroup.length})</span>
                  </h2>
                  {collapsible ? (
                    <button
                      type="button"
                      className="text-[11px] text-muted underline"
                      onClick={() => setShowLocked((v) => !v)}
                    >
                      {showLocked ? 'Hide' : 'Show'}
                    </button>
                  ) : null}
                </div>
                <p className="text-[11px] text-muted">{group.description}</p>
                {!collapsible || showLocked ? (
                  <ul className="space-y-1.5">
                    {inGroup.map((row) => (
                      <FieldRow
                        key={row.proposal.field.ref}
                        row={row}
                        onEdit={(value) => autofill.edit(row.proposal.field.ref, value)}
                        onApprove={(approved) => autofill.approve(row.proposal.field.ref, approved)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}

          {rows.length > 0 ? (
            <div className="sticky bottom-0 space-y-1 border-t border-border bg-background py-2">
              <Button
                className="w-full"
                onClick={() => void autofill.fill()}
                disabled={approvedCount === 0 || fillState.status === 'filling'}
              >
                <Check aria-hidden className="h-4 w-4" />
                {fillState.status === 'filling'
                  ? 'Filling…'
                  : `Fill ${approvedCount} approved field${approvedCount === 1 ? '' : 's'}`}
              </Button>
              <p className="flex items-center gap-1 text-[11px] text-muted">
                <ShieldCheck aria-hidden className="h-3 w-3" /> Nothing is submitted. Check the
                page, then submit it yourself.
              </p>
            </div>
          ) : null}

          {fillState.status === 'error' ? (
            <Alert tone="error" title="Nothing was filled">
              {fillState.message}
            </Alert>
          ) : null}
          {fillState.status === 'done' ? (
            <>
              <FillResults report={fillState.report} rows={rows} />
              <MarkAppliedCard
                scan={scanState.scan}
                analysis={sameSiteAnalysis(analysis, scanState.scan)}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The analyzed job, when it was read on the same site as the form (job page and form often differ by subdomain). */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.split('.').slice(-2).join('.');
  } catch {
    return '';
  }
}

function sameSiteAnalysis(
  analysis: ReturnType<typeof useAnalysis.getState>['state'],
  scan: FormScan,
) {
  if (analysis.status !== 'success') return null;
  const site = siteOf(scan.url);
  return site && siteOf(analysis.result.pageUrl) === site ? analysis.result : null;
}

function FillResults({
  report,
  rows,
}: {
  report: Parameters<typeof summarize>[0];
  rows: ReviewRow[];
}) {
  const { counts, problems } = summarize(report, rows);
  return (
    <Card className="space-y-2" role="status" aria-label="Fill results">
      <CardTitle>
        Filled {counts.filled} field{counts.filled === 1 ? '' : 's'}
      </CardTitle>
      <p className="flex flex-wrap gap-1 text-[11px]">
        <Badge tone="success">{counts.filled} filled</Badge>
        <Badge tone="neutral">{counts.skipped} skipped</Badge>
        <Badge tone="neutral">{counts.unsupported} not supported</Badge>
        <Badge tone="danger">{counts.failed} failed</Badge>
      </p>
      {problems.length > 0 ? (
        <ul className="space-y-1 text-[11px]">
          {problems.map((p) => (
            <li key={`${p.label}-${p.message}`} className="flex items-start gap-1">
              <Ban aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
              <span>
                <span className="font-medium">{p.label}</span>: {p.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {report.blockedSubmissions > 0 ? (
        <p className="text-[11px] text-warning">
          The page tried to submit while filling; ApplyPilot stopped it{' '}
          {report.blockedSubmissions === 1 ? 'once' : `${report.blockedSubmissions} times`}.
        </p>
      ) : null}
      {report.newFields > 0 ? (
        <Alert tone="info" title="New questions appeared">
          Your answers revealed {report.newFields} more field{report.newFields === 1 ? '' : 's'}.
          Scan again to review them.
        </Alert>
      ) : null}
      <p className="text-[11px] text-muted">
        Nothing was submitted. Review every field on the page before you submit.
      </p>
    </Card>
  );
}

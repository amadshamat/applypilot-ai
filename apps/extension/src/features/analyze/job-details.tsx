import type { ReactNode } from 'react';
import {
  Briefcase,
  Building2,
  CalendarClock,
  DollarSign,
  Hash,
  Laptop,
  MapPin,
  Timer,
} from 'lucide-react';
import type { ExtractedField, JobExtractionResult } from '@applypilot/shared';
import { Badge } from '../../components/ui/badge';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { MissingBadge, Provenance } from './field-badges';
import {
  ARRANGEMENT_LABELS,
  EMPLOYMENT_LABELS,
  PLATFORM_LABELS,
  formatDate,
  formatExperience,
  formatSalary,
} from './format';

function FieldRow<T>({
  icon,
  label,
  field,
  render,
}: {
  icon: ReactNode;
  label: string;
  field: ExtractedField<T>;
  render: (value: T) => ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-2">
      <span className="mt-0.5 text-muted">{icon}</span>
      <dt className="w-24 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 space-y-1">
        {field.status === 'found' ? (
          <>
            <div className="text-sm break-words">{render(field.value)}</div>
            <Provenance source={field.source} confidence={field.confidence} />
          </>
        ) : (
          <MissingBadge />
        )}
      </dd>
    </div>
  );
}

function ListSection({ title, field }: { title: string; field: ExtractedField<string[]> }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {field.status === 'found' ? (
          <Provenance source={field.source} confidence={field.confidence} />
        ) : (
          <MissingBadge />
        )}
      </div>
      {field.status === 'found' ? (
        <ul className="list-disc space-y-1 pl-4 text-sm marker:text-muted">
          {field.value.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <CardDescription>The posting does not list this, so nothing was assumed.</CardDescription>
      )}
    </Card>
  );
}

const icon = (Icon: typeof MapPin) => <Icon aria-hidden className="h-4 w-4" />;

export function JobDetails({ result }: { result: JobExtractionResult }) {
  const { job } = result;
  const title = job.title.status === 'found' ? job.title.value : 'Untitled position';
  const company = job.company.status === 'found' ? job.company.value : null;
  const description = job.description.status === 'found' ? job.description.value : null;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="primary">{PLATFORM_LABELS[result.platform]}</Badge>
          {job.employmentType.status === 'found' ? (
            <Badge>{EMPLOYMENT_LABELS[job.employmentType.value]}</Badge>
          ) : null}
          {job.workArrangement.status === 'found' ? (
            <Badge>{ARRANGEMENT_LABELS[job.workArrangement.value]}</Badge>
          ) : null}
        </div>
        <h2 className="mt-2 text-base leading-snug font-semibold text-brand">{title}</h2>
        {company ? <p className="text-sm text-muted">{company}</p> : null}
      </Card>

      <Card>
        <CardTitle>Job details</CardTitle>
        <dl className="divide-y divide-border">
          <FieldRow icon={icon(Building2)} label="Company" field={job.company} render={(v) => v} />
          <FieldRow icon={icon(MapPin)} label="Location" field={job.location} render={(v) => v} />
          <FieldRow
            icon={icon(Laptop)}
            label="Work setup"
            field={job.workArrangement}
            render={(v) => ARRANGEMENT_LABELS[v]}
          />
          <FieldRow
            icon={icon(Briefcase)}
            label="Type"
            field={job.employmentType}
            render={(v) => EMPLOYMENT_LABELS[v]}
          />
          <FieldRow icon={icon(DollarSign)} label="Pay" field={job.salary} render={formatSalary} />
          <FieldRow
            icon={icon(Timer)}
            label="Experience"
            field={job.yearsOfExperience}
            render={formatExperience}
          />
          <FieldRow
            icon={icon(CalendarClock)}
            label="Deadline"
            field={job.applicationDeadline}
            render={formatDate}
          />
          <FieldRow icon={icon(Hash)} label="Job ID" field={job.jobId} render={(v) => v} />
        </dl>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <CardTitle>Skills and technologies</CardTitle>
          {job.skills.status === 'found' ? (
            <Provenance source={job.skills.source} confidence={job.skills.confidence} />
          ) : (
            <MissingBadge />
          )}
        </div>
        {job.skills.status === 'found' ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
            {job.skills.value.map((skill) => (
              <li key={skill}>
                <Badge tone="primary" className="text-xs">
                  {skill}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <CardDescription>No recognised technologies were mentioned.</CardDescription>
        )}
      </Card>

      <ListSection title="Required qualifications" field={job.requiredQualifications} />
      <ListSection title="Preferred qualifications" field={job.preferredQualifications} />
      <ListSection title="Education" field={job.education} />

      {description ? (
        <Card>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Full description</summary>
            <p className="mt-2 text-xs leading-relaxed whitespace-pre-line text-muted">
              {description}
            </p>
          </details>
        </Card>
      ) : null}
    </div>
  );
}

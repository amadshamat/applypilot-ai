import { useId, useState } from 'react';
import { APPLICATION_STAGES, jobPageIdentity, type ApplicationStage } from '@applypilot/shared';
import { STAGE_LABELS } from '@applypilot/tracking';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field, Input, Select } from '../../components/ui/field';
import type { useApplications } from './use-applications';

function checkUrl(value: string): string | null {
  if (!value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Track a job found elsewhere (an email, a career fair) by typing its details. */
export function AddApplicationForm({
  add,
  onDone,
}: {
  add: ReturnType<typeof useApplications>['add'];
  onDone: (id: string | null, message: string) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ApplicationStage>('saved');
  const [errors, setErrors] = useState<{ title?: string; url?: string }>({});

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const checked = checkUrl(url);
    const next = {
      ...(title.trim() ? {} : { title: 'Enter the job title.' }),
      ...(checked === null ? { url: 'Enter a full web address starting with https://' } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length > 0 || checked === null) return;
    const result = await add({
      job: {
        title: title.trim().slice(0, 300),
        company: company.trim().slice(0, 300),
        location: location.trim().slice(0, 300),
        url: checked,
        jobKey: checked ? jobPageIdentity(checked).slice(0, 4100) : '',
        platform: 'manual',
        pay: '',
      },
      source: 'manual',
      status,
      matchScore: null,
    });
    if (!result) return;
    onDone(
      result.record.id,
      result.created
        ? `Added ${result.record.job.title}.`
        : `You already track ${result.record.job.title}; it is shown below.`,
    );
  };

  return (
    <Card>
      <form
        noValidate
        className="space-y-2"
        onSubmit={(e) => void submit(e)}
        aria-label="Add an application"
      >
        <CardTitle>Add an application</CardTitle>
        <Field id={`${id}-title`} label="Job title" error={errors.title}>
          {(props) => (
            <Input
              {...props}
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field id={`${id}-company`} label="Company">
          {(props) => (
            <Input
              {...props}
              value={company}
              maxLength={300}
              onChange={(e) => setCompany(e.target.value)}
            />
          )}
        </Field>
        <Field id={`${id}-location`} label="Location">
          {(props) => (
            <Input
              {...props}
              value={location}
              maxLength={300}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
        </Field>
        <Field id={`${id}-url`} label="Posting address (optional)" error={errors.url}>
          {(props) => (
            <Input
              {...props}
              type="url"
              placeholder="https://"
              value={url}
              maxLength={4000}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
        <Field id={`${id}-status`} label="Status">
          {(props) => (
            <Select
              {...props}
              value={status}
              onChange={(e) => setStatus(e.target.value as ApplicationStage)}
            >
              {APPLICATION_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDone(null, '')}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

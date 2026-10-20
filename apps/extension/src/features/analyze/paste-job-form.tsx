import { useId, useState, type SyntheticEvent } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { extractFromText } from '@applypilot/job-extraction';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Input, Textarea } from '../../components/ui/field';
import { useServices } from '../../services/app-services';
import { useAnalysis } from './store';

const MIN_DESCRIPTION = 80;
/** Used when the tab's address is not visible, so the analysis still has a valid address. */
const PASTED_URL = 'https://applypilot.invalid/pasted-job';

/**
 * The fallback that always works: the user copies the job's text from the page
 * and ApplyPilot analyzes only that text. Nothing on the page is read.
 */
export function PasteJobForm({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const services = useServices();
  const showPasted = useAnalysis((s) => s.showPasted);
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const titleError = submitted && !title.trim() ? 'Enter the job title.' : undefined;
  const textError =
    submitted && text.trim().length < MIN_DESCRIPTION
      ? 'Paste the job description (at least a few sentences).'
      : undefined;

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ClipboardPaste aria-hidden className="h-3.5 w-3.5" /> Paste the job instead
      </Button>
    );
  }

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!title.trim() || text.trim().length < MIN_DESCRIPTION) return;
    const tabUrl = await services.getActiveTabUrl().catch(() => null);
    const pageUrl = tabUrl && /^https?:/i.test(tabUrl) ? tabUrl : PASTED_URL;
    showPasted(extractFromText(document, { title, company, location, text, pageUrl }));
  };

  return (
    <Card>
      <form className="space-y-2" onSubmit={(e) => void submit(e)} aria-label="Paste a job">
        <CardTitle>Paste the job</CardTitle>
        <CardDescription>
          Select the job details on the page, copy them (Cmd+C or Ctrl+C) and paste them here.
          ApplyPilot analyzes only this text.
        </CardDescription>
        <Field id={`${id}-title`} label="Job title" error={titleError}>
          {(props) => <Input {...props} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field id={`${id}-company`} label="Company (optional)">
          {(props) => (
            <Input {...props} value={company} onChange={(e) => setCompany(e.target.value)} />
          )}
        </Field>
        <Field id={`${id}-location`} label="Location (optional)">
          {(props) => (
            <Input {...props} value={location} onChange={(e) => setLocation(e.target.value)} />
          )}
        </Field>
        <Field id={`${id}-text`} label="Job description" error={textError}>
          {(props) => (
            <Textarea {...props} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Analyze pasted job
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

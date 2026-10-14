import { useId, useRef, useState, type DragEvent } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { newId, type ResumeVersionMeta } from '@applypilot/shared';
import { parseResumeText } from '@applypilot/resume-parser';
import {
  ResumeFileError,
  detectResumeType,
  validateResumeFile,
} from '@applypilot/resume-parser/files';
import { Alert } from '../../components/ui/alert';
import { cn } from '../../lib/cn';
import { useServices } from '../../services/app-services';

const ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Upload a PDF or DOCX resume. The file is read and parsed in this browser,
 * stored as a new resume version, and handed to the review screen. Nothing is
 * written to the profile here.
 */
export function ResumeUpload({ onParsed }: { onParsed: (meta: ResumeVersionMeta) => void }) {
  const id = useId();
  const { readResumeText, resumes } = useServices();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'reading'; name: string } | { kind: 'error'; message: string }
  >({
    kind: 'idle',
  });
  const [dragging, setDragging] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateResumeFile(file);
    const mimeType = detectResumeType(file.name, file.type);
    if (problem || !mimeType) {
      setStatus({
        kind: 'error',
        message: problem ?? 'Only PDF and Word (.docx) files are supported.',
      });
      return;
    }
    setStatus({ kind: 'reading', name: file.name });
    try {
      const text = await readResumeText(file);
      const meta: ResumeVersionMeta = {
        id: newId(),
        fileName: file.name.slice(0, 255),
        mimeType,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        text: text.slice(0, 200_000),
        parsed: parseResumeText(text),
        appliedAt: null,
        label: '',
      };
      await resumes.put(meta, file);
      setStatus({ kind: 'idle' });
      onParsed(meta);
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof ResumeFileError
            ? error.message
            : 'This file could not be read. Try another copy or a different format.',
      });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void handle(event.dataTransfer.files[0]);
  };

  const reading = status.kind === 'reading';
  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        {reading ? (
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <FileUp aria-hidden className="h-5 w-5 text-primary" />
        )}
        <p className="text-sm font-medium" role="status">
          {reading ? `Reading ${status.name}…` : 'Drop your resume here'}
        </p>
        <p className="text-xs text-muted">
          PDF or Word (.docx), up to 5 MB. Read on this device; never uploaded.
        </p>
        <label
          htmlFor={`${id}-file`}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90',
            reading && 'pointer-events-none opacity-50',
          )}
        >
          Choose a file
        </label>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={reading}
          onChange={(event) => void handle(event.target.files?.[0])}
        />
      </div>
      {status.kind === 'error' ? (
        <Alert tone="error" title="Could not use this file">
          {status.message}
        </Alert>
      ) : null}
    </div>
  );
}

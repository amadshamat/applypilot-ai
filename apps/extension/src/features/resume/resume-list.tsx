import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Pencil, Trash2 } from 'lucide-react';
import type { ResumeVersionMeta } from '@applypilot/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { useServices } from '../../services/app-services';
import { formatBytes } from '../profile/format';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Every uploaded resume, newest first, with review, download and delete. */
export function ResumeList({
  refreshKey,
  onReview,
}: {
  refreshKey: number;
  onReview: (meta: ResumeVersionMeta) => void;
}) {
  const { resumes } = useServices();
  const [items, setItems] = useState<ResumeVersionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    resumes
      .list()
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [resumes]);

  useEffect(load, [load, refreshKey]);

  const download = async (meta: ResumeVersionMeta) => {
    const file = await resumes.getFile(meta.id);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = meta.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    await resumes.remove(id);
    setConfirming(null);
    load();
  };

  if (error) return <p className="text-xs text-danger">Could not load saved resumes: {error}</p>;
  if (!items) return null;

  return (
    <Card className="space-y-3" role="region" aria-label="Saved resumes">
      <div>
        <CardTitle>
          Saved resumes <span className="font-normal text-muted">({items.length})</span>
        </CardTitle>
        <CardDescription>
          Original files are kept unchanged in this browser so you can download them again.
        </CardDescription>
      </div>
      {items.length === 0 ? <p className="text-xs text-muted">No resumes uploaded yet.</p> : null}
      <ul className="space-y-2">
        {items.map((meta) => (
          <li key={meta.id} className="rounded-lg border border-border">
            <div className="flex items-center gap-2 px-2.5 py-2">
              <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{meta.fileName}</p>
                <p className="text-xs text-muted">
                  {dateFormat.format(new Date(meta.uploadedAt))} · {formatBytes(meta.size)}
                </p>
                {meta.appliedAt ? (
                  <Badge tone="success">Applied to profile</Badge>
                ) : (
                  <Badge>Not applied</Badge>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Review ${meta.fileName}`}
                onClick={() => onReview(meta)}
              >
                <Pencil aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Download ${meta.fileName}`}
                onClick={() => void download(meta)}
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${meta.fileName}`}
                onClick={() => setConfirming(meta.id)}
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </div>
            {confirming === meta.id ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-danger-surface px-2.5 py-2 text-xs">
                <span className="flex-1">Delete this file? Your profile is not changed.</span>
                <Button size="sm" variant="danger" onClick={() => void remove(meta.id)}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

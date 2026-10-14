import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { FieldErrors } from './validation';

/**
 * A profile section holding a list of entries (education, experience, …).
 * Each entry shows a one-line summary with edit and delete; editing expands
 * the entry's form in place. New entries open straight into edit mode.
 */
export function EntryList<T extends { id: string }>({
  title,
  description,
  items,
  onChange,
  create,
  summary,
  renderForm,
  errors,
  path,
  addLabel,
  emptyText,
}: {
  title: string;
  description?: string;
  items: readonly T[];
  onChange: (items: T[]) => void;
  create: () => T;
  summary: (item: T) => { primary: string; secondary?: string };
  renderForm: (
    item: T,
    update: (patch: Partial<T>) => void,
    errorFor: (field: string) => string | undefined,
  ) => ReactNode;
  errors: FieldErrors;
  /** Key of this list in the profile, used to find validation errors. */
  path: string;
  addLabel: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const update = (id: string, patch: Partial<T>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const remove = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
    setConfirmDelete(null);
    if (open === id) setOpen(null);
  };
  const move = (index: number, offset: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + offset, 0, item);
    onChange(next);
  };
  const add = () => {
    const item = create();
    onChange([...items, item]);
    setOpen(item.id);
  };

  return (
    <Card className="space-y-3" aria-label={title} role="region">
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>
            {title} <span className="font-normal text-muted">({items.length})</span>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <Button size="sm" variant="secondary" onClick={add}>
          <Plus aria-hidden className="h-3.5 w-3.5" /> {addLabel}
        </Button>
      </div>
      {items.length === 0 ? <p className="text-xs text-muted">{emptyText}</p> : null}
      <ul className="space-y-2">
        {items.map((item, index) => {
          const { primary, secondary } = summary(item);
          const base = `${path}.${String(index)}`;
          const hasError = Object.keys(errors).some(
            (key) => key === base || key.startsWith(`${base}.`),
          );
          const errorFor = (field: string) => errors[`${base}.${field}`];
          const isOpen = open === item.id || hasError;
          return (
            <li key={item.id} className="rounded-lg border border-border">
              <div className="flex items-center gap-1 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {primary || <span className="text-muted">Untitled</span>}
                  </p>
                  {secondary ? <p className="truncate text-xs text-muted">{secondary}</p> : null}
                  {errors[base] ? <p className="text-[11px] text-danger">{errors[base]}</p> : null}
                  {hasError && !errors[base] ? <Badge tone="danger">Needs a fix</Badge> : null}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${primary || 'entry'} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${primary || 'entry'} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${isOpen ? 'Close' : 'Edit'} ${primary || 'entry'}`}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(open === item.id ? null : item.id)}
                >
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${primary || 'entry'}`}
                  onClick={() => setConfirmDelete(item.id)}
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </Button>
              </div>
              {confirmDelete === item.id ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-border bg-danger-surface px-2.5 py-2 text-xs">
                  <span className="flex-1">Delete this entry?</span>
                  <Button size="sm" variant="danger" onClick={() => remove(item.id)}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                    Keep
                  </Button>
                </div>
              ) : null}
              {isOpen ? (
                <div className="space-y-2 border-t border-border p-2.5">
                  {renderForm(item, (patch) => update(item.id, patch), errorFor)}
                  {open === item.id ? (
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                        Done
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

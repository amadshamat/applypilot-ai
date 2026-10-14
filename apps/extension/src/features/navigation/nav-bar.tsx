import { useRef, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { useNavigation } from './store';
import { VIEWS } from './views';

/**
 * Primary navigation as an ARIA tab list: arrow keys, Home and End move between
 * views, and labels collapse to icons with tooltips at narrow widths.
 */
export function NavBar() {
  const { view, setView } = useNavigation();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = VIEWS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = VIEWS[next];
    if (target) {
      setView(target.id);
      refs.current[next]?.focus();
    }
  };

  return (
    <nav aria-label="Primary">
      <div
        role="tablist"
        aria-label="ApplyPilot sections"
        className="flex border-b border-border px-1"
      >
        {VIEWS.map(({ id, label, shortLabel, icon: Icon }, index) => {
          const selected = id === view;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              id={`tab-${id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${id}`}
              tabIndex={selected ? 0 : -1}
              title={label}
              aria-label={label}
              onClick={() => setView(id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 border-b-2 px-0.5 py-2 text-[11px] font-medium transition-colors',
                selected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              <span className="max-w-full truncate max-[319px]:sr-only">{shortLabel ?? label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

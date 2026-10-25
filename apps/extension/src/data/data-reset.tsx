import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { STORAGE_KEYS } from '@applypilot/shared';
import { useServices } from '../services/app-services';
import { PAGE_ORIGIN, resetPageState } from './page-state';

/**
 * Keeps every open ApplyPilot page in step after data is deleted, imported
 * or an import is undone.
 *
 * The page that made the change writes `applypilot.dataReset` (see
 * announceDataReset). Every page listening here then drops what it holds in
 * memory: the page analysis, the open tracker entry, and, on the other
 * pages, everything below the boundary is mounted afresh so forms and lists
 * re-read storage instead of showing deleted or replaced data.
 */

const resetSchema = z.object({
  at: z.string(),
  reason: z.enum(['deleted', 'imported', 'undone']),
  origin: z.string(),
});

export function DataResetBoundary({ children }: { children: ReactNode }) {
  const { localStore } = useServices();
  const [generation, setGeneration] = useState(0);

  useEffect(
    () =>
      localStore.subscribe(STORAGE_KEYS.dataReset, (value) => {
        const event = resetSchema.safeParse(value);
        if (!event.success) return;
        resetPageState();
        // The page that made the change keeps its views so it can show the result.
        if (event.data.origin !== PAGE_ORIGIN) setGeneration((g) => g + 1);
      }),
    [localStore],
  );

  return <Fragment key={generation}>{children}</Fragment>;
}

import { useCallback, useEffect, useState } from 'react';
import type { AiTask, TaskTypes } from '@applypilot/ai-core';
import { AiClientError } from '../../services/ai-client';
import { useServices } from '../../services/app-services';
import type { AiConnection } from '../../storage/ai-connection-repository';
import type { SavedDraft } from '../../storage/ai-drafts-repository';

export type AiTaskState<T extends AiTask> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; draft: SavedDraft<T>; restored: boolean }
  | { status: 'error'; message: string };

/**
 * Runs one AI task for one job and keeps its latest draft. Mount it with a
 * `key` per job so switching jobs starts fresh.
 */
export function useAiTask<T extends AiTask>(task: T, jobKey: string) {
  const services = useServices();
  const [state, setState] = useState<AiTaskState<T>>({ status: 'idle' });

  useEffect(() => {
    let active = true;
    void services.aiDrafts.find(task, jobKey).then((draft) => {
      if (active && draft) {
        setState((current) =>
          current.status === 'idle' ? { status: 'success', draft, restored: true } : current,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [services, task, jobKey]);

  const run = useCallback(
    async (connection: AiConnection, request: TaskTypes[T]['request']) => {
      setState({ status: 'loading' });
      try {
        const response = await services.ai.run(connection, task, request);
        const draft: SavedDraft<T> = {
          task,
          jobKey,
          savedAt: new Date().toISOString(),
          request,
          response,
        };
        // An edited draft this replaces is kept as `previous`, so it can be restored.
        const stored = await services.aiDrafts.save(draft);
        setState({ status: 'success', draft: stored, restored: false });
      } catch (e) {
        setState({
          status: 'error',
          message: e instanceof AiClientError ? e.message : 'The draft could not be generated.',
        });
      }
    },
    [services, task, jobKey],
  );

  const discard = useCallback(async () => {
    await services.aiDrafts.remove(task, jobKey);
    setState({ status: 'idle' });
  }, [services, task, jobKey]);

  /**
   * Stores the edited text of one part (null: back to the generated text).
   * Returns false if the draft shown is no longer the stored one.
   */
  const saveEdit = useCallback(
    async (generatedAt: string, part: string, text: string | null) => {
      const updated = await services.aiDrafts.saveEdit(task, jobKey, generatedAt, part, text);
      if (!updated) return false;
      setState((current) =>
        current.status === 'success' && current.draft.response.generatedAt === generatedAt
          ? { ...current, draft: updated }
          : current,
      );
      return true;
    },
    [services, task, jobKey],
  );

  /** Brings back the edited draft that the current one replaced. */
  const restorePrevious = useCallback(async () => {
    const restored = await services.aiDrafts.restorePrevious(task, jobKey);
    if (restored) setState({ status: 'success', draft: restored, restored: true });
  }, [services, task, jobKey]);

  return { state, run, discard, saveEdit, restorePrevious };
}

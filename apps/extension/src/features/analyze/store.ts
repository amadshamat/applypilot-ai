import { create } from 'zustand';
import type { AppError, JobExtractionResult } from '@applypilot/shared';
import type { AppServices } from '../../services/app-services';

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: JobExtractionResult; fromCache: boolean }
  | { status: 'error'; error: AppError };

interface AnalysisStore {
  state: AnalysisState;
  analyze: (services: AppServices) => Promise<void>;
  restoreCached: (services: AppServices) => Promise<void>;
  /** Shows an analysis made outside the page, from text the user pasted. */
  showPasted: (result: JobExtractionResult) => void;
  reset: () => void;
}

export const useAnalysis = create<AnalysisStore>((set, get) => ({
  state: { status: 'idle' },
  async analyze(services) {
    if (get().state.status === 'loading') return;
    set({ state: { status: 'loading' } });
    const response = await services.send({ type: 'job/extract-active-tab' });
    set({
      state: response.ok
        ? { status: 'success', result: response.data, fromCache: false }
        : { status: 'error', error: response.error },
    });
  },
  async restoreCached(services) {
    const tabId = await services.getActiveTabId();
    if (tabId === null || get().state.status !== 'idle') return;
    const response = await services.send({ type: 'job/get-cached', tabId });
    if (response.ok && response.data && get().state.status === 'idle') {
      set({ state: { status: 'success', result: response.data, fromCache: true } });
    }
  },
  showPasted: (result) => set({ state: { status: 'success', result, fromCache: false } }),
  reset: () => set({ state: { status: 'idle' } }),
}));

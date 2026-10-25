import { useAnalysis } from '../features/analyze/store';
import { useTrackerFocus } from '../features/applications/focus-store';

/** Identifies this page (the side panel or the options page are separate pages). */
export const PAGE_ORIGIN =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `page-${Math.random().toString(36).slice(2)}`;

/** Clears the state pages keep in memory across tabs of the side panel. */
export function resetPageState() {
  useAnalysis.getState().reset();
  useTrackerFocus.getState().setOpenId(null);
}

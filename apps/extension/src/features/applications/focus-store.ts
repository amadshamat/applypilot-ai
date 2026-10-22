import { create } from 'zustand';

/** Which tracked application is expanded, so other tabs can open the tracker on one. */
interface TrackerFocus {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

export const useTrackerFocus = create<TrackerFocus>((set) => ({
  openId: null,
  setOpenId: (openId) => set({ openId }),
}));

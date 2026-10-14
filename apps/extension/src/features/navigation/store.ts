import { create } from 'zustand';
import type { ViewId } from './views';

interface NavigationState {
  view: ViewId;
  setView: (view: ViewId) => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  view: 'analyze',
  setView: (view) => set({ view }),
}));

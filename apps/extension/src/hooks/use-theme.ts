import { useEffect } from 'react';
import type { ThemePreference } from '@applypilot/shared';

/** Applies the theme preference to <html>, following the OS when set to "system". */
export function useTheme(preference: ThemePreference | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = preference === 'dark' || (preference !== 'light' && media.matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    if (preference === 'system' || preference === undefined) {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [preference]);
}

import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@applypilot/shared';
import { useServices } from '../services/app-services';

/** Live settings: loads once, then follows storage changes from any extension page. */
export function useSettings() {
  const { settings: repository } = useServices();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    repository
      .load()
      .then((loaded) => active && setSettings(loaded))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : String(e)));
    const unsubscribe = repository.subscribe((next) => active && setSettings(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repository]);

  const save = useCallback(
    async (next: Settings) => {
      const saved = await repository.save(next);
      setSettings(saved);
      return saved;
    },
    [repository],
  );

  return { settings, error, save };
}

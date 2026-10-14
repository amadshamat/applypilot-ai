import { useCallback, useEffect, useState } from 'react';
import type { Profile, ProfileContent } from '@applypilot/shared';
import { useServices } from '../../services/app-services';
import type { ProfileLoad } from '../../storage/profile-repository';

/** Live profile: loads once, then follows changes saved from any extension page. */
export function useProfile() {
  const { profile: repository } = useServices();
  const [state, setState] = useState<ProfileLoad | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    repository
      .load()
      .then((loaded) => active && setState(loaded))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : String(e)));
    const unsubscribe = repository.subscribe((next) => active && setState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repository]);

  const save = useCallback(
    async (content: ProfileContent): Promise<Profile> => {
      const saved = await repository.save(content);
      setState({ status: 'ok', profile: saved });
      return saved;
    },
    [repository],
  );

  const reset = useCallback(async () => {
    await repository.clear();
    setState({ status: 'empty' });
  }, [repository]);

  return { state, error, save, reset };
}

import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../services/app-services';
import type { AiConnection } from '../storage/ai-connection-repository';

/** Live AI connection settings: loads once, then follows changes from any extension page. */
export function useAiConnection() {
  const { aiConnection: repository } = useServices();
  const [connection, setConnection] = useState<AiConnection | null>(null);

  useEffect(() => {
    let active = true;
    void repository.load().then((loaded) => active && setConnection(loaded));
    const unsubscribe = repository.subscribe((next) => active && setConnection(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repository]);

  const save = useCallback(
    async (next: AiConnection) => {
      const saved = await repository.save(next);
      setConnection(saved);
      return saved;
    },
    [repository],
  );

  return { connection, save };
}

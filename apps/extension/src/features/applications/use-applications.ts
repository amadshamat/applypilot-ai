import { useCallback, useEffect, useState } from 'react';
import { newId, type ApplicationRecord, type NewApplication } from '@applypilot/shared';
import { createApplication, findDuplicate, localDay, type Clock } from '@applypilot/tracking';
import { useServices } from '../../services/app-services';
import type { ApplicationsLoad } from '../../storage/applications-repository';

export const clock: Clock = { now: () => new Date(), newId };

/** The user's local calendar day, as YYYY-MM-DD. */
export const today = () => localDay(new Date());
/** The user's local calendar day of a stored timestamp. */
export const dayOf = (iso: string) => localDay(new Date(iso));

/** Live list of tracked applications: loads once, then follows changes from any extension page. */
export function useApplications() {
  const { applications: repository } = useServices();
  const [state, setState] = useState<ApplicationsLoad | null>(null);
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

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | null> => {
    try {
      setError(null);
      return await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  /** Saves a changed record (the result of one of the tracking operations). */
  const save = useCallback(
    (record: ApplicationRecord) =>
      run(async () => {
        const records = await repository.upsert(record);
        setState((s) => ({ records, unreadable: s?.unreadable ?? [] }));
        return record;
      }),
    [repository, run],
  );

  /** Starts tracking a job, unless it is already tracked; returns the record either way. */
  const add = useCallback(
    (input: NewApplication) =>
      run(async () => {
        const { records } = await repository.load();
        const existing = findDuplicate(records, input.job);
        if (existing) return { record: existing, created: false };
        const record = createApplication(input, clock);
        const next = await repository.upsert(record);
        setState((s) => ({ records: next, unreadable: s?.unreadable ?? [] }));
        return { record, created: true };
      }),
    [repository, run],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const records = await repository.remove(id);
        setState((s) => ({ records, unreadable: s?.unreadable ?? [] }));
      }),
    [repository, run],
  );

  return {
    loading: state === null && error === null,
    records: state?.records ?? [],
    unreadable: state?.unreadable.length ?? 0,
    error,
    save,
    add,
    remove,
  };
}

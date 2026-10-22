import { useCallback, useEffect, useState } from 'react';
import type { CloudSession } from '../cloud/auth';
import type { CloudSettings } from '../cloud/connection';
import type { BackupSummary } from '../cloud/local-data';
import type { SyncStatus } from '../cloud/sync-store';
import { useServices } from '../services/app-services';

export interface CloudView {
  settings: CloudSettings | null;
  /** The session for the saved connection; null when signed out. */
  session: CloudSession | null;
  status: SyncStatus | null;
  backups: BackupSummary[];
  reloadBackups: () => void;
}

/** Cloud settings, sign-in and the latest sync status, kept current across pages. */
export function useCloud(): CloudView {
  const { cloud } = useServices();
  const [settings, setSettings] = useState<CloudSettings | null>(null);
  const [rawSession, setRawSession] = useState<CloudSession | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);

  const reloadBackups = useCallback(() => {
    void cloud.backups().then(setBackups);
  }, [cloud]);

  useEffect(() => {
    let active = true;
    void Promise.all([cloud.settings.load(), cloud.auth.session(), cloud.status.load()]).then(
      ([s, session, st]) => {
        if (!active) return;
        setSettings(s);
        setRawSession(session);
        setStatus(st);
      },
    );
    reloadBackups();
    const unsubscribers = [
      cloud.settings.subscribe(setSettings),
      cloud.auth.subscribe(setRawSession),
      cloud.status.subscribe((st) => {
        setStatus(st);
        reloadBackups();
      }),
    ];
    return () => {
      active = false;
      unsubscribers.forEach((u) => u());
    };
  }, [cloud, reloadBackups]);

  const connection = settings?.connection ?? null;
  const session =
    rawSession &&
    connection &&
    rawSession.authUrl === connection.authUrl &&
    rawSession.clientId === connection.clientId
      ? rawSession
      : null;
  return { settings, session, status, backups, reloadBackups };
}

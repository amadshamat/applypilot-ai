import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@applypilot/shared';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { clearCachedAnalyses } from '../../data/analysis-cache';
import { buildBackup } from '../../data/backup-format';
import { PAGE_ORIGIN, resetPageState } from '../../data/page-state';
import { announceDataReset } from '../../data/import-plan';
import { useServices } from '../../services/app-services';
import { downloadText } from '../ai/download';
import { clearAllBuffered } from '../ai/edit-buffer';
import { ImportData } from './import-data';

/** Export, import and deletion of everything ApplyPilot stores in this browser. */
export function DataControls() {
  const { localStore, sessionStore, settings, resumes, cloud, appVersion } = useServices();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportData = async () => {
    // Everything stored here, including the original resume files. The API access token is left out.
    const text = await buildBackup(localStore, resumes, { appVersion });
    downloadText(
      `applypilot-export-${new Date().toISOString().slice(0, 10)}.json`,
      text,
      'application/json',
    );
    setMessage('Export downloaded. It includes your resume files; keep it somewhere private.');
  };

  const deleteData = async () => {
    await localStore.clear();
    await resumes.clear();
    // Signs this browser out of ApplyPilot Cloud too. Cloud data is deleted from Cloud sync.
    await cloud.auth.forget();
    // Page analyses cached for open tabs, and what this page holds in memory.
    await clearCachedAnalyses(sessionStore);
    clearAllBuffered();
    resetPageState();
    await settings.save(DEFAULT_SETTINGS);
    // Tells the other open ApplyPilot pages to drop what they show.
    await announceDataReset(localStore, 'deleted', PAGE_ORIGIN);
    setConfirming(false);
    setMessage(
      'All local ApplyPilot data, including your profile, resumes, tracked applications, AI drafts, the API token and cloud sync settings, was deleted, along with the cached page analyses. This browser is signed out of ApplyPilot Cloud; cloud data is managed under Cloud sync. Settings are back to defaults.',
    );
  };

  return (
    <Card className="space-y-3">
      <div>
        <CardTitle>Your data</CardTitle>
        <CardDescription>
          Everything ApplyPilot stores lives in this browser. Export it, import it back, or delete
          it at any time.
        </CardDescription>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void exportData()}>
          <Download aria-hidden className="h-3.5 w-3.5" /> Export data
        </Button>
        {confirming ? (
          <>
            <Button size="sm" variant="danger" onClick={() => void deleteData()}>
              Yes, delete everything
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setConfirming(true);
              setMessage(null);
            }}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" /> Delete all local data
          </Button>
        )}
      </div>
      {confirming ? (
        <p className="text-xs text-danger">
          This permanently removes your profile, uploaded resumes, tracked applications, AI drafts,
          settings and saved data from this browser.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-xs text-muted">
          {message}
        </p>
      ) : null}
      <ImportData onImported={() => setMessage(null)} />
    </Card>
  );
}

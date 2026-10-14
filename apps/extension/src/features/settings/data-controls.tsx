import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@applypilot/shared';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { useServices } from '../../services/app-services';

/** Export and deletion of everything ApplyPilot stores in this browser. */
export function DataControls() {
  const { localStore, settings, resumes } = useServices();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportData = async () => {
    const data = await localStore.getAll();
    // Resume metadata, extracted text and parsed drafts. Original files stay downloadable from the Profile tab.
    const resumeVersions = await resumes.list();
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), data, resumes: resumeVersions },
          null,
          2,
        ),
      ],
      {
        type: 'application/json',
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `applypilot-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Export downloaded.');
  };

  const deleteData = async () => {
    await localStore.clear();
    await resumes.clear();
    await settings.save(DEFAULT_SETTINGS);
    setConfirming(false);
    setMessage(
      'All local ApplyPilot data, including your profile and resumes, was deleted. Settings are back to defaults.',
    );
  };

  return (
    <Card className="space-y-3">
      <div>
        <CardTitle>Your data</CardTitle>
        <CardDescription>
          Everything ApplyPilot stores lives in this browser. Export it or delete it at any time.
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
          This permanently removes your profile, uploaded resumes, settings and saved data from this
          browser.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-xs text-muted">
          {message}
        </p>
      ) : null}
    </Card>
  );
}

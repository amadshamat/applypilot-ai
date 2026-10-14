import { ExternalLink } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { useSettings } from '../../hooks/use-settings';
import { useServices } from '../../services/app-services';
import { DataControls } from './data-controls';
import { SettingsForm, SettingsLoadError } from './settings-form';

export function SettingsView({ showOpenFullPage = true }: { showOpenFullPage?: boolean }) {
  const { settings, error, save } = useSettings();
  const { openOptionsPage } = useServices();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-brand">Settings</h1>
        {showOpenFullPage ? (
          <Button size="sm" variant="ghost" onClick={openOptionsPage}>
            Open in a tab <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {error ? <SettingsLoadError message={error} /> : null}
      {!settings && !error ? <Skeleton className="h-64 w-full" /> : null}
      {settings ? <SettingsForm settings={settings} onSave={save} /> : null}
      <DataControls />
    </div>
  );
}

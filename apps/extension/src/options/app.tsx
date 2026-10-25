import { APP_NAME, APP_TAGLINE } from '@applypilot/shared';
import { ErrorBoundary } from '../components/error-boundary';
import { DataResetBoundary } from '../data/data-reset';
import { useSettings } from '../hooks/use-settings';
import { useTheme } from '../hooks/use-theme';
import { SettingsView } from '../features/settings/settings-view';

export function OptionsApp() {
  const { settings } = useSettings();
  useTheme(settings?.theme);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-4">
          <img src="icons/icon-48.png" alt="" className="h-8 w-8" />
          <div>
            <p className="text-base font-semibold text-brand">{APP_NAME}</p>
            <p className="text-xs text-muted">{APP_TAGLINE}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-6">
        <ErrorBoundary>
          <DataResetBoundary>
            <SettingsView showOpenFullPage={false} />
          </DataResetBoundary>
        </ErrorBoundary>
      </main>
    </div>
  );
}

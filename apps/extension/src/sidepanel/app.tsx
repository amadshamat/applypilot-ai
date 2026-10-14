import { APP_NAME } from '@applypilot/shared';
import { ErrorBoundary } from '../components/error-boundary';
import { useSettings } from '../hooks/use-settings';
import { useTheme } from '../hooks/use-theme';
import { AnalyzeView } from '../features/analyze/analyze-view';
import { NavBar } from '../features/navigation/nav-bar';
import { useNavigation } from '../features/navigation/store';
import type { ViewId } from '../features/navigation/views';
import { RoadmapView } from '../features/roadmap/roadmap-view';
import { SettingsView } from '../features/settings/settings-view';

function CurrentView({ view }: { view: ViewId }) {
  switch (view) {
    case 'analyze':
      return <AnalyzeView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <RoadmapView feature={view} />;
  }
}

export function SidePanelApp() {
  const view = useNavigation((s) => s.view);
  const { settings } = useSettings();
  useTheme(settings?.theme);

  return (
    <div className="flex min-h-screen min-w-[280px] flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
        <img src="icons/icon-32.png" alt="" className="h-6 w-6" />
        <span className="text-sm font-semibold text-brand">{APP_NAME}</span>
      </header>
      <div className="sticky top-0 z-10 bg-surface">
        <NavBar />
      </div>
      <main
        id={`panel-${view}`}
        role="tabpanel"
        aria-labelledby={`tab-${view}`}
        tabIndex={0}
        className="flex-1 p-3 focus-visible:outline-none"
      >
        <ErrorBoundary resetKey={view}>
          <CurrentView view={view} />
        </ErrorBoundary>
      </main>
    </div>
  );
}

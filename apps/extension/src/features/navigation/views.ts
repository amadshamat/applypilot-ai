import {
  Bot,
  FileText,
  ListChecks,
  ScanSearch,
  Settings,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

export type ViewId = 'analyze' | 'autofill' | 'resume' | 'applications' | 'copilot' | 'settings';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  /** Visible text in the narrow tab bar; `label` stays the accessible name. */
  shortLabel?: string;
  icon: LucideIcon;
}

export const VIEWS: readonly ViewDefinition[] = [
  { id: 'analyze', label: 'Analyze', icon: ScanSearch },
  { id: 'autofill', label: 'Autofill', icon: Wand2 },
  { id: 'resume', label: 'Resume', icon: FileText },
  { id: 'applications', label: 'Applications', shortLabel: 'Tracker', icon: ListChecks },
  { id: 'copilot', label: 'AI Copilot', shortLabel: 'Copilot', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
];

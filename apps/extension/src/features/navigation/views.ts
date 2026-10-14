import {
  ListChecks,
  ScanSearch,
  Settings,
  Sparkles,
  UserRound,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

export type ViewId = 'analyze' | 'autofill' | 'resume' | 'applications' | 'tailor' | 'settings';

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
  { id: 'resume', label: 'Profile', icon: UserRound },
  { id: 'applications', label: 'Applications', shortLabel: 'Tracker', icon: ListChecks },
  { id: 'tailor', label: 'AI Tailor', shortLabel: 'Tailor', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: Settings },
];

import { Bot, ListChecks, Wand2, type LucideIcon } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';

interface PlannedFeature {
  icon: LucideIcon;
  title: string;
  phase: string;
  summary: string;
  points: string[];
}

const PLANNED: Record<'autofill' | 'applications' | 'copilot', PlannedFeature> = {
  autofill: {
    icon: Wand2,
    title: 'Assisted autofill',
    phase: 'Phase 4',
    summary:
      'Preview proposed answers for an application form and fill only the fields you approve.',
    points: [
      'Never submits or clicks Apply for you',
      'Leaves legal, eligibility and demographic questions to you',
      'Unknown answers stay blank',
    ],
  },
  applications: {
    icon: ListChecks,
    title: 'Application tracking',
    phase: 'Phase 5',
    summary:
      'Track every application from saved to offer, with follow-ups and analytics from your real data.',
    points: ['Status timeline and notes', 'Duplicate detection', 'CSV export'],
  },
  copilot: {
    icon: Bot,
    title: 'AI Copilot',
    phase: 'Phase 3',
    summary:
      'Ask questions about a job and your profile. Grounded in your verified information only.',
    points: [
      'Off until you allow AI processing',
      'Page content is treated as untrusted',
      'No invented experience or metrics',
    ],
  },
};

/** Honest placeholder for features that are not built yet. Nothing here pretends to work. */
export function RoadmapView({ feature }: { feature: keyof typeof PLANNED }) {
  const { icon: Icon, title, phase, summary, points } = PLANNED[feature];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold text-brand">{title}</h1>
        <Badge tone="warning">Not built yet · {phase}</Badge>
      </div>
      <Card className="flex gap-3">
        <div className="h-fit rounded-full bg-primary/10 p-2">
          <Icon aria-hidden className="h-4 w-4 text-primary" />
        </div>
        <div className="space-y-2">
          <CardTitle>What this will do</CardTitle>
          <CardDescription>{summary}</CardDescription>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

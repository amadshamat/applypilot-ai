import { dueFollowUps, localDay } from '@applypilot/tracking';
import type { ApplicationsRepository } from '../storage/applications-repository';

/**
 * Shows how many follow-ups are due on the toolbar icon. It reads the
 * tracker in this browser and changes only the icon's badge and tooltip;
 * nothing is sent anywhere and no notification pops up.
 */

export interface BadgeApi {
  setText: (text: string) => Promise<void>;
  setColor: (color: string) => Promise<void>;
  setTitle: (title: string) => Promise<void>;
}

export const DEFAULT_TITLE = 'Open ApplyPilot AI';

export async function refreshFollowUpBadge(
  applications: ApplicationsRepository,
  badge: BadgeApi,
  now: Date = new Date(),
): Promise<number> {
  const { records } = await applications.load();
  const due = dueFollowUps(records, localDay(now)).length;
  await badge.setText(due === 0 ? '' : due > 99 ? '99+' : String(due));
  if (due > 0) await badge.setColor('#B45309');
  await badge.setTitle(
    due === 0 ? DEFAULT_TITLE : `${DEFAULT_TITLE}: ${due} follow-up${due === 1 ? '' : 's'} due`,
  );
  return due;
}

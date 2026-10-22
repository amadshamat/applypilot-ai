import type { FormPlatform } from '@applypilot/shared';

/**
 * Application platforms ApplyPilot recognises by address. Recognising a
 * platform only changes the label shown and a few hints; every form is
 * detected and filled by the same generic engine.
 *
 * Support status is stated honestly: a platform is "verified" only after a
 * real application form on the live site was filled in Chrome. Until then it
 * is "experimental": tested on sample forms modeled on its public markup.
 */
export type SupportStatus = 'verified' | 'experimental';

export interface PlatformInfo {
  id: FormPlatform;
  name: string;
  status: SupportStatus;
  /** Shown under the platform name in the Autofill tab. */
  note: string;
}

const HOSTS: readonly [RegExp, FormPlatform][] = [
  [/(^|\.)smartapply\.indeed\.com$|(^|\.)indeed\.com$/i, 'indeed'],
  [/(^|\.)greenhouse\.io$/i, 'greenhouse'],
  [/(^|\.)lever\.co$/i, 'lever'],
  [/(^|\.)myworkdayjobs\.com$|(^|\.)myworkday(site)?\.com$|(^|\.)workday\.com$/i, 'workday'],
  [/(^|\.)ashbyhq\.com$/i, 'ashby'],
  [/(^|\.)smartrecruiters\.com$/i, 'smartrecruiters'],
];

export const PLATFORMS: Record<FormPlatform, PlatformInfo> = {
  indeed: {
    id: 'indeed',
    name: 'Indeed Apply',
    status: 'experimental',
    note: 'Tested on sample forms modeled on Indeed Apply. Not yet verified on a live application.',
  },
  greenhouse: {
    id: 'greenhouse',
    name: 'Greenhouse',
    status: 'experimental',
    note: 'Tested on sample forms modeled on Greenhouse job boards. Not yet verified on a live application.',
  },
  lever: {
    id: 'lever',
    name: 'Lever',
    status: 'experimental',
    note: 'Tested on sample forms modeled on Lever. Not yet verified on a live application.',
  },
  workday: {
    id: 'workday',
    name: 'Workday',
    status: 'experimental',
    note: 'Tested on sample multi-step forms modeled on Workday. Workday usually needs an account; sign in yourself. Not yet verified on a live application.',
  },
  ashby: {
    id: 'ashby',
    name: 'Ashby',
    status: 'experimental',
    note: 'Tested on sample forms modeled on Ashby. Not yet verified on a live application.',
  },
  smartrecruiters: {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    status: 'experimental',
    note: 'Tested on sample forms modeled on SmartRecruiters. Not yet verified on a live application.',
  },
  generic: {
    id: 'generic',
    name: 'Application form',
    status: 'experimental',
    note: 'Standard web form controls are supported. Check every value before you submit.',
  },
};

export function detectFormPlatform(url: string): FormPlatform {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return 'generic';
  }
  return HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? 'generic';
}

/** Frames on these hosts usually hold an embedded application form. */
export const FORM_FRAME_HOSTS =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkday(site)?\.com|smartrecruiters\.com|indeed\.com|icims\.com|jobvite\.com|bamboohr\.com|workable\.com)$/i;

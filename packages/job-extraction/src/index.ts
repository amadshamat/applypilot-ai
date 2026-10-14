export { extractJob, type ExtractOptions } from './extract';
export { waitForJobContent, isJobContentReady, type WaitOptions } from './wait';
export { SITE_ADAPTERS, detectPlatform } from './adapters';
export {
  findSkills,
  findSalary,
  findYearsOfExperience,
  findWorkArrangement,
  findEmploymentType,
  findEmploymentTypeList,
  parseEmploymentTypeLabels,
} from './strategies/text-signals';
export { parseSections, classifyHeading } from './strategies/sections';
export type { SiteAdapter, PartialJob } from './types';

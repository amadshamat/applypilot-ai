import type { Confidence, ExtractionSource, JobPosting, Platform } from '@applypilot/shared';

/** A value found by one strategy, before strategies are merged. */
export interface Found<T> {
  value: T;
  confidence: Confidence;
}

type ValueOf<F> = F extends { status: 'found'; value: infer V } ? V : never;

/** What a single strategy contributes: any subset of fields it could find. */
export type PartialJob = { [K in keyof JobPosting]?: Found<ValueOf<JobPosting[K]>> };

export interface SiteAdapter {
  platform: Exclude<Platform, 'generic'>;
  /** Cheap host/markup check. Must not touch the network. */
  matches(url: URL, doc: Document): boolean;
  /** Returns null when the page is on the platform but is not a job posting view. */
  extract(doc: Document, url: URL): PartialJob | null;
  /** The element holding the description, used for requirement and skill analysis. */
  descriptionElement(doc: Document): Element | null;
}

export interface StrategyOutput {
  source: ExtractionSource;
  fields: PartialJob;
}

import type {
  Confidence,
  ExtractionCheck,
  ExtractionSource,
  JobPosting,
  Platform,
} from '@applypilot/shared';

/** A value found by one strategy, before strategies are merged. */
export interface Found<T> {
  value: T;
  confidence: Confidence;
}

type ValueOf<F> = F extends { status: 'found'; value: infer V } ? V : never;

/** What a single strategy contributes: any subset of fields it could find. */
export type PartialJob = { [K in keyof JobPosting]?: Found<ValueOf<JobPosting[K]>> };

/** The one job an adapter found on a page that may show several. */
export interface JobScope {
  /** The document holding the job: the page itself, or a same-origin frame inside it. */
  doc: Document;
  /** The job's container. Nothing outside it is read. */
  root: Element;
  /**
   * True when `doc` describes this job only (a job page, or the frame that
   * shows the selected job), so its structured data applies to the job.
   */
  singleJobDocument: boolean;
  /** Whether the container was confirmed to show the job the user selected. */
  confirmed: boolean;
}

export interface LocateResult {
  scope: JobScope | null;
  /** The site's id for the selected job, when the page exposes one. */
  selectedJobId: string | null;
  /** Shown when no scope was found, telling the user what to do. */
  message?: string;
  checks: ExtractionCheck[];
}

export interface SiteAdapter {
  platform: Exclude<Platform, 'generic'>;
  /** Cheap host/markup check. Must not touch the network. */
  matches(url: URL, doc: Document): boolean;
  /**
   * For pages that can show many jobs at once: finds the selected job's
   * container. When present, every strategy is confined to that container, and
   * a null scope means nothing is extracted, so values from other jobs on the
   * page can never be mixed in.
   */
  locate?(doc: Document, url: URL): LocateResult;
  /** Returns null when the page is on the platform but no single job is shown. */
  extract(doc: Document, url: URL, scope?: JobScope): PartialJob | null;
  /** The element holding the description, used for requirement and skill analysis. */
  descriptionElement(doc: Document, scope?: JobScope): Element | null;
  /** True once client-rendered job content is present. Defaults to the generic check. */
  isReady?(doc: Document, url: URL): boolean;
  /** Same-origin frame documents whose changes should also wake the readiness check. */
  watchedDocuments?(doc: Document): Document[];
  /**
   * Set when the page can carry structured data that does not describe the
   * selected job (for example a search page listing many jobs). The adapter's
   * values then take precedence over JSON-LD.
   */
  preferOverStructuredData?: boolean;
  /** Shown when `extract` returns null, telling the user what to do. */
  noJobMessage?: string;
}

export interface StrategyOutput {
  source: ExtractionSource;
  fields: PartialJob;
}

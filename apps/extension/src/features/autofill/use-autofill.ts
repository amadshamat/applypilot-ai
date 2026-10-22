import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  aiClassifications,
  buildMappingRequest,
  proposeAnswers,
  type Classification,
  type ProposedValue,
  type ResumeFileInfo,
} from '@applypilot/autofill';
import {
  buildCandidateContext,
  buildJobContext,
  groundFieldMappings,
  hasUsableJob,
  type ScreeningQuestion,
} from '@applypilot/ai-core';
import type {
  AppError,
  FillReport,
  FormScan,
  ProfileContent,
  ResumeVersionMeta,
} from '@applypilot/shared';
import { AiClientError } from '../../services/ai-client';
import { useServices } from '../../services/app-services';
import { isConfigured, type AiConnection } from '../../storage/ai-connection-repository';
import { jobKeyFor } from '../../storage/ai-drafts-repository';
import { useAnalysis } from '../analyze/store';
import {
  applyDrafts,
  buildInstructions,
  editRow,
  fileToBase64,
  setApproved,
  toRows,
  type ReviewRow,
} from './review';

export type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; scan: FormScan };

export type FillState =
  | { status: 'idle' }
  | { status: 'filling' }
  | { status: 'error'; message: string }
  | { status: 'done'; report: FillReport };

export type AiStepState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; message: string };

function coverLetterText(output: {
  greeting: string;
  paragraphs: string[];
  closing: string;
}): string {
  return [output.greeting, ...output.paragraphs, output.closing].filter(Boolean).join('\n\n');
}

function newestResume(resumes: readonly ResumeVersionMeta[]): ResumeVersionMeta | null {
  return [...resumes].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0] ?? null;
}

/**
 * Scan, review and fill for the active tab. Nothing leaves the browser unless
 * the user asks for an AI step, and nothing is filled until they press Fill.
 */
export function useAutofill(
  profile: ProfileContent | null,
  connection: AiConnection | null,
  aiAllowed: boolean,
) {
  const services = useServices();
  const analysis = useAnalysis((s) => s.state);
  const [scanState, setScanState] = useState<ScanState>({ status: 'idle' });
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [fillState, setFillState] = useState<FillState>({ status: 'idle' });
  const [mapping, setMapping] = useState<AiStepState>({ status: 'idle' });
  const [drafting, setDrafting] = useState<AiStepState>({ status: 'idle' });
  const [resumes, setResumes] = useState<ResumeVersionMeta[]>([]);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [coverLetter, setCoverLetter] = useState<string | null>(null);
  const [aiMap, setAiMap] = useState<Record<string, Classification>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    services.resumes
      .list()
      .then((list) => {
        if (!active) return;
        setResumes(list);
        setResumeId((current) => current ?? newestResume(list)?.id ?? null);
      })
      .catch(() => active && setResumes([]));
    return () => {
      active = false;
    };
  }, [services]);

  // The cover letter drafted in AI Tailor for the analyzed job, if any.
  const jobKey = analysis.status === 'success' ? jobKeyFor(analysis.result.pageUrl) : null;
  useEffect(() => {
    let active = true;
    if (!jobKey) {
      setCoverLetter(null);
      return;
    }
    void services.aiDrafts.find('cover-letter', jobKey).then((draft) => {
      if (active) setCoverLetter(draft ? coverLetterText(draft.response.output) : null);
    });
    return () => {
      active = false;
    };
  }, [services, jobKey]);

  const resume: ResumeFileInfo | null = useMemo(() => {
    const meta = resumes.find((r) => r.id === resumeId);
    return meta ? { id: meta.id, fileName: meta.fileName, text: meta.text } : null;
  }, [resumes, resumeId]);

  const scan = useCallback(async () => {
    setScanState({ status: 'scanning' });
    setFillState({ status: 'idle' });
    setMapping({ status: 'idle' });
    setDrafting({ status: 'idle' });
    setAiMap({});
    setDrafts({});
    setRows([]);
    const response = await services.send({ type: 'autofill/scan' });
    setScanState(
      response.ok
        ? { status: 'ready', scan: response.data }
        : { status: 'error', error: response.error },
    );
  }, [services]);

  // Proposals follow the scan, the chosen resume, the cover letter and any AI
  // help. A field the user edited keeps their value (refs are per scan).
  useEffect(() => {
    if (scanState.status !== 'ready' || !profile) return;
    const fresh = applyDrafts(
      toRows(
        proposeAnswers(scanState.scan, { profile, resume, coverLetter, aiClassifications: aiMap }),
      ),
      drafts,
    );
    setRows((current) =>
      fresh.map(
        (row) =>
          current.find((c) => c.proposal.field.ref === row.proposal.field.ref && c.edited) ?? row,
      ),
    );
  }, [scanState, profile, resume, coverLetter, aiMap, drafts]);

  const edit = useCallback(
    (ref: string, value: ProposedValue | null) => setRows((r) => editRow(r, ref, value)),
    [],
  );
  const approve = useCallback(
    (ref: string, approved: boolean) => setRows((r) => setApproved(r, ref, approved)),
    [],
  );

  const fill = useCallback(async () => {
    if (scanState.status !== 'ready') return;
    setFillState({ status: 'filling' });
    let file = null;
    const wantsFile = rows.some((r) => r.approved && r.value?.type === 'file');
    if (wantsFile && resumeId) {
      const blob = await services.resumes.getFile(resumeId);
      const meta = resumes.find((r) => r.id === resumeId);
      if (blob && meta) file = { mimeType: meta.mimeType, base64: await fileToBase64(blob) };
    }
    const instructions = buildInstructions(rows, file);
    if (instructions.length === 0) {
      setFillState({ status: 'error', message: 'Select at least one field to fill.' });
      return;
    }
    const response = await services.send({
      type: 'autofill/fill',
      pageUrl: scanState.scan.url,
      instructions,
    });
    setFillState(
      response.ok
        ? { status: 'done', report: response.data }
        : { status: 'error', message: response.error.message },
    );
  }, [services, rows, scanState, resumeId, resumes]);

  const aiReady = aiAllowed && connection !== null && isConfigured(connection);

  /** Asks AI which profile field each unrecognised field wants. Labels only; no profile data. */
  const mapWithAi = useCallback(async () => {
    if (scanState.status !== 'ready' || !connection || !aiReady) return;
    const built = buildMappingRequest(scanState.scan.fields);
    if (!built) return;
    setMapping({ status: 'loading' });
    try {
      const response = await services.ai.run(connection, 'map-fields', built.request);
      const mappings = groundFieldMappings(built.request, response.output);
      setAiMap(aiClassifications(mappings, built.refs));
      setMapping({
        status: 'done',
        message:
          mappings.length === 0
            ? 'AI found no profile field for these. Fill them yourself.'
            : `AI matched ${mappings.length} field${mappings.length === 1 ? '' : 's'} to your profile. Check each one.`,
      });
    } catch (e) {
      setMapping({
        status: 'error',
        message: e instanceof AiClientError ? e.message : 'The AI step failed.',
      });
    }
  }, [services, connection, aiReady, scanState]);

  const job = useMemo(
    () => (analysis.status === 'success' ? buildJobContext(analysis.result.job) : null),
    [analysis],
  );

  /** Drafts open questions with AI Tailor's screening task, for the analyzed job. */
  const draftQuestions = useCallback(async () => {
    if (!connection || !aiReady || !profile || !job || !hasUsableJob(job)) return;
    const questionRows = rows.filter((r) => r.proposal.status === 'question').slice(0, 15);
    if (questionRows.length === 0) return;
    const questions: ScreeningQuestion[] = questionRows.map((r, i) => ({
      id: `Q${i + 1}`,
      text: [r.proposal.field.label, r.proposal.field.hint]
        .filter(Boolean)
        .join(' ')
        .slice(0, 1000),
    }));
    setDrafting({ status: 'loading' });
    try {
      const candidate = buildCandidateContext(profile, { includeName: false }).context;
      const response = await services.ai.run(connection, 'screening-answers', {
        job,
        candidate,
        questions,
      });
      const drafted: Record<string, string> = {};
      for (const answer of response.output.answers) {
        const index = Number(answer.questionId.slice(1)) - 1;
        const row = questionRows[index];
        if (row && answer.answer.trim()) drafted[row.proposal.field.ref] = answer.answer;
      }
      setDrafts(drafted);
      const count = Object.keys(drafted).length;
      setDrafting({
        status: 'done',
        message:
          count === 0
            ? 'No drafts were written. Answer these yourself.'
            : `Drafted ${count} answer${count === 1 ? '' : 's'}. Edit each one before you fill it.`,
      });
    } catch (e) {
      setDrafting({
        status: 'error',
        message: e instanceof AiClientError ? e.message : 'The drafts could not be generated.',
      });
    }
  }, [services, connection, aiReady, profile, job, rows]);

  return {
    scanState,
    rows,
    fillState,
    mapping,
    drafting,
    resumes,
    resumeId,
    setResumeId,
    coverLetterAvailable: coverLetter !== null,
    aiReady,
    canDraft: aiReady && job !== null && hasUsableJob(job),
    jobTitle: job?.title ?? null,
    scan,
    edit,
    approve,
    fill,
    mapWithAi,
    draftQuestions,
  };
}

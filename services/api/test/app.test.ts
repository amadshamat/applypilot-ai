import { describe, expect, it, vi } from 'vitest';
import {
  apiErrorSchema,
  healthResponseSchema,
  reviewCoverLetter,
  reviewScreeningAnswers,
  reviewTailoredResume,
  taskResponseSchema,
  TASK_SCHEMAS,
  type AiTask,
} from '@applypilot/ai-core';
import { createApi, type ApiRequest, type LogEntry } from '../src/app';
import { DailyLimiter } from '../src/limiter';
import { createMockProvider } from '../src/providers/mock';
import { ProviderError, type AiProvider } from '../src/providers/types';
import { TOKEN, candidate, coverBody, job, screeningBody, tailorBody, testConfig } from './helpers';

const NOW = new Date('2026-10-14T12:00:00');

function post(path: string, body: unknown, token = TOKEN): ApiRequest {
  return {
    method: 'POST',
    path,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function setup(provider: AiProvider = createMockProvider(), dailyLimit = 5) {
  const log = vi.fn<(entry: LogEntry) => void>();
  const generate = vi.spyOn(provider, 'generate');
  const handle = createApi({
    config: testConfig({ dailyLimit }),
    provider,
    limiter: new DailyLimiter(dailyLimit),
    now: () => NOW,
    log,
  });
  return { handle, log, generate };
}

function errorCode(body: unknown) {
  return apiErrorSchema.parse(body).error.code;
}

describe('authentication and routing', () => {
  it('rejects a missing or wrong token before doing anything else', async () => {
    const { handle, generate } = setup();
    for (const authorization of [undefined, 'Bearer nope', `Basic ${TOKEN}`, `Bearer ${TOKEN}x`]) {
      const res = await handle({
        method: 'GET',
        path: '/v1/health',
        headers: { authorization },
        body: '',
      });
      expect(res.status).toBe(401);
      expect(errorCode(res.body)).toBe('UNAUTHORIZED');
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports health with the provider and daily usage', async () => {
    const { handle } = setup();
    const res = await handle({
      method: 'GET',
      path: '/v1/health',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: '',
    });
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({
      provider: 'mock',
      requestsToday: 0,
      dailyLimit: 5,
    });
  });

  it('rejects unknown routes, wrong methods, non-JSON and malformed JSON', async () => {
    const { handle } = setup();
    expect((await handle(post('/v1/nope', {}))).status).toBe(404);
    expect(
      (await handle({ ...post('/v1/tailor-resume', tailorBody()), method: 'GET' })).status,
    ).toBe(405);
    const text = await handle({
      ...post('/v1/tailor-resume', tailorBody()),
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'text/plain' },
    });
    expect(text.status).toBe(400);
    expect((await handle(post('/v1/tailor-resume', '{bad json'))).status).toBe(400);
  });

  it('validates the request body and names the invalid field', async () => {
    const { handle, generate } = setup();
    const res = await handle(post('/v1/tailor-resume', { job: job(), candidate: { name: 1 } }));
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(res.body).error.message).toMatch(/^Invalid candidate\./);
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses to work without job content', async () => {
    const { handle } = setup();
    const empty = {
      ...job(),
      description: '',
      requiredQualifications: [],
      preferredQualifications: [],
    };
    const res = await handle(post('/v1/tailor-resume', { job: empty, candidate: candidate() }));
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(res.body).error.message).toMatch(/no description/);
  });
});

describe('generation with the mock provider', () => {
  it.each<[AiTask, () => unknown]>([
    ['tailor-resume', tailorBody],
    ['cover-letter', coverBody],
    ['screening-answers', screeningBody],
  ])('%s returns a valid, versioned response', async (task, body) => {
    const { handle } = setup();
    const res = await handle(post(`/v1/${task}`, body()));
    expect(res.status).toBe(200);
    const parsed = taskResponseSchema(TASK_SCHEMAS[task].output).parse(res.body);
    expect(parsed).toMatchObject({ task, provider: 'mock', model: 'mock-drafter', usage: null });
    expect(parsed.promptVersion).toMatch(new RegExp(`^${task}@`));
  });

  it('produces drafts that pass grounding review with no findings', async () => {
    const { handle } = setup();
    const tailor = (await handle(post('/v1/tailor-resume', tailorBody()))).body as {
      output: Parameters<typeof reviewTailoredResume>[0];
    };
    const resume = reviewTailoredResume(tailor.output, candidate());
    expect(resume.findings).toEqual([]);
    expect(resume.experience.flatMap((e) => e.bullets.flatMap((b) => b.flags))).toEqual([]);
    // Most relevant bullet (AWS + Python) first, original wording.
    expect(resume.experience[0]?.bullets[0]?.text).toMatch(/^Automated EC2/);
    expect(resume.skillsToFeature.slice(0, 2).sort()).toEqual(['AWS', 'Python']);

    const cover = (await handle(post('/v1/cover-letter', coverBody()))).body as {
      output: Parameters<typeof reviewCoverLetter>[0];
    };
    const letter = reviewCoverLetter(cover.output, candidate(), job(), '');
    expect(letter.findings).toEqual([]);
    expect(letter.paragraphs.flatMap((p) => p.flags)).toEqual([]);
    expect(letter.closing).toBe('Sincerely,\nAvery Chen');

    const questions = [{ id: 'Q1', text: 'Describe your AWS experience.' }];
    const screening = (await handle(post('/v1/screening-answers', screeningBody(questions))))
      .body as {
      output: Parameters<typeof reviewScreeningAnswers>[0];
    };
    const answers = reviewScreeningAnswers(screening.output, questions, candidate(), job());
    expect(answers.findings).toEqual([]);
    expect(answers.answers[0]?.answer).toMatch(/AWS Lambda/);
  });
});

describe('screening safety', () => {
  it('never forwards questions the user must answer', async () => {
    const { handle, generate } = setup();
    const res = await handle(post('/v1/screening-answers', screeningBody()));
    expect(res.status).toBe(200);
    const sent = generate.mock.calls[0]?.[1] as { questions: { id: string }[] };
    expect(sent.questions.map((q) => q.id)).toEqual(['Q1']);
    expect((res.body as { skipped: { questionId: string }[] }).skipped).toEqual([
      { questionId: 'Q2', reason: expect.stringMatching(/work authorization/) as unknown },
    ]);
  });

  it('answers without calling the provider when every question is sensitive', async () => {
    const { handle, generate } = setup();
    const res = await handle(
      post('/v1/screening-answers', screeningBody([{ id: 'Q1', text: 'What is your gender?' }])),
    );
    expect(res.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
    expect((res.body as { output: { answers: unknown[] } }).output.answers).toEqual([]);
  });
});

describe('limits and failures', () => {
  it('enforces the daily limit and reports usage', async () => {
    const { handle } = setup(createMockProvider(), 2);
    expect((await handle(post('/v1/tailor-resume', tailorBody()))).status).toBe(200);
    expect((await handle(post('/v1/tailor-resume', tailorBody()))).status).toBe(200);
    const third = await handle(post('/v1/tailor-resume', tailorBody()));
    expect(third.status).toBe(429);
    expect(errorCode(third.body)).toBe('DAILY_LIMIT');
  });

  it('passes provider errors through with their status', async () => {
    const provider: AiProvider = {
      kind: 'anthropic',
      model: 'claude-opus-5-5',
      generate: () => Promise.reject(new ProviderError('REFUSED', 422, 'Declined.')),
    };
    const { handle } = setup(provider);
    const res = await handle(post('/v1/cover-letter', coverBody()));
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe('REFUSED');
  });

  it('hides unexpected errors behind a generic message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const provider: AiProvider = {
      kind: 'anthropic',
      model: 'claude-opus-5-5',
      generate: () => Promise.reject(new Error('secret internals')),
    };
    const { handle } = setup(provider);
    const res = await handle(post('/v1/cover-letter', coverBody()));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
    consoleError.mockRestore();
  });

  it('rejects provider output that does not match the schema', async () => {
    const provider: AiProvider = {
      kind: 'anthropic',
      model: 'claude-opus-5-5',
      generate: () =>
        Promise.resolve({
          output: { wrong: true } as never,
          model: 'claude-opus-5-5',
          usage: null,
        }),
    };
    const { handle } = setup(provider);
    const res = await handle(post('/v1/tailor-resume', tailorBody()));
    expect(res.status).toBe(502);
    expect(errorCode(res.body)).toBe('INVALID_OUTPUT');
  });

  it('logs metadata and usage, never content', async () => {
    const provider: AiProvider = {
      kind: 'anthropic',
      model: 'claude-opus-5-5',
      generate: (task, request) =>
        createMockProvider()
          .generate(task, request)
          .then((g) => ({
            ...g,
            model: 'claude-opus-5-5',
            usage: { inputTokens: 4000, outputTokens: 2000, estimatedCostUsd: 0.056 },
          })),
    };
    const { handle, log } = setup(provider);
    await handle(post('/v1/tailor-resume', tailorBody()));
    expect(log).toHaveBeenCalledWith({
      route: 'POST /v1/tailor-resume',
      status: 200,
      durationMs: expect.any(Number) as unknown,
      task: 'tailor-resume',
      model: 'claude-opus-5-5',
      inputTokens: 4000,
      outputTokens: 2000,
      estimatedCostUsd: 0.056,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Northwind|Avery/);
  });
});

describe('map-fields', () => {
  const body = {
    fields: [
      {
        id: 'F1',
        label: 'Handle on the code hosting site',
        hint: '',
        section: '',
        control: 'text',
        options: [],
      },
      {
        id: 'F2',
        label: 'Do you require visa sponsorship?',
        hint: '',
        section: '',
        control: 'select',
        options: ['Yes', 'No'],
      },
      { id: 'F3', label: 'Favourite colour', hint: '', section: '', control: 'text', options: [] },
    ],
  };

  it('needs no job, sends only non-sensitive labels, and returns profile kinds', async () => {
    const { handle, generate } = setup();
    const res = await handle(post('/v1/map-fields', body));
    expect(res.status).toBe(200);
    const parsed = taskResponseSchema(TASK_SCHEMAS['map-fields'].output).parse(res.body);
    expect(parsed.skipped).toEqual([
      { questionId: 'F2', reason: 'This field asks something only you can answer.' },
    ]);
    expect(generate).toHaveBeenCalledWith('map-fields', {
      fields: [body.fields[0], body.fields[2]],
    });
    expect(parsed.output.mappings).toEqual([
      { fieldId: 'F1', kind: 'link.github', confidence: 'medium' },
      { fieldId: 'F3', kind: 'none', confidence: 'low' },
    ]);
  });

  it('does not call the provider when every field is sensitive', async () => {
    const { handle, generate } = setup();
    const res = await handle(post('/v1/map-fields', { fields: [body.fields[1]] }));
    expect(res.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects candidate data or oversized requests', async () => {
    const { handle } = setup();
    const tooMany = {
      fields: Array.from({ length: 41 }, (_, i) => ({ ...body.fields[0], id: `F${i + 1}` })),
    };
    expect((await handle(post('/v1/map-fields', tooMany))).status).toBe(400);
    expect((await handle(post('/v1/map-fields', { fields: [] }))).status).toBe(400);
  });
});

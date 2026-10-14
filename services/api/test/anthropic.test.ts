import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { tailorResumePrompt, type TailoredResume } from '@applypilot/ai-core';
import { createAnthropicProvider, FALLBACK_BETA } from '../src/providers/anthropic';
import { ProviderError } from '../src/providers/types';
import { tailorBody } from './helpers';

/**
 * Runs the real Anthropic SDK against a local fake of the Messages API, so the
 * exact request ApplyPilot sends (model, beta header, fallbacks, thinking,
 * effort, structured output schema, prompt) is checked without a paid call.
 */

interface Captured {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

const OUTPUT: TailoredResume = {
  summary: 'Computer science student with AWS experience.',
  experience: [{ ref: 'E1', bullets: [{ text: 'Automated EC2 snapshot cleanup', basedOn: [0] }] }],
  projects: [],
  skillsToFeature: ['AWS'],
  changes: ['Led with AWS work.'],
  notShownInProfile: ['Terraform'],
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify(OUTPUT) },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3000, output_tokens: 1500, cache_read_input_tokens: 1000 },
    ...overrides,
  };
}

async function fakeApi(status: number, body: unknown) {
  const captured: Captured[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      captured.push({
        url: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_test' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const client = new Anthropic({
    apiKey: 'sk-ant-test',
    baseURL: `http://127.0.0.1:${port}`,
    maxRetries: 0,
  });
  return {
    captured,
    provider: createAnthropicProvider({ client, model: 'claude-opus-5-5', effort: 'medium' }),
  };
}

describe('Anthropic provider', () => {
  it('sends a structured-output request with adaptive thinking, effort and fallbacks', async () => {
    const { captured, provider } = await fakeApi(200, message());
    const result = await provider.generate('tailor-resume', tailorBody());

    expect(result.output).toEqual(OUTPUT);
    expect(result.model).toBe('claude-opus-5-5');
    // Cache reads count as input tokens: 3000 + 1000 in, 1500 out at $4 / $20 per million.
    expect(result.usage).toEqual({
      inputTokens: 4000,
      outputTokens: 1500,
      estimatedCostUsd: 0.046,
    });

    const [req] = captured;
    expect(req?.url).toMatch(/^\/v1\/messages/);
    expect(req?.headers['x-api-key']).toBe('sk-ant-test');
    expect(String(req?.headers['anthropic-beta'])).toContain(FALLBACK_BETA);
    expect(req?.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: tailorResumePrompt.maxTokens,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
      system: tailorResumePrompt.system,
    });
    const messages = req?.body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toContain('<job_posting>');
    // No prefilled assistant turn, no API key or token in the prompt.
    expect(JSON.stringify(req?.body)).not.toContain('sk-ant-test');
  });

  it('reports the model that actually answered after a fallback', async () => {
    const { provider } = await fakeApi(200, message({ model: 'claude-opus-4-8' }));
    const result = await provider.generate('tailor-resume', tailorBody());
    expect(result.model).toBe('claude-opus-4-8');
    // No published price in this build for that model, so no guessed cost.
    expect(result.usage?.estimatedCostUsd).toBeNull();
  });

  it.each([
    [message({ stop_reason: 'refusal', content: [] }), 'REFUSED', 422],
    [message({ stop_reason: 'max_tokens' }), 'INVALID_OUTPUT', 502],
  ])('handles stop reasons before reading content (%#)', async (body, code, status) => {
    const { provider } = await fakeApi(200, body);
    const error = await provider.generate('tailor-resume', tailorBody()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, status });
  });

  it.each([
    [
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
      'PROVIDER_AUTH',
    ],
    [
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      'RATE_LIMITED',
    ],
    [
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },
      'PROVIDER_UNAVAILABLE',
    ],
    [
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } },
      'PROVIDER_UNAVAILABLE',
    ],
  ])('translates HTTP %i into %s', async (status, body, code) => {
    const { provider } = await fakeApi(status, body);
    const error = await provider.generate('tailor-resume', tailorBody()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    // The message is safe to show and never includes the key.
    expect((error as Error).message).not.toContain('sk-ant-test');
  });

  it('rejects output that is not valid JSON for the schema', async () => {
    const { provider } = await fakeApi(
      200,
      message({ content: [{ type: 'text', text: '{"summary": 5}' }] }),
    );
    const error = await provider.generate('tailor-resume', tailorBody()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INVALID_OUTPUT' });
  });
});

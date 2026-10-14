import { buildCandidateContext, buildJobContext } from '@applypilot/ai-core';
import { sampleJob, sampleProfile } from '../../../packages/ai-core/test/fixtures';
import type { ApiConfig } from '../src/config';

export const TOKEN = 'test-token-0123456789abcdefghij';

export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    version: '0.1.0',
    host: '127.0.0.1',
    port: 8787,
    token: TOKEN,
    provider: 'mock',
    anthropicApiKey: null,
    model: 'claude-opus-5-5',
    effort: 'medium',
    dailyLimit: 5,
    allowedOrigins: [],
    maxBodyBytes: 300_000,
    ...overrides,
  };
}

export const candidate = () =>
  buildCandidateContext(sampleProfile(), { includeName: true }).context;
export const job = () => buildJobContext(sampleJob());

export const tailorBody = () => ({ job: job(), candidate: candidate() });
export const coverBody = () => ({
  job: job(),
  candidate: candidate(),
  options: { tone: 'professional', length: 'standard', notes: '' },
});
export const screeningBody = (
  questions = [
    { id: 'Q1', text: 'Describe your AWS experience.' },
    { id: 'Q2', text: 'Will you require visa sponsorship?' },
  ],
) => ({ job: job(), candidate: candidate(), questions });

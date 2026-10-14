import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_SETTINGS,
  backgroundRequestSchema,
  contentRequestSchema,
  matchWeightsSchema,
  responseSchemas,
  salaryRangeSchema,
  settingsSchema,
} from '../src';

describe('settings', () => {
  it('ships valid defaults with AI processing off', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.allowAiProcessing).toBe(false);
  });

  it('default weights add up to 100', () => {
    expect(Object.values(DEFAULT_MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('rejects weights that do not add up to 100', () => {
    const result = matchWeightsSchema.safeParse({ ...DEFAULT_MATCH_WEIGHTS, education: 20 });
    expect(result.success).toBe(false);
  });
});

describe('salary range', () => {
  it('requires at least one bound and an ordered range', () => {
    expect(
      salaryRangeSchema.safeParse({ min: null, max: null, currency: null, period: null }).success,
    ).toBe(false);
    expect(
      salaryRangeSchema.safeParse({ min: 10, max: 5, currency: 'USD', period: 'hour' }).success,
    ).toBe(false);
    expect(
      salaryRangeSchema.safeParse({ min: 10, max: null, currency: null, period: null }).success,
    ).toBe(true);
  });
});

describe('message contract', () => {
  it('accepts known requests', () => {
    expect(backgroundRequestSchema.safeParse({ type: 'job/extract-active-tab' }).success).toBe(
      true,
    );
    expect(
      contentRequestSchema.safeParse({ type: 'content/extract-job', waitMs: 3000 }).success,
    ).toBe(true);
  });

  it('rejects unknown types and out-of-range values', () => {
    expect(backgroundRequestSchema.safeParse({ type: 'job/delete-everything' }).success).toBe(
      false,
    );
    expect(backgroundRequestSchema.safeParse({ type: 'job/get-cached', tabId: -1 }).success).toBe(
      false,
    );
    expect(
      contentRequestSchema.safeParse({ type: 'content/extract-job', waitMs: 60_000 }).success,
    ).toBe(false);
  });

  it('validates response envelopes', () => {
    const ping = responseSchemas['app/ping'];
    expect(ping.safeParse({ ok: true, data: { version: '0.1.0' } }).success).toBe(true);
    expect(ping.safeParse({ ok: false, error: { code: 'INTERNAL', message: 'x' } }).success).toBe(
      true,
    );
    expect(ping.safeParse({ ok: false, error: { code: 'NOPE', message: 'x' } }).success).toBe(
      false,
    );
  });
});

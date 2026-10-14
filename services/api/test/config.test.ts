import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { TOKEN } from './helpers';

describe('loadConfig', () => {
  it('defaults to free mock mode on localhost', () => {
    const config = loadConfig({ APPLYPILOT_LOCAL_TOKEN: TOKEN });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 8787,
      provider: 'mock',
      anthropicApiKey: null,
      model: 'claude-opus-5-5',
      effort: 'medium',
      dailyLimit: 25,
      allowedOrigins: [],
    });
  });

  it('stays in mock mode when only a key is set; paid calls need both settings', () => {
    expect(loadConfig({ APPLYPILOT_LOCAL_TOKEN: TOKEN, ANTHROPIC_API_KEY: 'sk-x' }).provider).toBe(
      'mock',
    );
    expect(() =>
      loadConfig({ APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_PROVIDER: 'anthropic' }),
    ).toThrow(/ANTHROPIC_API_KEY is not set/);
    const paid = loadConfig({
      APPLYPILOT_LOCAL_TOKEN: TOKEN,
      APPLYPILOT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-x',
    });
    expect(paid.provider).toBe('anthropic');
  });

  it.each([
    [{}, /APPLYPILOT_LOCAL_TOKEN/],
    [{ APPLYPILOT_LOCAL_TOKEN: 'short' }, /at least 24/],
    [{ APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_PROVIDER: 'openai' }, /"mock" or "anthropic"/],
    [{ APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_EFFORT: 'extreme' }, /APPLYPILOT_EFFORT/],
    [{ APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_PORT: '80' }, /APPLYPILOT_PORT/],
    [{ APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_DAILY_LIMIT: '0' }, /APPLYPILOT_DAILY_LIMIT/],
    [
      { APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_ALLOWED_ORIGINS: 'https://evil.example' },
      /chrome-extension/,
    ],
  ])('rejects %o', (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('reads allowed extension origins', () => {
    const origin = `chrome-extension://${'a'.repeat(32)}`;
    expect(
      loadConfig({ APPLYPILOT_LOCAL_TOKEN: TOKEN, APPLYPILOT_ALLOWED_ORIGINS: ` ${origin} ` })
        .allowedOrigins,
    ).toEqual([origin]);
  });
});

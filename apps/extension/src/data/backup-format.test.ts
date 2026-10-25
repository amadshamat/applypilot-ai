import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@applypilot/shared';
import { application, pdfBytes, populated, resumeMeta } from '../../test/data-fixtures';
import {
  BACKUP_FORMAT,
  base64ToBytes,
  buildBackup,
  bytesToBase64,
  parseBackup,
} from './backup-format';

const parse = (value: unknown) => parseBackup(JSON.stringify(value));

describe('backup files', () => {
  it('round-trips base64 and rejects malformed text', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 37, 80]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('not base64!')).toBeNull();
    expect(base64ToBytes('abc')).toBeNull();
  });

  it('exports everything with resume files and without the API token', async () => {
    const { store, resumes } = await populated();
    await store.set(STORAGE_KEYS.importUndo, { anything: true });
    const text = await buildBackup(store, resumes, {
      appVersion: '0.7.0',
      now: new Date('2026-10-25T10:00:00.000Z'),
    });
    expect(text).not.toContain('secret-token');
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw).toMatchObject({
      format: BACKUP_FORMAT,
      formatVersion: 2,
      appVersion: '0.7.0',
      exportedAt: '2026-10-25T10:00:00.000Z',
    });
    expect(Object.keys(raw.data as object)).not.toContain(STORAGE_KEYS.importUndo);

    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const { backup } = parsed;
    expect(backup.profile.status).toBe('ok');
    expect(backup.applications?.records).toHaveLength(2);
    expect(backup.aiDrafts?.drafts).toHaveLength(1);
    expect(backup.settings).toMatchObject({ status: 'ok', defaulted: false });
    expect(backup.resumes.files).toHaveLength(1);
    expect(new TextDecoder().decode(backup.resumes.files[0]?.bytes)).toContain('%PDF-');
    expect(backup.ignored).toEqual(['AI connection (enter the access token again in Settings)']);
  });

  it('reads exports from 0.6 and earlier, which have no resume files', () => {
    const bytes = pdfBytes();
    const result = parse({
      exportedAt: '2026-10-20T10:00:00.000Z',
      data: { [STORAGE_KEYS.applications]: [application('Old')] },
      resumes: [resumeMeta('r1', bytes)],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.backup.formatVersion).toBe(1);
    expect(result.backup.applications?.records).toHaveLength(1);
    expect(result.backup.resumes).toEqual({ files: [], withoutFile: 1, invalid: 0 });
  });

  it.each([
    ['not JSON', '{"data": ', /not valid JSON/],
    ['an array', '[1,2]', /not an ApplyPilot backup/],
    ['no data', '{"exportedAt":"x"}', /no saved data/],
    ['empty data', '{"data":{}}', /nothing ApplyPilot can restore/],
    [
      'a newer format',
      JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 3, appVersion: '1.0.0', data: {} }),
      /newer version of ApplyPilot \(1\.0\.0\)/,
    ],
    [
      'a different format',
      JSON.stringify({ format: 'other', formatVersion: 1, data: {} }),
      /not an ApplyPilot backup/,
    ],
  ])('refuses %s', (_name, text, error) => {
    const result = parseBackup(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });

  it('keeps valid records and counts the rest', () => {
    const good = application('Good');
    const result = parse({
      data: {
        [STORAGE_KEYS.profile]: { personal: 'broken' },
        [STORAGE_KEYS.applications]: [good, { ...good }, { id: 'x', job: 42 }, '<script>'],
        [STORAGE_KEYS.aiDrafts]: [{ task: 'cover-letter' }],
        [STORAGE_KEYS.settings]: { theme: 'neon', cacheAnalyses: false },
        'some.other.key': 1,
      },
    });
    if (!result.ok) throw new Error(result.error);
    const { backup } = result;
    expect(backup.profile.status).toBe('invalid');
    expect(backup.applications).toMatchObject({ invalid: 2, duplicateIds: 1 });
    expect(backup.applications?.records).toEqual([good]);
    expect(backup.aiDrafts).toEqual({ drafts: [], invalid: 1 });
    expect(backup.settings).toMatchObject({
      status: 'ok',
      defaulted: true,
      settings: { theme: 'system', cacheAnalyses: false },
    });
    expect(backup.ignored).toEqual(['Unknown item "some.other.key"']);
  });

  it('drops unknown fields so nothing extra is stored', () => {
    const result = parse({
      data: { [STORAGE_KEYS.applications]: [{ ...application('A'), onload: 'alert(1)' }] },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.backup.applications?.records[0]).not.toHaveProperty('onload');
  });

  it('does not trust __proto__ keys', () => {
    const result = parseBackup(
      '{"data":{"__proto__":{"applypilot.applications":[]}, "applypilot.applications": []}}',
    );
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>)['applypilot.applications']).toBeUndefined();
  });

  it('rejects resume files that do not match their description', () => {
    const bytes = pdfBytes();
    const meta = resumeMeta('r1', bytes);
    const entry = (base64: string, extra = {}) => ({ ...meta, ...extra, file: { base64 } });
    const result = parse({
      format: BACKUP_FORMAT,
      formatVersion: 2,
      data: {},
      resumes: [
        entry(bytesToBase64(bytes)),
        entry(bytesToBase64(bytes), { id: 'r2', size: bytes.length + 1 }),
        entry(bytesToBase64(new TextEncoder().encode('MZ executable!')), { id: 'r3', size: 14 }),
        entry('!!!', { id: 'r4' }),
        entry(bytesToBase64(bytes)),
      ],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.backup.resumes.files.map((f) => f.meta.id)).toEqual(['r1']);
    expect(result.backup.resumes.invalid).toBe(4);
  });
});

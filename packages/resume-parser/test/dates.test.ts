import { describe, expect, it } from 'vitest';
import { findDateRange, toPartialDate } from '../src';

describe('toPartialDate', () => {
  it.each([
    ['May 2024', '2024-05'],
    ['Sept. 2023', '2023-09'],
    ['September 2023', '2023-09'],
    ['06/2022', '2022-06'],
    ['2021-11', '2021-11'],
    ['2020', '2020'],
    ['Summer 2024', '2024-08'],
    ['Smarch 2024', ''],
    ['13/2024', ''],
    ['soon', ''],
  ])('%s → %s', (raw, expected) => {
    expect(toPartialDate(raw)).toBe(expected);
  });
});

describe('findDateRange', () => {
  it('reads month ranges with any dash or "to"', () => {
    expect(findDateRange('Intern | Jan 2024 – Apr 2024')).toMatchObject({
      startDate: '2024-01',
      endDate: '2024-04',
      current: false,
    });
    expect(findDateRange('06/2021 to 08/2021')).toMatchObject({
      startDate: '2021-06',
      endDate: '2021-08',
    });
  });

  it('treats Present as ongoing with no end date', () => {
    expect(findDateRange('Sep 2023 - Present')).toMatchObject({
      startDate: '2023-09',
      endDate: '',
      current: true,
    });
  });

  it('treats an expected graduation as current with an end date', () => {
    expect(findDateRange('Sep 2022 – Expected May 2026')).toMatchObject({
      startDate: '2022-09',
      endDate: '2026-05',
      current: true,
    });
    expect(findDateRange('Expected: Dec 2025')).toMatchObject({
      startDate: '',
      endDate: '2025-12',
      current: true,
    });
  });

  it('reads a lone year as an end date and ignores lines without dates', () => {
    expect(findDateRange('CompTIA A+ | 2023')).toMatchObject({ startDate: '', endDate: '2023' });
    expect(findDateRange('Built 3 services for 250 users')).toBeNull();
  });
});

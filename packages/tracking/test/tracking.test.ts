import { describe, expect, it } from 'vitest';
import {
  applicationRecordSchema,
  type ApplicationRecord,
  type NewApplication,
} from '@applypilot/shared';
import {
  addDays,
  addNote,
  appliedAt,
  computeAnalytics,
  createApplication,
  csvCell,
  DEFAULT_FILTER,
  dueFollowUps,
  filterRecords,
  findDuplicate,
  firstResponseAt,
  quietApplications,
  removeNote,
  setFollowUp,
  setStatus,
  toCsv,
  updateJob,
  type Clock,
} from '../src';

const dayOf = (iso: string) => iso.slice(0, 10);

function clockAt(start: string): Clock & { advance: (days: number) => void } {
  let now = new Date(start);
  let n = 0;
  return {
    now: () => now,
    newId: () => `id-${++n}`,
    advance(days) {
      now = new Date(now.getTime() + days * 86_400_000);
    },
  };
}

function job(title: string, company: string, extra: Partial<NewApplication['job']> = {}) {
  return {
    title,
    company,
    location: 'Remote',
    url: '',
    jobKey: '',
    platform: 'generic',
    pay: '',
    ...extra,
  };
}

const newApp = (title: string, company: string, extra: Partial<NewApplication> = {}) => ({
  job: job(title, company),
  source: 'manual' as const,
  status: 'saved' as const,
  matchScore: null,
  ...extra,
});

describe('records', () => {
  it('creates a valid record with its first status in the history', () => {
    const clock = clockAt('2026-10-01T10:00:00Z');
    const record = createApplication(newApp('Cloud Intern', 'Acme', { matchScore: 72 }), clock);
    expect(applicationRecordSchema.parse(record)).toEqual(record);
    expect(record).toMatchObject({
      id: 'id-1',
      status: 'saved',
      history: [{ status: 'saved', at: '2026-10-01T10:00:00.000Z' }],
      notes: [],
      followUp: null,
      matchScore: 72,
    });
  });

  it('rejects records without a title and never changes its input', () => {
    const clock = clockAt('2026-10-01T10:00:00Z');
    expect(() => createApplication(newApp('  ', 'Acme'), clock)).toThrow();
    const record = createApplication(newApp('Cloud Intern', 'Acme'), clock);
    const frozen = structuredClone(record);
    setStatus(record, 'applied', clock.now());
    addNote(record, 'Called recruiter', clock);
    expect(record).toEqual(frozen);
  });

  it('records each status change once, with its time, and knows when it was applied and answered', () => {
    const clock = clockAt('2026-10-01T10:00:00Z');
    let record = createApplication(newApp('Cloud Intern', 'Acme'), clock);
    expect(appliedAt(record)).toBeNull();
    clock.advance(2);
    record = setStatus(record, 'applied', clock.now());
    expect(setStatus(record, 'applied', clock.now())).toBe(record);
    clock.advance(5);
    record = setStatus(record, 'interview', clock.now());
    expect(record.history.map((h) => h.status)).toEqual(['saved', 'applied', 'interview']);
    expect(appliedAt(record)).toBe('2026-10-03T10:00:00.000Z');
    expect(firstResponseAt(record)).toBe('2026-10-08T10:00:00.000Z');
    expect(record.updatedAt).toBe('2026-10-08T10:00:00.000Z');
  });

  it('adds and removes notes, newest first, and ignores empty ones', () => {
    const clock = clockAt('2026-10-01T10:00:00Z');
    let record = createApplication(newApp('Cloud Intern', 'Acme'), clock);
    record = addNote(record, '  ', clock);
    expect(record.notes).toEqual([]);
    record = addNote(record, 'Applied through referral', clock);
    record = addNote(record, 'Recruiter: Sam', clock);
    expect(record.notes.map((n) => n.text)).toEqual(['Recruiter: Sam', 'Applied through referral']);
    const [newest] = record.notes;
    record = removeNote(record, newest?.id ?? '', clock.now());
    expect(record.notes.map((n) => n.text)).toEqual(['Applied through referral']);
  });

  it('sets, validates and clears follow-ups, and edits job details', () => {
    const clock = clockAt('2026-10-01T10:00:00Z');
    let record = createApplication(newApp('Cloud Intern', 'Acme'), clock);
    record = setFollowUp(record, { due: '2026-10-08', note: 'Email the recruiter' }, clock.now());
    expect(record.followUp).toEqual({ due: '2026-10-08', note: 'Email the recruiter' });
    expect(() => setFollowUp(record, { due: '8/10/2026', note: '' }, clock.now())).toThrow();
    record = setFollowUp(record, null, clock.now());
    expect(record.followUp).toBeNull();
    record = updateJob(record, { location: 'Toronto, ON' }, clock.now());
    expect(record.job.location).toBe('Toronto, ON');
  });

  it('finds a duplicate by posting identity, address, or company and title', () => {
    const clock = clockAt('2026-10-01T10:00:00Z');
    const indeed = createApplication(
      {
        ...newApp('Cloud Intern', 'Acme'),
        job: job('Cloud Intern', 'Acme', {
          jobKey: 'indeed:abc123',
          url: 'https://www.indeed.com/viewjob?jk=abc123',
        }),
      },
      clock,
    );
    const other = createApplication(newApp('Data Analyst', 'Globex'), clock);
    const records = [indeed, other];
    expect(
      findDuplicate(records, { jobKey: 'indeed:abc123', url: '', title: 'x', company: '' }),
    ).toBe(indeed);
    expect(
      findDuplicate(records, {
        jobKey: '',
        url: 'https://WWW.indeed.com/viewjob/?jk=abc123',
        title: '',
        company: '',
      }),
    ).toBe(indeed);
    expect(
      findDuplicate(records, { jobKey: '', url: '', title: 'data analyst', company: 'GLOBEX' }),
    ).toBe(other);
    expect(
      findDuplicate(records, { jobKey: '', url: '', title: 'Data Analyst', company: '' }),
    ).toBeNull();
  });
});

function sample(): ApplicationRecord[] {
  const clock = clockAt('2026-09-01T09:00:00Z');
  const a = createApplication(
    newApp('Cloud Support Intern', 'Acme', {
      source: 'analyzed',
      matchScore: 80,
      job: job('Cloud Support Intern', 'Acme', { platform: 'indeed' }),
    }),
    clock,
  );
  const b = createApplication(
    newApp('DevOps Intern', 'Globex', {
      matchScore: 60,
      job: job('DevOps Intern', 'Globex', { platform: 'greenhouse' }),
    }),
    clock,
  );
  const c = createApplication(
    newApp('IT Assistant', 'Initech', {
      job: job('IT Assistant', 'Initech', { platform: 'indeed' }),
    }),
    clock,
  );
  const d = createApplication(newApp('SRE Intern', 'Umbrella'), clock);
  clock.advance(1); // 2026-09-02
  const a1 = setStatus(a, 'applied', clock.now());
  const b1 = setStatus(b, 'applied', clock.now());
  const c1 = setStatus(c, 'applied', clock.now());
  clock.advance(4); // 2026-09-06
  const a2 = setStatus(a1, 'interview', clock.now());
  clock.advance(4); // 2026-09-10
  const b2 = setStatus(b1, 'rejected', clock.now());
  const a3 = addNote(a2, 'Second round with the platform team', clock);
  const d1 = setFollowUp(d, { due: '2026-09-12', note: 'Ask about deadline' }, clock.now());
  const c2 = setFollowUp(c1, { due: '2026-09-20', note: '' }, clock.now());
  return [a3, b2, c2, d1];
}

describe('filtering and reminders', () => {
  const records = sample();
  const titles = (list: ApplicationRecord[]) => list.map((r) => r.job.title);

  it('filters by status groups and by words across title, company, location and notes', () => {
    const today = '2026-09-15';
    expect(
      titles(filterRecords(records, { ...DEFAULT_FILTER, status: 'active' }, today)),
    ).not.toContain('DevOps Intern');
    expect(titles(filterRecords(records, { ...DEFAULT_FILTER, status: 'closed' }, today))).toEqual([
      'DevOps Intern',
    ]);
    expect(titles(filterRecords(records, { ...DEFAULT_FILTER, status: 'applied' }, today))).toEqual(
      ['IT Assistant'],
    );
    expect(
      titles(filterRecords(records, { ...DEFAULT_FILTER, query: 'platform team' }, today)),
    ).toEqual(['Cloud Support Intern']);
    expect(
      titles(filterRecords(records, { ...DEFAULT_FILTER, query: 'globex intern' }, today)),
    ).toEqual(['DevOps Intern']);
    expect(titles(filterRecords(records, { ...DEFAULT_FILTER, dueOnly: true }, today))).toEqual([
      'SRE Intern',
    ]);
  });

  it('sorts by company, applied date and follow-up date', () => {
    const today = '2026-09-15';
    expect(titles(filterRecords(records, { ...DEFAULT_FILTER, sort: 'company' }, today))).toEqual([
      'Cloud Support Intern',
      'DevOps Intern',
      'IT Assistant',
      'SRE Intern',
    ]);
    expect(
      titles(filterRecords(records, { ...DEFAULT_FILTER, sort: 'follow-up' }, today)).slice(0, 2),
    ).toEqual(['SRE Intern', 'IT Assistant']);
    expect(
      titles(filterRecords(records, { ...DEFAULT_FILTER, sort: 'applied' }, today)).at(-1),
    ).toBe('SRE Intern');
  });

  it('lists due follow-ups on open records, most overdue first', () => {
    expect(dueFollowUps(records, '2026-09-11')).toEqual([]);
    const due = dueFollowUps(records, '2026-09-21');
    expect(due.map((d) => [d.record.job.title, d.overdueDays])).toEqual([
      ['SRE Intern', 9],
      ['IT Assistant', 1],
    ]);
    // A closed record never reminds.
    const closed = records.map((r) =>
      r.job.title === 'SRE Intern'
        ? setStatus(r, 'withdrawn', new Date('2026-09-13T00:00:00Z'))
        : r,
    );
    expect(dueFollowUps(closed, '2026-09-21').map((d) => d.record.job.title)).toEqual([
      'IT Assistant',
    ]);
  });

  it('suggests following up on quiet applications without setting anything', () => {
    const withoutFollowUp = records.map((r) =>
      setFollowUp(r, null, new Date('2026-09-10T00:00:00Z')),
    );
    expect(quietApplications(withoutFollowUp, '2026-09-10', dayOf)).toEqual([]);
    expect(quietApplications(withoutFollowUp, '2026-09-16', dayOf).map((r) => r.job.title)).toEqual(
      ['IT Assistant'],
    );
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('analytics', () => {
  it('counts statuses, rates and weekly applications from the records only', () => {
    const stats = computeAnalytics(sample(), { today: '2026-09-15', dayOf, weeks: 3 });
    expect(stats).toMatchObject({
      total: 4,
      active: 3,
      applied: 3,
      responded: 2,
      interviews: 1,
      offers: 0,
      averageMatchScore: 70,
    });
    expect(stats.byStatus).toMatchObject({ saved: 1, applied: 1, interview: 1, rejected: 1 });
    expect(stats.responseRate).toBeCloseTo(2 / 3);
    expect(stats.interviewRate).toBeCloseTo(1 / 3);
    expect(stats.offerRate).toBe(0);
    // Answers after 4 and 8 days.
    expect(stats.medianDaysToResponse).toBe(6);
    // 2026-09-15 is a Tuesday; weeks start on Monday.
    expect(stats.weekly).toEqual([
      { weekStart: '2026-08-31', applied: 3 },
      { weekStart: '2026-09-07', applied: 0 },
      { weekStart: '2026-09-14', applied: 0 },
    ]);
    expect(stats.byPlatform).toEqual([
      { platform: 'indeed', count: 2 },
      { platform: 'generic', count: 1 },
      { platform: 'greenhouse', count: 1 },
    ]);
  });

  it('reports no rate instead of 0% when nothing was applied for', () => {
    const stats = computeAnalytics([], { today: '2026-09-15', dayOf });
    expect(stats).toMatchObject({
      total: 0,
      responseRate: null,
      interviewRate: null,
      medianDaysToResponse: null,
      averageMatchScore: null,
    });
    expect(stats.weekly).toHaveLength(8);
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and line breaks and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell(72)).toBe('72');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
  });

  it('writes one row per record with a header, history and notes', () => {
    const records = sample();
    const csv = toCsv(records, dayOf);
    expect(csv.startsWith('﻿Title,Company,Location,Status,Applied on')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(records.length + 2); // header, rows, trailing newline
    expect(lines[1]).toContain('Cloud Support Intern,Acme,Remote,Interview,2026-09-02,2026-09-01');
    expect(lines[1]).toContain('2026-09-01 Saved; 2026-09-02 Applied; 2026-09-06 Interview');
    expect(lines[1]).toContain('2026-09-10: Second round with the platform team');
  });
});

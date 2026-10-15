import { describe, expect, it } from 'vitest';
import { indeedJobKey, isSameJobPage, jobPageIdentity } from '../src';

describe('job page identity', () => {
  const search = 'https://www.indeed.com/jobs?q=security+officer&l=Alexandria%2C+VA';

  it('identifies an Indeed job by its key, whatever the search around it', () => {
    expect(jobPageIdentity(`${search}&vjk=B5E7A1C3D9F20486`)).toBe('indeed:b5e7a1c3d9f20486');
    expect(
      isSameJobPage(
        `${search}&vjk=b5e7a1c3d9f20486`,
        'https://www.indeed.com/viewjob?jk=b5e7a1c3d9f20486&from=serp',
      ),
    ).toBe(true);
  });

  it('tells two jobs on the same Indeed search apart', () => {
    expect(isSameJobPage(`${search}&vjk=b5e7a1c3d9f20486`, `${search}&vjk=3c9d2e8f71a04b65`)).toBe(
      false,
    );
  });

  it('uses the address without its hash elsewhere', () => {
    expect(isSameJobPage('https://jobs.example.com/1#apply', 'https://jobs.example.com/1')).toBe(
      true,
    );
    expect(isSameJobPage('https://jobs.example.com/1', 'https://jobs.example.com/2')).toBe(false);
  });

  it('ignores job keys that are not Indeed ids, and other sites', () => {
    expect(indeedJobKey(new URL('https://www.indeed.com/jobs?vjk=<script>'))).toBeNull();
    expect(indeedJobKey(new URL('https://example.com/jobs?vjk=b5e7a1c3d9f20486'))).toBeNull();
    expect(jobPageIdentity('not a url')).toBe('not a url');
  });
});

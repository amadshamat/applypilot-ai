import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { emptyProfileContent, type ProfileContent } from '@applypilot/shared';

const APPLICATIONS = resolve(import.meta.dirname, '../../../tests/fixtures/applications');

/** Loads a sample application page. Its own scripts run, as they would in the browser. */
export function loadApplication(name: string, url: string): { dom: JSDOM; doc: Document } {
  const html = readFileSync(resolve(APPLICATIONS, name), 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  return { dom, doc: dom.window.document };
}

export function htmlPage(body: string, url = 'https://careers.example.com/apply'): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url,
    pretendToBeVisual: true,
  }).window.document;
}

export function sampleProfile(): ProfileContent {
  const profile = emptyProfileContent();
  profile.personal = {
    fullName: 'Avery Chen',
    email: 'avery@example.com',
    phone: '+1 555 0100',
    location: 'Springfield, VA 22150',
    portfolioUrl: 'https://avery.dev',
    linkedinUrl: 'https://www.linkedin.com/in/averychen',
    githubUrl: 'https://github.com/avery',
  };
  profile.summary = 'Computer science student focused on cloud infrastructure.';
  profile.experience = [
    {
      id: 'e1',
      employer: 'Northwind Logistics',
      position: 'Cloud Support Intern',
      location: 'Remote',
      startDate: '2025-06',
      endDate: '2025-08',
      current: false,
      bullets: [
        'Automated EC2 snapshot cleanup with Python',
        'Wrote runbooks for 12 support tickets',
      ],
      technologies: ['AWS', 'Python'],
    },
    {
      id: 'e2',
      employer: 'Campus IT Help Desk',
      position: 'IT Support Assistant',
      location: 'Springfield, VA',
      startDate: '2024-09',
      endDate: '',
      current: true,
      bullets: ['Resolved 30 tickets a week'],
      technologies: [],
    },
  ];
  profile.education = [
    {
      id: 'ed1',
      institution: 'State University',
      degree: 'B.S. Computer Science',
      field: 'Computer Science',
      startDate: '2022-09',
      endDate: '2026-05',
      current: true,
      gpa: '3.8',
      coursework: [],
    },
  ];
  profile.skills = [
    { id: 's1', name: 'Python', category: 'language' },
    { id: 's2', name: 'AWS', category: 'cloud' },
  ];
  profile.certifications = [
    {
      id: 'c1',
      name: 'AWS Certified Cloud Practitioner',
      issuer: 'Amazon Web Services',
      date: '2025-01',
      credentialUrl: '',
    },
  ];
  profile.preferences.salaryExpectation = '$30/hour';
  return profile;
}

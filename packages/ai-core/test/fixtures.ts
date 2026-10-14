import { emptyProfileContent, type JobPosting, type ProfileContent } from '@applypilot/shared';

export function sampleProfile(): ProfileContent {
  const profile = emptyProfileContent();
  profile.personal = {
    fullName: 'Avery Chen',
    email: 'avery@example.com',
    phone: '+1 555 0100',
    location: 'Seattle, WA',
    portfolioUrl: 'https://avery.dev',
    linkedinUrl: '',
    githubUrl: 'https://github.com/avery',
  };
  profile.summary = 'Computer science student focused on cloud infrastructure.';
  profile.experience = [
    {
      id: 'exp-uuid-1',
      employer: 'Northwind Logistics',
      position: 'Cloud Support Intern',
      location: 'Remote',
      startDate: '2025-06',
      endDate: '2025-08',
      current: false,
      bullets: [
        'Automated EC2 snapshot cleanup with Python and AWS Lambda, cutting storage costs by 18%',
        'Wrote runbooks for 12 common support tickets',
      ],
      technologies: ['AWS', 'Python'],
    },
  ];
  profile.projects = [
    {
      id: 'proj-uuid-1',
      name: 'Homelab Kubernetes',
      description: 'A three-node cluster for learning.',
      technologies: ['Kubernetes', 'Docker'],
      url: '',
      bullets: ['Deployed a monitoring stack with Prometheus and Grafana'],
    },
  ];
  profile.education = [
    {
      id: 'edu-uuid-1',
      institution: 'State University',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      startDate: '2022-09',
      endDate: '2026-05',
      current: true,
      gpa: '3.8',
      coursework: ['Operating Systems'],
    },
  ];
  profile.certifications = [
    {
      id: 'cert-uuid-1',
      name: 'AWS Certified Cloud Practitioner',
      issuer: 'Amazon Web Services',
      date: '2025-01',
      credentialUrl: '',
    },
  ];
  profile.skills = [
    { id: 's1', name: 'Python', category: 'language' },
    { id: 's2', name: 'AWS', category: 'cloud' },
    { id: 's3', name: 'Docker', category: 'devops' },
    { id: 's4', name: 'Kubernetes', category: 'devops' },
  ];
  profile.preferences.salaryExpectation = '$30/hour';
  profile.preferences.locations = ['Seattle'];
  return profile;
}

const found = <T>(value: T) => ({
  status: 'found' as const,
  value,
  source: 'json-ld' as const,
  confidence: 'high' as const,
});
const missing = { status: 'missing' as const };

export function sampleJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    title: found('Cloud Engineering Intern'),
    company: found('Contoso'),
    description: found(
      'Join our 2027 summer internship. You will automate AWS infrastructure with Terraform and Python.',
    ),
    location: found('Seattle, WA'),
    workArrangement: missing,
    salary: missing,
    employmentType: missing,
    requiredQualifications: found(['Experience with AWS', 'Python scripting']),
    preferredQualifications: found(['Terraform']),
    skills: found(['AWS', 'Python', 'Terraform']),
    yearsOfExperience: missing,
    education: missing,
    applicationDeadline: missing,
    url: missing,
    jobId: missing,
    hasApplicationForm: missing,
    ...overrides,
  };
}

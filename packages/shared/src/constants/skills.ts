/**
 * Canonical skill vocabulary used by deterministic extraction and, later, matching.
 * Patterns are matched on token boundaries, so "Java" never matches "JavaScript"
 * and "Git" never matches "GitHub". Ambiguous English words ("go", "rest",
 * "swift", "spring") are matched only in their technical capitalization.
 */
export interface SkillDefinition {
  name: string;
  category: 'language' | 'framework' | 'cloud' | 'devops' | 'data' | 'tool' | 'practice';
  /** Matched case-insensitively. */
  aliases: readonly string[];
  /** Matched case-sensitively; used for short or ambiguous words such as "Go" or "REST". */
  exact?: readonly string[];
}

export const SKILL_TAXONOMY: readonly SkillDefinition[] = [
  { name: 'Python', category: 'language', aliases: ['python'] },
  { name: 'JavaScript', category: 'language', aliases: ['javascript', 'ecmascript'] },
  { name: 'TypeScript', category: 'language', aliases: ['typescript'] },
  { name: 'Java', category: 'language', aliases: ['java'] },
  { name: 'C#', category: 'language', aliases: ['c#', 'csharp'] },
  { name: 'C++', category: 'language', aliases: ['c++', 'cpp'] },
  { name: 'Go', category: 'language', aliases: ['golang'], exact: ['Go'] },
  { name: 'Rust', category: 'language', aliases: [], exact: ['Rust'] },
  { name: 'Ruby', category: 'language', aliases: ['ruby'] },
  { name: 'PHP', category: 'language', aliases: ['php'] },
  { name: 'Kotlin', category: 'language', aliases: ['kotlin'] },
  { name: 'Swift', category: 'language', aliases: [], exact: ['Swift'] },
  { name: 'SQL', category: 'language', aliases: ['sql'] },
  { name: 'Bash', category: 'language', aliases: ['bash', 'shell scripting', 'shell scripts'] },
  { name: 'PowerShell', category: 'language', aliases: ['powershell'] },
  { name: 'React', category: 'framework', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'Angular', category: 'framework', aliases: ['angular'] },
  { name: 'Vue', category: 'framework', aliases: ['vue', 'vue.js', 'vuejs'] },
  { name: 'Node.js', category: 'framework', aliases: ['node.js', 'nodejs'] },
  { name: 'Express', category: 'framework', aliases: ['express.js', 'expressjs'] },
  { name: 'Django', category: 'framework', aliases: ['django'] },
  { name: 'Flask', category: 'framework', aliases: ['flask'] },
  { name: 'Spring', category: 'framework', aliases: ['spring boot', 'spring framework'] },
  { name: '.NET', category: 'framework', aliases: ['.net', 'dotnet', 'asp.net'] },
  { name: 'AWS', category: 'cloud', aliases: ['aws', 'amazon web services'] },
  { name: 'Azure', category: 'cloud', aliases: ['azure', 'microsoft azure'] },
  { name: 'Google Cloud', category: 'cloud', aliases: ['gcp', 'google cloud'] },
  { name: 'AWS Lambda', category: 'cloud', aliases: ['aws lambda'], exact: ['Lambda'] },
  { name: 'Amazon EC2', category: 'cloud', aliases: ['amazon ec2'], exact: ['EC2'] },
  { name: 'Amazon S3', category: 'cloud', aliases: ['amazon s3'], exact: ['S3'] },
  { name: 'DynamoDB', category: 'cloud', aliases: ['dynamodb'] },
  { name: 'Docker', category: 'devops', aliases: ['docker', 'containerization'] },
  { name: 'Kubernetes', category: 'devops', aliases: ['kubernetes', 'k8s'] },
  { name: 'Terraform', category: 'devops', aliases: ['terraform'] },
  { name: 'AWS CDK', category: 'devops', aliases: ['aws cdk'], exact: ['CDK'] },
  { name: 'CloudFormation', category: 'devops', aliases: ['cloudformation'] },
  { name: 'Ansible', category: 'devops', aliases: ['ansible'] },
  {
    name: 'CI/CD',
    category: 'devops',
    aliases: ['ci/cd', 'continuous integration', 'continuous delivery'],
  },
  { name: 'GitHub Actions', category: 'devops', aliases: ['github actions'] },
  { name: 'Jenkins', category: 'devops', aliases: ['jenkins'] },
  { name: 'Linux', category: 'devops', aliases: ['linux', 'unix'] },
  {
    name: 'Networking',
    category: 'devops',
    aliases: ['computer networking', 'tcp/ip'],
    exact: ['DNS'],
  },
  { name: 'PostgreSQL', category: 'data', aliases: ['postgresql', 'postgres'] },
  { name: 'MySQL', category: 'data', aliases: ['mysql'] },
  { name: 'MongoDB', category: 'data', aliases: ['mongodb'] },
  { name: 'Redis', category: 'data', aliases: ['redis'] },
  { name: 'Machine Learning', category: 'data', aliases: ['machine learning'], exact: ['ML'] },
  { name: 'Git', category: 'tool', aliases: ['git'] },
  {
    name: 'REST APIs',
    category: 'practice',
    aliases: ['restful', 'rest api', 'rest apis'],
    exact: ['REST'],
  },
  { name: 'GraphQL', category: 'practice', aliases: ['graphql'] },
  {
    name: 'Agile',
    category: 'practice',
    aliases: ['agile methodology', 'scrum'],
    exact: ['Agile'],
  },
  { name: 'Unit Testing', category: 'practice', aliases: ['unit testing', 'unit tests', 'tdd'] },
  {
    name: 'Security',
    category: 'practice',
    aliases: ['cybersecurity', 'information security'],
    exact: ['IAM'],
  },
];

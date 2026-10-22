import { fileURLToPath } from 'node:url';
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import pkg from '../package.json' with { type: 'json' };
import { ApplyPilotStack } from '../lib/applypilot-stack';

/**
 * CDK app. Settings come from cdk.json "context" or the command line, e.g.
 *
 *   pnpm --filter @applypilot/infra synth -c extensionIds=<id> -c authDomainPrefix=applypilot-muhaid
 *
 * Synthesizing only writes CloudFormation templates to cdk.out: no AWS
 * account, credentials or charges are involved. Deploying is a separate,
 * deliberate step (docs/AWS.md).
 */

const app = new App();
const context = (key: string): string | undefined => {
  const value: unknown = app.node.tryGetContext(key);
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
};
const flag = (key: string) => context(key) === 'true';
const number = (key: string) => (context(key) === undefined ? undefined : Number(context(key)));

const region = context('region') ?? 'ca-central-1';
const alertEmail = context('alertEmail');
const monthlyBudgetUsd = number('monthlyBudgetUsd');
new ApplyPilotStack(app, 'ApplyPilotCloud', {
  env: {
    region,
    ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}),
  },
  description: 'ApplyPilot Cloud: optional sync backend for the ApplyPilot AI extension',
  extensionIds: (context('extensionIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  authDomainPrefix: context('authDomainPrefix') ?? '',
  lambdaDir: fileURLToPath(new URL('../../services/api/dist/lambda', import.meta.url)),
  appVersion: pkg.version,
  enableAi: flag('enableAi'),
  aiProvider: context('aiProvider') === 'anthropic' ? 'anthropic' : 'mock',
  enableWaf: flag('enableWaf'),
  ...(alertEmail ? { alertEmail } : {}),
  ...(monthlyBudgetUsd ? { monthlyBudgetUsd } : {}),
  tags: { project: 'applypilot-ai' },
});

// cdk-nag: AWS Solutions security checks run on every synth; a finding stops it.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { App, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { CLOUD_ROUTES } from '@applypilot/sync';
import { ApplyPilotStack, type ApplyPilotStackProps } from '../lib/applypilot-stack';

const EXT_A = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_B = 'ponmlkjihgfedcbaponmlkjihgfedcba';

function lambdaDir() {
  const dir = mkdtempSync(join(tmpdir(), 'applypilot-lambda-'));
  for (const name of ['data', 'account', 'ai']) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'index.mjs'), 'export const handler = async () => ({});');
  }
  return dir;
}

const cdkContext = (
  JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')) as {
    context: Record<string, unknown>;
  }
).context;

function synth(overrides: Partial<ApplyPilotStackProps> = {}, nag = false) {
  const app = new App({ context: cdkContext });
  if (nag) Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  const stack = new ApplyPilotStack(app, 'Test', {
    env: { region: 'ca-central-1', account: '111111111111' },
    extensionIds: [EXT_A, EXT_B],
    authDomainPrefix: 'applypilot-test',
    lambdaDir: lambdaDir(),
    appVersion: '0.6.0',
    ...overrides,
  });
  return { app, stack, template: Template.fromStack(stack) };
}

type Statement = { Action: string | string[]; Resource: unknown; Effect: string };

/** Every statement in the inline policies attached to the role whose logical id starts with `prefix`. */
function statements(template: Template, prefix: string): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .filter((p) => (p.Properties.Roles as { Ref: string }[]).some((r) => r.Ref.startsWith(prefix)))
    .flatMap((p) => p.Properties.PolicyDocument.Statement as Statement[]);
}

const actions = (list: Statement[]) =>
  list.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])).sort();

describe('ApplyPilot Cloud stack', () => {
  const { template } = synth();

  it('keeps data in one encrypted, recoverable, on-demand table that is never deleted by accident', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        BillingMode: 'PAY_PER_REQUEST',
        // SSEEnabled alone means KMS with the AWS managed key (aws/dynamodb).
        SSESpecification: { SSEEnabled: true },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        DeletionProtectionEnabled: true,
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        LocalSecondaryIndexes: [
          Match.objectLike({
            IndexName: 'byChange',
            KeySchema: [
              { AttributeName: 'pk', KeyType: 'HASH' },
              { AttributeName: 'changedAt', KeyType: 'RANGE' },
            ],
          }),
        ],
      }),
    });
  });

  it('signs users in with Cognito: strong passwords, optional MFA, no secrets in the extension', () => {
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        UserPoolTier: 'LITE',
        DeletionProtection: 'ACTIVE',
        MfaConfiguration: 'OPTIONAL',
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
        Policies: {
          PasswordPolicy: Match.objectLike({
            MinimumLength: 12,
            RequireLowercase: true,
            RequireUppercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
          }),
        },
      }),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ['openid', 'email'],
      CallbackURLs: [`https://${EXT_A}.chromiumapp.org/`, `https://${EXT_B}.chromiumapp.org/`],
      LogoutURLs: [`https://${EXT_A}.chromiumapp.org/`, `https://${EXT_B}.chromiumapp.org/`],
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      SupportedIdentityProviders: ['COGNITO'],
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'applypilot-test' });
  });

  it('creates exactly the routes in the shared route table, all behind Cognito except health', () => {
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method')).filter(
      (m) => m.Properties.HttpMethod !== 'OPTIONS',
    );
    expect(methods).toHaveLength(CLOUD_ROUTES.length);
    const resources = template.findResources('AWS::ApiGateway::Resource');
    const pathOf = (ref: string): string => {
      const resource = resources[ref];
      if (!resource) return '';
      const parent = resource.Properties.ParentId as { Ref?: string };
      return `${parent.Ref ? pathOf(parent.Ref) : ''}/${resource.Properties.PathPart as string}`;
    };
    const created = methods
      .map((m) => {
        const path = pathOf((m.Properties.ResourceId as { Ref: string }).Ref);
        return `${m.Properties.HttpMethod as string} ${path} ${m.Properties.AuthorizationType as string}`;
      })
      .sort();
    const expected = CLOUD_ROUTES.map(
      (r) => `${r.method} ${r.path} ${r.auth ? 'COGNITO_USER_POOLS' : 'NONE'}`,
    ).sort();
    expect(created).toEqual(expected);
    for (const m of methods) {
      if (m.Properties.AuthorizationType === 'COGNITO_USER_POOLS') {
        expect(m.Properties.AuthorizationScopes).toEqual(['openid']);
      }
    }
  });

  it('throttles the API and logs no bodies or personal data', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'prod',
      MethodSettings: [
        Match.objectLike({
          DataTraceEnabled: false,
          LoggingLevel: 'ERROR',
          MetricsEnabled: false,
          ThrottlingRateLimit: 20,
          ThrottlingBurstLimit: 40,
        }),
      ],
      AccessLogSetting: Match.objectLike({
        Format: Match.not(Match.stringLikeRegexp('sourceIp|identity|requestOverride|body')),
      }),
    });
    const groups = Object.values(template.findResources('AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) expect(group.Properties.RetentionInDays).toBe(30);
  });

  it('answers API Gateway’s own errors in the API’s JSON error shape', () => {
    template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'UNAUTHORIZED',
      ResponseTemplates: {
        'application/json': Match.stringLikeRegexp('"code":"UNAUTHORIZED"'),
      },
    });
    template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'MISSING_AUTHENTICATION_TOKEN',
      StatusCode: '404',
    });
  });

  it('gives each function only the permissions its routes need', () => {
    const data = statements(template, 'dataRole');
    const account = statements(template, 'accountRole');
    const dynamo = (list: Statement[]) => actions(list).filter((a) => a.startsWith('dynamodb:'));
    expect(dynamo(data)).toEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    expect(dynamo(account)).toEqual([
      'dynamodb:BatchWriteItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    expect(actions(data)).not.toContain('cognito-idp:AdminDeleteUser');
    const cognito = account.find((s) => s.Action === 'cognito-idp:AdminDeleteUser');
    expect(cognito?.Resource).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^Users/), 'Arn'] });
    for (const s of [...data, ...account]) {
      expect(s.Resource).not.toBe('*');
      expect(actions([s]).some((a) => a.endsWith(':*'))).toBe(false);
    }
    // No AWS managed policies on the function roles.
    const roles = template.findResources('AWS::IAM::Role');
    for (const [id, role] of Object.entries(roles)) {
      if (/^(data|account|ai)Role/.test(id))
        expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    }
  });

  it('runs current Node.js on ARM with short timeouts and no secrets in environment variables', () => {
    const functions = Object.values(template.findResources('AWS::Lambda::Function'));
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn.Properties).toMatchObject({
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        Handler: 'index.handler',
      });
      expect(fn.Properties.Timeout).toBeLessThanOrEqual(29);
      const env = JSON.stringify(fn.Properties.Environment);
      expect(env).not.toMatch(/sk-ant|ANTHROPIC_API_KEY|password|secret/i);
      expect(fn.Properties.Environment.Variables.ALLOWED_ORIGINS).toBe(
        `chrome-extension://${EXT_A},chrome-extension://${EXT_B}`,
      );
    }
  });

  it('includes nothing that costs money by default: no AI, secret, firewall or budget', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
    template.resourceCountIs('AWS::WAFv2::WebACL', 0);
    template.resourceCountIs('AWS::Budgets::Budget', 0);
    template.resourceCountIs('AWS::SNS::Topic', 0);
    // Alarms exist either way (a few cents a month each).
    template.resourceCountIs('AWS::CloudWatch::Alarm', 4);
  });

  it('outputs what the extension needs to connect', () => {
    for (const name of ['ApiUrl', 'AuthUrl', 'ClientId', 'UserPoolId', 'TableName']) {
      template.hasOutput(name, Match.anyValue());
    }
  });

  it('passes the cdk-nag AWS Solutions checks', () => {
    expect(() => synth({}, true).app.synth()).not.toThrow();
    expect(() =>
      synth({ enableAi: true, alertEmail: 'me@example.com', enableWaf: true }, true).app.synth(),
    ).not.toThrow();
  });
});

describe('optional parts', () => {
  it('adds the AI function with read access to its one secret, and the AI routes', () => {
    const { template } = synth({ enableAi: true, aiProvider: 'anthropic' });
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          AI_PROVIDER: 'anthropic',
          AI_DAILY_LIMIT: '25',
          ANTHROPIC_SECRET_ARN: { Ref: Match.stringLikeRegexp('^AnthropicApiKey') },
        }),
      },
    });
    const ai = statements(template, 'aiRole');
    const secretRead = ai.find((s) => actions([s]).includes('secretsmanager:GetSecretValue'));
    expect(secretRead?.Resource).toEqual({ Ref: expect.stringMatching(/^AnthropicApiKey/) });
    expect(actions(ai).filter((a) => a.startsWith('dynamodb:'))).toEqual([
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
    ]);
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method')).filter(
      (m) => m.Properties.HttpMethod === 'POST',
    );
    expect(methods.length).toBe(CLOUD_ROUTES.filter((r) => r.method === 'POST').length + 4);
  });

  it('adds email alerts, a budget and the firewall when asked', () => {
    const { template } = synth({
      alertEmail: 'me@example.com',
      monthlyBudgetUsd: 3,
      enableWaf: true,
    });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'me@example.com',
    });
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 3, Unit: 'USD' }, TimeUnit: 'MONTHLY' }),
    });
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'REGIONAL',
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'RateLimitPerIp',
          Statement: { RateBasedStatement: { Limit: 500, AggregateKeyType: 'IP' } },
        }),
      ]),
    });
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
    for (const alarm of alarms) expect(alarm.Properties.AlarmActions).toHaveLength(1);
  });

  it('refuses invalid settings', () => {
    expect(() => synth({ extensionIds: [] })).toThrow('extensionIds');
    expect(() => synth({ extensionIds: ['not-an-id'] })).toThrow('extensionIds');
    expect(() => synth({ authDomainPrefix: 'Bad_Prefix' })).toThrow('authDomainPrefix');
  });
});

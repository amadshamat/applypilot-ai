import { join } from 'node:path';
import {
  CfnOutput,
  type CfnResource,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
  aws_apigateway as apigw,
  aws_budgets as budgets,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cwActions,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_wafv2 as wafv2,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { AI_TASKS } from '@applypilot/ai-core';
import { CLOUD_ROUTES, type CloudFunction, type CloudRoute } from '@applypilot/sync';
import { TABLE } from '@applypilot/api/table';

/**
 * ApplyPilot Cloud: an optional, serverless backend for syncing a user's
 * profile and tracked applications across devices.
 *
 *   Extension ──HTTPS──▶ API Gateway (REST, throttled, Cognito authorizer)
 *                          ├─▶ Lambda "data"     ──▶ DynamoDB (one table)
 *                          ├─▶ Lambda "account"  ──▶ DynamoDB + Cognito AdminDeleteUser
 *                          └─▶ Lambda "ai" (opt) ──▶ Secrets Manager (Anthropic key) → Claude API
 *   Extension ──OAuth (code + PKCE)──▶ Cognito hosted sign-in
 *
 * Every function has its own role with only the actions its routes use.
 * Nothing here runs until someone deploys it (see docs/AWS.md).
 */

export interface ApplyPilotStackProps extends StackProps {
  /** Chrome extension IDs allowed to sign in (OAuth redirect) and call the API (CORS). */
  extensionIds: string[];
  /** Prefix of the Cognito sign-in domain: <prefix>.auth.<region>.amazoncognito.com */
  authDomainPrefix: string;
  /** Folder holding the bundled functions (services/api/dist/lambda). */
  lambdaDir: string;
  appVersion: string;
  /** Deploy the AI function and the secret for the Anthropic key. Off by default. */
  enableAi?: boolean;
  /** "mock" (free, offline drafts) or "anthropic" (real, billed Claude calls). */
  aiProvider?: 'mock' | 'anthropic';
  aiDailyLimit?: number;
  /** Email for alarm notifications and the monthly budget. */
  alertEmail?: string;
  monthlyBudgetUsd?: number;
  /** AWS WAF in front of the API. Off by default because it costs about $6+/month. */
  enableWaf?: boolean;
  /** Steady requests per second for the whole API (API Gateway throttling). */
  apiRateLimit?: number;
  apiBurstLimit?: number;
  requestsPerMinutePerUser?: number;
}

const EXTENSION_ID = /^[a-p]{32}$/;

export class ApplyPilotStack extends Stack {
  readonly api: apigw.RestApi;
  readonly table: dynamodb.Table;
  readonly userPool: cognito.UserPool;
  readonly functions: Partial<Record<CloudFunction, lambda.Function>> = {};

  constructor(scope: Construct, id: string, props: ApplyPilotStackProps) {
    super(scope, id, props);
    const ids = [...new Set(props.extensionIds)];
    if (ids.length === 0 || !ids.every((x) => EXTENSION_ID.test(x))) {
      throw new Error('extensionIds must list one or more Chrome extension IDs (32 letters a–p).');
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(props.authDomainPrefix)) {
      throw new Error('authDomainPrefix must be lower-case letters, digits and hyphens.');
    }
    const origins = ids.map((x) => `chrome-extension://${x}`);
    const redirects = ids.map((x) => `https://${x}.chromiumapp.org/`);

    // ---------- Data ----------
    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: TABLE.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: { name: TABLE.sortKey, type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Encrypted at rest with the AWS managed key for DynamoDB (no monthly key fee).
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: TABLE.ttlAttribute,
    });
    this.table.addLocalSecondaryIndex({
      indexName: TABLE.changeIndex,
      sortKey: { name: TABLE.changeAttribute, type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---------- Sign-in ----------
    this.userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: 'applypilot-users',
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.authDomainPrefix },
    });
    const client = this.userPool.addClient('Extension', {
      userPoolClientName: 'applypilot-extension',
      // A browser extension cannot keep a secret: public client with PKCE.
      generateSecret: false,
      authFlows: { userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: redirects,
        logoutUrls: redirects,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // ---------- Functions ----------
    const baseEnv = {
      TABLE_NAME: this.table.tableName,
      USER_POOL_ID: this.userPool.userPoolId,
      USER_POOL_CLIENT_ID: client.userPoolClientId,
      ALLOWED_ORIGINS: origins.join(','),
      APP_VERSION: props.appVersion,
      REQUESTS_PER_MINUTE: String(props.requestsPerMinutePerUser ?? 120),
    };
    const tableArns = [this.table.tableArn, `${this.table.tableArn}/index/${TABLE.changeIndex}`];

    const makeFunction = (
      name: CloudFunction,
      tableActions: string[],
      options: {
        timeout?: Duration;
        memorySize?: number;
        environment?: Record<string, string>;
      } = {},
    ) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      // Own role, no managed policies: write its own logs, and the table actions listed.
      const role = new iam.Role(this, `${name}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        description: `ApplyPilot ${name} function`,
      });
      logGroup.grantWrite(role);
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: tableActions.map((a) => `dynamodb:${a}`),
          resources: tableArns,
        }),
      );
      const fn = new lambda.Function(this, `${name}Function`, {
        description: `ApplyPilot Cloud: ${name}`,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(join(props.lambdaDir, name)),
        memorySize: options.memorySize ?? 256,
        timeout: options.timeout ?? Duration.seconds(10),
        role,
        logGroup,
        environment: { ...baseEnv, ...options.environment },
      });
      this.functions[name] = fn;
      Validations.of(role).acknowledge({
        id: `AwsSolutions-IAM5[Resource::<${this.getLogicalId(logGroup.node.defaultChild as CfnResource)}.Arn>:*]`,
        reason: 'Log stream names are created at run time inside this function’s own log group.',
      });
      return fn;
    };

    makeFunction('data', ['GetItem', 'PutItem', 'UpdateItem', 'Query']);
    const account = makeFunction('account', ['Query', 'BatchWriteItem', 'PutItem', 'UpdateItem'], {
      timeout: Duration.seconds(29),
    });
    account.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminDeleteUser'],
        resources: [this.userPool.userPoolArn],
      }),
    );

    let secret: secretsmanager.Secret | undefined;
    if (props.enableAi) {
      secret = new secretsmanager.Secret(this, 'AnthropicApiKey', {
        description:
          'Anthropic API key for ApplyPilot AI features. Starts as a random placeholder; put the real key with "aws secretsmanager put-secret-value".',
      });
      const ai = makeFunction('ai', ['GetItem', 'UpdateItem'], {
        timeout: Duration.seconds(29),
        memorySize: 512,
        environment: {
          AI_PROVIDER: props.aiProvider ?? 'mock',
          AI_DAILY_LIMIT: String(props.aiDailyLimit ?? 25),
          ANTHROPIC_SECRET_ARN: secret.secretArn,
        },
      });
      secret.grantRead(ai);
      Validations.of(secret).acknowledge({
        id: 'AwsSolutions-SMG4',
        reason:
          'A third-party API key cannot be rotated by Secrets Manager; it is rotated by hand in the Anthropic Console.',
      });
    }

    // ---------- API ----------
    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: 'applypilot-cloud',
      description: 'ApplyPilot Cloud API (v1)',
      endpointConfiguration: { types: [apigw.EndpointType.REGIONAL] },
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: props.apiRateLimit ?? 20,
        throttlingBurstLimit: props.apiBurstLimit ?? 40,
        // Execution logs for errors only, and never request or response bodies.
        loggingLevel: apigw.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        // Per-method metrics are billed as custom metrics; the API-wide ones are free.
        metricsEnabled: false,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogs),
        // No IP addresses, user ids, paths with ids or bodies: route template, status, timing.
        accessLogFormat: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            time: '$context.requestTimeEpoch',
            method: '$context.httpMethod',
            resource: '$context.resourcePath',
            status: '$context.status',
            latencyMs: '$context.responseLatency',
            error: '$context.error.message',
          }),
        ),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: origins,
        allowMethods: ['GET', 'PUT', 'POST', 'DELETE'],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: Duration.minutes(10),
      },
    });

    // Errors API Gateway itself returns use the same JSON shape as the API's own.
    const gatewayErrors: [apigw.ResponseType, string, string?][] = [
      [apigw.ResponseType.UNAUTHORIZED, 'UNAUTHORIZED'],
      [apigw.ResponseType.ACCESS_DENIED, 'FORBIDDEN'],
      [apigw.ResponseType.THROTTLED, 'RATE_LIMITED'],
      [apigw.ResponseType.MISSING_AUTHENTICATION_TOKEN, 'NOT_FOUND', '404'],
      [apigw.ResponseType.REQUEST_TOO_LARGE, 'PAYLOAD_TOO_LARGE'],
      [apigw.ResponseType.DEFAULT_4XX, 'INVALID_REQUEST'],
      [apigw.ResponseType.DEFAULT_5XX, 'INTERNAL'],
    ];
    for (const [type, code, statusCode] of gatewayErrors) {
      this.api.addGatewayResponse(`Gateway${code}${statusCode ?? ''}`, {
        type,
        ...(statusCode ? { statusCode } : {}),
        responseHeaders: { 'Content-Type': "'application/json'" },
        templates: {
          'application/json': `{"error":{"code":"${code}","message":$context.error.messageString,"requestId":"$context.requestId"}}`,
        },
      });
    }

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [this.userPool],
      resultsCacheTtl: Duration.minutes(5),
    });
    const routes: CloudRoute[] = [
      ...CLOUD_ROUTES,
      ...(props.enableAi
        ? AI_TASKS.map((task): CloudRoute => ({
            method: 'POST',
            path: `/v1/${task}`,
            fn: 'ai',
            auth: true,
            summary: `AI: ${task}`,
          }))
        : []),
    ];
    const integrations = new Map<CloudFunction, apigw.LambdaIntegration>();
    for (const route of routes) {
      const fn = this.functions[route.fn];
      if (!fn) continue;
      let integration = integrations.get(route.fn);
      if (!integration) {
        integration = new apigw.LambdaIntegration(fn, { proxy: true });
        integrations.set(route.fn, integration);
      }
      const resource = this.api.root.resourceForPath(route.path);
      resource.addMethod(
        route.method,
        integration,
        route.auth
          ? {
              authorizer,
              authorizationType: apigw.AuthorizationType.COGNITO,
              // With a scope, the authorizer accepts access tokens (not ID tokens).
              authorizationScopes: ['openid'],
            }
          : { authorizationType: apigw.AuthorizationType.NONE },
      );
    }

    // ---------- Optional: AWS WAF ----------
    if (props.enableWaf) {
      const acl = new wafv2.CfnWebACL(this, 'Firewall', {
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'applypilot-waf',
          sampledRequestsEnabled: false,
        },
        rules: [
          {
            name: 'RateLimitPerIp',
            priority: 0,
            action: { block: {} },
            statement: { rateBasedStatement: { limit: 500, aggregateKeyType: 'IP' } },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'applypilot-rate',
              sampledRequestsEnabled: false,
            },
          },
          {
            name: 'AwsCommonRules',
            priority: 1,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
                // Sync uploads are legitimately larger than this rule's 8 KB body limit.
                ruleActionOverrides: [
                  { name: 'SizeRestrictions_BODY', actionToUse: { count: {} } },
                ],
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'applypilot-common',
              sampledRequestsEnabled: false,
            },
          },
        ],
      });
      new wafv2.CfnWebACLAssociation(this, 'FirewallAssociation', {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: acl.attrArn,
      });
    }

    // ---------- Monitoring ----------
    const topic = props.alertEmail
      ? new sns.Topic(this, 'Alerts', { displayName: 'ApplyPilot Cloud alerts', enforceSSL: true })
      : undefined;
    if (topic && props.alertEmail) {
      topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    }
    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
    ) => {
      const a = new cloudwatch.Alarm(this, id, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });
      if (topic) a.addAlarmAction(new cwActions.SnsAction(topic));
      return a;
    };
    const fiveMinutes = { period: Duration.minutes(5), statistic: 'Sum' };
    alarm(
      'Api5xxAlarm',
      this.api.metricServerError(fiveMinutes),
      5,
      'The API returned server errors.',
    );
    alarm(
      'Api4xxAlarm',
      this.api.metricClientError(fiveMinutes),
      300,
      'Unusually many refused requests: a broken client or someone probing the API.',
    );
    for (const [name, fn] of Object.entries(this.functions)) {
      alarm(`${name}ErrorsAlarm`, fn.metricErrors(fiveMinutes), 1, `The ${name} function crashed.`);
    }

    if (props.alertEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'applypilot-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.monthlyBudgetUsd ?? 5, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
          },
        ],
      });
    }

    // ---------- What the extension needs ----------
    new CfnOutput(this, 'ApiUrl', { value: this.api.url.replace(/\/$/, '') });
    new CfnOutput(this, 'AuthUrl', { value: domain.baseUrl() });
    new CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'TableName', { value: this.table.tableName });

    // Only the health check and CORS preflights are open; everything else uses the authorizer.
    const open = this.api.methods.filter(
      (m) => m.httpMethod === 'OPTIONS' || m.resource.path === '/v1/health',
    );
    for (const method of open) {
      for (const id of ['AwsSolutions-APIG4', 'AwsSolutions-COG4']) {
        Validations.of(method).acknowledge({
          id,
          reason: 'Health check or CORS preflight: no data behind it.',
        });
      }
    }
    this.suppressReviewedFindings();
  }

  /** cdk-nag findings that were reviewed and accepted, each with the reason. */
  private suppressReviewedFindings() {
    const reviewed = [
      {
        id: 'AwsSolutions-COG2',
        reason:
          'MFA (authenticator app) is optional so signing up stays simple; users can turn it on.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason:
          'Threat protection needs the Cognito Plus plan (billed per user); the Lite plan is used to keep the project free to run.',
      },
      {
        id: 'AwsSolutions-APIG2',
        reason:
          'Every request body is validated in the function with the shared Zod contract, which is stricter than API Gateway models.',
      },
      {
        id: 'AwsSolutions-APIG3',
        reason:
          'AWS WAF costs about $6+/month; it is available with the enableWaf setting. API Gateway throttling and per-user limits stay on.',
      },
      {
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs]',
        reason:
          'Only API Gateway’s account-level CloudWatch role uses an AWS managed policy (AmazonAPIGatewayPushToCloudWatchLogs), as AWS requires.',
      },
    ];
    for (const finding of reviewed) Validations.of(this).acknowledge(finding);
  }
}

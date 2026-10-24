import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

/**
 * CSP for the frontend; the API sets its own headers. Built from what the SPA loads: Clerk (prod
 * instance clerk.cortexi.ai and the dev instance the AWS stacks still build with, plus Cloudflare
 * Turnstile for its bot protection), Paddle checkout (live and sandbox CDNs), the Meta SDK (WhatsApp
 * signup) and Google Fonts. The hash allows the one inline handler, the font stylesheet's
 * onload="this.media='all'". Images and video come from many CDNs (scraped social posts, S3, AI
 * image hosts), so those allow any https source. render.yaml sends the same policy plus the Render
 * API origin; keep them in step.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc=' https://clerk.cortexi.ai https://concrete-tuna-44.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com https://cdn.paddle.com https://sandbox-cdn.paddle.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.paddle.com https://sandbox-cdn.paddle.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://clerk.cortexi.ai https://concrete-tuna-44.clerk.accounts.dev https://*.protect.clerk.com:* https://*.paddle.com https://*.facebook.com",
  "frame-src https://challenges.cloudflare.com https://*.protect.clerk.com https://*.paddle.com https://*.facebook.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export interface QeStackProps extends cdk.StackProps {
  envName: 'staging' | 'prod';
  /** Checkout to build from: <srcDir>/server is the API image, <srcDir>/dist the built frontend. */
  srcDir: string;
  /** Worker tasks (background jobs). Staging starts at 0 until copied data is confirmed safe. */
  workerCount: number;
  /** Custom hostname; certificateArn must be an issued us-east-1 ACM cert. Unset = the cloudfront.net URL. */
  domain?: { name: string; certificateArn: string };
  /** API tasks. Default 1, like Render; 2+ needs the multi-instance fixes (page picker, job locks, shutdown). */
  apiCount?: number;
  /** Existing bucket for scraped media; tasks get read/write on its objects through their IAM role. */
  mediaBucket?: { name: string; region: string };
  /** CloudFront-scope WAF web ACL from the us-east-1 Qe-edge stack. Unset = no WAF. */
  webAclArn?: string;
  /** Account-wide monthly budget in USD, emailed to ALERT_EMAIL at 80% actual and 100% forecast. */
  monthlyBudgetUsd?: number;
  /** Include the restore task, which drops and reloads the public schema as the master user. */
  restoreTask: boolean;
  /** Connect the app as qe_app (AppDbSecret) instead of the master user. Run `restore-db.sh <env> role` first. */
  appDbRole?: boolean;
}

export class QeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: QeStackProps) {
    super(scope, id, props);
    const { envName, srcDir, workerCount, domain } = props;
    const isProd = envName === 'prod';
    const removal = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    cdk.Tags.of(this).add('app', 'quiet-eyes');
    cdk.Tags.of(this).add('env', envName);

    // ── Network. No NAT gateway: tasks sit in public subnets with public IPs for outbound
    // calls, and their security group only accepts traffic from the load balancer.
    // ponytail: add private subnets + NAT when a fixed egress IP or compliance requires it.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });

    // ── Database
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, isProd ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      databaseName: 'qe',
      // URL-safe password: docker-entrypoint.sh builds DATABASE_URL from it without encoding.
      credentials: rds.Credentials.fromGeneratedSecret('qe_admin', {
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\=,.^',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false, // ponytail: single-AZ by decision; turn on for prod once customers depend on uptime
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
    });
    const dbSecret = db.secret!;
    const dbEnvFrom = (secret: secretsmanager.ISecret): Record<string, ecs.Secret> => ({
      DB_HOST: ecs.Secret.fromSecretsManager(secret, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(secret, 'port'),
      DB_NAME: ecs.Secret.fromSecretsManager(secret, 'dbname'),
      DB_USER: ecs.Secret.fromSecretsManager(secret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(secret, 'password'),
    });
    const dbEnv = dbEnvFrom(dbSecret);
    // The app's own login, so it doesn't hold the master user: qe_app owns the public schema's
    // objects (the startup DDL still runs) but can't create roles or databases or reach other
    // schemas. lib/restore.sh creates it from this secret; `appDbRole` then switches the app over.
    const appDbSecret = new rds.DatabaseSecret(this, 'AppDbSecret', {
      username: 'qe_app',
      excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\=,.^', // same as the master: URL-safe
    }).attach(db);

    // ── App secrets: names in secrets.<env>.txt, values only in SSM (scripts/put-secrets.sh).
    const ssmSecret = (name: string) => ecs.Secret.fromSsmParameter(
      ssm.StringParameter.fromSecureStringParameterAttributes(this, `Param${name}`, { parameterName: `/qe/${envName}/${name}` }));
    const secretNames = fs.readFileSync(path.join(__dirname, `../secrets.${envName}.txt`), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const appSecrets: Record<string, ecs.Secret> = props.appDbRole ? dbEnvFrom(appDbSecret) : { ...dbEnv };
    for (const name of secretNames) appSecrets[name] = ssmSecret(name);

    // ── Load balancer: internal, reachable only from CloudFront through a VPC origin.
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      idleTimeout: cdk.Duration.seconds(900),
    });
    const cfOriginFacing = ec2.PrefixList.fromLookup(this, 'CloudFrontOriginFacing', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    alb.connections.allowFrom(cfOriginFacing, ec2.Port.HTTP);
    const listener = alb.addListener('Http', { port: 80, open: false });

    // ── Frontend bucket + CloudFront (the free *.cloudfront.net URL until a domain is attached)
    const web = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: removal,
      autoDeleteObjects: !isProd,
    });
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      code: cloudfront.FunctionCode.fromFile({ filePath: path.join(__dirname, 'spa-rewrite.js') }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    // The managed SECURITY_HEADERS values, plus the CSP and DENY in place of SAMEORIGIN.
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: false, override: true },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: `quiet-eyes ${envName}`,
      webAclId: props.webAclArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // North America, Europe, Israel
      ...(domain && {
        domainNames: [domain.name],
        certificate: acm.Certificate.fromCertificateArn(this, 'Cert', domain.certificateArn),
      }),
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY, // stays inside the AWS network
            // 120s is the default quota ceiling; long scans answer right away and finish in the background.
            readTimeout: cdk.Duration.seconds(120),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    // Also the API's CORS origin (FRONTEND_URL), so it must be the hostname browsers actually use.
    const siteUrl = `https://${domain?.name ?? distribution.distributionDomainName}`;

    // Hashed build assets are immutable; everything else (HTML, logos, robots) revalidates.
    const webDist = path.join(srcDir, 'dist');
    new s3deploy.BucketDeployment(this, 'WebAssets', {
      sources: [s3deploy.Source.asset(path.join(webDist, 'assets'))],
      destinationBucket: web,
      destinationKeyPrefix: 'assets/',
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
      memoryLimit: 512,
    });
    new s3deploy.BucketDeployment(this, 'WebPages', {
      sources: [s3deploy.Source.asset(webDist, { exclude: ['assets', 'assets/**'] })],
      destinationBucket: web,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
      prune: false,
      memoryLimit: 512,
      distribution,
      distributionPaths: ['/*'],
    });

    // ── Compute: one image, two services (web serves HTTP, worker runs node-cron jobs)
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const image = ecs.ContainerImage.fromAsset(path.join(srcDir, 'server'), { platform: Platform.LINUX_ARM64 });
    const arm64 = { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX };
    const logGroups: Record<string, logs.LogGroup> = {};
    const taskDef = (name: string, role: 'web' | 'worker', cpu: number) => {
      const td = new ecs.FargateTaskDefinition(this, `${name}Task`, { cpu, memoryLimitMiB: 1024, runtimePlatform: arm64 });
      td.addContainer('app', {
        image,
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          ROLE: role,
          TRUST_PROXY_HOPS: '2', // CloudFront + ALB
          FRONTEND_URL: siteUrl,
          SERVER_BASE_URL: siteUrl,
          ...(props.mediaBucket && { AWS_S3_BUCKET: props.mediaBucket.name, AWS_S3_REGION: props.mediaBucket.region }),
        },
        secrets: appSecrets,
        portMappings: [{ containerPort: 3000 }],
        stopTimeout: cdk.Duration.seconds(60),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: name.toLowerCase(),
          logGroup: (logGroups[name] = new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: removal })),
        }),
      });
      // Media uploads use the task role, so no AWS keys are stored anywhere (server/src/lib/s3.ts).
      if (props.mediaBucket) {
        td.addToTaskRolePolicy(new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`arn:aws:s3:::${props.mediaBucket.name}/*`],
        }));
      }
      return td;
    };

    const api = new ecs.FargateService(this, 'Api', {
      cluster,
      taskDefinition: taskDef('Api', 'web', isProd ? 512 : 256),
      desiredCount: props.apiCount ?? 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.minutes(3), // boot runs the startup DDL
    });
    const apiTargets = listener.addTargets('Api', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: '/healthz', healthyHttpCodes: '200' },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    const worker = new ecs.FargateService(this, 'Worker', {
      cluster,
      taskDefinition: taskDef('Worker', 'worker', 512),
      desiredCount: workerCount,
      // Stop the old worker before starting the new one, so two schedulers never overlap.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
    });

    db.connections.allowDefaultPortFrom(api);
    db.connections.allowDefaultPortFrom(worker);

    // ── One-off data copy from Supabase, and the qe_app role (scripts/restore-db.sh runs it).
    // It drops the public schema as the master user, so prod only has it until cutover.
    if (props.restoreTask) {
      const restoreSg = new ec2.SecurityGroup(this, 'RestoreSecurityGroup', { vpc, description: 'One-off DB restore task' });
      db.connections.allowDefaultPortFrom(restoreSg);
      const restoreLogs = new logs.LogGroup(this, 'RestoreLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: removal });
      const restoreTask = new ecs.FargateTaskDefinition(this, 'RestoreTask', {
        cpu: 1024, memoryLimitMiB: 2048, runtimePlatform: arm64, ephemeralStorageGiB: 30,
      });
      restoreTask.addContainer('pg', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/postgres:17'),
        entryPoint: ['sh', '-c'],
        command: [fs.readFileSync(path.join(__dirname, 'restore.sh'), 'utf8')],
        environment: { RDS_CA: fs.readFileSync(path.join(srcDir, 'server', 'rds-ca.pem'), 'utf8') }, // psql verify-full
        secrets: {
          ...dbEnv,
          SOURCE_DATABASE_URL: ssmSecret('SOURCE_DATABASE_URL'),
          APP_DB_PASSWORD: ecs.Secret.fromSecretsManager(appDbSecret, 'password'),
        },
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'restore', logGroup: restoreLogs }),
      });
      new cdk.CfnOutput(this, 'RestoreTaskDef', { value: restoreTask.taskDefinitionArn });
      new cdk.CfnOutput(this, 'RestoreSg', { value: restoreSg.securityGroupId });
      new cdk.CfnOutput(this, 'RestoreLogGroup', { value: restoreLogs.logGroupName });
    }

    // ── Alarms → email. The address stays out of this public repo: CI passes the ALERT_EMAIL
    // repo variable, scripts/deploy.sh reads it from infra/.env.<env>. Required, so a deploy
    // can't silently drop the subscription.
    // ponytail: a handful of coarse alarms; add per-job alarms if these prove too blunt.
    const alertEmail = process.env.ALERT_EMAIL;
    if (!alertEmail) throw new Error('Set ALERT_EMAIL (alarm recipient): GitHub repo variable in CI, infra/.env.<env> locally');
    const alerts = new sns.Topic(this, 'Alerts', { displayName: `quiet-eyes ${envName} alerts` });
    alerts.addSubscription(new subs.EmailSubscription(alertEmail));
    const notify = new cwActions.SnsAction(alerts);
    const minutes = (n: number) => cdk.Duration.minutes(n);
    const alarm = (id: string, description: string, metric: cloudwatch.IMetric, threshold: number,
      opts: { below?: boolean; periods?: number; missing?: cloudwatch.TreatMissingData } = {}) => {
      const a = new cloudwatch.Alarm(this, id, {
        alarmName: `qe-${envName}-${id}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: opts.periods ?? 1,
        comparisonOperator: opts.below
          ? cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD
          : cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: opts.missing ?? cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(notify);
      a.addOkAction(notify);
    };
    // Descriptions are what the alarm email shows (max 1024 chars): meaning, likely causes, first step.
    alarm('ApiNoHealthyTask', [
      'The API is down: no API container has passed the /healthz check for 3 minutes.',
      'The site still loads (the frontend is served from CloudFront/S3), but every API call fails.',
      'Likely causes: the container crashes at startup, runs out of memory, or cannot start after a config or secret change. A bad deploy rolls itself back, so it is rarely the cause.',
      `First step: ECS console > ${cluster.clusterName} > Api service > Events, then the Api log group.`,
    ].join('\n'),
      apiTargets.metrics.healthyHostCount({ period: minutes(1), statistic: 'Minimum' }), 1,
      { below: true, periods: 3, missing: cloudwatch.TreatMissingData.BREACHING });
    alarm('Api5xx', [
      'The API is up but failing: it returned more than 20 server errors (5xx) in 5 minutes.',
      'Requests reach the app, but a code path or dependency is failing: a database error, an unhandled exception, or a third-party API that errors out.',
      'First step: search the Api log group for errors around the alarm time.',
    ].join('\n'),
      apiTargets.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: minutes(5), statistic: 'Sum' }), 20);
    alarm('Alb5xx', [
      'The load balancer cannot get an answer from the app: more than 10 of its own 5xx in 5 minutes.',
      '502 = a container dropped the connection or crashed mid-request; 503 = no healthy container; 504 = over the 15-minute timeout. Usually fires with ApiNoHealthyTask or after an out-of-memory crash.',
      "Note: CloudFront's own 120-second timeouts happen before the load balancer and are not counted here.",
      'First step: ECS Api service events and the stopped-task reasons.',
    ].join('\n'),
      alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: minutes(5), statistic: 'Sum' }), 10);
    alarm('DbCpu', [
      'The database is overworked: CPU above 80% for 15 minutes.',
      'Usually a heavy or unindexed query, or too many jobs at once. On burstable (t4g) instances sustained load also burns CPU credits, after which the database slows sharply.',
      'First step: find the running queries (pg_stat_activity), then fix the query or move to a bigger instance.',
    ].join('\n'),
      db.metricCPUUtilization({ period: minutes(5) }), 80, { periods: 3 });
    alarm('DbStorage', [
      'The database disk is filling up: less than 2 GiB free.',
      'When it fills, the database stops accepting writes. automation_logs is the usual source of growth.',
      'First step: trim old automation_logs rows, or raise allocatedStorage in the stack (storage autoscaling is off).',
    ].join('\n'),
      db.metricFreeStorageSpace({ period: minutes(5), statistic: 'Minimum' }), 2 * 1024 ** 3, { below: true });
    // max_connections ≈ RAM/9.5MB: ~110 on db.t4g.micro, ~220 on small.
    const maxConnections = isProd ? 180 : 80;
    alarm('DbConnections', [
      `Close to the database connection limit: more than ${maxConnections} open connections (the instance allows about ${isProd ? 220 : 110}).`,
      'Each API or worker container holds up to 8 (Prisma pool), so the cause is too many tasks, a connection leak, or one-off tasks (e.g. a DB restore) running at the same time. At the limit, requests fail with "too many clients".',
      'First step: count running ECS tasks and look for idle or stuck connections in pg_stat_activity.',
    ].join('\n'),
      db.metricDatabaseConnections({ period: minutes(5), statistic: 'Maximum' }), maxConnections);
    const workerErrors = new logs.MetricFilter(this, 'WorkerErrorLines', {
      logGroup: logGroups.Worker,
      filterPattern: logs.FilterPattern.literal('"\\"level\\":\\"error\\""'),
      metricNamespace: 'QuietEyes',
      metricName: `${envName}-worker-errors`,
      metricValue: '1',
    });
    alarm('WorkerErrors', [
      'Background jobs are failing in bulk: the worker logged more than 20 error lines in an hour.',
      'Typical causes: an AI provider out of credits (e.g. OpenRouter 402), a database error in a job, or an external API that is down.',
      'Note: only the app\'s structured error lines ("level":"error") are counted; plain console.error and raw prisma:error lines are not.',
      'First step: search the Worker log group for "level":"error" around the alarm time.',
    ].join('\n'),
      workerErrors.metric({ period: minutes(60), statistic: 'Sum' }), 20);

    // Every 401/403 is a warn line in the API's access log (middleware/requestLog.ts).
    const authFailures = new logs.MetricFilter(this, 'ApiAuthFailureLines', {
      logGroup: logGroups.Api,
      filterPattern: logs.FilterPattern.any(
        logs.FilterPattern.numberValue('$.data.status', '=', 401),
        logs.FilterPattern.numberValue('$.data.status', '=', 403),
      ),
      metricNamespace: 'QuietEyes',
      metricName: `${envName}-api-auth-failures`,
      metricValue: '1',
    });
    alarm('ApiAuthFailures', [
      'Many refused requests: the API answered more than 100 requests with 401 or 403 in 5 minutes.',
      'A few are normal (expired sessions, a tab left open after sign-out). A burst usually means someone is guessing the admin key or cron secret, probing other tenants\' data, or a client is stuck retrying with a bad token.',
      'First step: search the Api log group for "status":401 or 403 around the alarm time and group by ip and path.',
    ].join('\n'),
      authFailures.metric({ period: minutes(5), statistic: 'Sum' }), 100);

    // Account-wide cost alert (one is enough, so only the prod stack sets it).
    if (props.monthlyBudgetUsd) {
      const subscribers = [{ subscriptionType: 'EMAIL', address: alertEmail }];
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'quiet-eyes-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' }, subscribers },
          { notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' }, subscribers },
        ],
      });
    }

    const output = (key: string, value: string) => new cdk.CfnOutput(this, key, { value });
    output('Url', siteUrl);
    output('DistributionId', distribution.distributionId);
    output('ClusterName', cluster.clusterName);
    output('ApiService', api.serviceName);
    output('WorkerService', worker.serviceName);
    output('PublicSubnets', cdk.Fn.join(',', vpc.publicSubnets.map((s) => s.subnetId)));
  }
}

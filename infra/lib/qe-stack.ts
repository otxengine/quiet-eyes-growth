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
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface QeStackProps extends cdk.StackProps {
  envName: 'staging' | 'prod';
  /** Checkout to build from: <srcDir>/server is the API image, <srcDir>/dist the built frontend. */
  srcDir: string;
  /** Worker tasks (background jobs). Staging starts at 0 until copied data is confirmed safe. */
  workerCount: number;
}

export class QeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: QeStackProps) {
    super(scope, id, props);
    const { envName, srcDir, workerCount } = props;
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
    const dbEnv: Record<string, ecs.Secret> = {
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
      DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
      DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
    };

    // ── App secrets: names in secrets.<env>.txt, values only in SSM (scripts/put-secrets.sh).
    const ssmSecret = (name: string) => ecs.Secret.fromSsmParameter(
      ssm.StringParameter.fromSecureStringParameterAttributes(this, `Param${name}`, { parameterName: `/qe/${envName}/${name}` }));
    const secretNames = fs.readFileSync(path.join(__dirname, `../secrets.${envName}.txt`), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const appSecrets: Record<string, ecs.Secret> = { ...dbEnv };
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
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: `quiet-eyes ${envName}`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // North America, Europe, Israel
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY, // stays inside the AWS network
            // ponytail: 120s is the default quota ceiling. The 8 long scan endpoints need async jobs before prod.
            readTimeout: cdk.Duration.seconds(120),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;

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
        },
        secrets: appSecrets,
        portMappings: [{ containerPort: 3000 }],
        stopTimeout: cdk.Duration.seconds(60),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: name.toLowerCase(),
          logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: removal }),
        }),
      });
      return td;
    };

    const api = new ecs.FargateService(this, 'Api', {
      cluster,
      taskDefinition: taskDef('Api', 'web', isProd ? 512 : 256),
      desiredCount: isProd ? 2 : 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.minutes(3), // boot runs the startup DDL
    });
    listener.addTargets('Api', {
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

    // ── One-off data copy from Supabase (scripts/restore-db.sh runs it)
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
      secrets: { ...dbEnv, SOURCE_DATABASE_URL: ssmSecret('SOURCE_DATABASE_URL') },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'restore', logGroup: restoreLogs }),
    });

    const output = (key: string, value: string) => new cdk.CfnOutput(this, key, { value });
    output('Url', siteUrl);
    output('DistributionId', distribution.distributionId);
    output('ClusterName', cluster.clusterName);
    output('ApiService', api.serviceName);
    output('WorkerService', worker.serviceName);
    output('RestoreTaskDef', restoreTask.taskDefinitionArn);
    output('RestoreSg', restoreSg.securityGroupId);
    output('RestoreLogGroup', restoreLogs.logGroupName);
    output('PublicSubnets', cdk.Fn.join(',', vpc.publicSubnets.map((s) => s.subnetId)));
  }
}

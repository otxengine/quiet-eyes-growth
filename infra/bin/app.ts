import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { QeStack } from '../lib/qe-stack';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { DnsStack } from '../lib/dns-stack';

const app = new cdk.App();
const region = 'eu-central-1';

// scripts/deploy.sh points SRC_DIR at a clean checkout of the ref being deployed.
const srcDir = process.env.SRC_DIR ?? path.join(__dirname, '../..');

// CloudFront only takes us-east-1 certificates. DNS lives at GoDaddy, so validation is a CNAME
// added there by hand; once ACM shows ISSUED, its ARN goes into cdk.json as "stagingCertArn".
const STAGING_DOMAIN = 'staging.cortexi.ai';
const certStack = new cdk.Stack(app, 'Qe-staging-cert', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  // CLI credentials + inline template; with no assets, us-east-1 needs no CDK bootstrap.
  synthesizer: new cdk.LegacyStackSynthesizer(),
});
const cert = new acm.Certificate(certStack, 'Cert', {
  domainName: STAGING_DOMAIN,
  validation: acm.CertificateValidation.fromDns(),
});
new cdk.CfnOutput(certStack, 'CertArn', { value: cert.certificateArn });

const stagingCertArn = app.node.tryGetContext('stagingCertArn');
new QeStack(app, 'Qe-staging', {
  envName: 'staging',
  srcDir,
  workerCount: Number(app.node.tryGetContext('workerCount') ?? 0),
  domain: stagingCertArn ? { name: STAGING_DOMAIN, certificateArn: stagingCertArn } : undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});

// cortexi.ai DNS zone, deployed by hand (`npx cdk deploy Qe-dns`), not by the staging pipeline.
new DnsStack(app, 'Qe-dns', { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region } });

// One-time: lets .github/workflows/deploy-staging.yml deploy without stored AWS keys.
new GithubOidcStack(app, 'Qe-github', {
  repo: 'otxengine/quiet-eyes-growth',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { QeStack } from '../lib/qe-stack';
import { EdgeStack } from '../lib/edge-stack';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { DnsStack } from '../lib/dns-stack';
import { AccountStack } from '../lib/account-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
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
  webAclArn: app.node.tryGetContext('stagingWebAclArn'), // Qe-edge output, like prodWebAclArn
  restoreTask: true,
  appDbRole: app.node.tryGetContext('stagingAppDbRole') === true,
  env: { account, region },
});

// The WAFs must live in us-east-1 too. Same pattern as the staging cert: deploy Qe-edge with admin
// credentials, then put its WebAclArn and StagingWebAclArn outputs into cdk.json as "prodWebAclArn"
// and "stagingWebAclArn".
new EdgeStack(app, 'Qe-edge', {
  env: { account, region: 'us-east-1' },
  synthesizer: new cdk.LegacyStackSynthesizer(), // no assets, so us-east-1 needs no CDK bootstrap
});

// `prodLive` in cdk.json stays false until cutover night: before that, a prod worker would
// run every background job a second time alongside Render. It's committed rather than a
// CLI flag so that CI deploys can't silently flip it back.
const prodLive = app.node.tryGetContext('prodLive') === true;
new QeStack(app, 'Qe-prod', {
  envName: 'prod',
  srcDir,
  apiCount: 1, // like Render today; 2 once page-picker state and job locks are fixed
  workerCount: prodLive ? 1 : 0,
  restoreTask: !prodLive, // the cutover-night data load is its last use
  appDbRole: app.node.tryGetContext('prodAppDbRole') === true,
  mediaBucket: { name: 'socialmediacomp2023', region: 'us-east-1' },
  webAclArn: app.node.tryGetContext('prodWebAclArn'),
  monthlyBudgetUsd: 250,
  env: { account, region },
});

// CloudTrail + GuardDuty for the whole account, deployed by hand (`npx cdk deploy Qe-account`).
new AccountStack(app, 'Qe-account', { env: { account, region } });

// cortexi.ai DNS zone, deployed by hand (`npx cdk deploy Qe-dns`), not by the pipelines.
new DnsStack(app, 'Qe-dns', { env: { account, region } });

// One-time: lets .github/workflows deploy without stored AWS keys.
new GithubOidcStack(app, 'Qe-github', {
  repo: 'otxengine/quiet-eyes-growth',
  env: { account, region },
});

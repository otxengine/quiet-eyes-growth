import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { QeStack } from '../lib/qe-stack';
import { GithubOidcStack } from '../lib/github-oidc-stack';

const app = new cdk.App();
const region = 'eu-central-1';

// scripts/deploy.sh points SRC_DIR at a clean checkout of the ref being deployed.
const srcDir = process.env.SRC_DIR ?? path.join(__dirname, '../..');

new QeStack(app, 'Qe-staging', {
  envName: 'staging',
  srcDir,
  workerCount: Number(app.node.tryGetContext('workerCount') ?? 0),
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});

// One-time: lets .github/workflows/deploy-staging.yml deploy without stored AWS keys.
new GithubOidcStack(app, 'Qe-github', {
  repo: 'otxengine/quiet-eyes-growth',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});

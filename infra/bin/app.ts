import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { QeStack } from '../lib/qe-stack';

const app = new cdk.App();

// scripts/deploy.sh points SRC_DIR at a clean checkout of the ref being deployed.
const srcDir = process.env.SRC_DIR ?? path.join(__dirname, '../..');

new QeStack(app, 'Qe-staging', {
  envName: 'staging',
  srcDir,
  workerCount: Number(app.node.tryGetContext('workerCount') ?? 0),
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' },
});

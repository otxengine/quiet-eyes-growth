import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

/**
 * Account-wide audit trail and threat detection; the account had neither on 2026-10-24.
 * Deployed once by hand (`npx cdk deploy Qe-account`), not by the pipelines.
 */
export class AccountStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const alertEmail = process.env.ALERT_EMAIL;
    if (!alertEmail) throw new Error('Set ALERT_EMAIL (findings recipient)');

    // Management events (API calls, console sign-ins) from every region, with log file validation,
    // into an encrypted, private bucket the trail creates. ponytail: no expiry; add a lifecycle rule if it grows.
    new cloudtrail.Trail(this, 'Trail');

    // GuardDuty for the region the workloads run in. Findings of medium severity and up are emailed.
    // ponytail: eu-central-1 only; enable it in us-east-1 too if the edge stacks there need watching.
    new guardduty.CfnDetector(this, 'GuardDuty', { enable: true, findingPublishingFrequency: 'FIFTEEN_MINUTES' });
    const findings = new sns.Topic(this, 'Findings', { displayName: 'quiet-eyes security findings' });
    findings.addSubscription(new subs.EmailSubscription(alertEmail));
    new events.Rule(this, 'FindingsToEmail', {
      eventPattern: { source: ['aws.guardduty'], detailType: ['GuardDuty Finding'], detail: { severity: [{ numeric: ['>=', 4] }] } },
      targets: [new targets.SnsTopic(findings)],
    });
  }
}

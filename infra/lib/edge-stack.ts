import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

/**
 * The WAF web ACLs for the prod and staging CloudFront distributions. CloudFront-scope WAF only
 * exists in us-east-1, so this is its own stack; the WebAclArn outputs go into cdk.json as
 * "prodWebAclArn" and "stagingWebAclArn".
 */
export class EdgeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const visibility = (metricName: string) => ({ cloudWatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName });
    const managed = (name: string, priority: number,
      tuning: Partial<wafv2.CfnWebACL.ManagedRuleGroupStatementProperty> = {}): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name, ...tuning } },
      overrideAction: { none: {} }, // the group's own actions apply, i.e. block
      visibilityConfig: visibility(name),
    });
    // Webhook bodies carry free text (customer messages, review text), the likeliest false
    // positives for the common rule set, and the app checks their signatures, so it skips them.
    const notWebhook: wafv2.CfnWebACL.StatementProperty = {
      notStatement: {
        statement: {
          orStatement: {
            statements: ['/api/webhooks/', '/api/billing/webhooks'].map((searchString) => ({
              byteMatchStatement: {
                fieldToMatch: { uriPath: {} },
                positionalConstraint: 'STARTS_WITH',
                searchString,
                textTransformations: [{ priority: 0, type: 'NONE' }],
              },
            })),
          },
        },
      },
    };

    // Blocking since 2026-10-24. Prod's count-only period saw about 50 requests (no real traffic
    // before cutover), so the exclusions come from what the app is known to send: media uploads
    // are base64 JSON bodies up to 35 MB, which SizeRestrictions_BODY (over 8 KB) would block, so
    // that one rule only counts. Check the BlockedRequests metric and sampled requests after cutover.
    const webAcl = (constructId: string, name: string) => new wafv2.CfnWebACL(this, constructId, {
      name,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility(name),
      rules: [
        {
          // Blocks one IP after 2,000 requests in 5 minutes; normal use is a few hundred.
          name: 'RateLimitPerIp',
          priority: 0,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },
          visibilityConfig: visibility('RateLimitPerIp'),
        },
        managed('AWSManagedRulesAmazonIpReputationList', 1),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 2),
        managed('AWSManagedRulesCommonRuleSet', 3, {
          scopeDownStatement: notWebhook,
          ruleActionOverrides: [{ name: 'SizeRestrictions_BODY', actionToUse: { count: {} } }],
        }),
      ],
    });

    new cdk.CfnOutput(this, 'WebAclArn', { value: webAcl('ProdWebAcl', 'quiet-eyes-prod').attrArn });
    // Staging holds a copy of prod's customer data, so it gets the same protection.
    new cdk.CfnOutput(this, 'StagingWebAclArn', { value: webAcl('StagingWebAcl', 'quiet-eyes-staging').attrArn });
  }
}

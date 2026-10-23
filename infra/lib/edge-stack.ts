import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

/**
 * The prod WAF web ACL. CloudFront-scope WAF only exists in us-east-1, so this is its own stack;
 * its WebAclArn output goes into cdk.json as "prodWebAclArn" for Qe-prod.
 */
export class EdgeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const visibility = (metricName: string) => ({ cloudWatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName });
    const managed = (name: string, priority: number): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
      // ponytail: count-only until a week of real traffic shows no false positives
      // (large JSON bodies can trip CommonRuleSet). Then switch to { none: {} } to block.
      overrideAction: { count: {} },
      visibilityConfig: visibility(name),
    });

    const acl = new wafv2.CfnWebACL(this, 'ProdWebAcl', {
      name: 'quiet-eyes-prod',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('quiet-eyes-prod'),
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
        managed('AWSManagedRulesCommonRuleSet', 3),
      ],
    });
    new cdk.CfnOutput(this, 'WebAclArn', { value: acl.attrArn });
  }
}

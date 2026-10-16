import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends cdk.StackProps {
  /** owner/name of the GitHub repository allowed to deploy */
  repo: string;
}

/**
 * Lets GitHub Actions deploy without stored AWS keys: a workflow job exchanges its
 * GitHub-issued OIDC token for a short-lived session on this role.
 */
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const github = new iam.OidcProviderNative(this, 'GitHubActions', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployStaging = new iam.Role(this, 'DeployStaging', {
      roleName: 'qe-github-deploy-staging',
      description: 'GitHub Actions deploys to Qe-staging',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // Only jobs that run in this repo's "staging" environment, which GitHub limits to the deploy branches.
          'token.actions.githubusercontent.com:sub': `repo:${props.repo}:environment:staging`,
        },
      }),
    });
    // Deploys go through the CDK bootstrap roles, like the qe-claude operator role.
    deployStaging.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
    }));
    // The smoke test reads the staging URL from the stack outputs.
    deployStaging.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStacks'],
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/Qe-staging/*`],
    }));

    new cdk.CfnOutput(this, 'DeployStagingRoleArn', { value: deployStaging.roleArn });
  }
}

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends cdk.StackProps {
  /** owner/name of the GitHub repository allowed to deploy */
  repo: string;
}

/**
 * Lets GitHub Actions deploy without stored AWS keys: a workflow job exchanges its
 * GitHub-issued OIDC token for a short-lived session on a deploy role.
 */
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const github = new iam.OidcProviderNative(this, 'GitHubActions', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // One role per GitHub environment. A job can assume it only while running in that
    // environment, which GitHub limits to the allowed branches (and, for production, to a
    // run a reviewer approved). Same account and same CDK bootstrap roles for both, so the
    // separation lives only in GitHub; a separate prod account would move it into AWS.
    const deployRole = (constructId: string, environment: string, stack: string) => {
      const role = new iam.Role(this, constructId, {
        roleName: `qe-github-deploy-${environment}`,
        description: `GitHub Actions deploys to ${stack}`,
        maxSessionDuration: cdk.Duration.hours(1),
        assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${props.repo}:environment:${environment}`,
          },
        }),
      });
      // Deploys go through the CDK bootstrap roles (eu-central-1 and us-east-1), like qe-claude.
      role.addToPolicy(new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }));
      // The smoke test reads the site URL from the stack outputs.
      role.addToPolicy(new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/${stack}/*`],
      }));
      new cdk.CfnOutput(this, `${constructId}RoleArn`, { value: role.roleArn });
    };

    deployRole('DeployStaging', 'staging', 'Qe-staging');
    deployRole('DeployProduction', 'production', 'Qe-prod');
  }
}

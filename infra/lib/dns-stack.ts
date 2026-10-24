import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';

/**
 * cortexi.ai DNS on Route 53 (GoDaddy stays the registrar). Records are copied exactly
 * from the GoDaddy zone as of 2026-10-23, so pointing the domain's nameservers here
 * changes no answers. Not deleted with the stack: the zone outlives any one deploy.
 *
 * Skipped on purpose: NS/SOA (Route 53 makes its own) and _domainconnect (GoDaddy-only).
 * Edit records here, not in GoDaddy, once the nameservers point at this zone.
 */
export class DnsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const zone = new route53.PublicHostedZone(this, 'Zone', { zoneName: 'cortexi.ai' });
    zone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    const ttl = (s: number) => cdk.Duration.seconds(s);

    // Site, still on Render until the app cutover switches it to the CloudFront alias.
    new route53.ARecord(this, 'Apex', { zone, target: route53.RecordTarget.fromIpAddresses('216.24.57.1'), ttl: ttl(600) });
    new route53.CnameRecord(this, 'Www', { zone, recordName: 'www', domainName: 'quiet-eyes-frontend.onrender.com', ttl: ttl(3600) });

    // Google Workspace mail + site verification, and the DMARC policy.
    new route53.MxRecord(this, 'Mx', { zone, values: [{ priority: 1, hostName: 'smtp.google.com' }], ttl: ttl(3600) });
    new route53.TxtRecord(this, 'ApexTxt', {
      zone, values: ['google-site-verification=NhykZNj_mEAXyrOL7YWv508CNraxd3w6qfUENk-e8XI'], ttl: ttl(3600),
    });
    new route53.TxtRecord(this, 'Dmarc', {
      zone, recordName: '_dmarc',
      values: ['v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;'], ttl: ttl(3600),
    });

    // Clerk production instance (frontend API, account portal, email + DKIM).
    const clerk: Array<[string, string, string]> = [
      ['ClerkFrontend', 'clerk', 'frontend-api.clerk.services'],
      ['ClerkAccounts', 'accounts', 'accounts.clerk.services'],
      ['ClerkMail', 'clkmail', 'mail.4wivjufxjfsm.clerk.services'],
      ['ClerkDkim1', 'clk._domainkey', 'dkim1.4wivjufxjfsm.clerk.services'],
      ['ClerkDkim2', 'clk2._domainkey', 'dkim2.4wivjufxjfsm.clerk.services'],
    ];
    for (const [id, recordName, domainName] of clerk) {
      new route53.CnameRecord(this, id, { zone, recordName, domainName, ttl: ttl(3600) });
    }

    new cdk.CfnOutput(this, 'NameServers', { value: cdk.Fn.join(' ', zone.hostedZoneNameServers!) });
    new cdk.CfnOutput(this, 'HostedZoneId', { value: zone.hostedZoneId });
  }
}

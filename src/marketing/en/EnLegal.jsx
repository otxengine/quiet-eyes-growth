import React from 'react';
import { Container } from '../ui/primitives.jsx';

/* Terms and Privacy of the English product (the competitor report, sold outside Israel).
   Same shell and styles as pages/Legal.jsx. The Hebrew app has its own pages at /terms and /privacy. */

function LegalShell({ title, updated, children }) {
  return (
    <Container className="max-w-3xl py-16 mkt-legal">
      <h1>{title}</h1>
      <p className="text-[12px] mb-8" style={{ color: 'var(--mkt-muted)' }}>Last updated: {updated}</p>
      {children}
    </Container>
  );
}

const CONTACT = <a href="mailto:contact@cortexi.ai">contact@cortexi.ai</a>;

export function EnTerms() {
  return (
    <LegalShell title="Terms of Service" updated="November 2026">
      <section><h2>1. Agreement</h2><p>By creating an account or using the Cortexi competitor report (the "Service"), you agree to these terms. If you do not agree, do not use the Service.</p></section>
      <section><h2>2. The Service</h2><p>Cortexi sends you a recurring report about the competitors you choose: what they posted on Instagram and Facebook, the ads they ran, the offers they made and what their customers wrote in public reviews. The report is delivered by email and is available in your account as a web page and a PDF. How often you receive it and how many competitors it covers depend on your plan.</p></section>
      <section><h2>3. Your account</h2><ul>
        <li>You must give accurate information about yourself and your business.</li>
        <li>You are responsible for keeping your sign-in details confidential and for activity in your account.</li>
        <li>Tell us right away at {CONTACT} if you suspect unauthorized access.</li>
      </ul></section>
      <section><h2>4. Acceptable use</h2><p>Use the Service only for lawful business purposes. You may not:</p><ul>
        <li>use it to harass anyone, invade privacy or break the law;</li>
        <li>copy the Service or collect data from it by automated means;</li>
        <li>attempt to disrupt or gain unauthorized access to our systems;</li>
        <li>resell or share access with third parties.</li>
      </ul></section>
      <section><h2>5. The information in the report</h2><p>Reports are built from publicly available sources and are summarized with the help of AI. Sources can be incomplete, late or wrong, and summaries can contain mistakes. The report is general information, not business, legal or financial advice, and you are responsible for decisions you make based on it. Competitor names, posts, ads and reviews belong to their owners; we show them to you for your own internal use.</p></section>
      <section><h2>6. Plans, payment and cancellation</h2><ul>
        <li>The Free plan costs nothing. Paid plans are billed monthly in advance, in US dollars.</li>
        <li>Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders and handles billing, invoices, taxes and refunds.</li>
        <li>You can change or cancel your plan at any time from your account. A cancellation takes effect at the end of the current billing period, after which the account moves to the Free plan.</li>
        <li>You can request a full refund within 14 calendar days of any charge, the first payment or any renewal. Write to {CONTACT} from your account's email address, or contact Paddle through the link in your receipt. A refund cancels the subscription.</li>
      </ul></section>
      <section><h2>7. Emails from us</h2><ul>
        <li>We email your reports to the addresses you list, and send messages about your account and billing.</li>
        <li>The Free plan is offered in exchange for your agreement to receive marketing emails from Cortexi, such as product news and offers. We ask for this agreement when you choose the Free plan.</li>
        <li>Every report and marketing email has an unsubscribe link, and you can also write to {CONTACT}. Unsubscribing from marketing emails does not close your account.</li>
      </ul></section>
      <section><h2>8. Intellectual property</h2><p>The Service, including its software, design and methods, belongs to Cortexi. You receive a limited, personal, non-transferable license to use it while your account is active.</p></section>
      <section><h2>9. Disclaimer and limitation of liability</h2><p>The Service is provided "as is" and "as available", without warranties of any kind. To the extent the law allows, Cortexi is not liable for indirect, incidental or consequential damages arising from use of the Service, and our total liability is limited to the amount you paid us in the three months before the claim.</p></section>
      <section><h2>10. Availability</h2><p>The Service is offered to businesses outside Israel. We may change, suspend or end any part of it, and we may suspend an account that breaks these terms.</p></section>
      <section><h2>11. Changes to these terms</h2><p>We may update these terms. We will announce material changes at least 30 days in advance by email or in your account. Continuing to use the Service after a change takes effect means you accept it.</p></section>
      <section><h2>12. Governing law</h2><p>These terms are governed by the laws of the State of Israel, and the courts of Tel Aviv have exclusive jurisdiction, except where the law of your country gives you rights that cannot be waived.</p></section>
      <section><h2>13. Contact</h2><p>Questions: {CONTACT}</p></section>
    </LegalShell>
  );
}

export function EnPrivacy() {
  return (
    <LegalShell title="Privacy Policy" updated="November 2026">
      <p className="text-[14px]">This policy explains what information Cortexi ("we") collects when you use the competitor report, how we use it and the choices you have.</p>
      <section><h2>1. Information we collect</h2>
        <h3>Information you give us</h3>
        <ul>
          <li><strong>Account:</strong> your name and email address, and your sign-in details, which are handled by our authentication provider.</li>
          <li><strong>Your business:</strong> its name, type, location and public Google listing, and the links to your own Instagram and Facebook pages if you add them.</li>
          <li><strong>Report settings:</strong> the competitors you choose, the email addresses that receive the report and your time zone.</li>
          <li><strong>Payment:</strong> payments are processed by Paddle.com. We receive your plan, billing status and country, but never your full card details.</li>
        </ul>
        <h3>Information collected automatically</h3>
        <p>Technical data such as IP address, approximate country, browser type, and the pages and actions you use, kept in logs to run and secure the Service.</p>
        <h3>Public information about businesses</h3>
        <p>To build your report we collect publicly available information about the competitors you choose and about your own business: public posts and profile details on Instagram and Facebook, public ads, websites, and public Google listings and reviews. Public reviews can include the name their author chose to publish.</p>
      </section>
      <section><h2>2. How we use information</h2><ul>
        <li>To create your account, build your reports and email them to you.</li>
        <li>To process payments, answer your requests and send messages about your account.</li>
        <li>To send marketing emails where you agreed to receive them (see section 4).</li>
        <li>To keep the Service secure, prevent abuse and fix problems.</li>
        <li>To improve the Service, using public business information and usage statistics. We do not use your account or payment details for this.</li>
      </ul></section>
      <section><h2>3. AI processing</h2><p>Report summaries are written with AI models operated by third-party providers. The public posts, ads and reviews in a report are sent to those providers only to produce your report.</p></section>
      <section><h2>4. Marketing emails</h2><p>If you choose the Free plan, we ask you to agree to receive marketing emails from Cortexi, such as product news and offers, and we record when you agreed. You can withdraw at any time with the unsubscribe link in any marketing email or by writing to {CONTACT}. Report emails have their own unsubscribe link.</p></section>
      <section><h2>5. Who we share information with</h2>
        <p>We do not sell your personal information. We share it only with:</p>
        <ul>
          <li><strong>Service providers</strong> that work for us: cloud hosting, authentication, payment processing (Paddle.com), email delivery, AI model providers and providers that collect public web data. They may use the information only to provide their service to us.</li>
          <li><strong>Authorities</strong>, when the law, a court order or a competent authority requires it.</li>
          <li><strong>A successor</strong>, if the business is merged or sold, under this policy.</li>
        </ul>
      </section>
      <section><h2>6. Where information is stored</h2><p>Our servers are in the European Union, and some of our providers operate in the United States and other countries. By using the Service you understand that your information is processed in those places.</p></section>
      <section><h2>7. Cookies</h2><p>We use cookies that are needed to sign you in and keep the site working, and to measure how the site is used. You can block cookies in your browser, but signing in will not work without them.</p></section>
      <section><h2>8. Security</h2><p>We use reasonable technical measures to protect information, including encryption in transit and access controls. No online service can guarantee absolute security.</p></section>
      <section><h2>9. How long we keep information</h2><p>We keep your account information while your account is open. When you ask us to delete your account we delete your personal information within a reasonable time, except what the law requires us to keep, such as billing records. Public business information and anonymous statistics may be kept longer.</p></section>
      <section><h2>10. Your rights</h2><p>You can ask to see, correct or delete your personal information, and to stop marketing emails, by writing to {CONTACT} from your account's email address. Depending on where you live, you may have further rights under local law, such as the right to object to certain processing or to complain to a data protection authority. We do not sell personal information and do not discriminate against anyone for using these rights.</p></section>
      <section><h2>11. Children</h2><p>The Service is for businesses and is not directed at anyone under 18.</p></section>
      <section><h2>12. Changes to this policy</h2><p>We may update this policy and will post the new version here with its date. We will tell you about material changes by email or in your account.</p></section>
      <section><h2>13. Contact</h2><p>Questions or requests about this policy: {CONTACT}</p></section>
    </LegalShell>
  );
}

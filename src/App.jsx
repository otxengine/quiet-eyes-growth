import React, { Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from 'sonner'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { SignIn, SignUp } from '@clerk/clerk-react';
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

// Public (marketing) routes — shared by all three trees below
import { publicRoutes, isPublicPath, marketingNotFound } from '@/marketing/PublicRoutes.jsx';
import { rememberBriefingSignup, freeToken, forgetFreeToken } from '@/briefing/keys.js';

// App layout
import AppLayout from '@/components/layout/AppLayout';
import DevUserSwitcher from '@/components/DevUserSwitcher';
import { OrganizationProvider } from '@/contexts/OrganizationContext';

// App pages — ALL lazy, so public visitors (and the prerendered "/" home) never
// download the app bundle, and each app screen loads its own chunk on demand.
const lazyPage = (loader) => React.lazy(loader);
const Onboarding = lazyPage(() => import('@/pages/Onboarding'));
// The English report-only product (sold outside Israel): its own sign-up flow and account area.
const BriefingStart = lazyPage(() => import('@/briefing/Start.jsx'));
const BriefingAccount = lazyPage(() => import('@/briefing/Account.jsx'));
const BriefingFree = lazyPage(() => import('@/briefing/Free.jsx'));
// /en/start opened from the Free plan's emailed link (?t=…) is the account-less setup; otherwise the
// account flow. A signed-out visitor without a link is sent to sign up.
const BriefingStartRoute = ({ signedIn }) => {
  if (freeToken()) return <BriefingStart free />;
  return signedIn ? <BriefingStart /> : <Navigate to="/sign-up?briefing=1" replace />;
};

// A visitor from the English landing page (/sign-up?briefing=1) signs up into /en/start; everyone
// else into the Hebrew onboarding. The flag is kept in sessionStorage across Clerk's sign-up steps.
const SignUpPage = () => {
  const briefing = rememberBriefingSignup();
  // Kept for the life of the page: UpgradeSignUp forgets the stored token once it has used it.
  const [upgradeToken] = React.useState(() => (briefing ? freeToken() : null));
  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/50">
      {upgradeToken ? <UpgradeSignUp token={upgradeToken} />
        : briefing ? <SignUp routing="path" path="/sign-up" forceRedirectUrl="/en/start" />
          : <SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/onboarding" />}
    </div>
  );
};
// Upgrade from the account-less Free plan (/sign-up?briefing=1&t=…, the link in its report emails).
// The token is used once, to read the address the reports go to, so the form starts with it: the
// business moves to the account that verifies that address (server/src/routes/briefing.ts). After
// that the token is dropped, so the new account is not mistaken for a free-link visitor.
function UpgradeSignUp({ token }) {
  const [email, setEmail] = React.useState(null); // null while loading
  React.useEffect(() => {
    let live = true;
    (async () => {
      let found = '';
      const { briefingApi, setFreeLink } = await import('@/briefing/api');
      try {
        setFreeLink(token);
        const { business } = await briefingApi.me();
        if (business) found = (await briefingApi.settings(business.businessProfileId)).recipients?.[0] || '';
      } catch { /* an expired link: the form simply starts empty */ }
      setFreeLink(null);
      forgetFreeToken();
      if (live) setEmail(found);
    })();
    return () => { live = false; };
  }, [token]);
  if (email === null) return <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" role="status" aria-label="Loading" />;
  return <SignUp routing="path" path="/sign-up" forceRedirectUrl="/en/start" initialValues={email ? { emailAddress: email } : undefined} />;
}
// Already signed in: the sign-up link from the landing page goes straight to the flow. An upgrade
// link's token is dropped: this visitor has an account, and the business follows it by email.
const SignedInSignUp = () => {
  if (new URLSearchParams(window.location.search).has('t')) forgetFreeToken();
  return <Navigate to={rememberBriefingSignup() ? '/en/start' : '/'} replace />;
};
// Clerk can still land a report-only sign-up on /onboarding (its provider-level fallback).
const OnboardingOrBriefing = () => (rememberBriefingSignup('') ? <Navigate to="/en/start" replace /> : <Onboarding />);
const Dashboard = lazyPage(() => import('@/pages/Dashboard.jsx'));
const Competitors = lazyPage(() => import('@/pages/Competitors.jsx'));
const Events = lazyPage(() => import('@/pages/Events.jsx'));
const Reputation = lazyPage(() => import('@/pages/Reputation.jsx'));
const ReviewsCompare = lazyPage(() => import('@/pages/ReviewsCompare.jsx'));
const Leads = lazyPage(() => import('@/pages/Leads.jsx'));
const Retention = lazyPage(() => import('@/pages/Retention.jsx'));
const Agents = lazyPage(() => import('@/pages/Agents.jsx'));
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage.jsx'));
const Reports = lazyPage(() => import('@/pages/Reports.jsx'));
const Tasks = lazyPage(() => import('@/pages/Tasks.jsx'));
const Subscription = lazyPage(() => import('@/pages/Subscription.jsx'));
const Integrations = lazyPage(() => import('@/pages/Integrations.jsx'));
const DataSources = lazyPage(() => import('@/pages/DataSources.jsx'));
const SocialConnections = lazyPage(() => import('@/pages/SocialConnections.jsx'));
const LearningCenter = lazyPage(() => import('@/pages/LearningCenter.jsx'));
const Marketing = lazyPage(() => import('@/pages/Marketing.jsx'));
const Posts = lazyPage(() => import('@/pages/Posts.jsx'));
const CampaignCreate = lazyPage(() => import('@/pages/CampaignCreate.jsx'));
const Insights = lazyPage(() => import('@/pages/Insights.jsx'));
const InsightDetail = lazyPage(() => import('@/pages/InsightDetail.jsx'));
const MarketAnalysis = lazyPage(() => import('@/pages/MarketAnalysis.jsx'));
const Strategy = lazyPage(() => import('@/pages/Strategy.jsx'));
const Approvals = lazyPage(() => import('@/pages/Approvals.jsx'));
const EventBusDashboard = lazyPage(() => import('@/pages/EventBusDashboard.jsx'));
const SocialComments = lazyPage(() => import('@/pages/SocialComments.jsx'));
const SocialCompetition = lazyPage(() => import('@/pages/SocialCompetition.jsx'));
const CompetitorsOffers = lazyPage(() => import('@/pages/CompetitorsOffers.jsx'));
const OrganizationSettings = lazyPage(() => import('@/pages/OrganizationSettings.jsx'));
const AgencyDashboard = lazyPage(() => import('@/pages/AgencyDashboard.jsx'));
const JoinPage = lazyPage(() => import('@/pages/JoinPage.jsx'));
const CommandHome = lazyPage(() => import('@/pages/CommandHome.jsx'));
const ChatPage = lazyPage(() => import('@/pages/Chat.jsx'));

const PageSpinner = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-white">
    <div className="w-8 h-8 border-4 border-border/50 border-t-[#111111] rounded-full animate-spin"></div>
  </div>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    // Marketing pages don't depend on auth — render them immediately instead of
    // a spinner, so prerendered static markup isn't wiped while auth resolves.
    if (typeof window !== 'undefined' && isPublicPath(window.location.pathname)) {
      return (
        <Routes>
          {publicRoutes()}
          <Route path="*" element={null} />
        </Routes>
      );
    }
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-border/50 border-t-[#111111] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    // For auth_required on public pages, just show the public site
    if (authError.type === 'auth_required') {
      return (
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {publicRoutes()}
            <Route path="*" element={marketingNotFound()} />
          </Routes>
        </Suspense>
      );
    }
  }

  // Not authenticated — show public pages + sign-in/sign-up
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/sign-in/*" element={
          <div className="min-h-screen flex items-center justify-center bg-secondary/50">
            <SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/" />
          </div>
        } />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        {/* The report-only screens need an account — except the Free plan's email page and its emailed setup link */}
        <Route path="/en/free" element={<BriefingFree />} />
        <Route path="/en/start" element={<BriefingStartRoute />} />
        <Route path="/en/briefing" element={<Navigate to="/sign-in" replace />} />
        {publicRoutes()}
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={marketingNotFound()} />
      </Routes>
      </Suspense>
    );
  }

  // Authenticated — show app
  return (
    <Suspense fallback={<PageSpinner />}>
    <Routes>
      {/* Public pages still accessible when logged in — "/" belongs to Dashboard here */}
      {publicRoutes({ includeRoot: false })}

      {/* Invite join — accessible without app layout */}
      <Route path="/join" element={<JoinPage />} />

      {/* Onboarding flow */}
      <Route path="/onboarding/*" element={<OnboardingOrBriefing />} />

      {/* English report-only product — outside the Hebrew app layout */}
      <Route path="/en/free" element={<BriefingFree />} />
      <Route path="/en/start" element={<BriefingStartRoute signedIn />} />
      <Route path="/en/briefing" element={<BriefingAccount />} />
      <Route path="/sign-up/*" element={<SignedInSignUp />} />

      {/* Main app with layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/command" element={<Navigate to="/" replace />} />
        <Route path="/signals" element={<Navigate to="/insights" replace />} />
        <Route path="/competitors" element={<Competitors />} />
        <Route path="/events" element={<Events />} />
        <Route path="/reviews" element={<Reputation />} />
        <Route path="/reviews/compare" element={<ReviewsCompare />} />
        <Route path="/social-comments" element={<SocialComments />} />
        <Route path="/social-competition" element={<SocialCompetition />} />
        <Route path="/competitors-offers" element={<CompetitorsOffers />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/retention" element={<Retention />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/subscription" element={<Subscription />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/data-sources" element={<DataSources />} />
        <Route path="/social" element={<SocialConnections />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* OTXEngine growth intelligence dashboard */}
        <Route path="/learning" element={<LearningCenter />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/posts" element={<Posts />} />
        <Route path="/marketing/create" element={<CampaignCreate />} />
        <Route path="/signals/:signalId" element={<Navigate to="/insights" replace />} />
        <Route path="/tasks/:taskId" element={<Tasks />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/insights/:id" element={<InsightDetail />} />
        <Route path="/market-analysis" element={<MarketAnalysis />} />
        <Route path="/intelligence" element={<Navigate to="/insights" replace />} />
        <Route path="/strategy" element={<Strategy />} />
        <Route path="/demand-gap" element={<Navigate to="/insights" replace />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/event-bus" element={<EventBusDashboard />} />
        <Route path="/org/settings" element={<OrganizationSettings />} />
        <Route path="/agency" element={<AgencyDashboard />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/command" element={<CommandHome />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>

      <Route path="*" element={marketingNotFound()} />
    </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <OrganizationProvider>
        <Router future={ROUTER_FUTURE}>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster position="top-center" richColors />
        <DevUserSwitcher />
        </OrganizationProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App

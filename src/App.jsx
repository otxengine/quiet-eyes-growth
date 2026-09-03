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

// App layout
import AppLayout from '@/components/layout/AppLayout';
import DevUserSwitcher from '@/components/DevUserSwitcher';
import { OrganizationProvider } from '@/contexts/OrganizationContext';

// App pages — ALL lazy, so public visitors (and the prerendered "/" home) never
// download the app bundle, and each app screen loads its own chunk on demand.
const lazyPage = (loader) => React.lazy(loader);
const Onboarding = lazyPage(() => import('@/pages/Onboarding'));
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
const OTXDashboard = lazyPage(() => import('@/pages/OTXDashboard'));
const LearningCenter = lazyPage(() => import('@/pages/LearningCenter.jsx'));
const Marketing = lazyPage(() => import('@/pages/Marketing.jsx'));
const Audience = lazyPage(() => import('@/pages/Audience.jsx'));
const Posts = lazyPage(() => import('@/pages/Posts.jsx'));
const CampaignCreate = lazyPage(() => import('@/pages/CampaignCreate.jsx'));
const TaskDetail = lazyPage(() => import('@/pages/TaskDetail.jsx'));
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
        <Route path="/sign-up/*" element={
          <div className="min-h-screen flex items-center justify-center bg-secondary/50">
            <SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/onboarding" />
          </div>
        } />
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
      <Route path="/onboarding/*" element={<Onboarding />} />

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
        <Route path="/otx" element={<Suspense fallback={null}><OTXDashboard /></Suspense>} />
        <Route path="/learning" element={<LearningCenter />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/posts" element={<Posts />} />
        <Route path="/marketing/create" element={<CampaignCreate />} />
        <Route path="/signals/:signalId" element={<Navigate to="/insights" replace />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
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

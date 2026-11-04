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

// Public layout & pages
import PublicLayout from '@/components/public/PublicLayout.jsx';
import PublicHome from '@/pages/public/Home.jsx';
import HowItWorks from '@/pages/public/HowItWorks.jsx';
import Features from '@/pages/public/Features.jsx';
import PricingPage from '@/pages/public/Pricing.jsx';
import AboutPage from '@/pages/public/About.jsx';
import ContactPage from '@/pages/public/Contact.jsx';
import TermsPage from '@/pages/public/Terms.jsx';
import PrivacyPage from '@/pages/public/Privacy.jsx';
// Segment landing pages (no layout wrapper — fully self-contained)
import LandingRestaurants from '@/pages/public/LandingRestaurants.jsx';
import LandingFitness from '@/pages/public/LandingFitness.jsx';
import LandingBeauty from '@/pages/public/LandingBeauty.jsx';
import LandingMain from '@/pages/public/LandingMain.jsx';

// App layout
import AppLayout from '@/components/layout/AppLayout';

// App pages
import Onboarding from '@/pages/Onboarding';
import Dashboard from '@/pages/Dashboard.jsx';
import Intelligence from '@/pages/Intelligence.jsx';
import Competitors from '@/pages/Competitors.jsx';
import Events from '@/pages/Events.jsx';
import Reputation from '@/pages/Reputation.jsx';
import Leads from '@/pages/Leads.jsx';
import Retention from '@/pages/Retention.jsx';
import Agents from '@/pages/Agents.jsx';
import SettingsPage from '@/pages/SettingsPage.jsx';
import Reports from '@/pages/Reports.jsx';
import Tasks from '@/pages/Tasks.jsx';
import Subscription from '@/pages/Subscription.jsx';
import Integrations from '@/pages/Integrations.jsx';
import DataSources from '@/pages/DataSources.jsx';
import SocialConnections from '@/pages/SocialConnections.jsx';
import OTXDashboard from '@/pages/OTXDashboard';
import LearningCenter from '@/pages/LearningCenter.jsx';
import Marketing from '@/pages/Marketing.jsx';
import CampaignCreate from '@/pages/CampaignCreate.jsx';
import SignalDetail from '@/pages/SignalDetail.jsx';
import TaskDetail from '@/pages/TaskDetail.jsx';
import Insights from '@/pages/Insights.jsx';
import InsightDetail from '@/pages/InsightDetail.jsx';
import MarketAnalysis from '@/pages/MarketAnalysis.jsx';
import Strategy from '@/pages/Strategy.jsx';
import DemandGap from '@/pages/DemandGap.jsx';
import Approvals from '@/pages/Approvals.jsx';
import EventBusDashboard from '@/pages/EventBusDashboard.jsx';
import SocialComments from '@/pages/SocialComments.jsx';
import AdminDashboard from '@/pages/AdminDashboard.jsx';
import AdminLayout from '@/components/layout/AdminLayout';
import DevUserSwitcher from '@/components/DevUserSwitcher';
import OrganizationSettings from '@/pages/OrganizationSettings.jsx';
import AgencyDashboard from '@/pages/AgencyDashboard.jsx';
import JoinPage from '@/pages/JoinPage.jsx';
import CommandHome from '@/pages/CommandHome.jsx';
import ChatPage from '@/pages/Chat.jsx';
import AccountPage from '@/pages/AccountPage.jsx';
import { OrganizationProvider } from '@/contexts/OrganizationContext';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
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
        <Routes>
          <Route path="/" element={<LandingMain />} />
          <Route element={<PublicLayout />}>
            <Route path="/home" element={<PublicHome />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/features" element={<Features />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Route>
          {/* Segment landing pages — standalone, no layout wrapper */}
          <Route path="/restaurants" element={<LandingRestaurants />} />
          <Route path="/fitness" element={<LandingFitness />} />
          <Route path="/beauty" element={<LandingBeauty />} />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      );
    }
  }

  // Not authenticated — show public pages + sign-in/sign-up
  if (!isAuthenticated) {
    return (
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
        {/* Main landing — standalone dark-mode */}
        <Route path="/" element={<LandingMain />} />
        {/* Segment landing pages — standalone, no layout wrapper */}
        <Route path="/restaurants" element={<LandingRestaurants />} />
        <Route path="/fitness" element={<LandingFitness />} />
        <Route path="/beauty" element={<LandingBeauty />} />
        <Route element={<PublicLayout />}>
          <Route path="/home" element={<PublicHome />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Route>
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Authenticated — show app
  return (
    <Routes>
      {/* Segment landing pages — standalone, no layout wrapper */}
      <Route path="/restaurants" element={<LandingRestaurants />} />
      <Route path="/fitness" element={<LandingFitness />} />
      <Route path="/beauty" element={<LandingBeauty />} />

      {/* Public pages still accessible when logged in */}
      <Route element={<PublicLayout />}>
        <Route path="/home" element={<PublicHome />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Route>

      {/* Invite join — accessible without app layout */}
      <Route path="/join" element={<JoinPage />} />

      {/* Onboarding flow */}
      <Route path="/onboarding/*" element={<Onboarding />} />

      {/* Admin — standalone layout, no businessProfile required */}
      <Route element={<AdminLayout />}>
        <Route path="/admin-dashboard" element={<AdminDashboard />} />
      </Route>

      {/* Main app with layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/command" element={<Navigate to="/" replace />} />
        <Route path="/signals" element={<Navigate to="/insights" replace />} />
        <Route path="/competitors" element={<Competitors />} />
        <Route path="/events" element={<Events />} />
        <Route path="/reviews" element={<Reputation />} />
        <Route path="/social-comments" element={<SocialComments />} />
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
        <Route path="/otx" element={<OTXDashboard />} />
        <Route path="/learning" element={<LearningCenter />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/marketing/create" element={<CampaignCreate />} />
        <Route path="/signals/:signalId" element={<Navigate to="/insights" replace />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/insights/:id" element={<InsightDetail />} />
        <Route path="/market-analysis" element={<MarketAnalysis />} />
        <Route path="/strategy" element={<Strategy />} />
        <Route path="/demand-gap" element={<DemandGap />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/event-bus" element={<EventBusDashboard />} />
        <Route path="/org/settings" element={<OrganizationSettings />} />
        <Route path="/agency" element={<AgencyDashboard />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/command" element={<CommandHome />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

// Renders LandingMain for guests, redirects to /dashboard for authenticated users
function RootRoute() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  // While auth is loading, show landing immediately (no flash)
  return <LandingMain />;
}

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <OrganizationProvider>
        <Router future={ROUTER_FUTURE}>
          <Routes>
            {/* Root: guests see landing, authenticated users → dashboard */}
            <Route path="/" element={<RootRoute />} />
            {/* Segment landing pages — standalone */}
            <Route path="/restaurants" element={<LandingRestaurants />} />
            <Route path="/fitness" element={<LandingFitness />} />
            <Route path="/beauty" element={<LandingBeauty />} />
            <Route path="/join" element={<JoinPage />} />
            {/* Auth pages at top level so Clerk can always mount them */}
            <Route path="/sign-in/*" element={
              <div className="min-h-screen flex items-center justify-center bg-secondary/50">
                <SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/dashboard" />
              </div>
            } />
            <Route path="/sign-up/*" element={
              <div className="min-h-screen flex items-center justify-center bg-secondary/50">
                <SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/onboarding" />
              </div>
            } />
            {/* Everything else goes through auth */}
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
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

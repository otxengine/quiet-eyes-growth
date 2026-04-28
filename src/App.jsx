import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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
import MarketAnalysis from '@/pages/MarketAnalysis.jsx';
import Tasks from '@/pages/Tasks.jsx';
import Subscription from '@/pages/Subscription.jsx';
import Integrations from '@/pages/Integrations.jsx';
import DataSources from '@/pages/DataSources.jsx';
import SocialConnections from '@/pages/SocialConnections.jsx';
import OTXDashboard from '@/pages/OTXDashboard';
import LearningCenter from '@/pages/LearningCenter.jsx';
import Marketing from '@/pages/Marketing.jsx';
import CampaignCreate from '@/pages/CampaignCreate.jsx';
import AdminDashboard from '@/pages/AdminDashboard.jsx';
import DevUserSwitcher from '@/components/DevUserSwitcher';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-[#f0f0f0] border-t-[#111111] rounded-full animate-spin"></div>
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
          <Route element={<PublicLayout />}>
            <Route path="/" element={<PublicHome />} />
            <Route path="/home" element={<PublicHome />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/features" element={<Features />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Route>
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
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/" />
          </div>
        } />
        <Route path="/sign-up/*" element={
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/onboarding" />
          </div>
        } />
        <Route element={<PublicLayout />}>
          <Route path="/" element={<PublicHome />} />
          <Route path="/home" element={<PublicHome />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Authenticated — show app
  return (
    <Routes>
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

      {/* Onboarding flow */}
      <Route path="/onboarding/*" element={<Onboarding />} />

      {/* Main app with layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/signals" element={<Intelligence />} />
        <Route path="/competitors" element={<Competitors />} />
        <Route path="/events" element={<Events />} />
        <Route path="/reviews" element={<Reputation />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/retention" element={<Retention />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/market-analysis" element={<MarketAnalysis />} />
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
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>

      <Route path="/sign-in/*" element={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <SignIn routing="path" path="/sign-in" />
        </div>
      } />
      <Route path="/sign-up/*" element={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <SignUp routing="path" path="/sign-up" />
        </div>
      } />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router future={ROUTER_FUTURE}>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <DevUserSwitcher />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App

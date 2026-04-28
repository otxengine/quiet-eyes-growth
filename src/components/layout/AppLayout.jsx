import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const ADMIN_EMAILS = ['contact@otxenginee.io'];
const ADMIN_DOMAINS = ['@otx.ai', '@quieteyes.ai'];
function checkIsAdmin(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return ADMIN_EMAILS.includes(e) || ADMIN_DOMAINS.some(d => e.endsWith(d));
}

// FIX 4: Track page visits in sessionStorage so badge counts clear after visiting the relevant page
function usePageVisits(pathname) {
  const [visits, setVisits] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('otx_page_visits') || '{}'); }
    catch { return {}; }
  });
  useEffect(() => {
    setVisits(prev => {
      const updated = { ...prev, [pathname]: Date.now() };
      sessionStorage.setItem('otx_page_visits', JSON.stringify(updated));
      return updated;
    });
  }, [pathname]);
  return visits;
}
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ChatWidget from '@/components/chat/ChatWidget';
import { cn } from '@/lib/utils';

const pageTitles = {
  '/': 'מרכז פיקוד',
  '/dashboard': 'מרכז פיקוד',
  '/signals': 'העיניים — מודיעין שוק',
  '/competitors': 'מתחרים',
  '/reviews': 'מוניטין',
  '/leads': 'לידים',
  '/retention': 'שימור לקוחות',
  '/reports': 'דוחות וניתוח',
  '/tasks': 'משימות',
  '/data-sources': 'מקורות מידע',
  '/subscription': 'ניהול מנוי',
  '/agents': 'סוכנים',
  '/learning': 'מרכז למידה',
  '/integrations': 'אינטגרציות',
  '/settings': 'הגדרות',
  '/social': 'רשתות חברתיות',
};

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const pageVisits = usePageVisits(location.pathname);

  // Use reactive auth context for reliable admin detection
  const { user: authUser, isLoadingAuth } = useAuth();
  const isAdmin = checkIsAdmin(authUser?.email);

  // Get current user
  const { data: user, isLoading: loadingUser, isError: userError } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: 3,
    retryDelay: 500,
  });

  // Get user's business profile
  const { data: businessProfiles, isLoading: loadingProfiles } = useQuery({
    queryKey: ['businessProfiles', user?.email],
    queryFn: () => base44.entities.BusinessProfile.filter({ created_by: user?.email }),
    enabled: !!user?.email
  });

  // Prefer a profile that completed onboarding; fall back to the first one
  const businessProfile = businessProfiles?.find(p => p.onboarding_completed) || businessProfiles?.[0];

  const stillLoading = loadingUser || (!!user?.email && loadingProfiles);

  const fromOnboarding = location.state?.fromOnboarding;

  // Redirect to onboarding if no business profile found
  useEffect(() => {
    if (stillLoading) return;
    if (isLoadingAuth) return; // wait for auth to resolve before checking admin
    if (location.pathname.startsWith('/onboarding')) return;
    if (fromOnboarding) return;
    if (isAdmin) return; // admins skip onboarding entirely
    // If user loaded but no profile — go to onboarding
    if (user && !businessProfile) {
      navigate('/onboarding');
      return;
    }
    // If user failed to load (401 from Clerk) — also send to onboarding so they can register
    if (userError && !user) {
      navigate('/onboarding');
    }
  }, [businessProfile, stillLoading, isLoadingAuth, user, userError, navigate, location.pathname, fromOnboarding, isAdmin]);

  // Fetch badge counts
  const { data: unreadSignals } = useQuery({
    queryKey: ['unreadSignals', businessProfile?.id],
    queryFn: () => base44.entities.MarketSignal.filter({ 
      linked_business: businessProfile?.id, 
      is_read: false 
    }),
    enabled: !!businessProfile?.id
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ['pendingReviews', businessProfile?.id],
    queryFn: () => base44.entities.Review.filter({ 
      linked_business: businessProfile?.id, 
      response_status: 'pending' 
    }),
    enabled: !!businessProfile?.id
  });

  const { data: hotLeads } = useQuery({
    queryKey: ['hotLeads', businessProfile?.id],
    queryFn: () => base44.entities.Lead.filter({ 
      linked_business: businessProfile?.id, 
      status: 'hot' 
    }),
    enabled: !!businessProfile?.id
  });

  // FIX 4: Only count items that arrived AFTER the user last visited the relevant page
  const signalsLastSeen = pageVisits['/signals'] || 0;
  const reviewsLastSeen = pageVisits['/reviews'] || 0;
  const leadsLastSeen   = pageVisits['/leads'] || 0;

  const badges = {
    unreadSignals: (unreadSignals || []).filter(
      s => new Date(s.detected_at || s.created_date || 0).getTime() > signalsLastSeen
    ).length,
    pendingReviews: (pendingReviews || []).filter(
      r => new Date(r.created_at || r.created_date || 0).getTime() > reviewsLastSeen
    ).length,
    hotLeads: (hotLeads || []).filter(
      l => new Date(l.created_at || l.created_date || 0).getTime() > leadsLastSeen
    ).length,
  };

  const pageTitle = pageTitles[location.pathname] || 'OTX';

  if (loadingProfiles) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar - Desktop */}
      <div className="hidden lg:block">
        <Sidebar 
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          badges={badges}
        />
      </div>

      {/* Sidebar - Mobile Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div 
            className="absolute inset-0 bg-black/50" 
            onClick={() => setMobileMenuOpen(false)} 
          />
          <div className="relative z-[51]">
            <Sidebar 
              collapsed={false}
              onToggle={() => setMobileMenuOpen(false)}
              badges={badges}
              onNavigate={() => setMobileMenuOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={cn(
        "transition-all duration-300",
        sidebarCollapsed ? "lg:mr-16" : "lg:mr-64"
      )}>
        <TopBar 
          pageTitle={pageTitle}
          user={user}
          badges={badges}
          onMenuClick={() => setMobileMenuOpen(true)}
          showMenuButton={true}
          businessProfileId={businessProfile?.id}
          selectedLocationId={selectedLocationId}
          onLocationChange={setSelectedLocationId}
        />
        {/* FIX 1: prevent horizontal scroll in main content */}
        <main className="px-4 md:px-6 py-4 overflow-x-hidden">
          <Outlet context={{ businessProfile, user, badges, selectedLocationId }} />
        </main>
      </div>
      <ChatWidget businessProfile={businessProfile} />
    </div>
  );
}
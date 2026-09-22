import { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import { useScanQuota } from '@/lib/useScanQuota';
import { PLAN_LABELS } from '@/lib/usePlan';
import ScanOverlay from '@/components/dashboard/ScanOverlay';
import { buildNotificationFeed } from '@/lib/notificationFeed';

// Track page visits in sessionStorage so badge counts clear after visiting the relevant page
// Sub-paths (e.g. /insights/:id) also mark the parent path as visited
function usePageVisits(pathname) {
  const [visits, setVisits] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('otx_page_visits') || '{}'); }
    catch { return {}; }
  });
  useEffect(() => {
    setVisits(prev => {
      const now = Date.now();
      const updated = { ...prev, [pathname]: now };
      // Mark parent routes visited so badges clear on sub-pages too
      if (pathname.startsWith('/insights/')) updated['/insights'] = now;
      if (pathname.startsWith('/tasks/'))    updated['/tasks']    = now;
      if (pathname.startsWith('/signals/'))  updated['/signals']  = now;
      sessionStorage.setItem('otx_page_visits', JSON.stringify(updated));
      return updated;
    });
  }, [pathname]);
  return visits;
}
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SupportWidget from '@/components/support/SupportWidget';
import { cn } from '@/lib/utils';
import { registerServiceWorker } from '@/lib/pushNotifications';
import { useOrganization } from '@/contexts/OrganizationContext';

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showGlobalScan, setShowGlobalScan] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const pageVisits = usePageVisits(location.pathname);

  const { isLoadingAuth } = useAuth();

  // Organization context: active branch
  const { currentBranch: orgBranch } = useOrganization();

  // Get current user
  const { data: user, isLoading: loadingUser, isError: userError } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled: !isLoadingAuth,
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
  const legacyProfile = businessProfiles?.find(p => p.onboarding_completed) || businessProfiles?.[0];

  // When org context has a branch selected, use its ID for queries but merge
  // with the full legacy profile data so pages still have all fields available.
  const activeBranchId = orgBranch?.id || legacyProfile?.id;
  const businessProfile = activeBranchId && legacyProfile
    ? (activeBranchId === legacyProfile.id
        ? legacyProfile
        : { ...legacyProfile, id: activeBranchId, name: orgBranch?.name || legacyProfile.name })
    : legacyProfile;

  const stillLoading = loadingUser || (!!user?.email && loadingProfiles);

  // Only trust the just-onboarded flag briefly, so it can't block a different
  // user/session that reuses the same browser tab later.
  const justOnboardedAt = Number(sessionStorage.getItem('otx_just_onboarded')) || 0;
  const fromOnboarding = location.state?.fromOnboarding || (Date.now() - justOnboardedAt) < 15_000;

  // Register service worker once on mount
  useEffect(() => { registerServiceWorker(); }, []);

  // Redirect to onboarding if no business profile found
  useEffect(() => {
    if (stillLoading) return;
    if (isLoadingAuth) return;
    if (location.pathname.startsWith('/onboarding')) return;
    // If the profile loaded successfully, clear the onboarding guard flag
    if (businessProfile) {
      sessionStorage.removeItem('otx_just_onboarded');
      return;
    }
    if (fromOnboarding) return;
    // If user loaded but no profile — go to onboarding
    if (user && !businessProfile) {
      navigate('/onboarding');
      return;
    }
    // If user failed to load (401 from Clerk) — also send to onboarding so they can register
    if (userError && !user) {
      navigate('/onboarding');
    }
  }, [businessProfile, stillLoading, isLoadingAuth, user, userError, navigate, location.pathname, fromOnboarding]);

  // Global scan overlay — works on all pages (Dashboard overrides with its own when active)
  const scanQuota = useScanQuota(businessProfile?.id);
  const isOnDashboard = ['/', '/dashboard', '/command'].includes(location.pathname);

  useEffect(() => {
    if (isOnDashboard) return; // Dashboard registers its own handler
    const handler = () => {
      if (scanQuota.isExhausted) {
        toast.error(
          `הגעת למגבלת הסריקות של תוכנית ${PLAN_LABELS[scanQuota.plan]} (${scanQuota.quota}/חודש). שדרג כדי להמשיך.`,
          { duration: 5000 }
        );
        return;
      }
      setShowGlobalScan(true);
    };
    // setTimeout ensures page-specific handlers (from Intelligence/Leads/etc.) run first.
    // Only register generic handler if no page has set its own.
    const t = setTimeout(() => {
      if (!window.__cortexi_scan) window.__cortexi_scan = handler;
    }, 0);
    return () => { clearTimeout(t); if (window.__cortexi_scan === handler) delete window.__cortexi_scan; };
  }, [isOnDashboard, scanQuota.isExhausted, scanQuota.plan, scanQuota.quota, location.pathname]);

  // Fetch badge counts.
  // Queries stay time-unfiltered so the react-query key is stable across navigation;
  // the "new since you last looked" cut happens client-side against pageVisits below.
  const bizId = businessProfile?.id;
  const bizQuery = (key, fn, extra) => ({
    queryKey: [key, bizId], queryFn: fn, enabled: !!bizId, ...extra,
  });

  // Own reviews awaiting a response (also drives the sidebar badge on /reviews)
  const { data: pendingReviews } = useQuery(bizQuery('pendingReviews', () =>
    base44.entities.Review.filter({ linked_business: bizId, response_status: 'pending' })));

  // Insights alerts (drives the sidebar badge on /insights)
  const { data: activeInsightAlerts } = useQuery(bizQuery('activeInsights', () =>
    base44.entities.ProactiveAlert.filter({ linked_business: bizId, is_dismissed: false, is_acted_on: false }),
    { refetchInterval: 120000 }));

  // Competitor activity. Posts and ads come back newest-first (ENTITY_DEFAULT_ORDER),
  // then split into offers vs plain content so the two bell rows never double-count.
  const { data: competitorPosts } = useQuery(bizQuery('competitorPosts', () =>
    base44.entities.CompetitorPost.filter({ linked_business: bizId }, null, 200),
    { refetchInterval: 300000 }));

  const { data: competitorAds } = useQuery(bizQuery('competitorAds', () =>
    base44.entities.CompetitorAdHistory.filter({ linked_business: bizId }, null, 200),
    { refetchInterval: 300000 }));

  // linked_competitor must be passed explicitly — the entities route defaults Review to own-business rows
  const { data: competitorReviews } = useQuery(bizQuery('competitorReviews', () =>
    base44.entities.Review.filter({ linked_business: bizId, linked_competitor: { not: null } }, null, 200),
    { refetchInterval: 300000 }));

  // Competitor names, for readable notification text
  const { data: competitors } = useQuery(bizQuery('competitorNames', () =>
    base44.entities.Competitor.filter({ linked_business: bizId }, null, 100)));

  const notifications = useMemo(() => buildNotificationFeed({
    pendingReviews, competitorReviews, competitorPosts, competitorAds,
    competitors, pageVisits,
  }), [pendingReviews, competitorReviews, competitorPosts, competitorAds, competitors, pageVisits]);

  const unreadBy = (kind) => notifications.filter((n) => n.unread && n.kind === kind).length;

  // Sidebar badges. activeInsights isn't part of the bell feed — it drives /insights only.
  const badges = {
    pendingReviews: unreadBy('review'),
    activeInsights: (activeInsightAlerts || []).filter(
      (a) => new Date(a.created_date || a.created_at || 0).getTime() > (pageVisits['/insights'] || 0)
    ).length,
  };

  if (stillLoading) {
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
          user={user}
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
              user={user}
              onNavigate={() => setMobileMenuOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={cn(
        "transition-all duration-300",
        sidebarCollapsed ? "lg:mr-14" : "lg:mr-52"
      )}>
        <TopBar 
          badges={badges}
          notifications={notifications}
          onMenuClick={() => setMobileMenuOpen(true)}
          showMenuButton={true}
        />
        {/* FIX 1: prevent horizontal scroll in main content */}
        <main className="px-4 md:px-6 py-4 overflow-x-hidden bg-dot-grid min-h-screen">
          <Outlet context={{ businessProfile, user, badges }} />
        </main>
      </div>
      <SupportWidget businessProfile={businessProfile} />

      {/* Global Scan Overlay — active on all non-Dashboard pages */}
      {showGlobalScan && businessProfile && (
        <ScanOverlay
          businessProfile={businessProfile}
          onComplete={() => {
            setShowGlobalScan(false);
            queryClient.invalidateQueries(); // refresh all queries after scan
          }}
          onClose={() => setShowGlobalScan(false)}
        />
      )}
    </div>
  );
}
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  LayoutGrid, Eye, Users, Star, CheckCircle, Heart, Settings,
  ChevronRight, ChevronLeft, LogOut, FileBarChart, TrendingUp,
  ClipboardList, Database, Bot, Plug, Crown, Share2, Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  {
    group: 'ראשי',
    items: [
      { path: '/', label: 'מרכז פיקוד', icon: LayoutGrid, badgeKey: 'unreadSignals' },
      { path: '/signals', label: 'העיניים', icon: Eye },
      { path: '/competitors', label: 'מתחרים', icon: Users },
    ]
  },
  {
    group: 'ניהול',
    items: [
      { path: '/reviews', label: 'מוניטין', icon: Star, badgeKey: 'pendingReviews' },
      { path: '/leads', label: 'לידים', icon: CheckCircle, badgeKey: 'hotLeads' },
      { path: '/retention', label: 'שימור', icon: Heart },
      { path: '/tasks', label: 'משימות', icon: ClipboardList },
    ]
  },
  {
    group: 'ניתוח',
    items: [
      { path: '/reports', label: 'דוחות', icon: FileBarChart },
      { path: '/market-analysis', label: 'ניתוח שוק', icon: TrendingUp },
    ]
  },
  {
    group: 'מערכת',
    items: [
      { path: '/learning', label: 'מרכז למידה', icon: Sparkles },
      { path: '/data-sources', label: 'מקורות מידע', icon: Database },
      { path: '/social', label: 'רשתות חברתיות', icon: Share2 },
      { path: '/integrations', label: 'אינטגרציות', icon: Plug },
      { path: '/subscription', label: 'מנוי', icon: Crown },
      { path: '/settings', label: 'הגדרות', icon: Settings },
    ]
  }
];

function useIsAdmin() {
  // Check via Clerk user metadata or email domain
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || '';
    return email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai');
  } catch { return false; }
}

export default function Sidebar({ collapsed, onToggle, badges = {}, onNavigate }) {
  const location = useLocation();
  const isAdmin = useIsAdmin();

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 h-screen z-40 transition-all duration-300 flex flex-col",
        "border-l",
        collapsed ? "w-16" : "w-60"
      )}
      style={{
        background: 'hsl(var(--sidebar-background))',
        borderColor: 'hsl(var(--sidebar-border))',
      }}
    >
      {/* Logo Area */}
      <div
        className="h-14 flex items-center justify-between px-3 shrink-0"
        style={{ borderBottom: '1px solid hsl(var(--sidebar-border))' }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 px-1">
            <img src="/logo.jpeg" alt="OTX" className="h-6 w-auto object-contain rounded-sm" />
            <span className="text-[14px] font-bold" style={{ color: 'hsl(var(--sidebar-accent-foreground))' }}>
              OTX
            </span>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto">
            <img src="/logo.jpeg" alt="OTX" className="h-7 w-7 object-contain rounded-sm" />
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'hsl(var(--sidebar-foreground-muted))' }}
            onMouseEnter={e => e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        {collapsed && (
          <button
            onClick={onToggle}
            className="absolute -left-3 top-6 w-6 h-6 rounded-full border flex items-center justify-center transition-colors"
            style={{
              background: 'hsl(var(--sidebar-background))',
              borderColor: 'hsl(var(--sidebar-border))',
              color: 'hsl(var(--sidebar-foreground-muted))',
            }}
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 overflow-y-auto min-h-0 pt-2 pb-4"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0,0,0,0.28) transparent',
          scrollbarGutter: 'stable',
          overflowY: 'auto',
          minHeight: 0,
          flex: '1 1 0',
        }}
      >
        {/* Admin-only: agents page */}
        {isAdmin && (
          <div className="px-2 mb-1">
            <Link
              to="/agents"
              onClick={() => onNavigate && onNavigate()}
              className={`flex items-center gap-2.5 h-8 rounded-md transition-all duration-150 text-[12px] relative ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
              style={{
                background: location.pathname === '/agents' ? 'hsl(var(--sidebar-accent-active))' : 'transparent',
                color: location.pathname === '/agents' ? 'hsl(var(--sidebar-accent-foreground))' : 'hsl(var(--sidebar-foreground-muted))',
              }}
              onMouseEnter={e => { if (location.pathname !== '/agents') { e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'; e.currentTarget.style.color = 'hsl(var(--sidebar-accent-foreground))'; } }}
              onMouseLeave={e => { if (location.pathname !== '/agents') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--sidebar-foreground-muted))'; } }}
            >
              <Bot className="w-[14px] h-[14px] flex-shrink-0 opacity-60" />
              {!collapsed && <span className="flex-1 font-medium text-[11px] opacity-70">סוכנים (admin)</span>}
            </Link>
          </div>
        )}

        {navItems.map((group, gi) => (
          <div key={group.group} className={cn("mb-1", gi > 0 && "mt-3")}>
            {!collapsed && (
              <div
                className="px-4 mb-1 text-[9px] font-semibold uppercase tracking-widest"
                style={{ color: 'hsl(var(--sidebar-foreground-muted))' }}
              >
                {group.group}
              </div>
            )}
            <ul className="px-2 space-y-0.5">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path;
                const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
                const Icon = item.icon;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => onNavigate && onNavigate()}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 h-8 rounded-md transition-all duration-150 text-[12px] relative",
                        collapsed ? "justify-center px-0" : "px-2.5",
                      )}
                      style={{
                        background: isActive ? 'hsl(var(--sidebar-accent-active))' : 'transparent',
                        color: isActive
                          ? 'hsl(var(--sidebar-accent-foreground))'
                          : 'hsl(var(--sidebar-foreground-muted))',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'hsl(var(--sidebar-accent))';
                          e.currentTarget.style.color = 'hsl(var(--sidebar-accent-foreground))';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'hsl(var(--sidebar-foreground-muted))';
                        }
                      }}
                    >
                      {/* Active indicator bar */}
                      {isActive && !collapsed && (
                        <div
                          className="absolute right-0 top-1 bottom-1 w-[3px] rounded-full"
                          style={{ background: 'hsl(var(--sidebar-primary))' }}
                        />
                      )}
                      <Icon
                        className="w-[14px] h-[14px] flex-shrink-0 transition-colors"
                        style={{ color: isActive ? 'hsl(var(--sidebar-primary))' : 'inherit', opacity: isActive ? 1 : 0.6 }}
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1 font-medium">{item.label}</span>
                          {badgeCount > 0 && (
                            <span
                              className="px-1.5 py-0.5 text-[8px] font-bold rounded-full"
                              style={{ background: 'hsl(var(--sidebar-primary) / 0.25)', color: 'hsl(var(--sidebar-primary))' }}
                            >
                              {badgeCount}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Logout */}
        <div className="px-2 mt-3 pt-3" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }}>
          <button
            onClick={() => base44.auth.logout('/')}
            className={cn(
              "flex items-center gap-2.5 h-8 rounded-md transition-all text-[12px] w-full",
              collapsed ? "justify-center px-0" : "px-2.5",
            )}
            style={{ color: 'hsl(var(--sidebar-foreground-muted))' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'hsl(0 60% 40% / 0.15)'; e.currentTarget.style.color = 'hsl(0 72% 65%)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--sidebar-foreground-muted))'; }}
          >
            <LogOut className="w-[14px] h-[14px] flex-shrink-0 opacity-60" />
            {!collapsed && <span className="flex-1 font-medium">התנתק</span>}
          </button>
        </div>
      </nav>
    </aside>
  );
}

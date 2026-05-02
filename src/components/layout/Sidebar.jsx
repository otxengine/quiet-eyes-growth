import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  LayoutGrid, Eye, Users, Star, CheckCircle, Heart, Settings,
  ChevronRight, ChevronLeft, ChevronDown, LogOut, FileBarChart,
  ClipboardList, Database, Bot, Plug, Crown, Sparkles, Calendar, Megaphone, ShieldAlert, Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';

// 2-level structure: standalone items always visible, groups collapsible
const NAV_STRUCTURE = [
  { type: 'item',  path: '/',      label: 'מרכז פיקוד',   icon: LayoutGrid, badgeKey: 'unreadSignals' },
  {
    type: 'group', key: 'intel', label: 'מודיעין', icon: Eye,
    items: [
      { path: '/signals',     label: 'תובנות שוק', icon: Eye },
      { path: '/competitors', label: 'מתחרים',     icon: Users },
      { path: '/events',      label: 'אירועים',    icon: Calendar },
      { path: '/insights',    label: 'תובנות',     icon: Lightbulb, badgeKey: 'activeInsights' },
    ],
  },
  { type: 'item',  path: '/leads', label: 'לידים', icon: CheckCircle, badgeKey: 'hotLeads' },
  {
    type: 'group', key: 'manage', label: 'שיווק וניהול', icon: Megaphone,
    items: [
      { path: '/marketing',  label: 'מרכז שיווק',   icon: Megaphone },
      { path: '/reviews',    label: 'מוניטין',      icon: Star, badgeKey: 'pendingReviews' },
      { path: '/retention',  label: 'שימור לקוחות', icon: Heart },
      { path: '/tasks',      label: 'משימות',       icon: ClipboardList },
      { path: '/reports',    label: 'דוחות',        icon: FileBarChart },
    ],
  },
  {
    type: 'group', key: 'system', label: 'הגדרות', icon: Settings,
    items: [
      { path: '/settings',     label: 'הגדרות',      icon: Settings },
      { path: '/data-sources', label: 'מקורות מידע', icon: Database },
      { path: '/integrations', label: 'אינטגרציות',  icon: Plug },
      { path: '/subscription', label: 'מנוי',        icon: Crown },
    ],
  },
];

function getDefaultOpen(key) {
  try {
    return localStorage.getItem(`sidebar_group_${key}`) === 'true';
  } catch {}
  return false;
}

function useIsAdmin() {
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || '';
    return email === 'contact@otxengine.io' || email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai');
  } catch { return false; }
}

function NavLink({ item, collapsed, isActive, onNavigate, indented = false }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      onClick={() => onNavigate && onNavigate()}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center gap-2.5 h-8 rounded-md transition-all duration-150 text-[12px] relative',
        collapsed ? 'justify-center px-0' : indented ? 'px-2.5 pr-5' : 'px-2.5',
      )}
      style={{
        background: isActive ? 'hsl(var(--sidebar-accent-active))' : 'transparent',
        color: isActive ? 'hsl(var(--sidebar-accent-foreground))' : 'hsl(var(--sidebar-foreground-muted))',
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
      {isActive && !collapsed && (
        <div className="absolute right-0 top-1 bottom-1 w-[3px] rounded-full" style={{ background: 'hsl(var(--sidebar-primary))' }} />
      )}
      <Icon
        className="w-[14px] h-[14px] flex-shrink-0 transition-colors"
        style={{ color: isActive ? 'hsl(var(--sidebar-primary))' : 'inherit', opacity: isActive ? 1 : 0.6 }}
      />
      {!collapsed && (
        <>
          <span className="flex-1 font-medium">{item.label}</span>
          {item.badgeCount > 0 && (
            <span className="px-1.5 py-0.5 text-[8px] font-bold rounded-full" style={{ background: 'hsl(var(--sidebar-primary) / 0.25)', color: 'hsl(var(--sidebar-primary))' }}>
              {item.badgeCount}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

export default function Sidebar({ collapsed, onToggle, badges = {}, onNavigate }) {
  const location = useLocation();
  const isAdmin = useIsAdmin();

  const [openGroups, setOpenGroups] = useState(() => ({
    intel:  getDefaultOpen('intel'),
    manage: getDefaultOpen('manage'),
    system: getDefaultOpen('system'),
  }));

  // Auto-expand group when a child route is active
  useEffect(() => {
    NAV_STRUCTURE.forEach(node => {
      if (node.type === 'group' && node.items.some(i => i.path === location.pathname)) {
        setOpenGroups(prev => prev[node.key] ? prev : { ...prev, [node.key]: true });
      }
    });
  }, [location.pathname]);

  const toggleGroup = (key) => {
    setOpenGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(`sidebar_group_${key}`, String(next[key])); } catch {}
      return next;
    });
  };

  const adminLinks = [
    { path: '/admin-dashboard', label: 'Admin Dashboard',   icon: ShieldAlert },
    { path: '/learning',        label: 'מרכז למידה (admin)', icon: Sparkles },
    { path: '/agents',          label: 'סוכנים (admin)',     icon: Bot },
  ];

  return (
    <aside
      className={cn('fixed top-0 right-0 h-screen z-40 transition-all duration-300 flex flex-col border-l', collapsed ? 'w-16' : 'w-60')}
      style={{ background: 'hsl(var(--sidebar-background))', borderColor: 'hsl(var(--sidebar-border))' }}
    >
      {/* Logo */}
      <div className="h-14 flex items-center justify-between px-3 shrink-0" style={{ borderBottom: '1px solid hsl(var(--sidebar-border))' }}>
        {!collapsed && (
          <div className="flex items-center gap-2 px-1">
            <img src="/logo.jpeg" alt="OTX" className="h-6 w-auto object-contain rounded-sm" />
            <span className="text-[14px] font-bold" style={{ color: 'hsl(var(--sidebar-accent-foreground))' }}>OTX</span>
          </div>
        )}
        {collapsed && <div className="mx-auto"><img src="/logo.jpeg" alt="OTX" className="h-7 w-7 object-contain rounded-sm" /></div>}
        {!collapsed && (
          <button onClick={onToggle} className="p-1.5 rounded-md transition-colors" style={{ color: 'hsl(var(--sidebar-foreground-muted))' }}
            onMouseEnter={e => e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        {collapsed && (
          <button onClick={onToggle} className="absolute -left-3 top-6 w-6 h-6 rounded-full border flex items-center justify-center transition-colors"
            style={{ background: 'hsl(var(--sidebar-background))', borderColor: 'hsl(var(--sidebar-border))', color: 'hsl(var(--sidebar-foreground-muted))' }}>
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto min-h-0 pt-2 pb-4" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,0,0,0.28) transparent' }}>
        {/* Admin-only links */}
        {isAdmin && (
          <div className="px-2 mb-2">
            {adminLinks.map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path;
              return (
                <Link key={path} to={path} onClick={() => onNavigate && onNavigate()}
                  className={`flex items-center gap-2.5 h-8 rounded-md transition-all duration-150 text-[12px] relative ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
                  style={{ background: isActive ? 'hsl(var(--sidebar-accent-active))' : 'transparent', color: isActive ? 'hsl(var(--sidebar-accent-foreground))' : 'hsl(var(--sidebar-foreground-muted))' }}
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'; e.currentTarget.style.color = 'hsl(var(--sidebar-accent-foreground))'; } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--sidebar-foreground-muted))'; } }}
                >
                  <Icon className="w-[14px] h-[14px] flex-shrink-0 opacity-60" />
                  {!collapsed && <span className="flex-1 font-medium text-[11px] opacity-70">{label}</span>}
                </Link>
              );
            })}
            <div className="mx-2 my-1" style={{ borderTop: '1px solid hsl(var(--sidebar-border) / 0.5)' }} />
          </div>
        )}

        <ul className="px-2 space-y-0.5">
          {NAV_STRUCTURE.map((node, idx) => {
            if (node.type === 'item') {
              const isActive = location.pathname === node.path;
              const badgeCount = node.badgeKey ? (badges[node.badgeKey] || 0) : 0;
              const showDivider = idx > 0;
              return (
                <React.Fragment key={node.path}>
                  {showDivider && !collapsed && (
                    <li><div className="my-1" style={{ borderTop: '1px solid hsl(var(--sidebar-border) / 0.4)' }} /></li>
                  )}
                  <li>
                    <NavLink item={{ ...node, badgeCount }} collapsed={collapsed} isActive={isActive} onNavigate={onNavigate} />
                  </li>
                </React.Fragment>
              );
            }

            // Group node
            const isOpen = openGroups[node.key];
            const GroupIcon = node.icon;
            const childBadge = node.items.reduce((sum, item) => sum + (item.badgeKey ? (badges[item.badgeKey] || 0) : 0), 0);

            return (
              <React.Fragment key={node.key}>
                {!collapsed && (
                  <li>
                    <div className="my-1" style={{ borderTop: '1px solid hsl(var(--sidebar-border) / 0.4)' }} />
                  </li>
                )}

                {/* Group header button */}
                {!collapsed && (
                  <li>
                    <button
                      onClick={() => toggleGroup(node.key)}
                      className="w-full flex items-center gap-2.5 h-8 rounded-md px-2.5 text-[12px] font-medium transition-all duration-150 relative"
                      style={{ color: 'hsl(var(--sidebar-foreground-muted))' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'; e.currentTarget.style.color = 'hsl(var(--sidebar-accent-foreground))'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--sidebar-foreground-muted))'; }}
                    >
                      <GroupIcon className="w-[14px] h-[14px] flex-shrink-0 opacity-60" />
                      <span className="flex-1 text-right">{node.label}</span>
                      {/* Badge dot on header when collapsed or group is closed */}
                      {!isOpen && childBadge > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'hsl(var(--sidebar-primary))' }} />
                      )}
                      <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
                    </button>
                  </li>
                )}

                {/* Group children — always shown in collapsed icon mode */}
                {(collapsed || isOpen) && node.items.map(item => {
                  const isActive = location.pathname === item.path;
                  const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0;
                  return (
                    <li key={item.path}>
                      <NavLink
                        item={{ ...item, badgeCount }}
                        collapsed={collapsed}
                        isActive={isActive}
                        onNavigate={onNavigate}
                        indented={!collapsed}
                      />
                    </li>
                  );
                })}
              </React.Fragment>
            );
          })}
        </ul>

        {/* Logout */}
        <div className="px-2 mt-3 pt-3" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }}>
          <button
            onClick={() => base44.auth.logout('/')}
            className={cn('flex items-center gap-2.5 h-8 rounded-md transition-all text-[12px] w-full', collapsed ? 'justify-center px-0' : 'px-2.5')}
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

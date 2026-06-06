import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  ChevronLeft, ChevronRight, LogOut,
  ShieldAlert, Sparkles, Bot, Building2, GitBranch, User,
  LayoutGrid, Eye, Users, Star, CheckCircle, Heart, Settings,
  FileBarChart, ClipboardList, Database, Plug, Crown, Calendar,
  Megaphone, Lightbulb, Target, SearchCheck, Home
} from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { cn } from '@/lib/utils';

// Main nav structure — matches Figma design
const NAV_STRUCTURE = [
  { type: 'item', path: '/command', label: 'בית' },
  { type: 'item', path: '/leads',   label: 'לידים', badgeKey: 'hotLeads' },
  {
    type: 'group', key: 'intel', label: 'תובנות',
    items: [
      { path: '/insights',    label: 'תובנות',      badgeKey: 'activeInsights' },
      { path: '/competitors', label: 'מתחרים' },
      { path: '/events',      label: 'אירועים' },
      { path: '/strategy',    label: 'אסטרטגיה' },
      { path: '/demand-gap',  label: 'פערי ביקוש' },
    ],
  },
  {
    type: 'group', key: 'manage', label: 'שיווק וניהול',
    items: [
      { path: '/marketing',  label: 'מרכז שיווק' },
      { path: '/reviews',    label: 'מוניטין',      badgeKey: 'pendingReviews' },
      { path: '/retention',  label: 'שימור לקוחות' },
      { path: '/tasks',      label: 'משימות' },
      { path: '/reports',    label: 'דוחות' },
    ],
  },
];

// Collapsed mode icons — one per nav entry
const COLLAPSED_ICONS = {
  '/command':   Home,
  '/leads':     CheckCircle,
  'intel':      Lightbulb,
  'manage':     Megaphone,
};

function getDefaultOpen(key) {
  try {
    const stored = localStorage.getItem(`sidebar_group_${key}`);
    if (stored !== null) return stored === 'true';
  } catch {}
  return false; // closed by default (matches Figma)
}

function useIsAdmin() {
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || '';
    return email === 'contact@otxengine.io' || email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai');
  } catch { return false; }
}

export default function Sidebar({ collapsed, onToggle, badges = {}, onNavigate }) {
  const location = useLocation();
  const isAdmin = useIsAdmin();
  const { isAgency, currentOrg } = useOrganization();

  const [openGroups, setOpenGroups] = useState(() => ({
    intel:  getDefaultOpen('intel'),
    manage: getDefaultOpen('manage'),
  }));

  // Auto-expand group when a child route is active
  useEffect(() => {
    NAV_STRUCTURE.forEach(node => {
      if (node.type === 'group' && node.items.some(i => i.path === location.pathname)) {
        setOpenGroups(prev => ({ ...prev, [node.key]: true }));
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

  // Check if any child of a group is active
  const isGroupActive = (node) =>
    node.items.some(i => location.pathname === i.path || location.pathname.startsWith(i.path + '/'));

  return (
    <aside
      className={cn(
        'fixed top-0 right-0 h-screen z-40 flex flex-col transition-all duration-300 border-l',
        collapsed ? 'w-14' : 'w-52'
      )}
      style={{
        background: 'hsl(var(--sidebar-background))',
        borderColor: 'hsl(var(--sidebar-border))',
        boxShadow: '-2px 0 20px rgba(0,0,0,0.05)',
      }}
    >
      {/* Logo / Header */}
      <div
        className={cn('h-14 flex items-center shrink-0', collapsed ? 'justify-center px-0' : 'px-5 justify-between')}
        style={{ borderBottom: '1px solid hsl(var(--sidebar-border))' }}
      >
        {!collapsed && (
          <>
            <div className="flex items-center gap-2">
              <img src="/logo.jpeg" alt="OTX" className="h-6 w-auto object-contain rounded-sm" />
              <span className="text-[14px] font-bold" style={{ color: 'hsl(var(--sidebar-accent-foreground))' }}>OTX</span>
            </div>
            <button
              onClick={onToggle}
              className="p-1 rounded transition-colors"
              style={{ color: 'hsl(var(--sidebar-foreground-muted))' }}
              onMouseEnter={e => e.currentTarget.style.color = 'hsl(var(--sidebar-accent-foreground))'}
              onMouseLeave={e => e.currentTarget.style.color = 'hsl(var(--sidebar-foreground-muted))'}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
        {collapsed && (
          <button onClick={onToggle} className="mx-auto">
            <img src="/logo.jpeg" alt="OTX" className="h-7 w-7 object-contain rounded-sm" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-5 min-h-0" style={{ scrollbarWidth: 'none' }}>

        {/* Admin-only links */}
        {isAdmin && !collapsed && (
          <div className="px-5 mb-4">
            {[
              { path: '/admin-dashboard', label: 'Admin', icon: ShieldAlert },
              { path: '/learning',        label: 'למידה', icon: Sparkles },
              { path: '/agents',          label: 'סוכנים', icon: Bot },
            ].map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path;
              return (
                <Link key={path} to={path} onClick={() => onNavigate?.()}
                  className="flex items-center gap-2 h-7 text-[10px] transition-colors"
                  style={{ color: isActive ? '#111' : '#aaa' }}>
                  <Icon className="w-3 h-3 flex-shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
            <div className="mt-3" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }} />
          </div>
        )}

        {/* Org links */}
        {currentOrg && !collapsed && (
          <div className="px-5 mb-4">
            {[
              ...(isAgency ? [{ path: '/agency',       label: 'סוכנות',     icon: Building2 }] : []),
              {               path: '/org/settings',  label: 'הגדרות ארגון', icon: GitBranch },
            ].map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path;
              return (
                <Link key={path} to={path} onClick={() => onNavigate?.()}
                  className="flex items-center gap-2 h-7 text-[11px] transition-colors"
                  style={{ color: isActive ? '#111' : '#999' }}>
                  <Icon className="w-3 h-3 flex-shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
            <div className="mt-3" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }} />
          </div>
        )}

        {/* Main nav */}
        <ul className={cn('space-y-1', collapsed ? 'px-2' : 'px-5')}>
          {NAV_STRUCTURE.map((node) => {
            if (node.type === 'item') {
              const isActive = location.pathname === node.path ||
                (node.path === '/' && location.pathname === '/dashboard');
              const badgeCount = node.badgeKey ? (badges[node.badgeKey] || 0) : 0;

              if (collapsed) {
                const Icon = COLLAPSED_ICONS[node.path] || Home;
                return (
                  <li key={node.path}>
                    <Link to={node.path} onClick={() => onNavigate?.()}
                      title={node.label}
                      className="flex items-center justify-center w-10 h-10 rounded-lg mx-auto transition-colors relative"
                      style={{ background: isActive ? 'hsl(var(--sidebar-accent-active))' : 'transparent', color: isActive ? 'hsl(var(--sidebar-primary))' : 'hsl(var(--sidebar-foreground-muted))' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Icon className="w-[15px] h-[15px]" />
                      {badgeCount > 0 && (
                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'hsl(var(--sidebar-primary))' }} />
                      )}
                    </Link>
                  </li>
                );
              }

              return (
                <li key={node.path}>
                  <Link
                    to={node.path}
                    onClick={() => onNavigate?.()}
                    className="flex items-center justify-between h-9 text-[14px] transition-colors group"
                    style={{ color: isActive ? '#111111' : '#888888', fontWeight: isActive ? '600' : '400', textDecoration: isActive ? 'underline' : 'none', textUnderlineOffset: '3px' }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#333333'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#888888'; }}
                  >
                    <span>{node.label}</span>
                    {badgeCount > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'hsl(var(--sidebar-primary) / 0.12)', color: 'hsl(var(--sidebar-primary))' }}>
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            }

            // Group node
            const isOpen = openGroups[node.key];
            const groupActive = isGroupActive(node);
            const childBadge = node.items.reduce((s, i) => s + (i.badgeKey ? (badges[i.badgeKey] || 0) : 0), 0);

            if (collapsed) {
              const Icon = COLLAPSED_ICONS[node.key] || Eye;
              return (
                <li key={node.key}>
                  <button
                    onClick={() => toggleGroup(node.key)}
                    title={node.label}
                    className="flex items-center justify-center w-10 h-10 rounded-lg mx-auto transition-colors relative"
                    style={{ background: groupActive ? 'hsl(var(--sidebar-accent-active))' : 'transparent', color: groupActive ? 'hsl(var(--sidebar-primary))' : 'hsl(var(--sidebar-foreground-muted))' }}
                    onMouseEnter={e => { if (!groupActive) e.currentTarget.style.background = 'hsl(var(--sidebar-accent))'; }}
                    onMouseLeave={e => { if (!groupActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Icon className="w-[15px] h-[15px]" />
                    {childBadge > 0 && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'hsl(var(--sidebar-primary))' }} />
                    )}
                  </button>
                </li>
              );
            }

            return (
              <React.Fragment key={node.key}>
                {/* Group header */}
                <li>
                  <button
                    onClick={() => toggleGroup(node.key)}
                    className="w-full flex items-center justify-between h-9 text-[14px] transition-colors"
                    style={{ color: groupActive ? '#111111' : '#888888', fontWeight: groupActive ? '500' : '400' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#333333'}
                    onMouseLeave={e => e.currentTarget.style.color = groupActive ? '#111111' : '#888888'}
                  >
                    <ChevronLeft
                      className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
                      style={{ transform: isOpen ? 'rotate(-90deg)' : 'rotate(0deg)', color: 'inherit', opacity: 0.5 }}
                    />
                    <span className="flex-1 text-right mr-1">{node.label}</span>
                    {!isOpen && childBadge > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'hsl(var(--sidebar-primary) / 0.12)', color: 'hsl(var(--sidebar-primary))' }}>
                        {childBadge}
                      </span>
                    )}
                  </button>
                </li>

                {/* Group children */}
                {isOpen && node.items.map(item => {
                  const isActive = location.pathname === item.path;
                  const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={() => onNavigate?.()}
                        className="flex items-center justify-between h-8 text-[13px] transition-colors pr-4"
                        style={{ color: isActive ? '#111111' : '#aaaaaa', fontWeight: isActive ? '500' : '400', textDecoration: isActive ? 'underline' : 'none', textUnderlineOffset: '3px' }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#555555'; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#aaaaaa'; }}
                      >
                        <span>{item.label}</span>
                        {badgeCount > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'hsl(var(--sidebar-primary) / 0.12)', color: 'hsl(var(--sidebar-primary))' }}>
                            {badgeCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </React.Fragment>
            );
          })}
        </ul>

        {/* Settings link — minimal, below main nav */}
        {!collapsed && (
          <div className="px-5 mt-4 pt-4" style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }}>
            <Link to="/settings" onClick={() => onNavigate?.()}
              className="flex items-center h-8 text-[13px] transition-colors"
              style={{ color: location.pathname === '/settings' ? '#111' : '#aaaaaa' }}
              onMouseEnter={e => e.currentTarget.style.color = '#555'}
              onMouseLeave={e => e.currentTarget.style.color = location.pathname === '/settings' ? '#111' : '#aaaaaa'}
            >
              הגדרות
            </Link>
          </div>
        )}
      </nav>

      {/* Footer — אזור אישי */}
      <div
        className={cn('shrink-0 flex items-center gap-3 py-4', collapsed ? 'flex-col justify-center px-2' : 'px-5')}
        style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }}
      >
        <button
          onClick={() => base44.auth.logout('/')}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
          style={{ background: '#f0f0f0' }}
          title="התנתק"
          onMouseEnter={e => e.currentTarget.style.background = '#e0e0e0'}
          onMouseLeave={e => e.currentTarget.style.background = '#f0f0f0'}
        >
          <User className="w-4 h-4" style={{ color: '#555' }} />
        </button>
        {!collapsed && (
          <span className="text-[13px]" style={{ color: '#888' }}>אזור אישי</span>
        )}
      </div>
    </aside>
  );
}

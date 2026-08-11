import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  ChevronRight, LogOut,
  ShieldAlert, Sparkles, Bot, Building2, GitBranch, User,
  Eye, Settings, Star, Users, Heart,
  Calendar, Megaphone, Lightbulb, Home, CreditCard
} from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { cn } from '@/lib/utils';

// Main nav structure — Cortexi design: flat list, no nested groups
const NAV_STRUCTURE = [
  { path: '/',                   label: 'בית',           icon: Home },
  { path: '/insights',           label: 'תובנות',        icon: Lightbulb, badgeKey: 'activeInsights' },
  { path: '/competitors',        label: 'מתחרים',        icon: Eye },
  { path: '/marketing',          label: 'מרכז השיווק',   icon: Megaphone },
  { path: '/events',             label: 'אירועים',       icon: Calendar },
  { path: '/reviews',            label: 'מוניטין',        icon: Star, badgeKey: 'pendingReviews' },
  { path: '/social-competition', label: 'תחרות סושיאל',  icon: Users },
  { path: '/retention',          label: 'ניהול לקוחות',   icon: Heart },
];

function useIsAdmin() {
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || '';
    return email === 'contact@otxengine.io' || email === 'admin@cortexi.ai' || email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai') || email.endsWith('@cortexi.ai');
  } catch { return false; }
}

export default function Sidebar({ collapsed, onToggle, badges = {}, onNavigate, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { isAgency, currentOrg } = useOrganization();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Close popover on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

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
              <img src="/logo.jpeg" alt="Cortexi" className="h-6 w-auto object-contain rounded-sm" />
              <span className="text-[14px] font-bold" style={{ color: 'hsl(var(--sidebar-accent-foreground))' }}>Cortexi</span>
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
            <img src="/logo.jpeg" alt="Cortexi" className="h-7 w-7 object-contain rounded-sm" />
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
            const isActive =
              (node.path === '/' ? (location.pathname === '/' || location.pathname === '/dashboard') : location.pathname === node.path);
            const badgeCount = node.badgeKey ? (badges[node.badgeKey] || 0) : 0;
            const Icon = node.icon;

            if (collapsed) {
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
        ref={userMenuRef}
        className={cn('shrink-0 relative py-4', collapsed ? 'flex flex-col items-center px-2' : 'px-5')}
        style={{ borderTop: '1px solid hsl(var(--sidebar-border))' }}
      >
        {/* Popover — opens above the button */}
        {userMenuOpen && (
          <div
            className="absolute left-0 right-0 mx-2 bg-white rounded-2xl shadow-xl border border-border/60 overflow-hidden"
            style={{
              bottom: '100%',
              marginBottom: 8,
              animation: 'fadeInUp 0.15s ease-out',
              zIndex: 60,
            }}
          >
            {/* User info */}
            <div className="px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-semibold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
                >
                  {(user?.full_name || user?.email || 'U')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  {user?.full_name && (
                    <p className="text-[13px] font-semibold text-foreground truncate">{user.full_name}</p>
                  )}
                  <p className="text-[11px] text-foreground-muted truncate">{user?.email || ''}</p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              {[
                { icon: Settings, label: 'הגדרות', path: '/settings' },
                { icon: CreditCard, label: 'מנוי', path: '/subscription' },
                ...(currentOrg ? [{ icon: GitBranch, label: 'הגדרות ארגון', path: '/org/settings' }] : []),
              ].map(({ icon: Icon, label, path }) => (
                <button
                  key={path}
                  onClick={() => { setUserMenuOpen(false); navigate(path); onNavigate?.(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-foreground-secondary hover:bg-secondary transition-colors text-right"
                >
                  <Icon className="w-4 h-4 text-foreground-muted flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            {/* Divider + Logout */}
            <div className="border-t border-border/50 py-1">
              <button
                onClick={() => base44.auth.logout('/')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-red-50 transition-colors text-right"
                style={{ color: '#E8344D' }}
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                התנתק
              </button>
            </div>
          </div>
        )}

        {/* Trigger button */}
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="flex items-center gap-3 w-full transition-opacity hover:opacity-80"
          title="אזור אישי"
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[13px] font-semibold"
            style={{ background: userMenuOpen ? 'linear-gradient(135deg, #E8344D, #FF6B6B)' : '#f0f0f0' }}
          >
            {userMenuOpen ? (
              <span style={{ color: 'white' }}>
                {(user?.full_name || user?.email || 'U')[0].toUpperCase()}
              </span>
            ) : (
              <User className="w-4 h-4" style={{ color: '#555' }} />
            )}
          </div>
          {!collapsed && (
            <span className="text-[13px]" style={{ color: '#888' }}>אזור אישי</span>
          )}
        </button>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </aside>
  );
}

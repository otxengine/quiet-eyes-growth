import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Bell, Menu, Eye, Star, CheckCircle, LogOut, Radar, Lightbulb } from 'lucide-react';
import LocationSwitcher from './LocationSwitcher';

export default function TopBar({ pageTitle, user, badges = {}, onMenuClick, showMenuButton, businessProfileId, selectedLocationId, onLocationChange }) {
  const userInitial = user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U';
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const navigate = useNavigate();
  const totalCount = (badges.unreadSignals || 0) + (badges.pendingReviews || 0) + (badges.hotLeads || 0) + (badges.activeInsights || 0);

  useEffect(() => {
    const handleClick = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const notifItems = [
    { count: badges.unreadSignals  || 0, label: 'סיגנלים חדשים',   icon: Eye,       path: '/signals'  },
    { count: badges.pendingReviews || 0, label: 'ביקורות ממתינות', icon: Star,       path: '/reviews'  },
    { count: badges.hotLeads       || 0, label: 'לידים חמים היום', icon: CheckCircle,path: '/leads'    },
    { count: badges.activeInsights || 0, label: 'תובנות פעילות',   icon: Lightbulb,  path: '/insights' },
  ];

  return (
    <header className="sticky top-0 z-30 h-14 bg-background/90 backdrop-blur-md border-b border-border/60">
      <div className="h-full px-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showMenuButton && (
            <button onClick={onMenuClick} className="p-2 rounded-md hover:bg-secondary transition-colors lg:hidden">
              <Menu className="w-5 h-5 text-foreground" />
            </button>
          )}
          <h1 className="text-[15px] font-semibold text-foreground">{pageTitle}</h1>
          {businessProfileId && onLocationChange && (
            <LocationSwitcher businessProfileId={businessProfileId} selectedLocationId={selectedLocationId} onLocationChange={onLocationChange} />
          )}
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          {/* Scan button - available on all pages */}
          <button
            onClick={() => window.__quieteyes_scan?.()}
            className="btn-subtle hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium text-foreground-muted border border-border hover:border-border-hover hover:text-foreground transition-all"
          >
            <Radar className="w-3 h-3" />
            סרוק עכשיו
          </button>

          {/* LIVE indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-100">
            <span className="w-[5px] h-[5px] rounded-full bg-emerald-500 pulse-glow" />
            <span className="text-[9px] font-semibold text-emerald-600 tracking-wide">LIVE</span>
          </div>

          {/* Search - removed until functional */}

          {/* Bell */}
          <div ref={bellRef} className="relative">
            <button
              onClick={() => setBellOpen(!bellOpen)}
              className="relative p-2 rounded-md hover:bg-secondary transition-colors"
            >
              <Bell className="w-5 h-5 text-foreground-muted" />
              {totalCount > 0 && (
                <span className="absolute top-1 left-1 w-4 h-4 flex items-center justify-center text-[9px] font-bold bg-primary text-primary-foreground rounded-full">
                  {totalCount > 9 ? '9+' : totalCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute left-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-lg shadow-black/5 z-50 overflow-hidden fade-in-up">
                <div className="px-3 py-2.5 border-b border-border">
                  <span className="text-[12px] font-semibold text-foreground">התראות</span>
                </div>
                {notifItems.map((item) => {
                  if (item.count === 0) return null;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.path}
                      onClick={() => { navigate(item.path); setBellOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-secondary transition-colors text-right"
                    >
                      <Icon className="w-4 h-4 text-foreground-muted flex-shrink-0" />
                      <span className="text-[12px] text-foreground-secondary flex-1">{item.count} {item.label}</span>
                    </button>
                  );
                })}
                {totalCount === 0 && (
                  <div className="px-3 py-4 text-center text-[11px] text-foreground-muted">אין התראות חדשות</div>
                )}
              </div>
            )}
          </div>

          {/* User avatar + logout */}
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-semibold text-[12px]">
              {userInitial}
            </span>
            <button
              onClick={() => base44.auth.logout('/')}
              title="התנתק"
              className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <LogOut className="w-4 h-4 text-foreground-muted hover:text-danger" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
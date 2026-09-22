import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { Bell, Menu, Star, LogOut, Megaphone, Tag, MessageSquare } from 'lucide-react';

const KIND_ICON = {
  review:           Star,
  competitorReview: MessageSquare,
  content:          Megaphone,
  offer:            Tag,
};

// Intl does the pluralisation and Hebrew wording; we only pick the unit.
const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
const UNITS = [['day', 86400e3], ['hour', 3600e3], ['minute', 60e3]];
function timeAgo(ts) {
  const diff = ts - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'הרגע';
}

export default function TopBar({ badges = {}, notifications = [], onMenuClick, showMenuButton }) {
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const navigate = useNavigate();

  const unreadCount = notifications.filter((n) => n.unread).length;

  useEffect(() => {
    const handleClick = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 h-14 glass border-b border-white/40">
      <div className="h-full px-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showMenuButton && (
            <button onClick={onMenuClick} className="p-2 rounded-md hover:bg-secondary transition-colors lg:hidden">
              <Menu className="w-5 h-5 text-foreground" />
            </button>
          )}
          <button
            onClick={() => base44.auth.logout('/')}
            title="התנתק"
            className="p-1.5 rounded-md hover:bg-secondary transition-colors"
          >
            <LogOut className="w-4 h-4 text-foreground-muted hover:text-danger" />
          </button>
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          {/* Bell */}
          <div ref={bellRef} className="relative">
            <button
              onClick={() => setBellOpen(!bellOpen)}
              className="relative p-2 rounded-md hover:bg-secondary transition-colors"
            >
              <Bell className="w-5 h-5 text-foreground-muted" />
              {unreadCount > 0 && (
                <span className="absolute top-1 left-1 w-4 h-4 flex items-center justify-center text-[9px] font-bold bg-primary text-primary-foreground rounded-full">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute left-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-lg shadow-black/5 z-50 overflow-hidden fade-in-up" dir="rtl">
                <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-foreground">התראות</span>
                  {unreadCount > 0 && (
                    <span className="text-[10px] text-foreground-muted">{unreadCount} חדשות</span>
                  )}
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {notifications.map((n) => {
                    const Icon = KIND_ICON[n.kind] || Bell;
                    return (
                      <button
                        key={n.id}
                        onClick={() => { navigate(n.path); setBellOpen(false); }}
                        className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-secondary transition-colors text-right border-b border-border/50 last:border-0"
                      >
                        <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', n.unread ? 'text-primary' : 'text-foreground-muted')} />
                        <span className="flex-1 min-w-0">
                          <span className={cn('block text-[12px] truncate', n.unread ? 'text-foreground font-medium' : 'text-foreground-secondary')}>
                            {n.text}
                          </span>
                          <span className="block text-[10px] text-foreground-muted mt-0.5">{timeAgo(n.ts)}</span>
                        </span>
                        {n.unread && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                      </button>
                    );
                  })}
                  {notifications.length === 0 && (
                    <div className="px-3 py-6 text-center text-[11px] text-foreground-muted">אין התראות</div>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
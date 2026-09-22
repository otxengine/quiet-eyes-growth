import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Bell, Menu, Star, LogOut, Megaphone, Tag, MessageSquare } from 'lucide-react';

export default function TopBar({ badges = {}, onMenuClick, showMenuButton }) {
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const navigate = useNavigate();

  const notifItems = [
    { count: badges.pendingReviews    || 0, label: 'ביקורות ממתינות למענה',        icon: Star,           path: '/reviews'           },
    { count: badges.competitorContent || 0, label: 'פוסטים ומודעות חדשים של מתחרים', icon: Megaphone,      path: '/social-competition' },
    { count: badges.competitorOffers  || 0, label: 'מבצעים חדשים של מתחרים',        icon: Tag,            path: '/competitors-offers' },
    { count: badges.competitorReviews || 0, label: 'ביקורות חדשות על מתחרים',       icon: MessageSquare,  path: '/reviews/compare'    },
  ];
  const totalCount = notifItems.reduce((sum, i) => sum + i.count, 0);

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

        </div>
      </div>
    </header>
  );
}
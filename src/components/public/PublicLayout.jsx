import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { path: '/home', label: 'בית' },
  { path: '/features', label: 'תכונות' },
  { path: '/how-it-works', label: 'איך זה עובד' },
  { path: '/pricing', label: 'מחירים' },
  { path: '/about', label: 'אודות' },
];

export default function PublicLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.jpeg" alt="OTX" className="h-7 w-auto object-contain" />
            <span className="text-[15px] font-bold text-foreground">OTX</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map(l => (
              <Link key={l.path} to={l.path} className={`text-[13px] font-medium transition-colors ${location.pathname === l.path ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'}`}>{l.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => base44.auth.redirectToLogin()} className="hidden md:block px-5 py-2 rounded-lg bg-foreground text-background text-[12px] font-semibold hover:opacity-90 transition-all">התחבר</button>
            <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden p-2">
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="md:hidden border-t border-border px-6 py-4 space-y-3">
            {navLinks.map(l => (
              <Link key={l.path} to={l.path} onClick={() => setMobileOpen(false)} className="block text-[13px] font-medium text-foreground-secondary">{l.label}</Link>
            ))}
            <button onClick={() => base44.auth.redirectToLogin()} className="w-full py-2.5 rounded-lg bg-foreground text-background text-[12px] font-semibold">התחבר</button>
          </div>
        )}
      </header>

      {/* Content */}
      <main className="flex-1"><Outlet /></main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8 bg-secondary/30">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.jpeg" alt="OTX" className="h-4 w-auto object-contain opacity-60" />
            <span className="text-[12px] text-foreground-muted">OTX © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-4">
            <Link to="/terms" className="text-[11px] text-foreground-muted hover:text-foreground">תנאי שימוש</Link>
            <Link to="/privacy" className="text-[11px] text-foreground-muted hover:text-foreground">פרטיות</Link>
            <Link to="/contact" className="text-[11px] text-foreground-muted hover:text-foreground">צור קשר</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
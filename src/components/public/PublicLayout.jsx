import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Menu, X } from 'lucide-react';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';

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
    <div className="min-h-screen flex flex-col" style={{ background: '#0A0A0F' }}>
      {/* Nav */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: 'rgba(10,10,15,0.92)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.jpeg" alt="Cortexi" className="h-7 w-auto object-contain" />
            <span className="text-[15px] font-bold text-white">Cortexi</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map(l => (
              <Link
                key={l.path}
                to={l.path}
                className="text-[13px] font-medium transition-colors"
                style={{ color: location.pathname === l.path ? '#ffffff' : 'rgba(255,255,255,0.6)' }}
                onMouseEnter={e => (e.target.style.color = '#ffffff')}
                onMouseLeave={e => (e.target.style.color = location.pathname === l.path ? '#ffffff' : 'rgba(255,255,255,0.6)')}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="hidden md:block px-5 py-2 rounded-lg text-[12px] font-semibold text-white transition-all hover:opacity-90"
              style={{ background: G }}
            >
              התחבר
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2"
              style={{ color: 'rgba(255,255,255,0.7)' }}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div
            className="md:hidden px-6 py-4 space-y-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(10,10,15,0.98)' }}
          >
            {navLinks.map(l => (
              <Link
                key={l.path}
                to={l.path}
                onClick={() => setMobileOpen(false)}
                className="block text-[13px] font-medium"
                style={{ color: 'rgba(255,255,255,0.7)' }}
              >
                {l.label}
              </Link>
            ))}
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="w-full py-2.5 rounded-lg text-[12px] font-semibold text-white"
              style={{ background: G }}
            >
              התחבר
            </button>
          </div>
        )}
      </header>

      {/* Content */}
      <main className="flex-1"><Outlet /></main>

      {/* Footer */}
      <footer style={{ background: '#0A0A0F', borderTop: '1px solid rgba(255,255,255,0.07)' }} className="px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <img src="/logo.jpeg" alt="Cortexi" className="h-4 w-auto object-contain opacity-70" />
              <span className="text-[13px] font-bold text-white">Cortexi</span>
            </div>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Inspired by the brain. Built for intelligence.</p>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>© 2026 Cortexi</p>
          </div>
          <div className="flex gap-4">
            <Link to="/terms" className="text-[11px] transition-colors" style={{ color: 'rgba(255,255,255,0.45)' }}>תנאי שימוש</Link>
            <Link to="/privacy" className="text-[11px] transition-colors" style={{ color: 'rgba(255,255,255,0.45)' }}>פרטיות</Link>
            <Link to="/contact" className="text-[11px] transition-colors" style={{ color: 'rgba(255,255,255,0.45)' }}>צור קשר</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

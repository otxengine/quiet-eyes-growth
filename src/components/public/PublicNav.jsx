import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Menu, X, Eye } from 'lucide-react';

const navLinks = [
  { path: '/', label: 'דף הבית' },
  { path: '/how-it-works', label: 'איך זה עובד' },
  { path: '/features', label: 'תכונות' },
  { path: '/pricing', label: 'תמחור' },
  { path: '/about', label: 'אודות' },
];

export default function PublicNav() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <nav aria-label="ניווט ראשי" className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-md border-b border-[#f0f0f0]' : 'bg-transparent'}`}>
      <div className="max-w-[1120px] mx-auto px-5 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-[#777]" />
          <span className="text-[16px] font-bold text-[#111]">Quiet<span className="text-[#10b981]">Eyes</span></span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map(link => (
            <Link key={link.path} to={link.path}
              className={`text-[13px] transition-colors ${location.pathname === link.path ? 'text-[#111] font-semibold' : 'text-[#999] hover:text-[#111]'}`}>
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <button onClick={() => base44.auth.redirectToLogin('/')} className="text-[13px] text-[#555] px-4 py-2 rounded-lg border border-[#ddd] hover:border-[#999] hover:text-[#111] transition-all">
            התחבר
          </button>
          <button onClick={() => base44.auth.redirectToLogin('/onboarding')} className="text-[13px] font-medium text-white bg-[#111] px-4 py-2 rounded-lg hover:bg-[#333] transition-all">
            התחל בחינם
          </button>
        </div>

        {/* Mobile burger */}
        <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden p-2">
          {mobileOpen ? <X className="w-5 h-5 text-[#111]" /> : <Menu className="w-5 h-5 text-[#111]" />}
        </button>
      </div>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 top-16 bg-white z-50 flex flex-col p-8 gap-4">
          {navLinks.map(link => (
            <Link key={link.path} to={link.path}
              className={`text-[18px] py-2 ${location.pathname === link.path ? 'text-[#111] font-semibold' : 'text-[#777]'}`}>
              {link.label}
            </Link>
          ))}
          <div className="mt-6 flex flex-col gap-3">
            <button onClick={() => base44.auth.redirectToLogin('/')} className="text-[14px] text-[#555] px-4 py-3 rounded-lg border border-[#ddd] text-center">התחבר</button>
            <button onClick={() => base44.auth.redirectToLogin('/onboarding')} className="text-[14px] font-medium text-white bg-[#111] px-4 py-3 rounded-lg text-center">התחל בחינם</button>
          </div>
        </div>
      )}
    </nav>
  );
}
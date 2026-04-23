import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const navLinks = [
  { label: 'דף הבית', path: '/' },
  { label: 'איך זה עובד', path: '/how-it-works' },
  { label: 'תכונות', path: '/features' },
  { label: 'תמחור', path: '/pricing' },
  { label: 'אודות', path: '/about' },
];

export default function PublicNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-[12px] border-b border-[#f0f0f0]" style={{ padding: '12px 40px' }}>
      <div className="max-w-[1200px] mx-auto flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <img src="/logo.jpeg" alt="OTX" className="h-7 w-auto object-contain" />
          <span className="text-[14.5px] font-bold text-[#111111]">OTX</span>
        </Link>

        {/* Center nav — desktop */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`text-[13px] font-medium transition-colors ${
                location.pathname === link.path ? 'text-[#111111]' : 'text-[#999999] hover:text-[#111111]'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* CTA buttons — desktop */}
        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-4 py-2 text-[13px] font-medium text-[#666666] border border-[#dddddd] rounded-[6px] hover:border-[#bbbbbb] transition-colors"
          >
            התחבר
          </button>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-4 py-2 text-[13px] font-medium text-white bg-[#111111] rounded-[6px] hover:bg-[#333333] transition-colors"
          >
            התחל בחינם
          </button>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-5 h-5 text-[#666666]" /> : <Menu className="w-5 h-5 text-[#666666]" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#f0f0f0] mt-3 pt-4 pb-4 px-2 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMobileOpen(false)}
              className={`block py-2.5 px-3 rounded-md text-[14px] font-medium transition-colors ${
                location.pathname === link.path ? 'text-[#111111] bg-[#f5f5f5]' : 'text-[#999999] hover:text-[#111111]'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="flex gap-2 pt-3 px-3">
            <button onClick={() => base44.auth.redirectToLogin()} className="flex-1 py-2.5 text-[13px] font-medium text-[#666666] border border-[#dddddd] rounded-[6px]">התחבר</button>
            <button onClick={() => base44.auth.redirectToLogin()} className="flex-1 py-2.5 text-[13px] font-medium text-white bg-[#111111] rounded-[6px]">התחל בחינם</button>
          </div>
        </div>
      )}
    </nav>
  );
}
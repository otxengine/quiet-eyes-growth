import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const ADMIN_EMAILS = ['contact@otxengine.io'];
const ADMIN_DOMAINS = ['@otx.ai', '@quieteyes.ai'];

function checkIsAdmin(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return ADMIN_EMAILS.includes(e) || ADMIN_DOMAINS.some(d => e.endsWith(d));
}

export default function AdminLayout() {
  const { user, isLoadingAuth, logout } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!checkIsAdmin(user?.email)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="h-12 border-b border-border flex items-center justify-between px-6 bg-background">
        <span className="text-[12px] font-bold text-foreground tracking-tight">OTX Admin</span>
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-foreground-muted">{user?.email}</span>
          <button
            onClick={() => logout()}
            className="text-[11px] text-foreground-muted hover:text-foreground transition-colors"
          >
            התנתק
          </button>
        </div>
      </header>
      <main className="px-4 md:px-6 py-4">
        <Outlet />
      </main>
    </div>
  );
}

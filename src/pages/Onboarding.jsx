import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import OnboardingForm from '@/components/onboarding/OnboardingForm';
import OnboardingScanning from '@/components/onboarding/OnboardingScanning';
import OnboardingInsights from '@/components/onboarding/OnboardingInsights';

const ADMIN_EMAILS = ['contact@otxenginee.io'];
const ADMIN_DOMAINS = ['@otx.ai', '@quieteyes.ai'];

function isAdminEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return ADMIN_EMAILS.includes(e) || ADMIN_DOMAINS.some(d => e.endsWith(d));
}

export default function Onboarding() {
  const { user, isLoadingAuth, logout } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (isAdminEmail(user?.email)) {
    return <Navigate to="/admin-dashboard" replace />;
  }

  return (
    <>
      {/* Emergency logout */}
      <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 9999 }}>
        <button
          onClick={() => logout()}
          style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          התנתק
        </button>
      </div>
      <Routes>
        <Route index element={<OnboardingForm />} />
        <Route path="scanning" element={<OnboardingScanning />} />
        <Route path="insights" element={<OnboardingInsights />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    </>
  );
}
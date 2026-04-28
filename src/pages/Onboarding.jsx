import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import OnboardingForm from '@/components/onboarding/OnboardingForm';
import OnboardingScanning from '@/components/onboarding/OnboardingScanning';
import OnboardingInsights from '@/components/onboarding/OnboardingInsights';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

const ADMIN_EMAILS = ['contact@otxenginee.io'];
const ADMIN_DOMAINS = ['@otx.ai', '@quieteyes.ai'];

function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email) || ADMIN_DOMAINS.some(d => email.endsWith(d));
}

export default function Onboarding() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 60_000,
    retry: 2,
  });

  // Wait for user to load before checking admin status
  if (isLoading) {
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
      {/* Emergency logout for stuck users */}
      <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 9999 }}>
        <button
          onClick={() => base44.auth.logout('/')}
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
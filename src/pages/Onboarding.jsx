import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import OnboardingForm from '@/components/onboarding/OnboardingForm';
import OnboardingScanning from '@/components/onboarding/OnboardingScanning';
import OnboardingApproveIdentity from '@/components/onboarding/OnboardingApproveIdentity';
import OnboardingInsights from '@/components/onboarding/OnboardingInsights';

export default function Onboarding() {
  const { isLoadingAuth, logout } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/50">
        <div className="w-8 h-8 border-4 border-border border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
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
        <Route path="approve-identity" element={<OnboardingApproveIdentity />} />
        <Route path="insights" element={<OnboardingInsights />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    </>
  );
}
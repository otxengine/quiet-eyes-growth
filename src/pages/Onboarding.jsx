import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import OnboardingForm from '@/components/onboarding/OnboardingForm';
import OnboardingScanning from '@/components/onboarding/OnboardingScanning';
import OnboardingInsights from '@/components/onboarding/OnboardingInsights';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

function useIsAdmin() {
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me(), staleTime: 60_000 });
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || user?.email || '';
    return email === 'contact@otxenginee.io' || email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai');
  } catch { return false; }
}

export default function Onboarding() {
  const isAdmin = useIsAdmin();
  if (isAdmin) return <Navigate to="/admin-dashboard" replace />;

  return (
    <Routes>
      <Route index element={<OnboardingForm />} />
      <Route path="scanning" element={<OnboardingScanning />} />
      <Route path="insights" element={<OnboardingInsights />} />
      <Route path="*" element={<Navigate to="/onboarding" replace />} />
    </Routes>
  );
}
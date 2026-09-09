import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { reactivationApi } from '@/api/orgApi';
import OnboardingForm from '@/components/onboarding/OnboardingForm';
import ReactivationChoice from '@/components/onboarding/ReactivationChoice';
import OnboardingSelectPlan from '@/components/onboarding/OnboardingSelectPlan';
import OnboardingScanning from '@/components/onboarding/OnboardingScanning';
import OnboardingApproveIdentity from '@/components/onboarding/OnboardingApproveIdentity';
import OnboardingDiscoverCompetitors from '@/components/onboarding/OnboardingDiscoverCompetitors';
import OnboardingInsights from '@/components/onboarding/OnboardingInsights';

function OnboardingIndex() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState(null); // null = loading
  const [startFresh, setStartFresh] = useState(false);

  useEffect(() => {
    reactivationApi.getCandidates()
      .then(setCandidates)
      .catch(() => setCandidates([])); // fail open — just show the normal form
  }, []);

  if (candidates === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/50">
        <div className="w-8 h-8 border-4 border-border border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (candidates.length > 0 && !startFresh) {
    return (
      <ReactivationChoice
        candidates={candidates}
        onReactivated={() => navigate('/')}
        onStartFresh={() => setStartFresh(true)}
      />
    );
  }

  return <OnboardingForm />;
}

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
        <Route index element={<OnboardingIndex />} />
        <Route path="select-plan" element={<OnboardingSelectPlan />} />
        <Route path="scanning" element={<OnboardingScanning />} />
        <Route path="approve-identity" element={<OnboardingApproveIdentity />} />
        <Route path="discover-competitors" element={<OnboardingDiscoverCompetitors />} />
        <Route path="insights" element={<OnboardingInsights />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    </>
  );
}

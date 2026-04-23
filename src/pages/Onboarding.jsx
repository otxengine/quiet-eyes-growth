import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import OnboardingForm from '@/components/onboarding/OnboardingForm';
import OnboardingScanning from '@/components/onboarding/OnboardingScanning';
import OnboardingInsights from '@/components/onboarding/OnboardingInsights';

export default function Onboarding() {
  return (
    <Routes>
      <Route index element={<OnboardingForm />} />
      <Route path="scanning" element={<OnboardingScanning />} />
      <Route path="insights" element={<OnboardingInsights />} />
      <Route path="*" element={<Navigate to="/onboarding" replace />} />
    </Routes>
  );
}
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import IdentityApprovalScreen from '@/components/identity/IdentityApprovalScreen';
import KoriAvatar from './KoriAvatar';

const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

export default function OnboardingApproveIdentity() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state;
  const businessProfile = state?.businessProfile;

  if (!businessProfile) { navigate('/onboarding'); return null; }

  const continueOn = () => navigate('/onboarding/insights', { state });

  return (
    <div dir="rtl" className="min-h-screen py-8 px-4" style={BG_STYLE}>
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center pb-2">
          <KoriAvatar size="md" className="mx-auto mb-4 shadow-md" />
          <h1 className="text-[20px] font-bold text-gray-900 mb-1">בוא נוודא שהבנו נכון</h1>
          <p className="text-[13px] text-gray-500">קורי ניסח את הזהות העסקית שלך — בדוק ואשר לפני שממשיכים</p>
        </div>

        <IdentityApprovalScreen
          businessProfileId={businessProfile.id}
          onApproved={continueOn}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  );
}

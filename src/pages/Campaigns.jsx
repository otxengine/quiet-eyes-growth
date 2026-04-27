import React from 'react';
import { useOutletContext } from 'react-router-dom';
import CampaignPlanner from '@/components/ui/CampaignPlanner';

export default function Campaigns() {
  const { businessProfile } = useOutletContext();

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto" dir="rtl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">תכנון קמפיין ממומן</h1>
        <p className="text-sm text-foreground-muted mt-1">
          תחזית ביצועים, טרגטינג מוכן להדבקה ותמחור לפי שוק ישראל
        </p>
      </div>
      <CampaignPlanner businessProfile={businessProfile} />
    </div>
  );
}

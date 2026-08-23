import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import IdentityApprovalScreen from '@/components/identity/IdentityApprovalScreen';

export default function SettingsLearnBusiness({ businessProfile, onApproved }) {
  const [refreshing, setRefreshing] = useState(false);
  const [screenKey, setScreenKey] = useState(0);

  const handleRefresh = async () => {
    if (!businessProfile?.id) return;
    setRefreshing(true);
    try {
      const res = await base44.raw.post('/onboarding/generate-about', { businessProfileId: businessProfile.id });
      if (res.needs_seed) {
        toast.error(res.prompt || 'צריך עוד מידע כדי לייצר טיוטה');
      } else if (res.ok) {
        setScreenKey(k => k + 1);
        toast.success('טיוטה חדשה נוצרה — בדוק ואשר');
      } else {
        toast.error(res.error || 'יצירת הטיוטה נכשלה');
      }
    } catch (err) {
      toast.error('שגיאה: ' + (err.message || 'נסה שוב'));
    } finally {
      setRefreshing(false);
    }
  };

  if (!businessProfile?.id) return null;

  return (
    <div className="space-y-3">
      <div className="card-base p-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">תיאור העסק</h2>
          <p className="text-[11px] text-foreground-muted mt-0.5">רענן את הזהות העסקית על סמך הערוצים המחוברים</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          רענן תיאור העסק
        </button>
      </div>
      <IdentityApprovalScreen
        key={screenKey}
        businessProfileId={businessProfile.id}
        onApproved={onApproved}
      />
    </div>
  );
}

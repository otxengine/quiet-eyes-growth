import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Share2, Plus, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import SocialAccountCard from '@/components/social/SocialAccountCard';
import SocialSignalsList from '@/components/social/SocialSignalsList';

const platforms = ['facebook', 'instagram', 'tiktok'];
const platformLabels = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

export default function SocialConnections() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [syncingAll, setSyncingAll] = useState(false);

  const queryClient = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ['socialAccounts', bpId],
    queryFn: () => base44.entities.SocialAccount.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const connectedPlatforms = accounts.map(a => a.platform);
  const unconnectedPlatforms = platforms.filter(p => !connectedPlatforms.includes(p));

  const handleAddPlatform = async (platform) => {
    await base44.entities.SocialAccount.create({
      linked_business: bpId,
      platform,
      account_name: '',
      access_token: '',
      is_connected: false,
    });
    queryClient.invalidateQueries({ queryKey: ['socialAccounts', bpId] });
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      await base44.functions.invoke('fetchSocialData', { businessProfileId: bpId });
      toast.success('כל החשבונות סונכרנו');
    } catch (err) {
      toast.error('שגיאה בסנכרון');
    }
    setSyncingAll(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">חיבור רשתות חברתיות</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">חבר את חשבונות הרשתות החברתיות שלך כדי למשוך נתונים ישירות</p>
        </div>
        {accounts.some(a => a.access_token) && (
          <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncingAll} className="text-[11px]">
            {syncingAll ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <RefreshCw className="w-3 h-3 ml-1" />}
            סנכרן הכל
          </Button>
        )}
      </div>

      {/* How it works */}
      <div className="card-base p-5">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">איך זה עובד?</h3>
        <ol className="text-[11px] text-foreground-muted space-y-1.5 list-decimal list-inside">
          <li>הוסף Access Token של הרשת החברתית (מה-Developer Console של כל פלטפורמה)</li>
          <li>ציין את מזהה העמוד / חשבון</li>
          <li>לחץ "סנכרן" כדי למשוך פוסטים, לייקים ותגובות</li>
          <li>הנתונים יופיעו כאן ויזינו את מנוע ה-OSINT שלך</li>
        </ol>
      </div>

      {/* Connected accounts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map(account => (
          <SocialAccountCard key={account.id} account={account} businessProfileId={bpId} />
        ))}
      </div>

      {/* Add new platform */}
      {unconnectedPlatforms.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">הוסף פלטפורמה</h3>
          <div className="flex gap-3">
            {unconnectedPlatforms.map(p => (
              <button
                key={p}
                onClick={() => handleAddPlatform(p)}
                className="card-base p-4 flex items-center gap-2.5 hover:border-primary/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 text-primary" />
                <span className="text-[12px] font-medium text-foreground">{platformLabels[p]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Social Signals List */}
      <SocialSignalsList businessProfileId={bpId} />
    </div>
  );
}
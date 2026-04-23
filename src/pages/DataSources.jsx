import React, { useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Search, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import KeywordsSection from '@/components/data-sources/KeywordsSection';
import UrlsSection from '@/components/data-sources/UrlsSection';
import CompetitorsSection from '@/components/data-sources/CompetitorsSection';
import AiInsightBox from '@/components/ai/AiInsightBox';

export default function DataSources() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);

  const { data: competitors = [], isLoading: loadingComp } = useQuery({
    queryKey: ['dsCompetitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const keywords = (businessProfile?.custom_keywords || '').split(',').map(k => k.trim()).filter(Boolean);
  const urls = (businessProfile?.custom_urls || '').split('\n').map(u => u.trim()).filter(Boolean);

  const saveKeywords = useCallback(async (newKeywords) => {
    await base44.entities.BusinessProfile.update(bpId, { custom_keywords: newKeywords.join(', ') });
    queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
    toast.success('מילות מפתח עודכנו');
  }, [bpId, queryClient]);

  const saveUrls = useCallback(async (newUrls) => {
    await base44.entities.BusinessProfile.update(bpId, { custom_urls: newUrls.join('\n') });
    queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
    toast.success('מקורות מידע עודכנו');
  }, [bpId, queryClient]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await base44.functions.invoke('autoConfigOsint', { businessProfileId: bpId });
      const { keywords_count = 0, urls_count = 0, competitors_created = 0 } = res?.data || res || {};
      // FIX 8: force refetch so the page shows updated keywords/URLs from context
      await queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
      await queryClient.refetchQueries({ queryKey: ['businessProfiles'] });
      queryClient.invalidateQueries({ queryKey: ['dsCompetitors'] });
      toast.success(`עודכן: ${keywords_count} מילות מפתח, ${urls_count} מקורות, ${competitors_created} מתחרים חדשים`);
    } catch (err) {
      toast.error('שגיאה: ' + err.message);
    }
    setRegenerating(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">מקורות מידע</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">מילות מפתח, מקורות ומתחרים — הוגדרו אוטומטית ע״י AI. ערוך והתאם לפי הצורך.</p>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50"
        >
          {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {regenerating ? 'מנתח מחדש...' : 'צור מחדש עם AI'}
        </button>
      </div>

      {keywords.length === 0 && urls.length === 0 && competitors.length === 0 && !regenerating ? (
        <div className="card-base py-16 text-center">
          <Search className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
          <p className="text-[13px] text-foreground-muted mb-4">עדיין לא הוגדרו מקורות מידע</p>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="btn-subtle px-5 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all"
          >
            <Sparkles className="w-4 h-4 inline ml-1.5" /> צור אוטומטית עם AI
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <KeywordsSection keywords={keywords} onSave={saveKeywords} />
          <UrlsSection urls={urls} onSave={saveUrls} />
          <CompetitorsSection competitors={competitors} bpId={bpId} />
          <AiInsightBox
            title="ניתוח מקורות המידע — המלצות AI"
            prompt={`אתה יועץ אסטרטגיית מידע לעסק ישראלי.
עסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
מילות מפתח פעילות (${keywords.length}): ${keywords.slice(0, 15).join(', ')}.
מקורות מידע (${urls.length}): ${urls.slice(0, 8).join(', ')}.
מתחרים שנצפים (${competitors.length}): ${competitors.map(c => c.name).slice(0, 5).join(', ')}.

1) האם מילות המפתח מכסות את כל תחומי הפעילות של העסק? אילו מילות מפתח חסרות?
2) האם מקורות המידע רלוונטיים לענף ולאזור הגיאוגרפי? מה כדאי להוסיף?
3) האם רשימת המתחרים מלאה? מי עשוי להיות מתחרה שלא נצפה?
4) המלץ על 3 שיפורים קונקרטיים להגדרת מקורות המידע.
בעברית, Markdown, ממוקד ופרקטי.`}
          />
        </div>
      )}
    </div>
  );
}
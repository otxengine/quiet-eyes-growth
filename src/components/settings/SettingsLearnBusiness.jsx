import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Globe, Loader2, CheckCircle, BookOpen, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const typeLabels = {
  services: '🛠️ שירותים',
  pricing: '💰 מחירון',
  faq: '❓ שאלות נפוצות',
  about: '📋 אודות',
  testimonials: '⭐ המלצות',
  general: '📝 כללי',
};

export default function SettingsLearnBusiness({ businessProfile }) {
  const [scanning, setScanning] = useState(false);
  const [knowledge, setKnowledge] = useState([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (businessProfile?.channels_website) {
      let siteUrl = businessProfile.channels_website;
      if (!siteUrl.startsWith('http')) siteUrl = 'https://' + siteUrl;
      setUrl(siteUrl);
    }
    loadKnowledge();
  }, [businessProfile]);

  const loadKnowledge = async () => {
    if (!businessProfile?.id) { setLoading(false); return; }
    const items = await base44.entities.BusinessKnowledge.filter({ linked_business: businessProfile.id });
    setKnowledge(items);
    setLoading(false);
  };

  const handleScan = async () => {
    if (!url) { toast.error('הזן כתובת אתר קודם'); return; }
    setScanning(true);
    const res = await base44.functions.invoke('learnFromWebsite', {
      businessProfileId: businessProfile?.id || '',
      websiteUrl: url.startsWith('http') ? url : 'https://' + url,
    });
    setScanning(false);
    if (res.data?.success) {
      toast.success(`נסרקו ${res.data.pages_scanned} עמודים — נוצרו ${res.data.knowledge_items_created} פריטי ידע`);
      loadKnowledge();
    } else {
      toast.error('שגיאה בסריקה: ' + (res.data?.error || 'לא ידוע'));
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.BusinessKnowledge.delete(id);
    setKnowledge(k => k.filter(item => item.id !== id));
    toast.success('פריט ידע נמחק');
  };

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-[#eef2ff] flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-[#6366f1]" />
        </div>
        <div>
          <h2 className="text-[14px] font-semibold text-[#222222]">למידת עסק אוטומטית</h2>
          <p className="text-[11px] text-[#999999]">סרוק את האתר שלך כדי שהבוט ילמד על השירותים, המחירים וערכי המותג</p>
        </div>
      </div>

      {/* URL input + scan button */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.example.co.il"
          dir="ltr"
          className="flex-1 bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2.5 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]"
        />
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-semibold bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-colors disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          {scanning ? 'סורק...' : 'סרוק אתר'}
        </button>
      </div>

      {scanning && (
        <div className="bg-[#eef2ff] border border-[#c7d2fe] rounded-lg p-3 text-center">
          <Loader2 className="w-5 h-5 animate-spin text-[#6366f1] mx-auto mb-1" />
          <p className="text-[12px] text-[#6366f1] font-medium">סורק את כל עמודי האתר ומחלץ ידע...</p>
          <p className="text-[10px] text-[#6366f1]/60">זה יכול לקחת עד דקה</p>
        </div>
      )}

      {/* Knowledge items */}
      {loading ? (
        <div className="text-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#999999] mx-auto" /></div>
      ) : knowledge.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#666666]">
              <CheckCircle className="w-3.5 h-3.5 inline text-[#10b981] ml-1" />
              {knowledge.length} פריטי ידע נלמדו
            </span>
            <button onClick={handleScan} disabled={scanning}
              className="flex items-center gap-1 text-[10px] text-[#6366f1] hover:underline">
              <RefreshCw className="w-3 h-3" /> סרוק מחדש
            </button>
          </div>
          {knowledge.map((item) => (
            <div key={item.id} className="bg-[#fafafa] border border-[#f0f0f0] rounded-lg p-3 group">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] bg-[#eef2ff] text-[#6366f1] px-2 py-0.5 rounded-full font-medium">
                      {typeLabels[item.knowledge_type] || '📝 כללי'}
                    </span>
                    {item.confidence && (
                      <span className="text-[10px] text-[#aaaaaa]">{item.confidence}% ביטחון</span>
                    )}
                  </div>
                  <h3 className="text-[13px] font-medium text-[#222222]">{item.title}</h3>
                  <p className="text-[11px] text-[#888888] mt-0.5 line-clamp-2">{item.content}</p>
                </div>
                <button onClick={() => handleDelete(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-[#cccccc] hover:text-[#dc2626] transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-[#cccccc]">
          <Globe className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-[12px]">עדיין לא נלמד מידע — הזן כתובת אתר ולחץ "סרוק אתר"</p>
        </div>
      )}
    </div>
  );
}
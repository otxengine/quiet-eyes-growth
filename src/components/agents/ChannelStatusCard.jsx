import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';

const channelDefs = [
  { key: 'whatsapp', label: 'WhatsApp', icon: '💬', activeColor: 'bg-[#dcfce7] border-[#bbf7d0]' },
  { key: 'instagram', label: 'Instagram', icon: '📸', activeColor: 'bg-[#fce7f3] border-[#fbcfe8]' },
  { key: 'facebook', label: 'Facebook', icon: '👤', activeColor: 'bg-[#dbeafe] border-[#bfdbfe]' },
  { key: 'tiktok', label: 'TikTok', icon: '🎵', activeColor: 'bg-[#f3e8ff] border-[#e9d5ff]' },
  { key: 'website', label: 'אתר', icon: '🌐', activeColor: 'bg-[#f0fdf4] border-[#dcfce7]' },
];

export default function ChannelStatusCard({ businessProfile }) {
  const navigate = useNavigate();

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold text-foreground">ערוצים מחוברים</h3>
        <button onClick={() => navigate('/settings')}
          className="text-[10px] text-foreground-muted hover:text-foreground flex items-center gap-1.5 font-medium transition-colors">
          <Settings className="w-3 h-3" /> הגדר
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {channelDefs.map((ch) => {
          const isEnabled = businessProfile?.[`channels_${ch.key}_enabled`] === true;
          return (
            <div key={ch.key}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-medium transition-all duration-150 ${
                isEnabled
                  ? `${ch.activeColor} text-foreground`
                  : 'bg-secondary border-border text-foreground-muted opacity-40'
              }`}>
              <span>{ch.icon}</span>
              <span>{ch.label}</span>
              {isEnabled && <span className="w-1.5 h-1.5 rounded-full bg-success" />}
            </div>
          );
        })}
      </div>
      {channelDefs.every(ch => !businessProfile?.[`channels_${ch.key}_enabled`]) && (
        <p className="text-[11px] text-foreground-muted mt-3 opacity-50">עדיין לא חיברת ערוצים — עבור להגדרות כדי להפעיל</p>
      )}
    </div>
  );
}
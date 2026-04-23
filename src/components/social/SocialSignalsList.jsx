import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Heart, MessageCircle, Share2, Eye, Video, Image, FileText } from 'lucide-react';
import moment from 'moment';

const mediaIcons = {
  video: Video, reel: Video, image: Image, carousel: Image, text: FileText, story: Video,
};

const platformColors = {
  facebook: 'bg-blue-50 text-blue-600',
  instagram: 'bg-pink-50 text-pink-600',
  tiktok: 'bg-gray-50 text-foreground',
};

export default function SocialSignalsList({ businessProfileId }) {
  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['socialSignals', businessProfileId],
    queryFn: () => base44.entities.SocialSignal.filter({ linked_business: businessProfileId }, '-fetched_at', 50),
    enabled: !!businessProfileId,
  });

  if (isLoading) {
    return <div className="py-8 text-center text-[12px] text-foreground-muted">טוען נתונים...</div>;
  }

  if (signals.length === 0) {
    return (
      <div className="card-base p-8 text-center">
        <p className="text-[13px] text-foreground-muted mb-1">אין נתונים חברתיים עדיין</p>
        <p className="text-[11px] text-foreground-muted opacity-60">חבר חשבון רשת חברתית ולחץ "סנכרן" כדי למשוך נתונים</p>
      </div>
    );
  }

  return (
    <div className="card-base overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border">
        <h3 className="font-semibold text-foreground text-[13px]">פוסטים אחרונים</h3>
        <p className="text-[10px] text-foreground-muted mt-0.5">{signals.length} פוסטים נמשכו</p>
      </div>
      <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
        {signals.map(signal => {
          const MediaIcon = mediaIcons[signal.media_type] || FileText;
          const pColor = platformColors[signal.platform] || 'bg-secondary text-foreground-muted';
          return (
            <div key={signal.id} className="px-5 py-3.5 hover:bg-secondary/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${pColor}`}>
                  <MediaIcon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${pColor}`}>{signal.platform}</span>
                    {signal.post_date && (
                      <span className="text-[9px] text-foreground-muted">{moment(signal.post_date).format('DD/MM/YY HH:mm')}</span>
                    )}
                  </div>
                  <p className="text-[12px] text-foreground leading-relaxed line-clamp-2">{signal.content || '(ללא טקסט)'}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <Heart className="w-3 h-3" /> {signal.likes || 0}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <MessageCircle className="w-3 h-3" /> {signal.comments || 0}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <Share2 className="w-3 h-3" /> {signal.shares || 0}
                    </span>
                    {signal.views > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                        <Eye className="w-3 h-3" /> {signal.views.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                {signal.post_url && (
                  <a href={signal.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex-shrink-0">
                    צפה
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
import React from 'react';
import { Star } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= rating ? 'text-warning fill-warning' : 'text-foreground-muted'}`}
        />
      ))}
    </div>
  );
}

function borderColor(sentiment) {
  if (sentiment === 'negative') return 'border-r-danger';
  if (sentiment === 'positive') return 'border-r-success';
  return 'border-r-warning';
}

export default function PendingReviews({ reviews = [] }) {
  const pendingCount = reviews.length;

  return (
    <div className="bg-background-card rounded-lg border border-border">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Star className="w-4 h-4 text-warning" />
        <h3 className="font-semibold text-foreground">ביקורות דורשות תגובה</h3>
        {pendingCount > 0 && (
          <span className="px-2 py-0.5 text-xs font-medium bg-danger/15 text-danger rounded-full mr-auto">
            {pendingCount} ממתינות
          </span>
        )}
      </div>
      {pendingCount === 0 ? (
        <div className="p-8 text-center text-sm text-foreground-muted">
          אין ביקורות ממתינות — מצוין! 🎉
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {reviews.slice(0, 4).map((review) => (
            <div 
              key={review.id}
              className={`bg-background-surface rounded-lg border border-border p-4 border-r-4 ${borderColor(review.sentiment)}`}
            >
              <div className="flex items-center justify-between mb-2">
                <StarRating rating={review.rating} />
                <span className="px-2 py-0.5 text-[10px] bg-secondary text-foreground-muted rounded">
                  {review.platform}
                </span>
              </div>
              <div className="flex items-center gap-1 mb-2 text-xs text-foreground-muted">
                <span>{review.reviewer_name}</span>
                <span>·</span>
                <span>{timeAgo(review.created_at || review.created_date)}</span>
              </div>
              <p className="text-[13px] text-foreground-secondary line-clamp-3 mb-3">
                {review.text}
              </p>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-xs font-medium bg-primary/15 text-primary rounded-md hover:bg-primary/25 transition-colors">
                  הצע תגובה
                </button>
                <button className="px-3 py-1.5 text-xs font-medium bg-secondary text-foreground-muted rounded-md hover:bg-secondary/80 transition-colors">
                  אחר כך
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
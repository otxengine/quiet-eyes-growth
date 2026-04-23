import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Clock, Send, X } from 'lucide-react';
import { toast } from 'sonner';

function timeUntil(dateStr) {
  if (!dateStr) return '';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'מוכן לשליחה';
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `בעוד ${hours} שעות`;
  return `בעוד ${Math.floor(hours / 24)} ימים`;
}

export default function ScheduledReviewRequests({ bpId }) {
  const queryClient = useQueryClient();

  const { data: alerts = [] } = useQuery({
    queryKey: ['scheduledReviewRequests', bpId],
    queryFn: () => base44.entities.PendingAlert.filter({ linked_business: bpId, alert_type: 'review_request', is_sent: false }, '-created_date', 20),
    enabled: !!bpId,
  });

  const markSent = useMutation({
    mutationFn: (id) => base44.entities.PendingAlert.update(id, { is_sent: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scheduledReviewRequests'] }); toast.success('✓ נשלח'); },
  });

  const cancel = useMutation({
    mutationFn: (id) => base44.entities.PendingAlert.update(id, { is_sent: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scheduledReviewRequests'] }); toast.success('✓ בוטל'); },
  });

  if (alerts.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-foreground-muted" />
        בקשות ביקורת מתוזמנות ({alerts.length})
      </h3>
      <div className="space-y-2">
        {alerts.map((alert) => (
          <div key={alert.id} className="card-base p-3 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-medium text-foreground block">{alert.customer_name || 'לקוח'}</span>
              <span className="text-[10px] text-foreground-muted">{timeUntil(alert.trigger_date)}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => { if (alert.whatsapp_url) window.open(alert.whatsapp_url, '_blank'); markSent.mutate(alert.id); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[10px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
                <Send className="w-3 h-3" /> שלח עכשיו
              </button>
              <button onClick={() => cancel.mutate(alert.id)}
                className="p-1.5 rounded-md text-[#cccccc] hover:text-[#999999] hover:bg-secondary transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
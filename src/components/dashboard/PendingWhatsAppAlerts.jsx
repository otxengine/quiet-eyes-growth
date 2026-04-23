import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Bell, ExternalLink } from 'lucide-react';

export default function PendingWhatsAppAlerts({ bpId }) {
  const queryClient = useQueryClient();
  const { data: alerts = [] } = useQuery({
    queryKey: ['pendingWhatsAppAlerts', bpId],
    queryFn: () => base44.entities.PendingAlert.filter({ linked_business: bpId, is_sent: false }, '-created_date', 10),
    enabled: !!bpId,
  });

  const markSent = useMutation({
    mutationFn: (id) => base44.entities.PendingAlert.update(id, { is_sent: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pendingWhatsAppAlerts'] }),
  });

  if (alerts.length === 0) return null;

  const handleSend = (alert) => {
    if (alert.whatsapp_url) {
      window.open(alert.whatsapp_url, '_blank');
    }
    markSent.mutate(alert.id);
  };

  return (
    <div className="card-base p-4 border-l-2 border-l-[#d97706] mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4 text-[#d97706]" />
        <span className="text-[12px] font-bold text-foreground">יש לך {alerts.length} התראות ממתינות</span>
      </div>
      <div className="space-y-2">
        {alerts.slice(0, 3).map((alert) => (
          <div key={alert.id} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
            <p className="text-[11px] text-foreground-secondary line-clamp-1 flex-1 ml-2">{alert.message?.substring(0, 80)}...</p>
            <button onClick={() => handleSend(alert)}
              className="btn-subtle flex items-center gap-1 px-3 py-1.5 rounded-md text-[10px] font-medium bg-foreground text-background hover:opacity-90 transition-all flex-shrink-0">
              <ExternalLink className="w-3 h-3" /> שלח ב-WhatsApp
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
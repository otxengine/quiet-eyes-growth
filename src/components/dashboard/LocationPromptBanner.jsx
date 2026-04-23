import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapPin, X } from 'lucide-react';

export default function LocationPromptBanner({ businessProfile }) {
  const navigate = useNavigate();
  const bpId = businessProfile?.id;

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', bpId],
    queryFn: () => base44.entities.BusinessLocation.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  if (!businessProfile || businessProfile.locations_prompt_dismissed || locations.length > 0) return null;

  const dismiss = async () => {
    await base44.entities.BusinessProfile.update(bpId, { locations_prompt_dismissed: true });
  };

  return (
    <div className="card-base p-4 flex items-center gap-3 mb-4 bg-blue-50/50 border-blue-100">
      <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
      <p className="text-[12px] text-foreground-secondary flex-1">יש לך עוד סניפים? הוסף אותם בהגדרות לניהול מרובה מיקומים</p>
      <button onClick={() => navigate('/settings')} className="text-[11px] px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90">הוסף סניפים</button>
      <button onClick={dismiss} className="p-1"><X className="w-4 h-4 text-foreground-muted" /></button>
    </div>
  );
}
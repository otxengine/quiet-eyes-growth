import React from 'react';
import { Star, MapPin, BadgeCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

export default function CompetitorSelectCard({ competitor, checked, onToggle }) {
  return (
    <label className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 bg-white cursor-pointer hover:border-gray-300 transition-colors">
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle(competitor.id)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0 text-right">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-semibold text-gray-900">{competitor.name}</span>
          {competitor.verification_status === 'מאומתת' && (
            <BadgeCheck className="w-3.5 h-3.5 text-[#e8344d]" />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {competitor.rating && (
            <span className="flex items-center gap-0.5 text-[11px] text-gray-500">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              {competitor.rating}
            </span>
          )}
          {competitor.address && (
            <span className="flex items-center gap-0.5 text-[11px] text-gray-500 truncate">
              <MapPin className="w-3 h-3" />
              {competitor.address}
            </span>
          )}
        </div>
      </div>
    </label>
  );
}

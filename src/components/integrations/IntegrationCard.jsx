import React from 'react';
import { Switch } from '@/components/ui/switch';
import { CheckCircle } from 'lucide-react';

export default function IntegrationCard({ icon, title, description, enabled, onToggle, accentColor, children }) {
  return (
    <div className="card-base overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: accentColor + '15' }}>
              {icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-bold text-foreground">{title}</h3>
                {enabled && <CheckCircle className="w-3.5 h-3.5 text-success" />}
              </div>
              <p className="text-[11px] text-foreground-muted">{description}</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </div>
        {enabled && children && (
          <div className="pt-3 border-t border-border space-y-3">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
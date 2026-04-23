import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapPin, ChevronDown } from 'lucide-react';

export default function LocationSwitcher({ businessProfileId, selectedLocationId, onLocationChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', businessProfileId],
    queryFn: () => base44.entities.BusinessLocation.filter({ linked_business: businessProfileId }),
    enabled: !!businessProfileId,
  });

  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  if (locations.length === 0) return null;

  const selected = selectedLocationId ? locations.find(l => l.id === selectedLocationId) : null;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors">
        <MapPin className="w-3.5 h-3.5 text-foreground-muted" />
        <span className="text-[11px] font-medium text-foreground-secondary">{selected?.name || 'כל הסניפים'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-50 min-w-[160px] overflow-hidden">
          <button onClick={() => { onLocationChange(null); setOpen(false); }}
            className={`w-full text-right px-3 py-2 text-[11px] font-medium hover:bg-secondary transition-colors ${!selectedLocationId ? 'text-primary bg-secondary' : 'text-foreground-secondary'}`}>
            כל הסניפים
          </button>
          {locations.map(loc => (
            <button key={loc.id} onClick={() => { onLocationChange(loc.id); setOpen(false); }}
              className={`w-full text-right px-3 py-2 text-[11px] font-medium hover:bg-secondary transition-colors ${selectedLocationId === loc.id ? 'text-primary bg-secondary' : 'text-foreground-secondary'}`}>
              {loc.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
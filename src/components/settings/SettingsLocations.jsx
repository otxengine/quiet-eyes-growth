import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapPin, Plus, Trash2, Star } from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsLocations({ businessProfile }) {
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', address: '', phone: '', is_primary: false });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', bpId],
    queryFn: () => base44.entities.BusinessLocation.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const save = async () => {
    if (!form.name.trim()) return toast.error('נדרש שם סניף');
    await base44.entities.BusinessLocation.create({ ...form, linked_business: bpId });
    setForm({ name: '', city: '', address: '', phone: '', is_primary: false });
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: ['locations'] });
    toast.success('סניף נוסף ✓');
  };

  const remove = async (id) => {
    await base44.entities.BusinessLocation.delete(id);
    queryClient.invalidateQueries({ queryKey: ['locations'] });
    toast.success('סניף הוסר');
  };

  const togglePrimary = async (loc) => {
    // Unset all others
    for (const l of locations) {
      if (l.is_primary && l.id !== loc.id) await base44.entities.BusinessLocation.update(l.id, { is_primary: false });
    }
    await base44.entities.BusinessLocation.update(loc.id, { is_primary: !loc.is_primary });
    queryClient.invalidateQueries({ queryKey: ['locations'] });
  };

  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground">סניפים</h3>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors">
          <Plus className="w-3.5 h-3.5" /> הוסף סניף
        </button>
      </div>

      {locations.length === 0 && !showForm && (
        <p className="text-[12px] text-foreground-muted text-center py-4">לא הוגדרו סניפים — הוסף סניפים לניהול מרובה מיקומים</p>
      )}

      {locations.map(loc => (
        <div key={loc.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-foreground">{loc.name}</span>
              {loc.is_primary && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
            </div>
            <span className="text-[10px] text-foreground-muted">{[loc.city, loc.address].filter(Boolean).join(' · ')}</span>
          </div>
          <button onClick={() => togglePrimary(loc)} title="סניף ראשי" className="p-1.5 hover:bg-white rounded transition-colors">
            <Star className={`w-3.5 h-3.5 ${loc.is_primary ? 'text-amber-500 fill-amber-500' : 'text-foreground-muted'}`} />
          </button>
          <button onClick={() => remove(loc.id)} className="p-1.5 hover:bg-white rounded transition-colors">
            <Trash2 className="w-3.5 h-3.5 text-foreground-muted hover:text-danger" />
          </button>
        </div>
      ))}

      {showForm && (
        <div className="space-y-2 p-3 rounded-lg border border-border">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="שם הסניף"
            className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="עיר"
              className="text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="טלפון"
              className="text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
          </div>
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="כתובת"
            className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
          <div className="flex gap-2">
            <button onClick={save} className="text-[12px] px-4 py-2 rounded-lg bg-foreground text-background hover:opacity-90">שמור</button>
            <button onClick={() => setShowForm(false)} className="text-[12px] px-4 py-2 rounded-lg bg-secondary text-foreground-muted">ביטול</button>
          </div>
        </div>
      )}
    </div>
  );
}
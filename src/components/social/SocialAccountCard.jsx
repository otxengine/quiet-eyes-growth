import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import moment from 'moment';

const platformConfig = {
  facebook: { label: 'Facebook', color: 'bg-blue-500', tokenLabel: 'Page Access Token', pageIdLabel: 'Page ID', helpUrl: 'https://developers.facebook.com/tools/explorer/' },
  instagram: { label: 'Instagram', color: 'bg-pink-500', tokenLabel: 'Access Token', pageIdLabel: 'Instagram Business Account ID', helpUrl: 'https://developers.facebook.com/docs/instagram-api/' },
  tiktok: { label: 'TikTok', color: 'bg-foreground', tokenLabel: 'Access Token', pageIdLabel: 'שם המשתמש (ללא @)', helpUrl: 'https://developers.tiktok.com/' },
};

export default function SocialAccountCard({ account, businessProfileId }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!account);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [form, setForm] = useState({
    account_name: account?.account_name || '',
    access_token: account?.access_token || '',
    page_id: account?.page_id || '',
  });

  const config = platformConfig[account?.platform] || platformConfig.facebook;

  const handleSave = async () => {
    if (!form.access_token) { toast.error('חובה להזין Access Token'); return; }
    setSaving(true);
    if (account?.id) {
      await base44.entities.SocialAccount.update(account.id, { ...form, is_connected: true });
    } else {
      await base44.entities.SocialAccount.create({
        ...form,
        linked_business: businessProfileId,
        platform: account?.platform || 'facebook',
        is_connected: true,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    setEditing(false);
    setSaving(false);
    toast.success('החיבור נשמר');
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await base44.functions.invoke('fetchSocialData', {
        businessProfileId,
        platform: account.platform,
      });
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      queryClient.invalidateQueries({ queryKey: ['socialSignals'] });
      toast.success('הנתונים סונכרנו בהצלחה');
    } catch (err) {
      toast.error(`שגיאה בסנכרון: ${err.message}`);
    }
    setSyncing(false);
  };

  const handleDelete = async () => {
    if (!account?.id) return;
    await base44.entities.SocialAccount.delete(account.id);
    queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    toast.success('החיבור נמחק');
  };

  const maskedToken = form.access_token
    ? form.access_token.substring(0, 8) + '••••••••' + form.access_token.slice(-4)
    : '';

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg ${config.color} flex items-center justify-center`}>
            <span className="text-white text-[11px] font-bold">{config.label[0]}</span>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">{config.label}</h3>
            {account?.account_name && <p className="text-[11px] text-foreground-muted">{account.account_name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {account?.is_connected ? (
            <span className="flex items-center gap-1 text-[10px] text-success font-medium">
              <CheckCircle className="w-3 h-3" /> מחובר
            </span>
          ) : account?.last_error ? (
            <span className="flex items-center gap-1 text-[10px] text-danger font-medium">
              <XCircle className="w-3 h-3" /> שגיאה
            </span>
          ) : (
            <span className="text-[10px] text-foreground-muted">לא מחובר</span>
          )}
        </div>
      </div>

      {account?.last_sync && (
        <p className="text-[10px] text-foreground-muted mb-3">
          סנכרון אחרון: {moment(account.last_sync).fromNow()}
        </p>
      )}
      {account?.last_error && (
        <p className="text-[10px] text-danger mb-3">שגיאה: {account.last_error}</p>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-foreground-secondary mb-1 block">שם החשבון / עמוד</label>
            <Input value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })} placeholder="לדוגמה: MyBusiness" className="text-[12px]" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-foreground-secondary mb-1 block">{config.tokenLabel}</label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={form.access_token}
                onChange={e => setForm({ ...form, access_token: e.target.value })}
                placeholder="הדבק את הטוקן כאן..."
                className="text-[12px] pl-8"
              />
              <button onClick={() => setShowToken(!showToken)} className="absolute left-2 top-1/2 -translate-y-1/2">
                {showToken ? <EyeOff className="w-3.5 h-3.5 text-foreground-muted" /> : <Eye className="w-3.5 h-3.5 text-foreground-muted" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-foreground-secondary mb-1 block">{config.pageIdLabel}</label>
            <Input value={form.page_id} onChange={e => setForm({ ...form, page_id: e.target.value })} placeholder="מזהה העמוד/חשבון" className="text-[12px]" />
          </div>
          <p className="text-[10px] text-foreground-muted">
            <a href={config.helpUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              איך להשיג טוקן? →
            </a>
          </p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="text-[11px]">
              {saving ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : null}
              שמור חיבור
            </Button>
            {account?.id && (
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="text-[11px]">ביטול</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {form.access_token && (
            <p className="text-[11px] text-foreground-muted font-mono bg-secondary rounded px-2 py-1">{maskedToken}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="text-[11px]">ערוך</Button>
            {account?.access_token && (
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="text-[11px]">
                {syncing ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <RefreshCw className="w-3 h-3 ml-1" />}
                סנכרן עכשיו
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={handleDelete} className="text-[11px] text-danger hover:text-danger">
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
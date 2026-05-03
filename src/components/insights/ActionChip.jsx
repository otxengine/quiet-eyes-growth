import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ClipboardList, Star, MessageSquare, Megaphone, Zap, Users, UserPlus,
  TrendingUp, Heart, Globe, Eye, BarChart2, Settings, Truck,
  MessageCircle, Loader2, CheckCheck, ExternalLink, Camera, Share2,
} from 'lucide-react';
import { logCompletedAction } from '@/lib/businessSnapshot';

const ICON_MAP = {
  ClipboardList, Star, MessageSquare, Megaphone, Zap, Users, UserPlus,
  TrendingUp, Heart, Globe, Eye, BarChart2, Settings, Truck,
  MessageCircle, ExternalLink, Camera, Share2,
};

/**
 * ActionChip — executes a single action from insightActions.js
 *
 * Props:
 *   action     — { label, type, icon, url, href, fn, params }
 *   bpId       — businessProfileId for execute actions
 *   insightId  — insight id for outcome tracing (optional)
 *   size       — 'sm' | 'md' (default 'md')
 *   onDone     — callback after successful execute
 */
export default function ActionChip({ action, bpId, insightId, size = 'md', onDone }) {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);

  const Icon = ICON_MAP[action.icon] || Zap;

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-2.5 py-1 gap-1'
    : 'text-[11px] px-3 py-1.5 gap-1.5';

  const handleClick = async () => {
    if (loading || done) return;

    // ── navigate: internal route ──
    if (action.type === 'navigate') {
      // Log navigation as a completed action so agents know the user went there
      logCompletedAction(bpId, 'navigate', action.label, insightId);
      navigate(action.url);
      return;
    }

    // ── external: open URL ──
    if (action.type === 'external') {
      // Log so agents know this was acted on (e.g. "opened Google Business registration")
      logCompletedAction(bpId, 'external_link', action.label, insightId);
      window.open(action.href, '_blank', 'noopener');
      return;
    }

    // ── execute: API call ──
    if (action.type === 'execute' && action.fn === 'createTask') {
      setLoading(true);
      try {
        await base44.entities.Task.create({
          title:           action.params?.title       || 'משימה חדשה',
          description:     action.params?.description || '',
          status:          'pending',
          priority:        action.params?.priority    || 'medium',
          source_type:     'alert',
          linked_business: bpId || '',
        });
        setDone(true);
        toast.success('המשימה נוצרה ✓');
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        // Log + invalidate snapshot so agents know a task was created
        await logCompletedAction(bpId, 'createTask', `נוצרה משימה: ${action.params?.title || ''}`, insightId);
        onDone?.('createTask');
      } catch {
        toast.error('שגיאה ביצירת המשימה');
      }
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center rounded-xl border font-medium transition-all
        ${sizeClasses}
        ${done
          ? 'bg-green-50 border-green-200 text-green-700 cursor-default'
          : 'bg-white border-border text-foreground hover:bg-secondary/40 hover:border-border-hover'
        }
        disabled:opacity-60`}
    >
      {loading
        ? <Loader2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} animate-spin`} />
        : done
          ? <CheckCheck className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          : <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      }
      <span>{done ? 'בוצע' : action.label}</span>
      {action.type === 'external' && !done && (
        <ExternalLink className={size === 'sm' ? 'w-2.5 h-2.5 opacity-50' : 'w-3 h-3 opacity-50'} />
      )}
    </button>
  );
}

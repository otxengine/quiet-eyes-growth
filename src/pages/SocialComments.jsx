// @ts-nocheck
import React, { useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageCircle, RefreshCw, Send, Sparkles, X, ThumbsUp,
  ThumbsDown, Minus, Facebook, Instagram, Loader2, ChevronDown, Trash2
} from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3007/api';
const HEADERS  = { 'Content-Type': 'application/json', 'x-dev-user': 'dev-user' };

const PLATFORM_FILTERS = [
  { id: 'all',       label: 'הכל' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
];

const STATUS_FILTERS = [
  { id: 'all',        label: 'כל התגובות' },
  { id: 'unanswered', label: 'לא נענו' },
  { id: 'negative',   label: 'שליליות' },
  { id: 'answered',   label: 'נענו' },
];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'כרגע';
  if (m < 60)  return `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `לפני ${h} שעות`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

function SentimentBadge({ sentiment }) {
  if (!sentiment) return null;
  const cfg = {
    positive: { icon: ThumbsUp,   color: 'text-green-600 bg-green-50',  label: 'חיובי'  },
    negative: { icon: ThumbsDown, color: 'text-red-600 bg-red-50',      label: 'שלילי'  },
    neutral:  { icon: Minus,      color: 'text-gray-500 bg-gray-100',   label: 'נייטרלי' },
  }[sentiment] || { icon: Minus, color: 'text-gray-500 bg-gray-100', label: sentiment };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function PlatformIcon({ platform }) {
  if (platform === 'facebook')  return <Facebook  className="w-4 h-4 text-blue-600" />;
  if (platform === 'instagram') return <Instagram className="w-4 h-4 text-pink-500" />;
  return <MessageCircle className="w-4 h-4 text-gray-400" />;
}

function CommentCard({ comment, businessProfileId, onUpdate }) {
  const [expanded,    setExpanded]    = useState(false);
  const [replyText,   setReplyText]   = useState(comment.ai_suggested_reply || '');
  const [suggesting,  setSuggesting]  = useState(false);
  const [sending,     setSending]     = useState(false);
  const [dismissing,  setDismissing]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const res  = await fetch(`${API_BASE}/social/comments/${comment.id}/suggest-reply`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ businessProfileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReplyText(data.suggestion);
      setExpanded(true);
      toast.success('הצעת תגובה נוצרה');
    } catch (e) {
      toast.error(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSuggesting(false);
  };

  const handleSend = async () => {
    if (!replyText.trim()) { toast.error('יש להזין תגובה'); return; }
    setSending(true);
    try {
      const res  = await fetch(`${API_BASE}/social/comments/${comment.id}/reply`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ businessProfileId, replyText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('תגובה נשלחה!');
      onUpdate();
    } catch (e) {
      toast.error(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSending(false);
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await fetch(`${API_BASE}/social/comments/${comment.id}/dismiss`, {
        method: 'PATCH', headers: HEADERS,
      });
      onUpdate();
    } catch { setDismissing(false); }
  };

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setDeleting(true);
    try {
      const res  = await fetch(`${API_BASE}/social/comments/${comment.id}`, {
        method: 'DELETE',
        headers: HEADERS,
        body: JSON.stringify({ businessProfileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('התגובה נמחקה מ-' + (comment.platform === 'facebook' ? 'Facebook' : 'Instagram'));
      onUpdate();
    } catch (e) {
      toast.error(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  const isAnswered = comment.reply_sent;

  return (
    <div className={`bg-white rounded-xl border p-4 shadow-sm transition-all ${
      isAnswered ? 'opacity-60 border-gray-100' : 'border-gray-200 hover:border-gray-300'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {(comment.author_name || comment.author_id || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-gray-800">
                {comment.author_name || (comment.author_id ? `user_${comment.author_id.slice(-4)}` : 'אנונימי')}
              </span>
              <PlatformIcon platform={comment.platform} />
              <SentimentBadge sentiment={comment.sentiment} />
              {isAnswered && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">נענה</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{timeAgo(comment.created_time || comment.fetched_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Delete from platform */}
          {confirmDel ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-500 font-medium">מחק?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'כן'}
              </button>
              <button
                onClick={() => setConfirmDel(false)}
                className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
              >
                לא
              </button>
            </div>
          ) : (
            <button
              onClick={handleDelete}
              className="text-gray-300 hover:text-red-500 transition-colors mt-0.5"
              title="מחק תגובה מהפלטפורמה"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {/* Dismiss from inbox */}
          <button
            onClick={handleDismiss}
            disabled={dismissing}
            className="text-gray-300 hover:text-gray-500 transition-colors mt-0.5"
            title="התעלם (הסתר מהתיבה)"
          >
            {dismissing ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Post context */}
      {comment.post_message && (
        <p className="mt-2 text-xs text-gray-400 bg-gray-50 rounded px-2 py-1 line-clamp-1 text-right">
          פוסט: {comment.post_message}
        </p>
      )}

      {/* Comment text */}
      <p className="mt-2.5 text-sm text-gray-700 leading-relaxed text-right">{comment.comment_text}</p>

      {/* Already-sent reply preview */}
      {isAnswered && comment.reply_text && (
        <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-sm text-blue-700 text-right">
          <span className="text-xs font-medium text-blue-500 block mb-1">תגובתך:</span>
          {comment.reply_text}
        </div>
      )}

      {/* Action bar (only when not answered) */}
      {!isAnswered && (
        <div className="mt-3">
          {/* AI suggested reply */}
          {(replyText || expanded) && (
            <div className="mb-2">
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={3}
                dir="rtl"
                placeholder="כתוב תגובה..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent"
              />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSuggest}
              disabled={suggesting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50 transition-colors disabled:opacity-50"
            >
              {suggesting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />
              }
              הצע תגובה AI
            </button>

            {!expanded && !replyText && (
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                כתוב תגובה
              </button>
            )}

            {(replyText || expanded) && (
              <button
                onClick={handleSend}
                disabled={sending || !replyText.trim()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
                שלח תגובה
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SocialComments() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();

  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('unanswered');
  const [syncing,        setSyncing]         = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['socialComments', bpId],
    queryFn: async () => {
      const res  = await fetch(
        `${API_BASE}/social/comments?businessProfileId=${bpId}`,
        { headers: HEADERS },
      );
      const json = await res.json();
      return json.comments || [];
    },
    enabled: !!bpId,
    staleTime: 2 * 60 * 1000,
  });

  const handleSync = useCallback(async () => {
    setSyncing(true);
    toast.info('מסנכרן תגובות...');
    try {
      const res  = await fetch(
        `${API_BASE}/social/comments?businessProfileId=${bpId}`,
        { headers: HEADERS },
      );
      const json = await res.json();
      if (json.errors?.length) toast.error(`שגיאות: ${json.errors.join(', ')}`);
      await queryClient.invalidateQueries({ queryKey: ['socialComments', bpId] });
      toast.success('תגובות עודכנו');
    } catch {
      toast.error('שגיאה בסנכרון');
    }
    setSyncing(false);
  }, [bpId, queryClient]);

  const comments = data || [];
  const activeComments = comments.filter(c => !c.is_dismissed);

  const filtered = comments.filter(c => {
    // "All comments" shows everything including dismissed; other filters hide dismissed
    if (statusFilter !== 'all' && c.is_dismissed) return false;
    if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
    if (statusFilter === 'unanswered' && c.reply_sent) return false;
    if (statusFilter === 'answered'   && !c.reply_sent) return false;
    if (statusFilter === 'negative'   && c.sentiment !== 'negative') return false;
    return true;
  });

  const unansweredCount = activeComments.filter(c => !c.reply_sent).length;
  const negativeCount   = activeComments.filter(c => c.sentiment === 'negative').length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-violet-600" />
            תגובות סושיאל
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">ניהול תגובות מ-Facebook ו-Instagram</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-50"
        >
          {syncing
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />
          }
          סנכרן תגובות
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">{activeComments.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">סה"כ תגובות</p>
        </div>
        <div className="bg-white rounded-xl border border-orange-100 p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-orange-500">{unansweredCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">ממתינות לתגובה</p>
        </div>
        <div className="bg-white rounded-xl border border-red-100 p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-red-500">{negativeCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">שליליות</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
          {PLATFORM_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setPlatformFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                platformFilter === f.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                statusFilter === f.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span>טוען תגובות...</span>
        </div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">שגיאה בטעינת תגובות</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">אין תגובות להצגה</p>
          <p className="text-xs mt-1">לחץ "סנכרן תגובות" כדי לטעון מ-Facebook ו-Instagram</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(c => (
            <CommentCard
              key={c.id}
              comment={c}
              businessProfileId={bpId}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ['socialComments', bpId] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
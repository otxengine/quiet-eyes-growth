/**
 * FeedbackWidget — universal feedback component for any AI output.
 *
 * Usage:
 *   <FeedbackWidget
 *     agentName="runViralCatalyst"
 *     outputType="insight"
 *     outputId={aiOutputId}      // optional
 *     module="Layer7"
 *     businessProfileId={bpId}
 *     compact={false}            // true = just thumbs, false = full widget
 *   />
 *
 * When the user clicks thumbs up/down, a minimal inline panel appears
 * with optional tags and comment. On submit, POSTs to /api/feedback.
 */

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3002';

const NEGATIVE_TAGS = [
  { key: 'irrelevant',    label: 'לא רלוונטי' },
  { key: 'inaccurate',   label: 'לא מדויק' },
  { key: 'too_generic',  label: 'גנרי מדי' },
  { key: 'wrong_priority', label: 'עדיפות שגויה' },
  { key: 'bad_timing',   label: 'תזמון גרוע' },
];

const POSITIVE_TAGS = [
  { key: 'accurate',      label: 'מדויק' },
  { key: 'actionable',    label: 'ניתן לפעולה' },
  { key: 'good_insight',  label: 'תובנה מצוינת' },
  { key: 'highly_relevant', label: 'רלוונטי מאוד' },
  { key: 'useful',        label: 'שימושי' },
];

export default function FeedbackWidget({
  agentName,
  outputType = 'general',
  outputId,
  module: moduleName,
  businessProfileId,
  compact = false,
  className = '',
}) {
  const { businessProfile } = useAuth();
  const bpId = businessProfileId || businessProfile?.id;

  const [vote, setVote]         = useState(null); // 'up' | 'down' | null
  const [expanded, setExpanded] = useState(false);
  const [selectedTags, setTags] = useState([]);
  const [comment, setComment]   = useState('');
  const [correction, setCorrection] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]   = useState(false);

  const tags = vote === 'down' ? NEGATIVE_TAGS : POSITIVE_TAGS;

  function toggleTag(key) {
    setTags(prev => prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]);
  }

  async function submit(quickVote) {
    const v = quickVote ?? vote;
    if (!v || !bpId) return;
    setLoading(true);
    try {
      await fetch(`${SERVER_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessProfileId: bpId,
          aiOutputId:        outputId || null,
          agentName,
          module:            moduleName || agentName,
          outputType,
          rating:            v === 'up' ? 'positive' : 'negative',
          score:             v === 'up' ? 1 : -1,
          comment:           comment || null,
          tags:              selectedTags.join(',') || null,
          correction:        correction || null,
          actionTaken:       v === 'up' ? 'accepted' : 'rejected',
        }),
      });
      setSubmitted(true);
      setExpanded(false);
      toast.success(v === 'up' ? 'תודה! המשוב שלך ישפר את הסוכן' : 'קיבלנו — נשתדל להשתפר');
    } catch {
      toast.error('שגיאה בשמירת משוב');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <span style={{ fontSize: 11, color: '#22c55e', opacity: 0.8 }}>
        ✓ משוב נשמר
      </span>
    );
  }

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} className={className}>
        <button
          onClick={() => { setVote('up'); submit('up'); }}
          title="מועיל"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: vote === 'up' ? 1 : 0.5, padding: 2 }}
        >👍</button>
        <button
          onClick={() => { setVote('down'); submit('down'); }}
          title="לא מועיל"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: vote === 'down' ? 1 : 0.5, padding: 2 }}
        >👎</button>
      </span>
    );
  }

  return (
    <div className={`feedback-widget ${className}`} style={{ marginTop: 8 }} dir="rtl">
      {/* Thumb buttons */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>האם זה מועיל?</span>
        <button
          onClick={() => {
            const v = 'up';
            setVote(v);
            setExpanded(true);
            setTags([]);
          }}
          style={{
            background: vote === 'up' ? '#dcfce7' : 'transparent',
            border: `1px solid ${vote === 'up' ? '#86efac' : '#e2e8f0'}`,
            borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 13,
            transition: 'all 0.15s',
          }}
        >👍</button>
        <button
          onClick={() => {
            const v = 'down';
            setVote(v);
            setExpanded(true);
            setTags([]);
          }}
          style={{
            background: vote === 'down' ? '#fee2e2' : 'transparent',
            border: `1px solid ${vote === 'down' ? '#fca5a5' : '#e2e8f0'}`,
            borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 13,
            transition: 'all 0.15s',
          }}
        >👎</button>
        {vote && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            style={{ background: 'none', border: 'none', fontSize: 11, color: '#6366f1', cursor: 'pointer', textDecoration: 'underline' }}
          >הוסף פרטים</button>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          marginTop: 8, padding: 12, borderRadius: 10,
          background: vote === 'up' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${vote === 'up' ? '#bbf7d0' : '#fecaca'}`,
        }}>
          {/* Tag selector */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
              {vote === 'down' ? 'מה לא עבד?' : 'מה עבד טוב?'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tags.map(t => (
                <button
                  key={t.key}
                  onClick={() => toggleTag(t.key)}
                  style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                    background: selectedTags.includes(t.key)
                      ? (vote === 'up' ? '#22c55e' : '#ef4444')
                      : 'white',
                    color: selectedTags.includes(t.key) ? 'white' : '#64748b',
                    border: `1px solid ${selectedTags.includes(t.key) ? 'transparent' : '#e2e8f0'}`,
                    transition: 'all 0.15s',
                  }}
                >{t.label}</button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="הערה חופשית (אופציונלי)..."
            rows={2}
            style={{
              width: '100%', fontSize: 12, padding: '6px 8px',
              borderRadius: 6, border: '1px solid #e2e8f0',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />

          {/* Correction (for negative) */}
          {vote === 'down' && (
            <textarea
              value={correction}
              onChange={e => setCorrection(e.target.value)}
              placeholder="מה היה נכון יותר? (אופציונלי)..."
              rows={2}
              style={{
                width: '100%', marginTop: 4, fontSize: 12, padding: '6px 8px',
                borderRadius: 6, border: '1px solid #e2e8f0',
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setExpanded(false); setVote(null); }}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer' }}
            >ביטול</button>
            <button
              onClick={() => submit(null)}
              disabled={loading}
              style={{
                fontSize: 11, padding: '4px 12px', borderRadius: 6,
                background: vote === 'up' ? '#22c55e' : '#ef4444',
                color: 'white', border: 'none', cursor: 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >{loading ? '...' : 'שלח משוב'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

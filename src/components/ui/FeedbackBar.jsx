import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * FeedbackBar — like/dislike on any insight/signal.
 * Writes to /api/feedback → updates AgentLearningProfile + BusinessMemory.
 *
 * Props:
 *   signalId       — MarketSignal ID (used as aiOutputId)
 *   signalText     — summary text (for context logging)
 *   agentName      — which agent produced this insight
 *   businessId     — linked_business
 *   compact        — show small 👍/👎 buttons (default: false → full card)
 */
export default function FeedbackBar({
  signalId,
  signalText,
  agentName,
  businessId,
  compact = false,
}) {
  const [vote,     setVote]     = useState(null); // 'like' | 'dislike'
  const [showText, setShowText] = useState(false);
  const [text,     setText]     = useState('');
  const [saved,    setSaved]    = useState(false);
  const [saving,   setSaving]   = useState(false);

  async function submit(type, freeText) {
    if (saving || saved) return;
    setSaving(true);
    const score = type === 'like' ? 1 : -1;
    try {
      await base44.feedback.submit({
        businessProfileId: businessId,
        agentName: agentName || 'MarketIntelligence',
        outputType: 'market_signal',
        score,
        comment: freeText || null,
        tags: type === 'dislike' ? 'not_relevant' : 'useful',
        aiOutputId: signalId,
      });
      setSaved(true);
    } catch (err) {
      console.error('[FeedbackBar] submit failed:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleLike() {
    setVote('like');
    submit('like');
  }

  function handleDislike() {
    setVote('dislike');
    setShowText(true);
  }

  function handleSendText() {
    submit('dislike', text);
  }

  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <button
          onClick={handleLike}
          disabled={saved}
          style={{
            background: vote === 'like' ? '#EAF3DE' : 'transparent',
            border: `1px solid ${vote === 'like' ? '#639922' : '#e5e7eb'}`,
            borderRadius: 6, padding: '2px 8px', fontSize: 13, cursor: saved ? 'default' : 'pointer',
            color: vote === 'like' ? '#27500A' : '#9ca3af',
            transition: 'all 0.15s',
          }}
          title="תובנה שימושית"
        >
          👍
        </button>
        <button
          onClick={handleDislike}
          disabled={saved}
          style={{
            background: vote === 'dislike' ? '#FCEBEB' : 'transparent',
            border: `1px solid ${vote === 'dislike' ? '#E24B4A' : '#e5e7eb'}`,
            borderRadius: 6, padding: '2px 8px', fontSize: 13, cursor: saved ? 'default' : 'pointer',
            color: vote === 'dislike' ? '#A32D2D' : '#9ca3af',
            transition: 'all 0.15s',
          }}
          title="לא רלוונטי"
        >
          👎
        </button>

        {showText && !saved && (
          <input
            autoFocus
            placeholder="מה לא עבד? (Enter לשליחה)"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendText()}
            style={{
              flex: 1, minWidth: 120, fontSize: 12, padding: '3px 8px',
              border: '1px solid #d1d5db', borderRadius: 6,
              background: '#f9fafb', color: '#111', direction: 'rtl',
            }}
          />
        )}
        {saved && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>תודה!</span>
        )}
      </div>
    );
  }

  // Full version
  return (
    <div style={{
      marginTop: 12, padding: '10px 14px',
      background: '#f9fafb', borderRadius: 10,
      border: '1px solid #f3f4f6',
      direction: 'rtl',
    }}>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        האם התובנה הזו הייתה שימושית?
      </p>
      {!saved ? (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleLike}
              style={{
                flex: 1, padding: '7px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${vote === 'like' ? '#639922' : '#e5e7eb'}`,
                background: vote === 'like' ? '#EAF3DE' : '#fff',
                color: vote === 'like' ? '#27500A' : '#374151',
                fontWeight: 500, transition: 'all 0.15s',
              }}
            >
              👍 שימושי
            </button>
            <button
              onClick={handleDislike}
              style={{
                flex: 1, padding: '7px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${vote === 'dislike' ? '#E24B4A' : '#e5e7eb'}`,
                background: vote === 'dislike' ? '#FCEBEB' : '#fff',
                color: vote === 'dislike' ? '#A32D2D' : '#374151',
                fontWeight: 500, transition: 'all 0.15s',
              }}
            >
              👎 לא רלוונטי
            </button>
          </div>
          {showText && (
            <div style={{ marginTop: 8 }}>
              <textarea
                autoFocus
                placeholder="ספר לנו מה לא עבד — זה עוזר לשפר את המערכת"
                value={text}
                onChange={e => setText(e.target.value)}
                rows={2}
                style={{
                  width: '100%', borderRadius: 6, padding: '8px',
                  fontSize: 12, border: '1px solid #d1d5db',
                  background: '#fff', color: '#111',
                  fontFamily: 'inherit', resize: 'none', direction: 'rtl',
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={handleSendText}
                disabled={saving}
                style={{
                  marginTop: 6, padding: '5px 14px', background: '#6366f1',
                  color: '#fff', border: 'none', borderRadius: 6,
                  fontSize: 12, cursor: 'pointer', fontWeight: 500,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'שולח...' : 'שלח משוב'}
              </button>
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: 12, color: '#10b981', textAlign: 'center' }}>
          ✓ תודה! המשוב נשמר ומשפיע על הלמידה
        </p>
      )}
    </div>
  );
}

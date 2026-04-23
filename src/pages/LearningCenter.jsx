/**
 * LearningCenter — AI Learning Hub
 * Route: /learning
 *
 * Shows:
 * - Overall accuracy stats
 * - Per-agent accuracy bars
 * - Learned business preferences
 * - Recent improvements (patterns detected)
 * - Top feedback tags
 * - Recent accepted / rejected recommendations
 * - "Run Learning Engine" button
 */

import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3007';

const AGENT_LABELS = {
  collectWebSignals:        'Eyeni — סורק אינטרנט',
  collectSocialSignals:     'Social — סושיאל',
  runMarketIntelligence:    'Analyzer — אינטל',
  runCompetitorIdentification: 'Tracker — מתחרים',
  generateProactiveAlerts:  'Supervisor — התראות',
  runPredictions:           'Predictor — תחזיות',
  updateSectorKnowledge:    'Memory — זיכרון',
  runLeadGeneration:        'Filter — לידים',
  calculateHealthScore:     'HealthScore',
  findSocialLeads:          'Hunter — לידים סושיאל',
  detectTrends:             'Trends — טרנדים',
  applyDataFreshness:       'Cleaner — ניקוי',
  runMLLearning:            'Brain — למידה',
  runViralCatalyst:         'Viral — ויראלי',
  runInfluenceIntegrity:    'Integrity — אמינות',
  runDeepContextVision:     'Vision — ניתוח',
  runRetentionSentinel:     'Retention — שימור',
  runNegotiationPricing:    'Pricing — תמחור',
  runCampaignAutopilot:     'Autopilot — קמפיין',
  runExpansionScout:        'Expansion — הרחבה',
  runReputationWarRoom:     'Reputation — מוניטין',
};

function AccuracyBar({ value, color = '#6366f1' }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width 0.5s' }} />
    </div>
  );
}

function StatCard({ label, value, sub, color = '#6366f1' }) {
  return (
    <div style={{
      background: 'white', borderRadius: 12, padding: '16px 20px',
      border: '1px solid #f1f5f9', flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value ?? '—'}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function LearningCenter() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const qc   = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['learningDashboard', bpId],
    queryFn:  async () => {
      const r = await fetch(`${SERVER_URL}/api/learning/dashboard/${bpId}`);
      if (!r.ok) throw new Error(`שגיאת שרת ${r.status}`);
      return r.json();
    },
    enabled:  !!bpId,
    refetchInterval: 60_000,
    retry: 1,
  });

  const runLearning = useMutation({
    mutationFn: async () => {
      // Try the dedicated learning endpoint first, fall back to general function invoke
      try {
        const r = await fetch(`${SERVER_URL}/api/learning/run/${bpId}`, { method: 'POST' });
        if (r.ok) return r.json();
      } catch (_) {}
      // Fallback: invoke via functions API
      const res = await base44.functions.invoke('runMLLearningCycle', { businessProfileId: bpId });
      return res?.data || res;
    },
    onSuccess: (res) => {
      toast.success(res?.message || `למידה הושלמה — ${res?.processed ?? 0} אירועי משוב עובדו`);
      qc.invalidateQueries({ queryKey: ['learningDashboard', bpId] });
    },
    onError: () => toast.error('שגיאה בהרצת מנוע הלמידה'),
  });

  const overview = data?.overview || {};
  const profiles = data?.agent_profiles || [];
  const improvements = data?.improvements || [];
  const topTags = data?.top_tags || [];
  const prefs = data?.preferences || {};
  const recentAccepted = data?.recent_accepted || [];
  const recentRejected = data?.recent_rejected || [];

  const accuracyColor = (pct) => pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';

  if (!bpId) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>טוען פרופיל עסקי...</div>;

  if (isError) return (
    <div style={{ padding: 40, textAlign: 'center', direction: 'rtl' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>לא ניתן לטעון נתוני למידה</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>השרת אינו זמין כרגע. ייתכן שהשרת לא פועל.</div>
      <button
        onClick={() => qc.invalidateQueries({ queryKey: ['learningDashboard', bpId] })}
        style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#6366f1', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
      >נסה שוב</button>
    </div>
  );

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto', direction: 'rtl' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>🧠 מרכז הלמידה</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            הפלטפורמה לומדת מהמשוב שלך ומשתפרת עם הזמן
          </p>
        </div>
        <button
          onClick={() => runLearning.mutate()}
          disabled={runLearning.isPending}
          style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: '#6366f1', color: 'white', fontWeight: 600,
            fontSize: 13, cursor: 'pointer', opacity: runLearning.isPending ? 0.7 : 1,
          }}
        >
          {runLearning.isPending ? '⚙️ מריץ...' : '⚡ הרץ מנוע למידה'}
        </button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>טוען נתוני למידה...</div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <StatCard label="דיוק כולל" value={overview.overall_accuracy != null ? `${overview.overall_accuracy}%` : null} sub="מכל המשובים" color="#6366f1" />
            <StatCard label="סה״כ משובים" value={overview.total_feedback} sub="30 ימים אחרונים" color="#3b82f6" />
            <StatCard label="חיוביים" value={overview.positive_count} sub="👍" color="#22c55e" />
            <StatCard label="שליליים" value={overview.negative_count} sub="👎" color="#ef4444" />
            <StatCard label="תבניות נלמדו" value={overview.total_patterns_learned} sub="דפוסים שזוהו" color="#f59e0b" />
            <StatCard label="סוכנים במעקב" value={overview.total_agents_tracked} sub="מתוך 19" color="#8b5cf6" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            {/* Agent accuracy */}
            <div style={{ background: 'white', borderRadius: 14, padding: 20, border: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 14, margin: '0 0 14px' }}>
                📊 דיוק סוכנים
              </h3>
              {profiles.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>עדיין אין מספיק משוב לסוכנים</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {profiles.sort((a, b) => b.accuracy - a.accuracy).map(p => (
                    <div key={p.agent}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: '#374151' }}>
                          {AGENT_LABELS[p.agent] || p.agent}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: accuracyColor(p.accuracy) }}>
                          {p.accuracy}%
                        </span>
                      </div>
                      <AccuracyBar value={p.accuracy} color={accuracyColor(p.accuracy)} />
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                        {p.positive} חיובי · {p.negative} שלילי · {p.total_outputs} סה״כ
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Preferences learned */}
            <div style={{ background: 'white', borderRadius: 14, padding: 20, border: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 14px' }}>
                🎯 העדפות שנלמדו
              </h3>
              {!prefs.last_updated ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>טרם נלמדו העדפות — הוסף משוב כדי להתחיל</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {prefs.preferred_tone && (
                    <div>
                      <span style={{ fontSize: 11, color: '#64748b' }}>טון מועדף: </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{prefs.preferred_tone}</span>
                    </div>
                  )}
                  {prefs.preferred_channels?.length > 0 && (
                    <div>
                      <span style={{ fontSize: 11, color: '#64748b' }}>ערוצים: </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{prefs.preferred_channels.join(', ')}</span>
                    </div>
                  )}
                  {prefs.top_accepted?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>מה עובד ✓</div>
                      {prefs.top_accepted.slice(0, 4).map(p => (
                        <div key={p} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#dcfce7', color: '#166534', display: 'inline-block', margin: '2px 2px' }}>{p}</div>
                      ))}
                    </div>
                  )}
                  {prefs.top_rejected?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>מה לא עובד ✗</div>
                      {prefs.top_rejected.slice(0, 4).map(p => (
                        <div key={p} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', display: 'inline-block', margin: '2px 2px' }}>{p}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                    עדכון אחרון: {new Date(prefs.last_updated).toLocaleDateString('he-IL')}
                    {prefs.learning_version ? ` · גרסה ${prefs.learning_version}` : ''}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
            {/* Improvements detected */}
            <div style={{ background: 'white', borderRadius: 14, padding: 20, border: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 14px' }}>
                📈 שיפורים שזוהו
              </h3>
              {improvements.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                  אין דפוסים שזוהו עדיין.<br />נדרש 3+ משובים על אותו סוכן.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {improvements.map((imp, i) => (
                    <div key={i} style={{
                      padding: '8px 10px', borderRadius: 8,
                      background: imp.type === 'positive_pattern' ? '#f0fdf4' : '#fef2f2',
                      borderRight: `3px solid ${imp.type === 'positive_pattern' ? '#22c55e' : '#ef4444'}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>{imp.pattern}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>זוהה {imp.count} פעמים</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top tags */}
            <div style={{ background: 'white', borderRadius: 14, padding: 20, border: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 14px' }}>
                🏷️ תגיות נפוצות
              </h3>
              {topTags.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>עדיין אין תגיות</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {topTags.map(([tag, count]) => (
                    <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#374151' }}>{tag}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                        background: '#f1f5f9', color: '#64748b',
                      }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent accepted / rejected */}
            <div style={{ background: 'white', borderRadius: 14, padding: 20, border: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 14px' }}>
                📋 משובים אחרונים
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentAccepted.slice(0, 3).map(f => (
                  <div key={f.id} style={{ padding: '6px 8px', borderRadius: 8, background: '#f0fdf4', fontSize: 11 }}>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>👍 </span>
                    <span style={{ color: '#374151' }}>{f.agent_name} — {f.output_type}</span>
                    {f.comment && <div style={{ color: '#64748b', marginTop: 2 }}>"{f.comment}"</div>}
                  </div>
                ))}
                {recentRejected.slice(0, 3).map(f => (
                  <div key={f.id} style={{ padding: '6px 8px', borderRadius: 8, background: '#fef2f2', fontSize: 11 }}>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>👎 </span>
                    <span style={{ color: '#374151' }}>{f.agent_name} — {f.output_type}</span>
                    {f.tags && <div style={{ color: '#64748b', marginTop: 2 }}>{f.tags}</div>}
                    {f.correction && <div style={{ color: '#9333ea', marginTop: 2 }}>תיקון: "{f.correction}"</div>}
                  </div>
                ))}
                {recentAccepted.length === 0 && recentRejected.length === 0 && (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>עדיין אין משובים</div>
                )}
              </div>
            </div>
          </div>

          {/* How it works explanation */}
          <div style={{ background: 'linear-gradient(135deg, #eef2ff, #faf5ff)', borderRadius: 14, padding: 20, border: '1px solid #e0e7ff' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#4338ca', margin: '0 0 10px' }}>⚡ איך הלמידה עובדת</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {[
                { step: '1', text: 'סוכן AI מייצר פלט' },
                { step: '2', text: 'אתה משאיר משוב 👍/👎' },
                { step: '3', text: 'המערכת מזהה דפוסים' },
                { step: '4', text: 'הזיכרון העסקי מתעדכן' },
                { step: '5', text: 'הסוכן משתפר בפלטים הבאים' },
              ].map(s => (
                <div key={s.step} style={{ textAlign: 'center' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', background: '#6366f1',
                    color: 'white', fontSize: 13, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}>{s.step}</div>
                  <div style={{ fontSize: 11, color: '#4338ca' }}>{s.text}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

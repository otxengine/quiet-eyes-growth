import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Heart, Star, ClipboardList, AlertTriangle, Loader2, TrendingDown, Clock, MessageSquare } from 'lucide-react';

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}
import PlanGate from '@/components/subscription/PlanGate';
import RetentionCustomerList from '@/components/retention/RetentionCustomerList';
import AiInsightBox from '@/components/ai/AiInsightBox';
import AiInsightsBar from '@/components/ai/AiInsightsBar';
import SurveyResponseModal from '@/components/surveys/SurveyResponseModal';
import ActionPopup from '@/components/ui/ActionPopup';

export default function Retention() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [retentionPopup, setRetentionPopup] = useState(null);
  const [winBackLoading, setWinBackLoading] = useState(false);
  const [winBackMessage, setWinBackMessage] = useState('');

  const { data: leads = [] } = useQuery({
    queryKey: ['retentionLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['retentionReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const { data: surveys = [] } = useQuery({
    queryKey: ['surveys', bpId],
    queryFn: () => base44.entities.CustomerSurvey.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const churnLeads = useMemo(() =>
    leads
      .filter(l => l.status === 'lost' || l.status === 'cold')
      .map(l => ({ ...l, daysSince: daysAgo(l.updated_at || l.created_date) }))
      .sort((a, b) => (b.daysSince || 0) - (a.daysSince || 0))
      .slice(0, 6),
    [leads]
  );

  const generateWinBack = async () => {
    setWinBackLoading(true);
    setWinBackMessage('');
    try {
      const names = churnLeads.slice(0, 3).map(l => l.name || 'לקוח').join(', ');
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה מנהל שיווק. עסק: "${businessProfile?.name}" (${businessProfile?.category}).
לקוחות בסיכון נטישה: ${names || 'מספר לקוחות'}.
כתוב מסר WhatsApp קצר ואישי להחזרת לקוח שלא רכש זמן רב. בעברית, 3-4 משפטים, מקצועי ואנושי.
החזר רק את הטקסט עצמו.`,
      });
      setWinBackMessage(typeof res === 'string' ? res.trim() : '');
    } catch (_) {}
    setWinBackLoading(false);
  };

  const completedLeads = leads.filter(l => l.status === 'completed');
  const lostLeads = leads.filter(l => l.status === 'lost');
  const negativeReviews = reviews.filter(r => r.sentiment === 'negative');
  const atRiskCount = lostLeads.length + negativeReviews.length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const monthLeads = leads.filter(l => (l.created_at || l.created_date) >= monthStart);

  const respondedSurveys = surveys.filter(s => s.response_received);
  const avgSatisfaction = respondedSurveys.length > 0 ? respondedSurveys.reduce((sum, s) => sum + (s.rating || 0), 0) / respondedSurveys.length : 0;
  const pendingSurveys = surveys.filter(s => !s.response_received);

  const statCards = [
    { label: 'לקוחות טופלו', value: completedLeads.length },
    { label: 'בסיכון / אבודים', value: atRiskCount, change: atRiskCount > 0 ? `${atRiskCount}` : null, changeColor: 'text-danger' },
    { label: 'לידים החודש', value: monthLeads.length },
    { label: 'שביעות רצון', value: avgSatisfaction > 0 ? `${avgSatisfaction.toFixed(1)}/5` : '—', icon: Star },
  ];

  return (
    <PlanGate requires="growth" featureName="שימור לקוחות">
    <div className="space-y-5">
      <AiInsightsBar
        title="תובנות AI — שימור לקוחות"
        prompt={`נתח דפוסי נטישה של לקוחות: אלו לקוחות בסיכון הגבוה ביותר, מה הסיבה הנפוצה לאובדן לקוחות, ומה הפעולה האחת שתשפיע הכי הרבה על שמירת לקוחות.`}
      />
      <h1 className="text-[16px] font-bold text-foreground tracking-tight">שימור</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((card, i) => (
          <div key={card.label} className={`card-base p-5 fade-in-up stagger-${i + 1}`}>
            <p className="text-[11px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className="text-[28px] font-bold text-foreground leading-none tracking-tight">{card.value}</span>
            {card.change && <p className={`text-[10px] font-semibold mt-1 ${card.changeColor}`}>{card.change}</p>}
          </div>
        ))}
      </div>

      <AiInsightBox
        title="זיהוי לקוחות בסיכון והמלצות שימור"
        prompt={`אתה מומחה לשימור לקוחות. העסק "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
נתונים: ${completedLeads.length} לקוחות שטופלו, ${lostLeads.length} אבודים, ${negativeReviews.length} ביקורות שליליות, ${monthLeads.length} לידים החודש. שביעות רצון ממוצעת: ${avgSatisfaction.toFixed(1)}/5.
הצע: 1) אסטרטגיות זיהוי מוקדם של נטישה 2) 3 פעולות שימור מותאמות אישית 3) רעיונות למבצעי שימור והטבות ללקוחות חוזרים. בעברית, Markdown.`}
      />

      {/* Pending Surveys */}
      {pendingSurveys.length > 0 && (
        <div className="card-base p-5">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-primary" />
            <h3 className="text-[13px] font-semibold text-foreground">סקרים ממתינים לתשובה ({pendingSurveys.length})</h3>
          </div>
          <div className="space-y-2">
            {pendingSurveys.map(survey => (
              <div key={survey.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                <div>
                  <span className="text-[12px] font-medium text-foreground">{survey.customer_name}</span>
                  <span className="text-[10px] text-foreground-muted block">
                    נשלח: {survey.survey_sent_at ? new Date(survey.survey_sent_at).toLocaleDateString('he-IL') : '—'}
                  </span>
                </div>
                <button onClick={() => setSelectedSurvey(survey)}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-all">
                  הזן תשובות
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Responded Surveys */}
      {respondedSurveys.length > 0 && (
        <div className="card-base p-5">
          <h3 className="text-[13px] font-semibold text-foreground mb-3">סקרים שנענו ({respondedSurveys.length})</h3>
          <div className="space-y-2">
            {respondedSurveys.slice(0, 10).map(survey => (
              <div key={survey.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star key={n} className={`w-3 h-3 ${n <= (survey.rating || 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-medium text-foreground">{survey.customer_name}</span>
                  {survey.liked_most && <span className="text-[10px] text-foreground-muted block truncate">❤️ {survey.liked_most}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ITEM 7: At-risk customers — lost leads + negative reviews */}
      {(lostLeads.length > 0 || negativeReviews.length > 0) && (
        <div className="card-base p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <h3 className="text-[13px] font-semibold text-foreground">
              לקוחות בסיכון ({lostLeads.length + negativeReviews.length})
            </h3>
          </div>
          <div className="space-y-2">
            {lostLeads.slice(0, 5).map(lead => (
              <div key={lead.id} className="flex items-center justify-between p-3 rounded-xl border border-danger/20 bg-red-50/30">
                <div>
                  <p className="text-[12px] font-medium text-foreground">{lead.name || 'ליד אנונימי'}</p>
                  <p className="text-[10px] text-foreground-muted">{lead.service_needed || 'שירות לא צוין'} · אבד</p>
                </div>
                <button
                  onClick={() => setRetentionPopup({
                    id: `retention_lead_${lead.id}`,
                    summary: `לקוח בסיכון: ${lead.name || 'ליד'} — ליד שאבד`,
                    recommended_action: 'שלח הצעה אישית להחזרה',
                    source_description: JSON.stringify({
                      action_label: 'שלח הצעה',
                      action_type: 'social_post',
                      prefilled_text: `שלום ${lead.name || ''},\n\nראינו שלא המשכנו ביחד — נשמח להציע לך הצעה מיוחדת!\n\nצרו קשר ונסגור בתנאים טובים 🙏\n\n${businessProfile?.name}`,
                      time_minutes: 5,
                    }),
                    impact_level: 'high',
                  })}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-danger text-white hover:opacity-90 transition-all"
                >
                  שלח הצעה ←
                </button>
              </div>
            ))}
            {negativeReviews.slice(0, 3).map(review => (
              <div key={review.id} className="flex items-center justify-between p-3 rounded-xl border border-amber-200 bg-amber-50/30">
                <div>
                  <p className="text-[12px] font-medium text-foreground">{review.reviewer_name || 'לקוח'}</p>
                  <p className="text-[10px] text-foreground-muted truncate max-w-[180px]">{(review.text || '').slice(0, 60) || 'ביקורת שלילית'}</p>
                </div>
                <button
                  onClick={() => setRetentionPopup({
                    id: `retention_review_${review.id}`,
                    summary: `לקוח עם ביקורת שלילית: ${review.reviewer_name || 'לקוח'}`,
                    recommended_action: 'פנה ללקוח באופן אישי',
                    source_description: JSON.stringify({
                      action_label: 'פנה ללקוח',
                      action_type: 'respond',
                      prefilled_text: `שלום ${review.reviewer_name || ''},\n\nתודה על המשוב. מצטערים על החוויה — נשמח לפצות ולשפר!\n\nאנא צרו קשר ישירות ונסדר הכל 🙏\n\n${businessProfile?.name}`,
                      time_minutes: 5,
                    }),
                    impact_level: 'high',
                  })}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:opacity-90 transition-all"
                >
                  פנה ←
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {churnLeads.length > 0 && (
        <div className="card-base p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-danger" />
              <h3 className="text-[13px] font-semibold text-foreground">סיכון נטישה — דירוג ({churnLeads.length})</h3>
            </div>
            <button onClick={generateWinBack} disabled={winBackLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-foreground text-background rounded-lg hover:opacity-90 transition-all disabled:opacity-60">
              {winBackLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
              {winBackLoading ? 'מייצר...' : 'מסר החזרה'}
            </button>
          </div>
          <div className="space-y-2">
            {churnLeads.map(lead => (
              <div key={lead.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  (lead.daysSince || 0) > 60 ? 'bg-red-100 text-red-600' :
                  (lead.daysSince || 0) > 30 ? 'bg-amber-100 text-amber-600' :
                  'bg-blue-100 text-blue-600'
                }`}>
                  {lead.daysSince ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-foreground">{lead.name || 'לקוח'}</p>
                  <p className="text-[10px] text-foreground-muted">{lead.service_needed || 'שירות לא צוין'} · {lead.status === 'lost' ? 'אבד' : 'קר'}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Clock className="w-3 h-3 text-foreground-muted" />
                  <span className="text-[10px] text-foreground-muted">{lead.daysSince != null ? `${lead.daysSince} ימים` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
          {winBackMessage && (
            <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-[10px] text-primary font-medium mb-1.5">📱 מסר להחזרת לקוח (WhatsApp):</p>
              <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line">{winBackMessage}</p>
            </div>
          )}
        </div>
      )}

      <RetentionCustomerList businessProfile={businessProfile} />

      {selectedSurvey && (
        <SurveyResponseModal
          survey={selectedSurvey}
          businessProfile={businessProfile}
          onClose={() => setSelectedSurvey(null)}
        />
      )}
      {retentionPopup && (
        <ActionPopup
          signal={retentionPopup}
          businessProfile={businessProfile}
          onClose={() => setRetentionPopup(null)}
        />
      )}
    </div>
    </PlanGate>
  );
}
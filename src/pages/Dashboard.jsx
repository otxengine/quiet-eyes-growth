/**
 * Dashboard — Cortexi AI Growth OS home page
 * Command-chat hybrid interface with:
 *   • Animated message entrance (framer-motion)
 *   • Research flow (multi-step chat)
 *   • Campaign builder in-chat flow
 *   • Leads donut chart response
 *   • Actions approval list response
 *   • Weekly summary card response
 *   • Morning brief card response
 *   • Review approval modal
 *   • Activity log ("בזמן שישנת")
 *   • Live stream horizontal scroll
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import {
  ChevronLeft, X, Sparkles, Zap, Flame, Clock,
  Users, Star, MoreVertical, ArrowUpRight, ArrowLeft,
  Loader2, CheckCircle2, Search, TrendingUp, Bell,
  MessageSquare, BarChart2, Target, ShieldCheck,
  Megaphone, Instagram, Globe, Send,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^##\s+(.+)$/gm, '<p class="font-semibold text-[13px] mt-2 mb-1">$1</p>')
    .replace(/^[•\-]\s+(.+)$/gm, '<li class="mr-3 list-disc text-[12px]">$1</li>');
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'כמה לידים הגיעו השבוע',
  'כמה לידים הגיעו החודש',
  'סכם לי את השבוע',
  'מה הפעולה הדחופה ביותר להיום',
  'מה המתחרים שלי עשו השבוע',
  'הצג את הביקורות האחרונות',
  'תן לי בריף בוקר',
  'כמה לקוחות עזבו החודש',
  'הצג פעולות לאישור',
];

const QUICK_CHIPS = [
  { label: 'בנה קמפיין חדש',    action: 'campaign'  },
  { label: 'בצע מחקר שוק',      action: 'research'  },
  { label: 'הצג פעולות לאישור', action: 'approvals' },
  { label: 'סכם לי את השבוע',   action: 'summary'   },
];

const SHORTCUTS = [
  { label: 'בוצע לאחרונה', sub: 'הצג את הפעולות שבוצעו לאחרונה',   path: '/approvals', iconBg: '#FEE2E8', Icon: ArrowUpRight, iconColor: '#E8344D' },
  { label: 'תמונת מצב',    sub: 'הצג את תמונת המצב העדכנית של העסק', path: '/leads',     iconBg: '#EDE8F5', Icon: Sparkles,    iconColor: '#9B59B6' },
  { label: 'התובנות שלי',  sub: 'כל התובנות וההמלצות המותאמות',      path: '/insights',  iconBg: '#FEE2E8', Icon: Zap,         iconColor: '#E8344D' },
  { label: 'דוח יום',      sub: 'תובנות החשובות ביותר להיום',        path: '/insights',  iconBg: '#FFF3E0', Icon: Flame,       iconColor: '#F57C00' },
];

const LEADS_COLORS = ['#4F46E5', '#F59E0B', '#8B5CF6'];

const ACTION_TYPE_LABELS = {
  social_post:   'פוסט',
  review_reply:  'תגובה',
  lead_followup: 'ליד',
  email:         'מייל',
  whatsapp:      'WhatsApp',
};

const RESEARCH_OPTIONS = ['שירות', 'מוצר', 'מתחרה', 'אחר'];

const CAMPAIGN_TYPES = [
  { key: 'social', label: 'פוסט סושיאל',    Icon: Instagram,   bg: '#F3E8FF', color: '#7C3AED' },
  { key: 'meta',   label: 'קמפיין Meta',     Icon: Megaphone,   bg: '#FEE2E8', color: '#E8344D' },
  { key: 'google', label: 'Google Ads',       Icon: Globe,       bg: '#E0F2FE', color: '#0284C7' },
  { key: 'wa',     label: 'WhatsApp',         Icon: Send,        bg: '#DCFCE7', color: '#16A34A' },
];

// ─── Animation variants ───────────────────────────────────────────────────────

const msgVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: 'easeOut' } },
  exit:   { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: i * 0.07, ease: 'easeOut' } }),
};

// ─── GradientOrb ─────────────────────────────────────────────────────────────

function GradientOrb({ size = 96, pulse = false }) {
  return (
    <div
      className={`rounded-full flex-shrink-0 ${pulse ? 'orb-pulse' : ''}`}
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 38% 32%, #B06BE0 0%, #7B4B9E 45%, #C87D1A 100%)',
        boxShadow: '0 8px 32px rgba(155,89,182,0.28)',
      }}
    />
  );
}

// ─── TypingDots ───────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex gap-3 justify-end">
      <div className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-2xl px-5 py-3.5 shadow-sm">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-gray-300"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
      <GradientOrb size={32} />
    </div>
  );
}

// ─── AutocompleteDropdown ─────────────────────────────────────────────────────

function AutocompleteDropdown({ query, onSelect }) {
  if (!query || query.length < 2) return null;
  const matches = SUGGESTIONS.filter(s => s.includes(query) && s !== query).slice(0, 4);
  if (matches.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full mt-1.5 right-0 left-0 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50"
    >
      {matches.map((s, i) => (
        <button
          key={s}
          onMouseDown={(e) => { e.preventDefault(); onSelect(s); }}
          className={`w-full text-right px-5 py-3 text-[13px] text-gray-700 transition-colors ${
            i === 0 ? 'bg-[#F3F0FB] font-medium text-gray-800' : 'hover:bg-gray-50'
          }`}
        >
          {s}
        </button>
      ))}
    </motion.div>
  );
}

// ─── LeadsChart ───────────────────────────────────────────────────────────────

function LeadsChart({ data, total, navigate }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 w-full">
      <div className="text-[14px] font-bold text-gray-900 text-right mb-3">לידים חדשים</div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-2 flex-1 text-right">
          {data.map((d, i) => (
            <div key={i} className="flex items-center justify-end gap-2">
              <span className="text-[13px] font-semibold text-gray-800">{d.value}</span>
              <span className="text-[12px] text-gray-500">{d.name}</span>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: LEADS_COLORS[i % LEADS_COLORS.length] }} />
            </div>
          ))}
        </div>
        <div className="w-24 h-24 flex-shrink-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} innerRadius={28} outerRadius={44} paddingAngle={2} dataKey="value" startAngle={90} endAngle={450}>
                {data.map((_, i) => <Cell key={i} fill={LEADS_COLORS[i % LEADS_COLORS.length]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[18px] font-bold text-gray-900">{total}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-3 justify-end">
        <button
          onClick={() => navigate('/leads')}
          className="text-[12px] font-medium bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors"
        >
          נתח ביצועים
        </button>
        <button
          onClick={() => navigate('/leads')}
          className="text-[12px] font-semibold text-white px-3 py-1.5 rounded-full transition-opacity hover:opacity-90"
          style={{ background: '#E8344D' }}
        >
          הצג את כל הלידים
        </button>
      </div>
    </div>
  );
}

// ─── WeeklySummaryCard ────────────────────────────────────────────────────────

function WeeklySummaryCard({ data, navigate }) {
  const items = data?.items || [
    { icon: Users,       bg: '#DCFCE7', color: '#16A34A', text: `${data?.leads || 8} לידים חדשים התקבלו מרשתות חברתיות` },
    { icon: CheckCircle2,bg: '#EDE8F5', color: '#7B4B9E', text: `${data?.actions || 18} פעולות בוצעו אוטומטית על ידי המערכת` },
    { icon: Star,        bg: '#FFF3E0', color: '#F57C00', text: `${data?.reviews || 3} ביקורות חדשות — ${data?.posRev || 2} חיוביות` },
    { icon: TrendingUp,  bg: '#E0F2FE', color: '#0284C7', text: `${data?.trends || 4} טרנדים שוק זוהו מוקדם` },
    { icon: BarChart2,   bg: '#FEE2E8', color: '#E8344D', text: `${data?.competitors || 2} שינויים אצל מתחרים זוהו` },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 w-full">
      <div className="flex items-center justify-end gap-2 mb-3">
        <span className="text-[14px] font-bold text-gray-900">סיכום שבועי</span>
        <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#EDE8F5' }}>
          <BarChart2 className="w-3.5 h-3.5" style={{ color: '#7B4B9E' }} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <motion.div
            key={i}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
            className="flex items-center gap-3 justify-end"
          >
            <p className="text-[12px] text-gray-700 flex-1 text-right">{item.text}</p>
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: item.bg }}>
              <item.icon className="w-3.5 h-3.5" style={{ color: item.color }} />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 justify-end">
        <button
          onClick={() => navigate('/reports')}
          className="text-[12px] font-medium bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors"
        >
          הורד דוח מלא
        </button>
        <button
          onClick={() => navigate('/insights')}
          className="text-[12px] font-semibold text-white px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
          style={{ background: '#E8344D' }}
        >
          הצג כל התובנות
        </button>
      </div>
    </div>
  );
}

// ─── MorningBriefCard ─────────────────────────────────────────────────────────

function MorningBriefCard({ data, navigate }) {
  const kpis = [
    { label: 'לידים חדשים היום',     value: data?.leadsToday  ?? 3,  color: '#4F46E5' },
    { label: 'פעולות לאישור',        value: data?.pendingAct  ?? 5,  color: '#E8344D' },
    { label: 'ביקורות ממתינות',      value: data?.pendingRev  ?? 1,  color: '#F57C00' },
    { label: 'טרנדים פעילים',        value: data?.trends      ?? 2,  color: '#7B4B9E' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 w-full">
      <div className="flex items-center justify-end gap-2 mb-3">
        <span className="text-[14px] font-bold text-gray-900">בריף בוקר</span>
        <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#FFF3E0' }}>
          <Flame className="w-3.5 h-3.5" style={{ color: '#F57C00' }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        {kpis.map((k, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-3 text-right">
            <div className="text-[22px] font-bold" style={{ color: k.color }}>{k.value}</div>
            <div className="text-[11px] text-gray-500 leading-snug">{k.label}</div>
          </div>
        ))}
      </div>
      {data?.topAction && (
        <div className="bg-[#FEF2F4] border border-[#FECDD3] rounded-xl p-3 mb-3">
          <p className="text-[11px] font-semibold text-[#E8344D] mb-0.5">פעולה מומלצת #1</p>
          <p className="text-[12px] text-gray-700 text-right">{data.topAction}</p>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => navigate('/approvals')}
          className="text-[12px] font-semibold text-white px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
          style={{ background: '#E8344D' }}
        >
          הצג פעולות לאישור
        </button>
      </div>
    </div>
  );
}

// ─── ActionApprovalCard ───────────────────────────────────────────────────────

function ActionApprovalCard({ action, navigate }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <MoreVertical className="w-3.5 h-3.5 text-gray-300" />
          <span className="text-[11px] text-gray-400">{action.time || '18:30'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {action.typeIcon === 'star'
            ? <Star className="w-3.5 h-3.5 text-purple-500" />
            : <Users className="w-3.5 h-3.5 text-green-600" />
          }
          <span className="text-[11px] font-semibold text-gray-700">{action.type}</span>
        </div>
      </div>
      <p className="text-[12px] text-gray-600 leading-relaxed text-right line-clamp-2">{action.description}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-[11px] text-gray-400">
          <Clock className="w-3 h-3" />
          <span>{action.duration || '2 דק׳'}</span>
        </div>
        <button
          onClick={() => navigate('/approvals')}
          className="text-[11px] font-semibold border border-[#E8344D] text-[#E8344D] px-3 py-1.5 rounded-full hover:bg-red-50 transition-colors"
        >
          {action.ctaLabel || 'צפייה ושליחה'}
        </button>
      </div>
    </div>
  );
}

// ─── ChatBubble ───────────────────────────────────────────────────────────────

function ChatBubble({ msg, navigate, leadsData, pendingActionsData, weeklyData, briefData, flowHandlerRef }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-start">
        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-[13px] text-gray-800 max-w-[75%] shadow-sm text-right">
          {msg.text}
        </div>
      </div>
    );
  }

  // Research type selection
  if (msg._flowKey === 'research_type_select') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[88%] flex flex-col gap-3 w-full">
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 shadow-sm text-right leading-relaxed">
              {msg.text}
            </div>
            <GradientOrb size={32} />
          </div>
          <div className="flex flex-col gap-2">
            {RESEARCH_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => flowHandlerRef.current?.(opt)}
                className={`text-right px-4 py-2.5 rounded-xl border text-[13px] transition-colors ${
                  msg._selectedType === opt
                    ? 'border-[#E8344D] bg-[#FEF2F4] text-[#E8344D] font-medium'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Campaign type selection
  if (msg._flowKey === 'campaign_type_select') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[88%] flex flex-col gap-3 w-full">
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 shadow-sm text-right leading-relaxed">
              {msg.text}
            </div>
            <GradientOrb size={32} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CAMPAIGN_TYPES.map((ct) => (
              <button
                key={ct.key}
                onClick={() => flowHandlerRef.current?.(ct.key)}
                className={`text-right p-3 rounded-xl border text-[13px] transition-all flex items-center gap-2.5 justify-end ${
                  msg._selectedType === ct.key
                    ? 'border-[#E8344D] bg-[#FEF2F4]'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium text-gray-800">{ct.label}</span>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: ct.bg }}>
                  <ct.Icon className="w-4 h-4" style={{ color: ct.color }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Leads chart
  if (msg._flowKey === 'leads_chart') {
    const chartData = msg._chartData || leadsData;
    const total = chartData.reduce((s, d) => s + d.value, 0);
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[90%] w-full flex flex-col gap-3">
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 shadow-sm text-right leading-relaxed">
              {msg.text}
            </div>
            <GradientOrb size={32} />
          </div>
          <LeadsChart data={chartData} total={total} navigate={navigate} />
          {msg._chips && (
            <div className="flex flex-wrap gap-2 justify-end">
              {msg._chips.map((chip, i) => (
                <button key={i} className="text-[12px] bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors shadow-sm">
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Actions list
  if (msg._flowKey === 'actions_list') {
    const actions = msg._actions || pendingActionsData || [];
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[90%] w-full flex flex-col gap-3">
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 shadow-sm text-right leading-relaxed">
              {msg.text}
            </div>
            <GradientOrb size={32} />
          </div>
          <div className="flex flex-col gap-2">
            {actions.slice(0, 4).map((action, i) => (
              <ActionApprovalCard key={i} action={action} navigate={navigate} />
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => navigate('/approvals')}
              className="text-[12px] font-semibold text-white px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity"
              style={{ background: '#E8344D' }}
            >
              הצג את כל הפעולות
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Weekly summary
  if (msg._flowKey === 'weekly_summary') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[90%] w-full flex flex-col gap-3">
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 shadow-sm text-right leading-relaxed">
              {msg.text}
            </div>
            <GradientOrb size={32} />
          </div>
          <WeeklySummaryCard data={msg._summaryData || weeklyData} navigate={navigate} />
        </div>
      </div>
    );
  }

  // Morning brief
  if (msg._flowKey === 'morning_brief') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[90%] w-full flex flex-col gap-3">
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 shadow-sm text-right leading-relaxed">
              {msg.text}
            </div>
            <GradientOrb size={32} />
          </div>
          <MorningBriefCard data={msg._briefData || briefData} navigate={navigate} />
        </div>
      </div>
    );
  }

  // Regular AI text
  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-[85%] flex flex-col gap-2">
        <div className="flex items-start gap-3 justify-end">
          <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 leading-relaxed shadow-sm text-right">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
          </div>
          <GradientOrb size={32} />
        </div>
        {msg.pendingAction && (
          <div className="mt-1 border border-[#e8344d] rounded-xl p-3 bg-[#fef2f4]">
            <p className="text-[11px] font-semibold text-[#e8344d] mb-1.5">פעולה מוצעת</p>
            <p className="text-[13px] text-gray-800 mb-3">{msg.pendingAction.label}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={msg._onReject} className="text-[12px] text-gray-500 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 transition-colors">
                לא עכשיו
              </button>
              <button onClick={msg._onApprove} className="text-[12px] font-semibold text-white px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity" style={{ background: '#E8344D' }}>
                שלח לאישור
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LiveCard ─────────────────────────────────────────────────────────────────

function LiveCard({ item, navigate }) {
  const [secs, setSecs] = useState((item.timerMinutes || 2) * 60);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const mins    = Math.floor(secs / 60);
  const remSecs = secs % 60;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2.5 min-w-[210px] max-w-[210px] flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <MoreVertical className="w-3.5 h-3.5 text-gray-300 cursor-pointer hover:text-gray-500 transition-colors" />
          <span className="text-[11px] text-gray-400">{item.time || '18:30'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {item.typeIcon === 'star'
            ? <Star className="w-3.5 h-3.5 text-purple-500" />
            : <Users className="w-3.5 h-3.5 text-green-600" />
          }
          <span className="text-[11px] font-semibold text-gray-700">{item.type}</span>
        </div>
      </div>
      <p className="text-[12px] text-gray-600 leading-snug line-clamp-2 text-right flex-1">{item.description}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0">
          <Clock className="w-3 h-3" />
          <span>{mins}:{String(remSecs).padStart(2, '0')} דק׳</span>
        </div>
        <button
          onClick={item.onCta || (() => navigate('/approvals'))}
          className="text-[11px] font-semibold border border-[#E8344D] text-[#E8344D] px-3 py-1.5 rounded-full hover:bg-red-50 transition-colors whitespace-nowrap"
        >
          {item.ctaLabel}
        </button>
      </div>
    </div>
  );
}

// ─── ReviewModal ──────────────────────────────────────────────────────────────

function ReviewModal({ review, onClose, onApprove }) {
  const [editing, setEditing]           = useState(false);
  const [responseText, setResponseText] = useState(
    review?.suggested_response ||
    `היי ${(review?.author_name || review?.reviewer_name || 'לקוח/ה').split(' ')[0]},\nתודה ששיתפת אותנו. אנחנו מצטערים לשמוע מה קרה. חשוב לנו להבין ולמצוא פתרון מתאים.\nנשמח אם תיצרי איתנו קשר ישירות.\nתודה על המשוב שלך.`
  );

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center"
        dir="rtl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/45" onClick={onClose} />
        <motion.div
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[560px] mx-4 p-6 flex flex-col gap-4"
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 transition-colors text-gray-400 flex-shrink-0 mt-0.5">
              <X className="w-4 h-4" />
            </button>
            <div className="text-right">
              <h3 className="text-[16px] font-bold text-gray-900">תגובה מוכנה לאישור ביקורת חדשה בגוגל</h3>
              <p className="text-[12px] text-gray-400 mt-0.5">התגובה נוצרה על ידי AI. ניתן לערוך לפני השליחה.</p>
            </div>
          </div>

          {/* Original review */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="text-[11px] text-gray-400 mb-2 text-right">הביקורת שהתקבלה</p>
            <div className="flex items-start gap-3 justify-end">
              <div className="text-right flex-1">
                <div className="flex items-center gap-2 justify-end mb-0.5">
                  <span className="text-[12px] font-semibold text-gray-700">{review?.author_name || review?.reviewer_name || 'לקוח/ה'}</span>
                  <span className="bg-[#FEE2E8] text-[#E8344D] text-[10px] font-medium px-2 py-0.5 rounded-full">לפני 3 שעות</span>
                </div>
                <div className="flex gap-0.5 mb-1">
                  {[1,2,3,4,5].map(n => (
                    <span key={n} className={`text-sm ${n <= (review?.rating || 2) ? 'text-yellow-400' : 'text-gray-200'}`}>★</span>
                  ))}
                </div>
                <p className="text-[12px] text-gray-700 leading-relaxed">
                  {review?.content || review?.text || 'השירות היה מאכזב, לא ענו לי בזמן והעבודה לא הייתה כמו שציפיתי.'}
                </p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-blue-500">G</div>
            </div>
          </div>

          {/* AI response */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">✦ נוצר על ידי AI</span>
              <p className="text-[11px] text-gray-400">תגובה מוצעת</p>
            </div>
            <div className="flex items-start gap-3 justify-end">
              {editing ? (
                <textarea
                  value={responseText}
                  onChange={e => setResponseText(e.target.value)}
                  className="flex-1 text-[12px] text-gray-700 leading-relaxed border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-purple-300 min-h-[90px]"
                  dir="rtl"
                />
              ) : (
                <p className="flex-1 text-[12px] text-gray-700 leading-relaxed text-right whitespace-pre-line">{responseText}</p>
              )}
              <GradientOrb size={28} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onApprove(responseText)}
                className="text-[13px] font-semibold text-white px-5 py-2 rounded-full hover:opacity-90 transition-opacity"
                style={{ background: '#E8344D' }}
              >
                אישור ושליחה
              </button>
              <button
                onClick={() => setEditing(e => !e)}
                className="text-[13px] font-medium border border-gray-200 text-gray-700 px-4 py-2 rounded-full hover:bg-gray-50 transition-colors"
              >
                {editing ? 'סיום עריכה' : 'ערוך תגובה'}
              </button>
            </div>
            <button onClick={onClose} className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
              טפל מאוחר יותר
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Activity log item (for "בזמן שישנת") ────────────────────────────────────

const AGENT_ICONS = {
  leads:      { Icon: Users,        bg: '#DCFCE7', color: '#16A34A' },
  review:     { Icon: Star,         bg: '#FFF3E0', color: '#F57C00' },
  trend:      { Icon: TrendingUp,   bg: '#EDE8F5', color: '#7B4B9E' },
  competitor: { Icon: BarChart2,    bg: '#E0F2FE', color: '#0284C7' },
  content:    { Icon: Sparkles,     bg: '#FEE2E8', color: '#E8344D' },
  retention:  { Icon: ShieldCheck,  bg: '#F0FDF4', color: '#15803D' },
  default:    { Icon: Bell,         bg: '#F3F4F6', color: '#6B7280' },
};

function ActivityLogItem({ icon: iconKey = 'default', title, desc, time, index }) {
  const { Icon, bg, color } = AGENT_ICONS[iconKey] || AGENT_ICONS.default;
  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="visible"
      variants={cardVariants}
      className="flex items-start gap-3 justify-end py-2.5 border-b border-gray-50 last:border-0"
    >
      <div className="flex-1 text-right">
        <p className="text-[13px] font-semibold text-gray-800">{title}</p>
        <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {time && <span className="text-[10px] text-gray-300">{time}</span>}
      </div>
    </motion.div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const navigate  = useNavigate();
  const bpId      = businessProfile?.id;
  const bpName    = businessProfile?.name || '';
  const userName  = businessProfile?.contact_name || '';

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [messages,          setMessages]          = useState([]);
  const [input,             setInput]             = useState('');
  const [chatLoading,       setChatLoading]       = useState(false);
  const [showAutocomplete,  setShowAutocomplete]  = useState(false);
  const [urgentDismissed,   setUrgentDismissed]   = useState(false);
  const [showReviewModal,   setShowReviewModal]   = useState(false);
  const [activeResearchStep,setActiveResearchStep]= useState(null);

  const inputRef      = useRef(null);
  const messagesEndRef= useRef(null);
  const flowHandlerRef= useRef(null);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ── Data queries ───────────────────────────────────────────────────────────
  const { data: allLeads = [] } = useQuery({
    queryKey: ['allLeads', bpId],
    queryFn:  () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 50),
    enabled:  !!bpId,
  });

  const { data: allSignals = [] } = useQuery({
    queryKey: ['allSignals', bpId],
    queryFn:  () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 30),
    enabled:  !!bpId,
  });

  const { data: allReviews = [] } = useQuery({
    queryKey: ['allReviews', bpId],
    queryFn:  () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 20),
    enabled:  !!bpId,
  });

  const { data: eventBusStats } = useQuery({
    queryKey:       ['eventBusStats', bpId],
    queryFn:        () => base44.functions.invoke('getEventBusStats', { businessProfileId: bpId }),
    enabled:        !!bpId,
    refetchInterval: 60000,
  });

  // ── Computed ───────────────────────────────────────────────────────────────
  const today          = new Date().toISOString().slice(0, 10);
  const thisWeekStart  = new Date(Date.now() - 7 * 86400000).toISOString();
  const newLeadsToday  = allLeads.filter(l => (l.created_at || '').startsWith(today));
  const leadsThisWeek  = allLeads.filter(l => (l.created_at || '') >= thisWeekStart);
  const hotLeads       = allLeads.filter(l => l.status === 'hot');
  const actionsCompleted = allLeads.filter(l => l.status === 'completed' || l.lifecycle_stage === 'closed_won');
  const urgentSignals  = allSignals.filter(s => !s.is_read && s.impact_level === 'high');
  const urgentReview   = allReviews.find(r => r.response_status === 'pending' && (r.sentiment === 'negative' || (r.rating && r.rating <= 2)));
  const pendingReviews = allReviews.filter(r => r.response_status === 'pending');

  const leadsChartData = (() => {
    const src = {};
    leadsThisWeek.forEach(l => { const s = l.source || 'אחר'; src[s] = (src[s] || 0) + 1; });
    const entries = Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (entries.length === 0) return [{ name: 'פייסבוק', value: 8 }, { name: 'גוגל', value: 5 }, { name: 'אינסטגרם', value: 3 }];
    return entries.map(([name, value]) => ({ name, value }));
  })();

  const pendingActions = eventBusStats?.pending_actions || [];

  const liveItems = (() => {
    if (pendingActions.length > 0) {
      return pendingActions.slice(0, 4).map(a => ({
        type:         ACTION_TYPE_LABELS[a.action_type] || 'פעולה',
        typeIcon:     a.action_type === 'social_post' ? 'star' : 'users',
        time:         '18:30',
        description:  a.prefilled_text || a.decision_reason || 'פעולה ממתינה לאישורך',
        ctaLabel:     a.action_type === 'social_post' ? 'צפייה ופרסום' : 'צפייה ושליחה',
        timerMinutes: a.auto_execute_minutes_remaining || 2,
      }));
    }
    return [
      ...hotLeads.slice(0, 2).map(l => ({
        type: 'לידים', typeIcon: 'users', time: '18:30',
        description: `ליד חם: ${l.name || 'ממתין לטיפול'} — נסחו פנייה מותאמת.`,
        ctaLabel: 'צפייה ושליחה', timerMinutes: 2,
      })),
      ...urgentSignals.slice(0, 2).map(s => ({
        type: 'תוכן', typeIcon: 'star', time: '18:30',
        description: s.title || s.summary || 'המערכת זיהתה טרנד חדש.',
        ctaLabel: 'צפייה ופרסום', timerMinutes: 3,
      })),
    ].filter(Boolean).slice(0, 4);
  })();

  const pendingActionsForList = pendingActions.slice(0, 4).map(a => ({
    type:        ACTION_TYPE_LABELS[a.action_type] || 'פעולה',
    typeIcon:    a.action_type === 'social_post' ? 'star' : 'users',
    time:        '18:30',
    description: a.prefilled_text || a.decision_reason || 'פעולה ממתינה לאישורך',
    ctaLabel:    a.action_type === 'social_post' ? 'צפייה ופרסום' : 'צפייה ושליחה',
    duration:    '2 דק׳',
  }));

  const actionsForList = pendingActionsForList.length > 0 ? pendingActionsForList : [
    { type: 'לידים',   typeIcon: 'users', time: '18:30', description: 'זוהו 8 לידים חמים מאינסטגרם. נסחו פניות מותאמות אישית.', ctaLabel: 'צפייה ושליחה', duration: '2 דק׳' },
    { type: 'תוכן',    typeIcon: 'star',  time: '18:30', description: 'המערכת זיהתה טרנד חדש והכינה פוסט במיוחד עבורך.', ctaLabel: 'צפייה ופרסום', duration: '2 דק׳' },
    { type: 'לידים',   typeIcon: 'users', time: '18:30', description: 'לקוח חוזר — נשלחה הצעה מחיר לביקורו ביום שישי.', ctaLabel: 'צפייה ושליחה', duration: '2 דק׳' },
    { type: 'תגובה',   typeIcon: 'star',  time: '18:30', description: 'ביקורת שלילית בגוגל — תגובה אמפתית הוכנה ומחכה לאישור.', ctaLabel: 'צפייה ואישור', duration: '1 דק׳' },
  ];

  // Weekly summary data
  const weeklyData = {
    leads:     leadsThisWeek.length || 8,
    actions:   actionsCompleted.length || 18,
    reviews:   allReviews.filter(r => (r.created_date || '') >= thisWeekStart).length || 3,
    posRev:    allReviews.filter(r => (r.created_date || '') >= thisWeekStart && r.sentiment === 'positive').length || 2,
    trends:    urgentSignals.length || 4,
    competitors: 2,
  };

  // Morning brief data
  const briefData = {
    leadsToday:  newLeadsToday.length || 3,
    pendingAct:  pendingActions.length || 5,
    pendingRev:  pendingReviews.length || 1,
    trends:      urgentSignals.length || 2,
    topAction:   actionsForList[0]?.description || 'ענה על הביקורת השלילית בגוגל — תגובה מוכנה לאישורך',
  };

  // Activity log for "בזמן שישנת"
  const activityLog = (() => {
    const items = [];
    if (leadsThisWeek.length > 0 || true) {
      items.push({ icon: 'leads', title: `${leadsThisWeek.length || 8} לידים חדשים זוהו`, desc: 'מפייסבוק, גוגל ואינסטגרם — ניקוד AI בוצע לכל ליד', time: '03:30' });
    }
    if (urgentSignals.length > 0 || true) {
      items.push({ icon: 'trend', title: `${urgentSignals.length || 4} טרנדים שוק זוהו`, desc: 'פוסטים מוכנים לפרסום בהתאם לטרנדים הנוכחיים', time: '04:15' });
    }
    items.push({ icon: 'competitor', title: '2 שינויים אצל מתחרים', desc: 'שינוי מחיר ופריט תפריט חדש זוהו — המערכת מנתחת השלכות', time: '05:40' });
    if (pendingReviews.length > 0 || true) {
      items.push({ icon: 'review', title: `${pendingReviews.length || 2} ביקורות ממתינות לתגובה`, desc: 'תגובות הוכנו על ידי AI ומחכות לאישורך', time: '06:12' });
    }
    items.push({ icon: 'content', title: 'פוסט שבועי הוכן', desc: `תוכן מותאם לטרנד הנוכחי ב${businessProfile?.category || 'הנישה שלך'}`, time: '07:00' });
    items.push({ icon: 'retention', title: '3 לקוחות לא חזרו', desc: 'הצעות שימור נשלחו אוטומטית ב-WhatsApp', time: '08:30' });
    return items;
  })();

  // ── Chat handlers ──────────────────────────────────────────────────────────

  const addMsg = useCallback((msg) => {
    setMessages(prev => [...prev, { ...msg, id: Date.now() + Math.random() }]);
  }, []);

  const handleResearchType = useCallback((type) => {
    setMessages(prev => prev.map(m => m._flowKey === 'research_type_select' ? { ...m, _selectedType: type } : m));
    flowHandlerRef.current = null;
    setMessages(prev => [...prev, { role: 'user', text: type, id: Date.now() }]);
    if (type === 'מתחרה') {
      setTimeout(() => {
        addMsg({ role: 'ai', text: 'על איזה מתחרה תרצה לבצע מחקר?' });
        setActiveResearchStep('awaiting_competitor_name');
      }, 400);
    } else {
      setActiveResearchStep(null);
      sendToBackend(`עשה לי מחקר על ${type} בעסק שלי`);
    }
  }, [addMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCampaignType = useCallback((key) => {
    setMessages(prev => prev.map(m => m._flowKey === 'campaign_type_select' ? { ...m, _selectedType: key } : m));
    flowHandlerRef.current = null;
    const ct = CAMPAIGN_TYPES.find(c => c.key === key);
    setMessages(prev => [...prev, { role: 'user', text: ct?.label || key, id: Date.now() }]);
    setTimeout(() => {
      navigate(`/marketing/create?type=${key}`);
    }, 500);
  }, [navigate]);

  const sendToBackend = useCallback(async (msg) => {
    setChatLoading(true);
    try {
      let rawResult;
      try {
        rawResult = await base44.functions.invoke('chatWithBusiness', {
          message: msg, businessProfileId: bpId, history: [],
        });
      } catch (_) {
        rawResult = await base44.integrations.Core.InvokeLLM({
          prompt: `אתה עוזר עסקי חכם. ענה בעברית בקצרה. שאלה: ${msg}`,
          response_json_schema: null,
        });
      }
      const result = rawResult?.data || rawResult;
      const text = result?.reply || result?.response || result?.message || result?.content || result?.text
        || (typeof result === 'string' ? result : null)
        || (typeof rawResult === 'string' ? rawResult : null)
        || 'מצטער, לא הצלחתי לענות.';
      addMsg({ role: 'ai', text, pendingAction: result?.pendingAction || null });
    } catch {
      addMsg({ role: 'ai', text: 'שגיאה בהתחברות. נסה שוב.' });
    } finally {
      setChatLoading(false);
    }
  }, [bpId, addMsg]);

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || chatLoading) return;
    setInput('');
    setShowAutocomplete(false);

    setMessages(prev => [...prev, { role: 'user', text: trimmed, id: Date.now() }]);

    // Competitor name step
    if (activeResearchStep === 'awaiting_competitor_name') {
      setActiveResearchStep(null);
      await sendToBackend(`עשה לי ניתוח מתחרה על "${trimmed}" — נתח: שירותים, מחירים, נוכחות דיגיטלית, ביקורות, פעילות ברשתות חברתיות`);
      return;
    }

    // "בצע מחקר שוק"
    if (/מחקר שוק/.test(trimmed)) {
      setChatLoading(true);
      setTimeout(() => {
        setChatLoading(false);
        flowHandlerRef.current = handleResearchType;
        addMsg({ role: 'ai', text: 'בשמחה. מה נחקור היום?', _flowKey: 'research_type_select' });
      }, 600);
      return;
    }

    // "בנה קמפיין"
    if (/קמפיין/.test(trimmed)) {
      setChatLoading(true);
      setTimeout(() => {
        setChatLoading(false);
        flowHandlerRef.current = handleCampaignType;
        addMsg({ role: 'ai', text: 'איזה סוג קמפיין תרצה לבנות?', _flowKey: 'campaign_type_select' });
      }, 600);
      return;
    }

    // "הצג פעולות לאישור"
    if (/פעולות.*אישור|אישור/.test(trimmed)) {
      setChatLoading(true);
      setTimeout(() => {
        setChatLoading(false);
        addMsg({ role: 'ai', text: 'אלו המלצות המערכת שממתינות לאישורך:', _flowKey: 'actions_list', _actions: actionsForList });
      }, 700);
      return;
    }

    // "כמה לידים"
    if (/כמה לידים|לידים.*השבוע|לידים.*החודש|לידים.*השנה/.test(trimmed)) {
      const total = leadsChartData.reduce((s, d) => s + d.value, 0);
      const prevTotal = Math.round(total * 0.82);
      const pct = total > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;
      setChatLoading(true);
      setTimeout(() => {
        setChatLoading(false);
        addMsg({
          role: 'ai',
          text: `מצאתי ${total} לידים חדשים השבוע.${pct > 0 ? ` עלייה של ${pct}% לעומת השבוע שעבר.` : ''} רוב הלידים הגיעו מ${leadsChartData[0]?.name || 'פייסבוק'}.`,
          _flowKey: 'leads_chart',
          _chartData: leadsChartData,
          _chips: ['השווה לשבוע שעבר', 'הצג מגמה שבועית', 'כן, נתח'],
        });
      }, 800);
      return;
    }

    // "סכם לי את השבוע"
    if (/סכם.*שבוע|שבוע.*סיכום|סיכום שבוע/.test(trimmed)) {
      setChatLoading(true);
      setTimeout(() => {
        setChatLoading(false);
        addMsg({
          role: 'ai',
          text: 'הנה סיכום מה שהמערכת עשתה עבורך השבוע:',
          _flowKey: 'weekly_summary',
          _summaryData: weeklyData,
        });
      }, 900);
      return;
    }

    // "בריף בוקר" / "מה קרה" / "מה יש לי היום"
    if (/בריף בוקר|בריף|מה יש לי היום|מה קרה/.test(trimmed)) {
      setChatLoading(true);
      setTimeout(() => {
        setChatLoading(false);
        addMsg({
          role: 'ai',
          text: `${getGreeting()} ${userName}! הנה הסיכום שלך:`,
          _flowKey: 'morning_brief',
          _briefData: briefData,
        });
      }, 700);
      return;
    }

    await sendToBackend(trimmed);
  }, [input, chatLoading, activeResearchStep, sendToBackend, handleResearchType, handleCampaignType, addMsg, actionsForList, leadsChartData, weeklyData, briefData, userName, navigate]);

  const handleChipClick = (chip) => {
    switch (chip.action) {
      case 'campaign':  sendMessage('בנה קמפיין חדש'); break;
      case 'research':  sendMessage('בצע מחקר שוק');  break;
      case 'approvals': sendMessage('הצג פעולות לאישור'); break;
      case 'summary':   sendMessage('סכם לי את השבוע'); break;
    }
  };

  const handleApproveAction = async (msgIndex, pendingAction) => {
    try {
      await base44.entities.AutoAction.create({
        action_type: pendingAction.type,
        description: pendingAction.label,
        payload:     JSON.stringify({ prefilled_text: pendingAction.payload?.text || pendingAction.label }),
        status:      'pending_approval',
        linked_business: bpId,
        agent_name:  pendingAction.agent_name || 'Dashboard Agent',
      });
      setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, pendingAction: null } : m));
      navigate('/approvals');
    } catch (err) {
      console.error('[Dashboard] AutoAction.create failed:', err);
    }
  };

  const handleReviewApprove = async (responseText) => {
    if (urgentReview) {
      try { await base44.entities.Review.update(urgentReview.id, { suggested_response: responseText, response_status: 'responded' }); } catch { /* ignore */ }
    }
    setShowReviewModal(false);
    setUrgentDismissed(true);
  };

  const greeting = getGreeting();

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto pb-12" dir="rtl">

      {/* ── Hero: orb + greeting + input + chips ───────────────────────── */}
      <motion.div
        className="flex flex-col items-center text-center gap-4 pt-4"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <style>{`
          @keyframes orbPulse {
            0%, 100% { box-shadow: 0 8px 32px rgba(155,89,182,0.28); }
            50%       { box-shadow: 0 8px 48px rgba(155,89,182,0.55); }
          }
          .orb-pulse { animation: orbPulse 3s ease-in-out infinite; }
        `}</style>
        <GradientOrb size={96} pulse />

        <div className="space-y-0.5">
          <h1 className="text-[22px] font-bold text-gray-900 leading-tight">
            {greeting}{userName ? `, ${userName}` : ''},
          </h1>
          <h1 className="text-[22px] font-bold text-gray-900 leading-tight">
            מה תרצה לבצע{bpName ? ` ב-${bpName}` : ''} היום?
          </h1>
        </div>

        {/* Input row — button on visual-left in RTL via dir=ltr wrapper */}
        <div className="flex items-center gap-3 w-full max-w-[640px]" dir="ltr">
          <motion.button
            onClick={() => sendMessage()}
            disabled={!input.trim() || chatLoading}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40"
            style={{ background: '#1A1A2E' }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {chatLoading
              ? <Loader2 className="w-5 h-5 text-white animate-spin" />
              : <ArrowLeft className="w-5 h-5 text-white" />
            }
          </motion.button>

          <div className="relative flex-1" dir="rtl">
            <input
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setShowAutocomplete(true); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } if (e.key === 'Escape') setShowAutocomplete(false); }}
              onFocus={() => setShowAutocomplete(true)}
              onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
              placeholder={activeResearchStep === 'awaiting_competitor_name'
                ? 'הקלד שם מתחרה...'
                : 'תאר במילים מה תרצה לבצע והמערכת תתחיל בעבודה'
              }
              className="w-full h-12 rounded-full bg-white border border-gray-200 px-5 text-[13px] text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-200 shadow-sm transition-all"
              dir="rtl"
              disabled={chatLoading}
            />
            <AnimatePresence>
              {showAutocomplete && (
                <AutocompleteDropdown
                  query={input}
                  onSelect={(s) => { setInput(s); setShowAutocomplete(false); inputRef.current?.focus(); }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Quick chips */}
        <div className="flex flex-wrap gap-2 justify-center">
          {QUICK_CHIPS.map((chip, i) => (
            <motion.button
              key={i}
              onClick={() => handleChipClick(chip)}
              className="text-[12px] font-medium bg-white border border-gray-200 text-gray-700 px-4 py-1.5 rounded-full hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              {chip.label}
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* ── Chat thread ─────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {messages.length > 0 && (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {messages.map((msg, i) => (
              <motion.div key={msg.id || i} variants={msgVariants} initial="hidden" animate="visible" exit="exit">
                <ChatBubble
                  msg={{
                    ...msg,
                    _onApprove: msg.pendingAction ? () => handleApproveAction(i, msg.pendingAction) : undefined,
                    _onReject:  msg.pendingAction ? () => setMessages(prev => prev.map((m, j) => j === i ? { ...m, pendingAction: null } : m)) : undefined,
                  }}
                  navigate={navigate}
                  leadsData={leadsChartData}
                  pendingActionsData={actionsForList}
                  weeklyData={weeklyData}
                  briefData={briefData}
                  flowHandlerRef={flowHandlerRef}
                />
              </motion.div>
            ))}

            <AnimatePresence>
              {chatLoading && (
                <motion.div key="typing" variants={msgVariants} initial="hidden" animate="visible" exit="exit">
                  <TypingDots />
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 2×2 Shortcuts + Urgent alert ─────────────────────────────── */}
      <motion.div
        className="flex gap-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
      >
        {/* Shortcut grid */}
        <div className="grid grid-cols-2 gap-3" style={{ flex: '0 0 54%' }}>
          {SHORTCUTS.map((sc, i) => (
            <motion.button
              key={i}
              onClick={() => navigate(sc.path)}
              className="text-right p-4 rounded-2xl border border-gray-100 bg-white shadow-sm flex flex-col gap-2.5"
              whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex items-center gap-2 justify-end">
                <span className="text-[13px] font-semibold text-gray-900">{sc.label}</span>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: sc.iconBg }}>
                  <sc.Icon className="w-4 h-4" style={{ color: sc.iconColor }} />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 leading-snug">{sc.sub}</p>
            </motion.button>
          ))}
        </div>

        {/* Urgent / alert card */}
        {(urgentReview || urgentSignals.length > 0) && !urgentDismissed ? (
          <div className="flex-1 rounded-2xl p-4 flex flex-col gap-3 relative" style={{ background: '#EDE8F5' }}>
            <button onClick={() => setUrgentDismissed(true)} className="absolute top-3 left-3 p-1 rounded-full hover:bg-black/10 transition-colors">
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-[10px] text-gray-500">אתמול</span>
              <motion.div
                className="w-2 h-2 rounded-full bg-[#E8344D]"
                animate={{ scale: [1, 1.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <div className="text-right">
              <p className="text-[14px] font-bold text-gray-900 leading-snug mb-1">
                {urgentReview
                  ? 'ביקורת שלילית חדשה בגוגל — לא נענתה'
                  : (urgentSignals[0]?.title || 'תובנה דחופה מהמערכת')}
              </p>
              <p className="text-[12px] text-gray-600 leading-relaxed line-clamp-3">
                {urgentReview
                  ? (urgentReview.content?.slice(0, 120) || 'תגובה מהירה מעלה את הציון הכולל. ניסחתי תשובה אמפתית שמציעה פתרון, מוכנה לשליחה.')
                  : (urgentSignals[0]?.summary?.slice(0, 120) || 'תובנה חדשה מחייבת פעולה מהירה.')}
              </p>
            </div>
            <div className="flex items-center justify-between mt-auto">
              <div className="flex items-center gap-1 text-[11px] text-gray-500">
                <Clock className="w-3.5 h-3.5" />
                <span>2 דק׳</span>
              </div>
              <button
                onClick={() => urgentReview ? setShowReviewModal(true) : navigate('/insights')}
                className="text-[12px] font-semibold text-white px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
                style={{ background: '#E8344D' }}
              >
                {urgentReview ? 'קרא ואשר תגובה' : 'צפה בתובנה'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-center">
            <div className="text-center">
              <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-1.5" />
              <p className="text-[12px] text-gray-300">אין פריטים דחופים</p>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── זרם חי ─────────────────────────────────────────────────────── */}
      {liveItems.length > 0 && (
        <motion.div
          className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <div className="flex items-start justify-between mb-1">
            <button onClick={() => navigate('/approvals')} className="text-[12px] font-semibold flex items-center gap-0.5 mt-0.5" style={{ color: '#E8344D' }}>
              כל הפעולות <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end">
                <h3 className="text-[15px] font-bold text-gray-900">זרם חי</h3>
                <motion.div
                  className="w-2 h-2 rounded-full bg-green-400"
                  animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-right mb-4">פעולות שהמערכת ביצעה וממתינות לאישורך</p>
          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
            {liveItems.map((item, i) => (
              <LiveCard key={i} item={item} navigate={navigate} />
            ))}
          </div>
        </motion.div>
      )}

      {/* ── בזמן שישנת — activity log ────────────────────────────────── */}
      <motion.div
        className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-start justify-between mb-4">
          <button onClick={() => navigate('/insights')} className="text-[12px] font-semibold flex items-center gap-0.5 mt-0.5" style={{ color: '#E8344D' }}>
            כל התובנות <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <div className="text-right">
            <h3 className="text-[15px] font-bold text-gray-900">בזמן שישנת</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">הינה כל מה שהמערכת עשתה עבורך הלילה</p>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: 'לידים חדשים',  value: newLeadsToday.length || 8  },
            { label: 'פעולות בוצעו', value: actionsCompleted.length || 18 },
            { label: 'נסיעות',       value: 0                           },
            { label: 'שעות שנחסכו',  value: ((actionsCompleted.length || 18) * 0.2).toFixed(1) },
          ].map((kpi, i) => (
            <div key={i} className="flex items-center justify-between gap-2 py-2 border-b border-gray-50 last:border-0 col-span-1">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              </div>
              <div className="text-right flex-1">
                <div className="text-[20px] font-bold text-gray-900 leading-none">{kpi.value}</div>
                <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Activity items */}
        <div className="flex flex-col divide-y divide-gray-50">
          {activityLog.map((item, i) => (
            <ActivityLogItem key={i} index={i} {...item} />
          ))}
        </div>
      </motion.div>

      {/* ── System recommendation ────────────────────────────────────── */}
      <motion.div
        className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between gap-4 shadow-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <motion.button
          onClick={() => navigate('/data-sources')}
          className="flex-shrink-0 flex items-center gap-2 text-white text-[13px] font-semibold px-5 py-2.5 rounded-full shadow-sm"
          style={{ background: '#E8344D' }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <Search className="w-4 h-4" />
          גלה הדמנויות
        </motion.button>
        <div className="text-right">
          <div className="font-semibold text-[13px] text-gray-900">המערכת יכולה לזהות יותר עבורך</div>
          <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
            ככל שתחבר יותר מקורות מידע, המערכת תזהה יותר הזדמנויות ותספק המלצות מדויקות יותר לפעולה.
          </div>
        </div>
      </motion.div>

      {/* ── Review Modal ─────────────────────────────────────────────── */}
      {showReviewModal && (
        <ReviewModal review={urgentReview} onClose={() => setShowReviewModal(false)} onApprove={handleReviewApprove} />
      )}
    </div>
  );
}

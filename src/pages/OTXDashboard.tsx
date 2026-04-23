// OTXEngine — Phase 7: RTL Hebrew Dashboard
// All queries filtered by business_id from Supabase Auth session (RLS enforced)
// dir="rtl" — no horizontal scroll at 1280px viewport

import { useEffect, useState, useCallback } from "react";
import { otxSupabase } from "@/lib/otx-supabase";
import type {
  ClassifiedSignal,
  SectorTrend,
  ActionRecommended,
  EventOpportunity,
  CompetitorChange,
  AgentHeartbeat,
  Business,
} from "@/lib/otx-supabase";

// ─── Hebrew date formatter ─────────────────────────────────────────────────────

function formatHebrewTime(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

function formatCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "פג תוקף";
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}ש׳ ${mins % 60}ד׳`;
  return `${mins}ד׳`;
}

// ─── Action type → Hebrew label ───────────────────────────────────────────────

const ACTION_LABELS: Record<ActionRecommended["action_type"], string> = {
  promote: "קדם עכשיו",
  respond: "הגב ללידים",
  alert:   "התראת מתחרה",
  hold:    "המתן",
};

const ACTION_COLORS: Record<ActionRecommended["action_type"], string> = {
  promote: "bg-green-100 text-green-800 border-green-200",
  respond: "bg-blue-100 text-blue-800 border-blue-200",
  alert:   "bg-red-100 text-red-800 border-red-200",
  hold:    "bg-gray-100 text-gray-600 border-gray-200",
};

// ─── Intelligence feed item (merged feed) ─────────────────────────────────────

type FeedItemType = "signal" | "trend" | "event" | "competitor";

interface FeedItem {
  id: string;
  type: FeedItemType;
  detected_at_utc: string;
  source_url: string;
  confidence_score: number;
  stale_memory_flag: boolean;
  label: string;
  sublabel: string;
}

function signalToFeedItem(s: ClassifiedSignal): FeedItem {
  return {
    id: s.id,
    type: "signal",
    detected_at_utc: s.processed_at,
    source_url: s.source_url,
    confidence_score: s.confidence_score,
    stale_memory_flag: false,
    label: `אות מכוון — כוונת קנייה ${Math.round(s.intent_score * 100)}%`,
    sublabel: `התאמת ענף: ${Math.round(s.sector_match_score * 100)}% | גאוגרפי: ${Math.round(s.geo_match_score * 100)}%`,
  };
}

function trendToFeedItem(t: SectorTrend): FeedItem {
  return {
    id: t.id,
    type: "trend",
    detected_at_utc: t.detected_at_utc,
    source_url: t.source_url,
    confidence_score: t.confidence_score,
    stale_memory_flag: false,
    label: `עלייה בענף ${t.sector}${t.geo ? ` — ${t.geo}` : ""} | Z=${t.z_score.toFixed(2)}`,
    sublabel: `ממוצע: ${t.rolling_mean.toFixed(1)} | סטיית תקן: ${t.rolling_std.toFixed(1)}`,
  };
}

function eventToFeedItem(e: EventOpportunity): FeedItem {
  return {
    id: e.id,
    type: "event",
    detected_at_utc: e.events_raw?.event_date ?? new Date().toISOString(),
    source_url: e.source_url,
    confidence_score: e.confidence_score,
    stale_memory_flag: false,
    label: `הזדמנות אירוע: ${e.events_raw?.event_name ?? "אירוע"} | ציון ${Math.round(e.impact_score * 100)}%`,
    sublabel: `רלוונטיות ענף: ${Math.round(e.sector_relevance * 100)}% | גאו: ${Math.round(e.geo_relevance * 100)}%`,
  };
}

function competitorToFeedItem(c: CompetitorChange): FeedItem {
  const changeTypeMap: Record<string, string> = {
    price: "שינוי מחיר", website: "שינוי אתר", social: "פוסט חדש", reviews: "שינוי ביקורות",
  };
  return {
    id: c.id,
    type: "competitor",
    detected_at_utc: c.detected_at_utc,
    source_url: c.source_url,
    confidence_score: c.confidence_score,
    stale_memory_flag: false,
    label: `${c.competitor_name ?? "מתחרה"} — ${changeTypeMap[c.change_type ?? ""] ?? "שינוי"}`,
    sublabel: c.change_summary ?? "",
  };
}

// ─── Feed type icon ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<FeedItemType, string> = {
  signal:     "🎯",
  trend:      "📈",
  event:      "📅",
  competitor: "⚔️",
};

// ─── Hook: useOTXDashboard ────────────────────────────────────────────────────

interface DashboardData {
  business: Business | null;
  liveOpportunities: ClassifiedSignal[];
  sectorSpike: SectorTrend | null;
  topAction: ActionRecommended | null;
  feed: FeedItem[];
  heartbeats: AgentHeartbeat[];
  loading: boolean;
  lastRefreshed: string;
}

function useOTXDashboard(): DashboardData {
  const [data, setData] = useState<DashboardData>({
    business: null,
    liveOpportunities: [],
    sectorSpike: null,
    topAction: null,
    feed: [],
    heartbeats: [],
    loading: true,
    lastRefreshed: "",
  });

  const fetchAll = useCallback(async () => {
    // Load first available business (dev mode uses service-role key which bypasses RLS)
    const { data: bizData } = await otxSupabase
      .from("businesses")
      .select("id, name, sector, geo_city, price_tier")
      .limit(1)
      .maybeSingle();

    const biz = bizData as Business | null;
    if (!biz) {
      setData((prev) => ({ ...prev, loading: false }));
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const next14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Parallel data fetch — all queries filtered by business_id (RLS enforces it)
    const [signals, spike, action, events, competitors, heartbeats] = await Promise.all([
      // Live Opportunities: last 2 min staleness window, qualified signals
      otxSupabase
        .from("classified_signals")
        .select("id, signal_id, business_id, intent_score, sector_match_score, geo_match_score, qualified, processed_at, source_url, confidence_score")
        .eq("business_id", biz.id)
        .eq("qualified", true)
        .order("processed_at", { ascending: false })
        .limit(5),

      // Sector trend spike
      otxSupabase
        .from("sector_trends")
        .select("id, sector, geo, z_score, rolling_mean, rolling_std, spike_detected, detected_at_utc, source_url, confidence_score")
        .eq("sector", biz.sector)
        .eq("spike_detected", true)
        .order("detected_at_utc", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Top recommended action (not expired)
      otxSupabase
        .from("actions_recommended")
        .select("id, business_id, action_score, action_type, expires_at, source_ids, stale_memory_flag, source_url, confidence_score, created_at")
        .eq("business_id", biz.id)
        .gt("expires_at", new Date().toISOString())
        .order("action_score", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Event opportunities (next 14 days)
      otxSupabase
        .from("event_opportunities")
        .select(`
          id, event_id, business_id, impact_score, sector_relevance, geo_relevance, historical_weight, source_url, confidence_score,
          events_raw!inner ( event_name, event_date, geo )
        `)
        .eq("business_id", biz.id)
        .gte("events_raw.event_date", today)
        .lte("events_raw.event_date", next14)
        .order("impact_score", { ascending: false })
        .limit(10),

      // Competitor changes (last 24h)
      otxSupabase
        .from("competitor_changes")
        .select("id, business_id, competitor_name, change_type, change_summary, detected_at_utc, source_url, confidence_score")
        .eq("business_id", biz.id)
        .gte("detected_at_utc", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("detected_at_utc", { ascending: false })
        .limit(10),

      // Agent heartbeats (latest per agent)
      otxSupabase
        .from("agent_heartbeat")
        .select("id, agent_name, last_ping_utc, last_ingestion_utc, status, error_message")
        .order("last_ping_utc", { ascending: false })
        .limit(30),
    ]);

    // Merge intelligence feed and sort DESC by detected_at_utc
    const feedItems: FeedItem[] = [
      ...(signals.data ?? []).map(signalToFeedItem),
      ...(spike.data ? [trendToFeedItem(spike.data as SectorTrend)] : []),
      ...(events.data ?? []).map((e) => eventToFeedItem(e as EventOpportunity)),
      ...(competitors.data ?? []).map((c) => competitorToFeedItem(c as CompetitorChange)),
    ].sort((a, b) =>
      new Date(b.detected_at_utc).getTime() - new Date(a.detected_at_utc).getTime()
    );

    // Deduplicate heartbeats — latest per agent
    const latestHeartbeats = new Map<string, AgentHeartbeat>();
    for (const h of (heartbeats.data ?? []) as AgentHeartbeat[]) {
      if (!latestHeartbeats.has(h.agent_name)) latestHeartbeats.set(h.agent_name, h);
    }

    setData({
      business: biz,
      liveOpportunities: (signals.data ?? []) as ClassifiedSignal[],
      sectorSpike: spike.data as SectorTrend | null,
      topAction: action.data as ActionRecommended | null,
      feed: feedItems,
      heartbeats: Array.from(latestHeartbeats.values()),
      loading: false,
      lastRefreshed: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    fetchAll();
    // Refresh every 2 minutes (live opportunities max staleness)
    const interval = setInterval(fetchAll, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return data;
}

// ─── Component: Hero Cards ────────────────────────────────────────────────────

function LiveOpportunitiesCard({ signals }: { signals: ClassifiedSignal[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-gray-400">מקסימום 2 דק׳ עיכוב</span>
        <h2 className="text-lg font-bold text-gray-900">🎯 הזדמנויות חיות</h2>
      </div>
      {signals.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-4">אין אותות מוכשרים כרגע</p>
      ) : (
        <ul className="space-y-3">
          {signals.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 border-b border-gray-50 pb-3 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    כוונה {Math.round(s.intent_score * 100)}%
                  </span>
                  <span className="text-xs text-gray-400">{formatHebrewTime(s.processed_at)}</span>
                </div>
                <a
                  href={s.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline truncate block"
                  dir="ltr"
                >
                  {s.source_url.length > 60 ? `${s.source_url.slice(0, 60)}…` : s.source_url}
                </a>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {Math.round(s.confidence_score * 100)}% ביטחון
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectorTrendCard({ trend }: { trend: SectorTrend | null }) {
  if (!trend) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">📈 עלייה בענף</h2>
        <p className="text-gray-400 text-sm text-center py-4">אין עלייה חריגה זוהתה</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-orange-200 p-5 shadow-sm bg-orange-50">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
          ⚡ עלייה חריגה
        </span>
        <h2 className="text-lg font-bold text-gray-900">📈 עלייה בענף</h2>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="font-bold text-2xl text-orange-600">Z={trend.z_score.toFixed(2)}</span>
          <span className="text-sm text-gray-500 self-end">{trend.sector}{trend.geo ? ` | ${trend.geo}` : ""}</span>
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          <span>ממוצע: {trend.rolling_mean.toFixed(1)}</span>
          <span>סטיית תקן: {trend.rolling_std.toFixed(1)}</span>
          <span>ביטחון: {Math.round(trend.confidence_score * 100)}%</span>
        </div>
        <a
          href={trend.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline block truncate"
          dir="ltr"
        >
          {trend.source_url}
        </a>
        <p className="text-xs text-gray-400">{formatHebrewTime(trend.detected_at_utc)}</p>
      </div>
    </div>
  );
}

function RecommendedActionCard({ action }: { action: ActionRecommended | null }) {
  if (!action) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">⚡ פעולה מומלצת</h2>
        <p className="text-gray-400 text-sm text-center py-4">אין פעולה פעילה</p>
      </div>
    );
  }

  const colorClass = ACTION_COLORS[action.action_type];
  const label = ACTION_LABELS[action.action_type];
  const isExpired = new Date(action.expires_at) <= new Date();

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${colorClass}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs opacity-70">{formatCountdown(action.expires_at)}</span>
        <h2 className="text-lg font-bold">⚡ פעולה מומלצת</h2>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-3xl font-bold">{Math.round(action.action_score * 100)}%</span>
          <span className="text-lg font-semibold">{label}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs opacity-70">
            ביטחון: {Math.round(action.confidence_score * 100)}%
          </span>
          {action.stale_memory_flag && (
            <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">
              ⚠ נתוני זיכרון ישנים
            </span>
          )}
          {isExpired && (
            <span className="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded-full">
              פג תוקף
            </span>
          )}
        </div>
        <a
          href={action.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline opacity-70 block truncate"
          dir="ltr"
        >
          {action.source_url}
        </a>
      </div>
    </div>
  );
}

// ─── Component: Intelligence Feed ─────────────────────────────────────────────

function IntelligenceFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900">🧠 פיד מודיעין</h2>
      </div>
      {items.length === 0 ? (
        <div className="p-5 text-center text-gray-400 text-sm py-10">אין אותות עדכניים</div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span>{TYPE_ICONS[item.type]}</span>
                    <span className="text-sm font-medium text-gray-900">{item.label}</span>
                    {item.stale_memory_flag && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                        ⚠ נתוני זיכרון ישנים
                      </span>
                    )}
                  </div>
                  {item.sublabel && (
                    <p className="text-xs text-gray-500 mb-1">{item.sublabel}</p>
                  )}
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline truncate block"
                    dir="ltr"
                  >
                    {item.source_url.length > 80 ? `${item.source_url.slice(0, 80)}…` : item.source_url}
                  </a>
                </div>
                <div className="shrink-0 text-left">
                  <div className="text-xs text-gray-400">{formatHebrewTime(item.detected_at_utc)}</div>
                  <div className="text-xs text-gray-400 text-left">{Math.round(item.confidence_score * 100)}%</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Component: System Status Bar ─────────────────────────────────────────────

function SystemStatusBar({ heartbeats }: { heartbeats: AgentHeartbeat[] }) {
  const now = Date.now();
  const DELAY_MS = 10 * 60 * 1000;

  const statuses = heartbeats.map((h) => {
    const msSince = now - new Date(h.last_ping_utc).getTime();
    const isDelayed = msSince > DELAY_MS;
    return { ...h, isDelayed };
  });

  const overallOk = statuses.every((s) => !s.isDelayed && s.status === "OK");
  const signalCollector = statuses.find((s) => s.agent_name === "SignalCollector");

  return (
    <div className={`rounded-2xl border px-5 py-3 flex items-center justify-between flex-wrap gap-3 ${overallOk ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${overallOk ? "bg-green-500" : "bg-yellow-500"} animate-pulse`} />
        <span className="text-sm font-medium text-gray-700">
          {overallOk ? "כל המערכות תקינות" : "דגרדציה — בדוק סטטוס"}
        </span>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {signalCollector && (
          <span className="text-xs text-gray-500">
            עדכון אחרון: {signalCollector.last_ingestion_utc
              ? formatHebrewTime(signalCollector.last_ingestion_utc)
              : "אין מידע"}
          </span>
        )}
        {statuses
          .filter((s) => s.isDelayed || s.status !== "OK")
          .map((s) => (
            <span key={s.agent_name} className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
              {s.agent_name}: {s.isDelayed ? "DELAYED" : s.status}
            </span>
          ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard Component ─────────────────────────────────────────────────

export default function OTXDashboard() {
  const {
    business,
    liveOpportunities,
    sectorSpike,
    topAction,
    feed,
    heartbeats,
    loading,
    lastRefreshed,
  } = useOTXDashboard();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">טוען נתוני מודיעין…</p>
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-700 font-medium text-lg mb-2">לא נמצא פרופיל עסקי</p>
          <p className="text-gray-400 text-sm">השלם הרשמה להפעלת מנוע המודיעין</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>עודכן: {lastRefreshed ? formatHebrewTime(lastRefreshed) : "—"}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{business.name}</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
              {business.sector} | {business.geo_city}
            </span>
            <h1 className="text-xl font-black text-gray-900 tracking-tight">OTX</h1>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
        {/* System status bar */}
        {heartbeats.length > 0 && <SystemStatusBar heartbeats={heartbeats} />}

        {/* Hero section — 3 cards above fold */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RecommendedActionCard action={topAction} />
          <SectorTrendCard trend={sectorSpike} />
          <LiveOpportunitiesCard signals={liveOpportunities} />
        </section>

        {/* Intelligence feed — below fold */}
        <IntelligenceFeed items={feed} />
      </main>
    </div>
  );
}

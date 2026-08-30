import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { fmtCount } from '@/components/competitors/socialShared';
import RadarComparisonChart, { RADAR_OWN_COLOR as OWN_COLOR, RADAR_COMPETITOR_COLOR as COMPETITOR_COLOR, normalizeRadarTopics } from '@/components/competitors/RadarComparisonChart';

const RADAR_TOPICS = [
  { key: 'followers',      label: 'עוקבים' },
  { key: 'avgEngagement',  label: 'מעורבות ממוצעת' },
  { key: 'postCount30d',   label: 'פוסטים (30 יום)' },
  { key: 'engagementRate', label: 'אחוז מעורבות' },
];

// Own vs. the average of tracked competitors, one axis per topic.
function buildRadarData(rows) {
  const own = rows.find(r => r.isOwn);
  const competitors = rows.filter(r => !r.isOwn);
  if (!own || competitors.length === 0) return [];

  const competitorAvg = {};
  for (const topic of RADAR_TOPICS) {
    const vals = competitors.map(c => c[topic.key]).filter(v => v != null);
    competitorAvg[topic.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  return normalizeRadarTopics(RADAR_TOPICS, own, competitorAvg);
}

function sumOrNull(profiles, field) {
  const vals = profiles.map(p => p[field]).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

function truncateName(name) {
  return (name || '').length > 12 ? name.slice(0, 12) + '…' : name;
}

function engagementRate(avgEngagement, followers) {
  return followers ? (avgEngagement / followers) * 100 : null;
}

function buildComparisonRows({ competitors, competitorProfiles, ownProfiles, leaderboard, ownRow, businessName }) {
  const rows = competitors.map(c => {
    const profiles = competitorProfiles.filter(p => p.competitor_id === c.id);
    const lb = leaderboard.find(l => l.competitor_id === c.id);
    const followers = sumOrNull(profiles, 'follower_count');
    const avgEngagement = lb?.avg_interactions ?? 0;
    return {
      id: c.id,
      name: c.name,
      isOwn: false,
      followers,
      following: sumOrNull(profiles, 'following_count'),
      postCount30d: lb?.post_count ?? 0,
      avgEngagement,
      hasEngagementData: !!lb,
      engagementRate: lb ? engagementRate(avgEngagement, followers) : null,
    };
  });

  const ownFollowers = sumOrNull(ownProfiles, 'follower_count');
  const ownAvgEngagement = ownRow?.avg_interactions ?? 0;
  rows.unshift({
    id: '__own__',
    name: businessName || 'העסק שלי',
    isOwn: true,
    followers: ownFollowers,
    following: sumOrNull(ownProfiles, 'following_count'),
    postCount30d: ownRow?.post_count ?? 0,
    avgEngagement: ownAvgEngagement,
    hasEngagementData: !!ownRow,
    engagementRate: ownRow ? engagementRate(ownAvgEngagement, ownFollowers) : null,
  });

  return rows;
}

const COLUMNS = [
  { key: 'followers',     label: 'עוקבים' },
  { key: 'following',     label: 'נעקבים' },
  { key: 'postCount30d',  label: 'פוסטים (30 יום)' },
  { key: 'avgEngagement', label: 'מעורבות ממוצעת' },
];

function SortButton({ label, active, dir, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
      {label}
      {active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
    </button>
  );
}

function ComparisonChart({ title, subtitle, data, dataKey }) {
  if (data.length === 0) return null;
  return (
    <div className="bg-white rounded-[10px] border border-border/50 p-5">
      <h3 className="text-[13px] font-semibold text-[#222222] mb-1">{title}</h3>
      <p className="text-[10px] text-foreground-muted mb-4">{subtitle}</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#999' }} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10, fill: '#999' }} tickFormatter={fmtCount} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f0f0f0' }} formatter={v => fmtCount(v)} />
            <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} barSize={20}>
              {data.map(d => <Cell key={d.id} fill={d.isOwn ? OWN_COLOR : COMPETITOR_COLOR} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function SocialInsightsComparison({
  competitors = [], competitorProfiles = [], ownProfiles = [], leaderboard = [], ownRow = null,
  businessName, onSelectCompetitor, isLoading = false,
}) {
  const [sort, setSort] = useState({ key: 'avgEngagement', dir: 'desc' });

  const rows = useMemo(
    () => buildComparisonRows({ competitors, competitorProfiles, ownProfiles, leaderboard, ownRow, businessName }),
    [competitors, competitorProfiles, ownProfiles, leaderboard, ownRow, businessName],
  );

  const radarData = useMemo(() => buildRadarData(rows), [rows]);

  const sortedRows = useMemo(() => {
    const own = rows.find(r => r.isOwn);
    const rest = rows.filter(r => !r.isOwn).sort((a, b) => {
      const av = a[sort.key] ?? -Infinity;
      const bv = b[sort.key] ?? -Infinity;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });
    return own ? [own, ...rest] : rest;
  }, [rows, sort]);

  const followersChartData = useMemo(
    () => rows.filter(r => r.followers != null).map(r => ({ id: r.id, name: truncateName(r.name), followers: r.followers, isOwn: r.isOwn })),
    [rows],
  );
  const engagementChartData = useMemo(
    () => rows.filter(r => r.isOwn || r.hasEngagementData).map(r => ({ id: r.id, name: truncateName(r.name), avgEngagement: r.avgEngagement, isOwn: r.isOwn })),
    [rows],
  );

  if (competitors.length === 0) return null;

  if (isLoading) {
    return (
      <div className="card-base p-4 flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function toggleSort(key) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }

  return (
    <div className="space-y-3">
      <RadarComparisonChart title="השוואה לפי נושאים" subtitle="העסק שלי מול ממוצע המתחרים" data={radarData} />

      <div className="card-base p-4 overflow-x-auto">
        <table dir="rtl" className="w-full">
          <thead>
            <tr className="border-b border-border/40">
              <th className="text-right py-2 px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">עסק</th>
              {COLUMNS.map(col => (
                <th key={col.key} className="text-center py-2 px-2">
                  <SortButton label={col.label} active={sort.key === col.key} dir={sort.dir} onClick={() => toggleSort(col.key)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(row => (
              <tr
                key={row.id}
                dir="rtl"
                onClick={row.isOwn ? undefined : () => onSelectCompetitor?.(row.id)}
                className={`border-b border-border/40 last:border-0 ${row.isOwn ? 'bg-blue-50/30' : 'hover:bg-muted cursor-pointer'} transition-colors`}
              >
                <td className="py-2 px-2">
                  <p className="text-[12px] font-semibold text-foreground truncate max-w-[140px]">{row.name}</p>
                  {row.isOwn && <p className="text-[9px] text-blue-500 font-medium mt-0.5">העסק שלי</p>}
                </td>
                <td className={`text-center py-2 px-2 text-[12px] font-medium ${row.isOwn ? 'text-blue-600' : 'text-foreground'}`}>
                  {row.followers != null ? fmtCount(row.followers) : '—'}
                </td>
                <td className={`text-center py-2 px-2 text-[12px] font-medium ${row.isOwn ? 'text-blue-600' : 'text-foreground'}`}>
                  {row.following != null ? fmtCount(row.following) : '—'}
                </td>
                <td className={`text-center py-2 px-2 text-[12px] font-medium ${row.isOwn ? 'text-blue-600' : 'text-foreground'}`}>
                  {row.postCount30d || '—'}
                </td>
                <td className={`text-center py-2 px-2 text-[12px] font-semibold ${row.isOwn ? 'text-blue-600' : 'text-foreground'}`}>
                  {row.hasEngagementData || row.isOwn ? fmtCount(row.avgEngagement) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ComparisonChart title="עוקבים" subtitle="סה״כ עוקבים לפי עסק" data={followersChartData} dataKey="followers" />
        <ComparisonChart title="מעורבות" subtitle="מעורבות ממוצעת לפוסט — 30 יום אחרונים" data={engagementChartData} dataKey="avgEngagement" />
      </div>
    </div>
  );
}

import { CheckCircle } from 'lucide-react';

const PLATFORM_CHIP_COLORS = {
  facebook:  { bg: '#e7f3ff', color: '#1877f2' },
  meta:      { bg: '#e7f3ff', color: '#1877f2' },
  instagram: { bg: '#fde8f0', color: '#e1306c' },
  google:    { bg: '#e8f0fe', color: '#4285f4' },
};

export function InterestChip({ label, platform }) {
  const c = PLATFORM_CHIP_COLORS[platform] || PLATFORM_CHIP_COLORS.facebook;
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border" style={{ background: c.bg, color: c.color, borderColor: c.color + '33' }}>
      {label}
    </span>
  );
}

const MATCH_CONFIG = {
  exact:    { label: 'מדויק',  bg: '#dcfce7', color: '#166534' },
  phrase:   { label: 'ביטוי',  bg: '#fef9c3', color: '#854d0e' },
  broad:    { label: 'רחב',    bg: '#f3f4f6', color: '#374151' },
  negative: { label: 'שלילה',  bg: '#fee2e2', color: '#991b1b' },
};

export function KeywordRow({ term, match }) {
  const mc = MATCH_CONFIG[match] || MATCH_CONFIG.broad;
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-[11px] font-medium text-foreground flex-1">{term}</span>
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: mc.bg, color: mc.color }}>
        {mc.label}
      </span>
    </div>
  );
}

/**
 * Renders one audience segment (the shape returned by the getAudienceSegments
 * function / stored in AudienceSegment.segment_json) as a card.
 * Pass `onClick` to make the whole card selectable (CampaignCreate.jsx's
 * picker); pass `actions` for a footer of buttons (AudienceTab's save/delete)
 * — actions stop click propagation so they don't also trigger `onClick`.
 */
export default function AudienceSegmentCard({ segment: seg, platform = 'facebook', selected = false, onClick = undefined, actions = null, accentColor = '#1877f2', accentBg = '#e7f3ff' }) {
  return (
    <div
      onClick={onClick}
      className={`w-full text-right px-4 py-3 rounded-xl border-2 transition-all ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        borderColor: selected ? accentColor : 'hsl(var(--border))',
        background: selected ? accentBg : 'transparent',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-bold text-foreground">{seg.segment_name}</span>
        <div className="flex items-center gap-2">
          {selected && <CheckCircle className="w-4 h-4" style={{ color: accentColor }} />}
          <span className="text-[10px] text-foreground-muted">{seg.estimated_audience_range}</span>
        </div>
      </div>
      <p className="text-[11px] text-foreground-muted mb-2">{seg.description}</p>

      {/* FB interests */}
      {platform !== 'google' && seg.facebook_targeting?.interests?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {seg.facebook_targeting.interests.slice(0, 5).map((interest, j) => (
            <InterestChip key={j} label={interest} platform={platform} />
          ))}
        </div>
      )}

      {/* Google keywords */}
      {platform === 'google' && seg.google_targeting?.keywords?.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          {seg.google_targeting.keywords.slice(0, 3).map((kw, j) => (
            <KeywordRow key={j} term={kw} match="exact" />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-2 text-[10px] text-foreground-muted">
        <span>גיל: {seg.age_min}–{seg.age_max}</span>
        <span>{seg.genders}</span>
        <span>המרה: {Math.round((seg.conversion_probability || 0) * 100)}%</span>
      </div>
      {seg.ad_creative_tip && (
        <p className="mt-1.5 text-[10px] text-foreground-muted bg-secondary/50 rounded-lg px-2 py-1">
          💡 {seg.ad_creative_tip}
        </p>
      )}

      {actions && (
        <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border/50" onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

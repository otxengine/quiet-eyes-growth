import React from 'react';
import { Globe, MessageSquare, Users, TrendingUp, Search, Link2 } from 'lucide-react';

const sourceConfig = {
  web: { icon: Globe, label: 'חיפוש ווב', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  social: { icon: MessageSquare, label: 'רשתות חברתיות', cls: 'bg-purple-50 text-purple-600 border-purple-100' },
  competitor: { icon: Users, label: 'מתחרים', cls: 'bg-orange-50 text-orange-600 border-orange-100' },
  trend: { icon: TrendingUp, label: 'מגמה עולה', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  group: { icon: Users, label: 'קבוצות/פורומים', cls: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
  unknown: { icon: Search, label: 'מקור', cls: 'bg-gray-50 text-gray-500 border-gray-100' },
};

const platformConfig = {
  facebook: { label: 'Facebook', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  instagram: { label: 'Instagram', cls: 'bg-pink-50 text-pink-600 border-pink-100' },
  tiktok: { label: 'TikTok', cls: 'bg-gray-900 text-white border-gray-700' },
  google: { label: 'Google', cls: 'bg-green-50 text-green-600 border-green-100' },
  forum: { label: 'פורום', cls: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
  website: { label: 'אתר', cls: 'bg-gray-50 text-gray-600 border-gray-100' },
};

const sentimentConfig = {
  positive: { label: 'חיובי', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100', emoji: '😊' },
  negative: { label: 'שלילי', cls: 'bg-red-50 text-red-600 border-red-100', emoji: '😟' },
  neutral: { label: 'ניטרלי', cls: 'bg-gray-50 text-gray-500 border-gray-100', emoji: '😐' },
};

export function SourceTypeBadge({ sourceType }) {
  const config = sourceConfig[sourceType] || sourceConfig.unknown;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-semibold border ${config.cls}`}>
      <Icon className="w-2.5 h-2.5" /> {config.label}
    </span>
  );
}

export function PlatformBadge({ platform }) {
  if (!platform || platform === 'unknown') return null;
  const config = platformConfig[platform] || platformConfig.website;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-semibold border ${config.cls}`}>
      {config.label}
    </span>
  );
}

export function SentimentBadge({ sentiment }) {
  if (!sentiment || sentiment === 'unknown') return null;
  const config = sentimentConfig[sentiment];
  if (!config) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[9px] font-semibold border ${config.cls}`}>
      {config.emoji} {config.label}
    </span>
  );
}
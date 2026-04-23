import React, { useState } from 'react';
import { Sparkles, Loader2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useInsight } from '@/hooks/useInsight';

/** Renders AI text without raw markdown — handles headings, lists, bold inline. */
function SimpleMarkdown({ text }) {
  if (!text) return null;
  const raw = typeof text === 'string' ? text : JSON.stringify(text, null, 2);

  const renderInline = (str) => ({
    __html: str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
  });

  const paragraphs = raw.split(/\n{2,}/);

  return (
    <div className="space-y-2">
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n').filter(Boolean);
        return (
          <div key={pi}>
            {lines.map((line, li) => {
              if (/^#{2,3}\s/.test(line)) {
                return (
                  <p key={li} className="text-[12px] font-semibold text-foreground mt-2 mb-0.5">
                    {line.replace(/^#{2,3}\s/, '')}
                  </p>
                );
              }
              if (/^[-•*]\s/.test(line) || /^\d+\.\s/.test(line)) {
                const content = line.replace(/^[-•*]\s/, '').replace(/^\d+\.\s/, '');
                return (
                  <div key={li} className="flex gap-1.5 text-[12px] text-foreground-secondary">
                    <span className="text-foreground-muted flex-shrink-0 mt-0.5">·</span>
                    <span dangerouslySetInnerHTML={renderInline(content)} />
                  </div>
                );
              }
              return (
                <p key={li}
                  className="text-[12px] text-foreground-secondary leading-relaxed"
                  dangerouslySetInnerHTML={renderInline(line)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function AiInsightBox({ title, prompt, icon, accentColor = '#111111', compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const { insight, loading, error, fetch: fetchInsight, refresh } = useInsight(prompt);

  const handleOpen = () => {
    setExpanded(true);
    if (!insight && !loading) fetchInsight();
  };

  const handleRefresh = (e) => {
    e.stopPropagation();
    refresh();
  };

  // Pre-expanded trigger button — show when collapsed and no insight yet
  if (!expanded && !insight) {
    return (
      <button
        onClick={handleOpen}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 rounded-xl border border-dashed border-border hover:border-border-hover bg-secondary/50 hover:bg-secondary transition-all text-right group"
      >
        {icon || (
          <Sparkles className="w-4 h-4 flex-shrink-0 text-primary opacity-60 group-hover:opacity-100 transition-opacity" />
        )}
        <span className="text-[12px] font-medium text-foreground-muted group-hover:text-foreground-secondary transition-colors">
          {title}
        </span>
        <Sparkles className="w-3 h-3 text-foreground-muted/30 mr-auto" />
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      {/* Collapsible header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 hover:bg-secondary/30 transition-all duration-150 text-right cursor-pointer"
        role="button"
      >
        {icon || <Sparkles className="w-4 h-4 flex-shrink-0 text-primary opacity-60" />}
        <span className="text-[12px] font-medium text-foreground-secondary">{title}</span>
        <div className="mr-auto flex items-center gap-1.5">
          {insight && !loading && (
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
              title="רענן תובנה"
            >
              <RefreshCw className="w-3 h-3 text-foreground-muted/40" />
            </button>
          )}
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-foreground-muted/30" />
            : <ChevronDown className="w-4 h-4 text-foreground-muted/30" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border">
          {loading ? (
            <div className="animate-pulse space-y-2.5 pt-4">
              <div className="h-3 w-3/4 bg-gray-200 rounded" />
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-5/6 bg-gray-100 rounded" />
              <div className="h-3 w-2/3 bg-gray-200 rounded mt-2" />
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-4/5 bg-gray-100 rounded" />
            </div>
          ) : error ? (
            <div className="py-5 text-center">
              <p className="text-[12px] text-[#dc2626]">{error}</p>
              <button onClick={() => fetchInsight()}
                className="mt-3 text-[11px] text-foreground-muted underline hover:text-foreground transition-colors">
                נסה שוב
              </button>
            </div>
          ) : insight ? (
            <div className="pt-4">
              <SimpleMarkdown text={insight} />
            </div>
          ) : (
            <div className="py-5 text-center">
              <button onClick={() => fetchInsight()}
                className="text-[11px] text-primary underline hover:text-primary/80">
                טען תובנה
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

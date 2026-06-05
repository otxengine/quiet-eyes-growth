import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Zap, CheckCircle, AlertCircle, Loader2, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

function ToolCallBubble({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const name = toolCall?.name || 'פעולה';
  const status = toolCall?.status || 'pending';

  const statusConfig = {
    pending: { icon: Clock, color: 'text-foreground-muted/60', spin: false },
    running: { icon: Loader2, color: 'text-foreground-muted', spin: true },
    in_progress: { icon: Loader2, color: 'text-foreground-muted', spin: true },
    completed: { icon: CheckCircle, color: 'text-[#10b981]', spin: false },
    success: { icon: CheckCircle, color: 'text-[#10b981]', spin: false },
    failed: { icon: AlertCircle, color: 'text-[#dc2626]', spin: false },
    error: { icon: AlertCircle, color: 'text-[#dc2626]', spin: false },
  }[status] || { icon: Zap, color: 'text-foreground-muted', spin: false };

  const Icon = statusConfig.icon;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 bg-secondary/50 text-[10px] text-foreground-muted hover:bg-secondary transition-colors"
    >
      <Icon className={cn('w-3 h-3', statusConfig.color, statusConfig.spin && 'animate-spin')} />
      <span>{name.split('.').pop()}</span>
    </button>
  );
}

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2.5 max-w-full', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
        >
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div className={cn('max-w-[85%]', isUser && 'flex flex-col items-end')}>
        {message.content && (
          <div
            className={cn('rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed')}
            style={isUser ? { background: 'linear-gradient(135deg, #E8344D 0%, #FF6B6B 100%)' } : undefined}
          >
            {isUser ? (
              <p className="text-white">{message.content}</p>
            ) : (
              <div className="bg-secondary/60 rounded-2xl px-3.5 py-2.5 -mx-3.5 -my-2.5">
                <ReactMarkdown className="prose prose-sm max-w-none text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
        {message.tool_calls?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.tool_calls.map((tc, i) => <ToolCallBubble key={i} toolCall={tc} />)}
          </div>
        )}
      </div>
    </div>
  );
}

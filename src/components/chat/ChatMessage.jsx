import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Zap, CheckCircle, AlertCircle, Loader2, ChevronLeft, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

function ToolCallBubble({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const name = toolCall?.name || 'פעולה';
  const status = toolCall?.status || 'pending';

  const statusConfig = {
    pending: { icon: Clock, color: 'text-[#cccccc]', spin: false },
    running: { icon: Loader2, color: 'text-[#999999]', spin: true },
    in_progress: { icon: Loader2, color: 'text-[#999999]', spin: true },
    completed: { icon: CheckCircle, color: 'text-[#10b981]', spin: false },
    success: { icon: CheckCircle, color: 'text-[#10b981]', spin: false },
    failed: { icon: AlertCircle, color: 'text-[#dc2626]', spin: false },
    error: { icon: AlertCircle, color: 'text-[#dc2626]', spin: false },
  }[status] || { icon: Zap, color: 'text-[#999999]', spin: false };

  const Icon = statusConfig.icon;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#f0f0f0] bg-[#fafafa] text-[10px] text-[#999999] hover:bg-[#f5f5f5] transition-colors"
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
        <div className="w-6 h-6 rounded-full bg-[#f5f5f5] flex items-center justify-center flex-shrink-0 mt-0.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
        </div>
      )}
      <div className={cn('max-w-[85%]', isUser && 'flex flex-col items-end')}>
        {message.content && (
          <div className={cn(
            'rounded-xl px-3.5 py-2.5 text-[13px] leading-[1.6]',
            isUser ? 'bg-[#111111] text-white' : 'bg-[#f5f5f5] text-[#333333]'
          )}>
            {isUser ? (
              <p>{message.content}</p>
            ) : (
              <ReactMarkdown className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                {message.content}
              </ReactMarkdown>
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
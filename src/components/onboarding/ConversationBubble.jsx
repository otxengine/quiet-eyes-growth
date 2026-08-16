import React, { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import KoriAvatar from './KoriAvatar';

function AnimatedWrapper({ children }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className="transition-all duration-400"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
      }}
    >
      {children}
    </div>
  );
}

// AI message — avatar on right (start in RTL), text on left
export function AiBubble({ children, className = '' }) {
  return (
    <AnimatedWrapper>
      <div className={`flex items-start gap-3 ${className}`}>
        <div className="flex-1 max-w-sm">
          <div className="bg-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm border border-gray-100 text-[14px] text-gray-800 leading-relaxed whitespace-pre-line">
            {children}
          </div>
        </div>
        <KoriAvatar size="sm" />
      </div>
    </AnimatedWrapper>
  );
}

// User answer — pill aligned to start (right in RTL) — just below the question
// editable: pass an onClick to let the user re-open this answer for editing.
export function UserBubble({ children, className = '', editable = false, onClick }) {
  return (
    <AnimatedWrapper>
      <div className={`flex ${className}`} style={{ paddingRight: '52px' }}>
        <button
          type="button"
          disabled={!editable}
          onClick={onClick}
          title={editable ? 'לחץ לעריכה' : undefined}
          className={`group flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-5 py-2.5 text-[13px] text-gray-700 shadow-sm max-w-xs leading-snug text-right ${
            editable ? 'cursor-pointer hover:border-[#e8344d] transition-colors' : 'cursor-default'
          }`}
        >
          <span>{children}</span>
          {editable && (
            <Pencil className="w-3 h-3 text-gray-300 group-hover:text-[#e8344d] flex-shrink-0 transition-colors" />
          )}
        </button>
      </div>
    </AnimatedWrapper>
  );
}

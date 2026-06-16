import React, { useState, useEffect } from 'react';
import { MessageSquare, X } from 'lucide-react';
import ChatPanel from './ChatPanel';
import { useLocation } from 'react-router-dom';

export default function ChatWidget({ businessProfile, urgentCount = 0 }) {
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem('quieteyes_chat_open') === '1'; } catch { return false; }
  });
  const [prefilledMessage, setPrefilledMessage] = useState('');
  const location = useLocation();

  // Persist open state across page reloads within the session
  useEffect(() => {
    try { sessionStorage.setItem('quieteyes_chat_open', open ? '1' : '0'); } catch {}
  }, [open]);

  // Listen for chat:open events dispatched by LeadCard / ReviewCard
  useEffect(() => {
    const handler = (e) => {
      setOpen(true);
      if (e.detail?.message) setPrefilledMessage(e.detail.message);
    };
    window.addEventListener('chat:open', handler);
    return () => window.removeEventListener('chat:open', handler);
  }, []);

  return (
    <>
      {open && (
        <ChatPanel
          onClose={() => setOpen(false)}
          businessProfile={businessProfile}
          prefilledMessage={prefilledMessage}
          onPrefilledConsumed={() => setPrefilledMessage('')}
          pageKey={location.pathname}
        />
      )}
      <button
        onClick={() => setOpen(!open)}
        className="fixed z-[60] w-14 h-14 rounded-full text-white flex items-center justify-center transition-all duration-200 relative"
        style={{
          bottom: '1rem',
          left: '1.5rem',
          background: 'linear-gradient(135deg, #E8344D, #FF6B6B)',
          boxShadow: '0 4px 20px rgba(232,52,77,0.35), 0 2px 6px rgba(232,52,77,0.2)',
        }}
      >
        {open ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
        {!open && urgentCount > 0 && (
          <span
            className="absolute -top-1 -right-1 w-4 h-4 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse"
            style={{ background: '#E8344D', boxShadow: '0 0 0 2px white' }}
          >
            {urgentCount > 9 ? '9+' : urgentCount}
          </span>
        )}
      </button>
    </>
  );
}

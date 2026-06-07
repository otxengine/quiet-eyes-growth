import React, { useState, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';
import SupportPanel from './SupportPanel';

export default function SupportWidget({ businessProfile }) {
  const [open, setOpen] = useState(false);
  const [hasOpenTicket, setHasOpenTicket] = useState(() => {
    try { return localStorage.getItem('quieteyes_support_ticket_open') === '1'; } catch { return false; }
  });

  useEffect(() => {
    const handler = () => {
      try { setHasOpenTicket(localStorage.getItem('quieteyes_support_ticket_open') === '1'); } catch {}
    };
    window.addEventListener('support:ticket_created', handler);
    return () => window.removeEventListener('support:ticket_created', handler);
  }, []);

  const handleTicketCreated = () => {
    try { localStorage.setItem('quieteyes_support_ticket_open', '1'); } catch {}
    setHasOpenTicket(true);
    window.dispatchEvent(new Event('support:ticket_created'));
  };

  return (
    <>
      {open && (
        <SupportPanel
          onClose={() => setOpen(false)}
          businessProfile={businessProfile}
          onTicketCreated={handleTicketCreated}
        />
      )}
      <button
        onClick={() => setOpen(!open)}
        className="fixed z-[60] w-14 h-14 rounded-full text-white flex items-center justify-center transition-all duration-200 relative"
        style={{
          bottom: '24px',
          right: '24px',
          background: 'linear-gradient(135deg, #E8344D, #FF6B6B)',
          boxShadow: '0 4px 20px rgba(232,52,77,0.35), 0 2px 6px rgba(232,52,77,0.2)',
        }}
      >
        {open ? <X className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
        {!open && hasOpenTicket && (
          <span
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse"
            style={{ background: '#FF6B6B', boxShadow: '0 0 0 2px white' }}
          />
        )}
      </button>
    </>
  );
}

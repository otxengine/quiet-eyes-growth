import React, { useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import ChatPanel from './ChatPanel';

export default function ChatWidget({ businessProfile }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && <ChatPanel onClose={() => setOpen(false)} businessProfile={businessProfile} />}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 left-4 md:left-6 z-50 w-14 h-14 rounded-full text-white flex items-center justify-center transition-all duration-200"
        style={{
          background: 'linear-gradient(135deg, #E8344D, #FF6B6B)',
          boxShadow: '0 4px 20px rgba(232,52,77,0.35), 0 2px 6px rgba(232,52,77,0.2)',
        }}
      >
        {open ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
      </button>
    </>
  );
}

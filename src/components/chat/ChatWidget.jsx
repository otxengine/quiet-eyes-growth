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
        className="fixed bottom-4 left-4 md:left-6 z-50 w-12 h-12 rounded-full bg-[#111111] text-white shadow-lg hover:bg-[#333333] transition-all flex items-center justify-center"
      >
        {open ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
      </button>
    </>
  );
}
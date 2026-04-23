import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

const AVATARS = {
  'dev-user':   '🧑‍💻',
  'dev-user-2': '👩',
  'dev-user-3': '👨',
};

export default function DevUserSwitcher() {
  const { user, devUsers, switchDevUser, isDevMode } = useAuth();
  const [open, setOpen] = useState(false);

  if (!isDevMode) return null;

  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}>
      {open && (
        <div style={{
          marginBottom: 8,
          background: '#1e1e2e',
          border: '1px solid #333',
          borderRadius: 10,
          padding: '8px 0',
          minWidth: 200,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: '4px 12px 8px', color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
            DEV USER SWITCHER
          </div>
          {devUsers.map(u => (
            <button
              key={u.id}
              onClick={() => { setOpen(false); switchDevUser(u.id); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 12px',
                background: u.id === user.id ? '#2a2a3e' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 18 }}>{AVATARS[u.id]}</span>
              <div>
                <div style={{ fontWeight: u.id === user.id ? 700 : 400 }}>{u.full_name}</div>
                <div style={{ color: '#888', fontSize: 11 }}>{u.email}</div>
              </div>
              {u.id === user.id && (
                <span style={{ marginLeft: 'auto', color: '#6ee7b7', fontSize: 12 }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        title="Switch dev user"
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: '#1e1e2e',
          border: '2px solid #444',
          cursor: 'pointer',
          fontSize: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      >
        {AVATARS[user.id]}
      </button>
    </div>
  );
}

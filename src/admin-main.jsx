import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClientInstance } from '@/lib/query-client';
import AdminDashboard from '@/pages/AdminDashboard';
import { Toaster } from '@/components/ui/toaster';
import { verifyAdminKey } from '@/api/adminClient';
import '@/index.css';

const spinStyle = `@keyframes spin { to { transform: rotate(360deg); } }`;

function AdminKeyGate({ onUnlock }) {
  const [key, setKey]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError('');
    const ok = await verifyAdminKey(key.trim());
    if (ok) {
      sessionStorage.setItem('__admin_key', key.trim());
      onUnlock();
    } else {
      setError('מפתח שגוי — נסה שוב');
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', fontFamily: 'sans-serif', direction: 'rtl' }}>
      <style>{spinStyle}</style>
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '32px 40px', width: 320, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#111' }}>OTX Admin</p>
        <p style={{ fontSize: 12, color: '#999', marginBottom: 24 }}>הזן מפתח ניהול להמשך</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Admin secret key"
            autoFocus
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box', outline: 'none' }}
          />
          {error && <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading || !key.trim()}
            style={{ width: '100%', padding: '10px 0', borderRadius: 8, background: '#111', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: loading || !key.trim() ? 'not-allowed' : 'pointer', opacity: loading || !key.trim() ? 0.6 : 1 }}
          >
            {loading ? 'מאמת...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminShell() {
  const [unlocked, setUnlocked] = useState(() => !!sessionStorage.getItem('__admin_key'));

  const handleLogout = () => {
    sessionStorage.removeItem('__admin_key');
    setUnlocked(false);
  };

  if (!unlocked) return <AdminKeyGate onUnlock={() => setUnlocked(true)} />;

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background" dir="rtl">
        <header style={{ height: 48, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#fff' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>OTX Admin</span>
          <button
            onClick={handleLogout}
            style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            התנתק
          </button>
        </header>
        <main style={{ padding: '16px 24px' }}>
          <AdminDashboard skipAdminCheck />
        </main>
      </div>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('admin-root')).render(
  <QueryClientProvider client={queryClientInstance}>
    <AdminShell />
    <Toaster />
  </QueryClientProvider>
);

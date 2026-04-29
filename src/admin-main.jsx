import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, useUser, useClerk } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClientInstance } from '@/lib/query-client';
import AdminDashboard from '@/pages/AdminDashboard';
import { Toaster } from '@/components/ui/toaster';
import '@/index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const ADMIN_EMAILS = ['contact@otxengine.io'];
const ADMIN_DOMAINS = ['@otx.ai', '@quieteyes.ai'];

function isAdminEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return ADMIN_EMAILS.includes(e) || ADMIN_DOMAINS.some(d => e.endsWith(d));
}

// Sets up window.__clerk and signals when token is ready
function TokenSetup({ onReady }) {
  const clerk = useClerk();
  useEffect(() => {
    if (!clerk.session) return;
    window.__clerk = clerk;
    clerk.session.getToken().then(token => {
      if (token) window.__clerk_session_token = token;
      onReady();
    });
    const interval = setInterval(() => {
      clerk.session?.getToken().then(token => {
        if (token) window.__clerk_session_token = token;
      });
    }, 50_000);
    return () => clearInterval(interval);
  }, [clerk.session]);
  return null;
}

function AdminApp() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [tokenReady, setTokenReady] = useState(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    '';

  if (!isLoaded) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '4px solid #f0f0f0', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAdminEmail(email)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, fontFamily: 'sans-serif', direction: 'rtl' }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>אין הרשאת גישה</p>
        <p style={{ fontSize: 12, color: '#888' }}>מחובר כ: <strong>{email || '(לא ידוע)'}</strong></p>
        <button
          onClick={() => signOut(() => window.location.reload())}
          style={{ marginTop: 8, padding: '8px 20px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#333' }}
        >
          התנתק והתחבר עם חשבון אחר
        </button>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {/* Must render before AdminDashboard so token is set before queries fire */}
      <TokenSetup onReady={() => setTokenReady(true)} />
      <div className="min-h-screen bg-background" dir="rtl">
        <header style={{ height: 48, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#fff' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>OTX Admin</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 11, color: '#999' }}>{email}</span>
            <button onClick={() => signOut(() => window.location.reload())} style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>התנתק</button>
          </div>
        </header>
        <main style={{ padding: '16px 24px' }}>
          {tokenReady ? (
            <AdminDashboard skipAdminCheck />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 }}>
              <div style={{ width: 20, height: 20, border: '3px solid #f0f0f0', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 12, color: '#999' }}>מאמת הרשאות...</span>
            </div>
          )}
        </main>
      </div>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('admin-root')).render(
  <ClerkProvider
    publishableKey={PUBLISHABLE_KEY}
    signInUrl="/admin.html"
    signInFallbackRedirectUrl="/admin.html"
  >
    <QueryClientProvider client={queryClientInstance}>
      <SignedIn>
        <AdminApp />
      </SignedIn>
      <SignedOut>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
          <SignIn fallbackRedirectUrl="/admin.html" />
        </div>
      </SignedOut>
      <Toaster />
    </QueryClientProvider>
  </ClerkProvider>
);

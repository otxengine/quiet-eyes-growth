import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import AdminDashboard from '@/pages/AdminDashboard';
import '@/index.css';

// Same Clerk instance as the app. The server decides who is an admin (ADMIN_USER_IDS + two-step
// verification, server/src/middleware/auth.ts); this page only signs the user in.
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const USE_CLERK = PUBLISHABLE_KEY && !PUBLISHABLE_KEY.includes('your_key_here');

const app = (
  <QueryClientProvider client={queryClientInstance}>
    <AdminDashboard />
  </QueryClientProvider>
);

ReactDOM.createRoot(document.getElementById('admin-root')).render(
  USE_CLERK ? (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <SignedOut>
        <div className="min-h-screen grid place-items-center bg-muted/40">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>{app}</SignedIn>
    </ClerkProvider>
  ) : app,
);

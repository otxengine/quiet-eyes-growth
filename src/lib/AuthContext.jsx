import React, { createContext, useContext, useState, useEffect } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';

const AuthContext = createContext();

const DEV_USERS = [
  {
    id: 'dev-user',
    email: 'dev@quieteyes.local',
    full_name: 'Dev User',
    first_name: 'Dev',
    last_name: 'User',
    picture: null,
  },
  {
    id: 'dev-user-2',
    email: 'yael@quieteyes.local',
    full_name: 'Yael Cohen',
    first_name: 'Yael',
    last_name: 'Cohen',
    picture: null,
  },
  {
    id: 'dev-user-3',
    email: 'moshe@quieteyes.local',
    full_name: 'Moshe Levi',
    first_name: 'Moshe',
    last_name: 'Levi',
    picture: null,
  },
];

const DEV_USER = DEV_USERS[0];

// Only rendered when ClerkProvider is present
function ClerkAuthProvider({ children }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    if (isSignedIn && clerk.session) {
      window.__clerk = clerk;
      clerk.session.getToken().then(token => {
        if (token) window.__clerk_session_token = token;
        setTokenReady(true);
      });
    } else if (isLoaded) {
      setTokenReady(true);
    }
  }, [isSignedIn, isLoaded, clerk]);

  // Refresh token every 50 seconds (Clerk tokens expire after 60s)
  useEffect(() => {
    if (!isSignedIn) return;
    const interval = setInterval(() => {
      clerk.session?.getToken().then(token => {
        if (token) window.__clerk_session_token = token;
      });
    }, 50_000);
    return () => clearInterval(interval);
  }, [isSignedIn, clerk]);

  const logout = (shouldRedirect = true) => {
    clerk.signOut().then(() => {
      if (shouldRedirect) window.location.href = '/';
    });
  };

  const mappedUser = user ? {
    id: user.id,
    email: user.primaryEmailAddress?.emailAddress,
    full_name: user.fullName,
    first_name: user.firstName,
    last_name: user.lastName,
    picture: user.imageUrl,
  } : null;

  return (
    <AuthContext.Provider value={{
      user: mappedUser,
      isAuthenticated: !!isSignedIn,
      isLoadingAuth: !isLoaded || !tokenReady,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: null,
      logout,
      navigateToLogin: () => clerk.redirectToSignIn({ afterSignInUrl: window.location.href }),
      checkAppState: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// Used when no Clerk key — auto-authenticated as dev user with switcher
function DevAuthProvider({ children }) {
  const [activeId, setActiveId] = useState(
    () => localStorage.getItem('dev_user_id') || 'dev-user'
  );

  const user = DEV_USERS.find(u => u.id === activeId) || DEV_USERS[0];

  const switchUser = (id) => {
    localStorage.setItem('dev_user_id', id);
    setActiveId(id);
    window.location.reload();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: true,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: null,
      logout: () => {},
      navigateToLogin: () => {},
      checkAppState: () => {},
      devUsers: DEV_USERS,
      switchDevUser: switchUser,
      isDevMode: true,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

const HAS_CLERK = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY &&
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY !== 'pk_test_your_key_here';

export const AuthProvider = ({ children }) => {
  if (HAS_CLERK) {
    return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
  }
  return <DevAuthProvider>{children}</DevAuthProvider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

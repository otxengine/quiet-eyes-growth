import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { heIL } from '@clerk/localizations'
import App from '@/App.jsx'
import { rememberBriefingSignup } from '@/briefing/keys.js'
import '@/index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const USE_CLERK = PUBLISHABLE_KEY && !PUBLISHABLE_KEY.includes('your_key_here')

// Clerk's sign-in/up in the site's look (src/marketing/styles/tokens.css). Variables take real
// colors (Clerk derives shades from them); elements may use the tokens, loaded by the page shell.
const APPEARANCE = {
  variables: {
    colorPrimary: '#EC1E63',
    colorText: '#101014',
    colorTextSecondary: '#71717A',
    fontFamily: "'Heebo', 'Inter', sans-serif",
    borderRadius: '0.75rem',
  },
  elements: {
    cardBox: { boxShadow: 'none', border: '1px solid var(--mkt-border)', borderRadius: 16 },
    formButtonPrimary: { backgroundImage: 'var(--mkt-grad)', border: 0 },
    // ponytail: sign-up asks only email + password. The name fields are optional in Clerk; if they
    // are ever made required, turn them off in the Clerk dashboard instead, or sign-up gets stuck.
    formFieldRow__name: { display: 'none' },
  },
}
// A visitor from the English landing page (?briefing=1, kept for the tab) gets Clerk's English.
const LOCALIZATION = rememberBriefingSignup() ? undefined : heIL

ReactDOM.createRoot(document.getElementById('root')).render(
  USE_CLERK ? (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signUpFallbackRedirectUrl="/onboarding"
      signInFallbackRedirectUrl="/"
      appearance={APPEARANCE}
      localization={LOCALIZATION}
    >
      <App />
    </ClerkProvider>
  ) : (
    <App />
  )
)

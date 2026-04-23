import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from '@/App.jsx'
import '@/index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const USE_CLERK = PUBLISHABLE_KEY && !PUBLISHABLE_KEY.includes('your_key_here')

ReactDOM.createRoot(document.getElementById('root')).render(
  USE_CLERK ? (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signUpFallbackRedirectUrl="/onboarding"
      signInFallbackRedirectUrl="/"
    >
      <App />
    </ClerkProvider>
  ) : (
    <App />
  )
)

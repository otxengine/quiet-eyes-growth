import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from '@/App.jsx'
import '@/index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', gap: '12px' }}>
          <p style={{ fontSize: '16px', color: '#333' }}>משהו השתבש. אנא רענן את הדף.</p>
          <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid #ccc', cursor: 'pointer', fontSize: '14px' }}>
            רענן
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const USE_CLERK = PUBLISHABLE_KEY && !PUBLISHABLE_KEY.includes('your_key_here')

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    {USE_CLERK ? (
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
    )}
  </ErrorBoundary>
)

// What AppLayout renders once auth has resolved: 'loading' | 'signin' | 'error' | 'onboarding' | 'app'.
// Onboarding only when the profile request succeeded and found no business. Never because a
// request failed: finishing onboarding replaces the user's existing business profile.
export function appLayoutView({ loading, error, profilesLoaded, hasProfile, fromOnboarding }) {
  if (loading) return 'loading';
  if (error) return error.status === 401 ? 'signin' : 'error';
  if (profilesLoaded && !hasProfile && !fromOnboarding) return 'onboarding';
  return 'app';
}

// Seconds to wait before retrying a rate-limited request (the API sends Retry-After on 429).
export function retryAfterSeconds(error) {
  return error?.status === 429 ? Math.max(1, error.retryAfter || 30) : 0;
}

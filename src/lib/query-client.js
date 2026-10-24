import { QueryClient } from '@tanstack/react-query';


// Never retry a 429: it only spends more of the rate limit, and AppLayout's error page waits out
// Retry-After instead. Other failures keep react-query's default backoff (1s, 2s, 4s… capped at 30s).
export const retryUnlessRateLimited = (max) => (failureCount, error) =>
	error?.status !== 429 && failureCount < max;

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: retryUnlessRateLimited(1),
		},
	},
});
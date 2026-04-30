import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export const PLAN_ORDER = ['free_trial', 'starter', 'growth', 'pro', 'enterprise'];

export const PLAN_LABELS = {
  free_trial: 'Free Trial',
  starter:    'Starter',
  growth:     'Growth',
  pro:        'Pro',
  enterprise: 'Enterprise',
};

export const PLAN_COLORS = {
  free_trial: '#4CAF50',
  starter:    '#2196F3',
  growth:     '#9C27B0',
  pro:        '#FF5722',
  enterprise: '#F4A800',
};

export function planMeetsRequirement(userPlan, requiredPlan) {
  const userIdx = PLAN_ORDER.indexOf(userPlan);
  const reqIdx  = PLAN_ORDER.indexOf(requiredPlan);
  if (userIdx === -1 || reqIdx === -1) return false;
  return userIdx >= reqIdx;
}

export function usePlan() {
  // Admin override stored directly on BusinessProfile.subscription_plan
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: profiles } = useQuery({
    queryKey: ['businessProfiles', user?.email],
    queryFn: () => base44.entities.BusinessProfile.filter({ created_by: user?.email }),
    enabled: !!user?.email,
    staleTime: 2 * 60 * 1000,
  });

  // Stripe subscription status
  const { data: subData, isLoading } = useQuery({
    queryKey: ['subscriptionStatus'],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke('getSubscriptionStatus', {});
        return res.data;
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
  });

  // Admin override takes priority over Stripe
  const bp = profiles?.find(p => p.onboarding_completed) || profiles?.[0];
  const adminOverride = bp?.subscription_plan || bp?.plan_id;
  const stripePlan    = subData?.plan;

  // Normalize legacy plan IDs
  const normalize = (p) => {
    if (!p) return null;
    if (p === 'free') return 'free_trial';
    return PLAN_ORDER.includes(p) ? p : null;
  };

  const plan = normalize(adminOverride) || normalize(stripePlan) || 'free_trial';

  return {
    plan,
    isLoading,
    planLabel: PLAN_LABELS[plan] || plan,
    planColor: PLAN_COLORS[plan] || '#4CAF50',
    isFreeTrial:  plan === 'free_trial',
    isStarter:    plan === 'starter',
    isGrowth:     plan === 'growth',
    isPro:        plan === 'pro',
    isEnterprise: plan === 'enterprise',
    can: (requiredPlan) => planMeetsRequirement(plan, requiredPlan),
  };
}

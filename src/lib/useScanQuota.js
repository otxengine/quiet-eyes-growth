/**
 * useScanQuota — Returns scan quota status for the current user.
 * Reads AutomationLog to count runFullScan runs this calendar month.
 */
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { usePlan } from './usePlan';
import { getLimits, COST_PER_SCAN } from './planConfig';

export function useScanQuota(businessProfileId) {
  const { plan } = usePlan();
  const limits   = getLimits(plan);

  // Month start (UTC)
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartISO = monthStart.toISOString();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['scanLogs', businessProfileId, monthStartISO],
    queryFn: () => base44.entities.AutomationLog.filter(
      { linked_business: businessProfileId, automation_name: 'runFullScan' },
      '-start_time',
      200,
    ),
    enabled: !!businessProfileId,
    staleTime: 2 * 60 * 1000,
  });

  const scansThisMonth = logs.filter(l => (l.start_time || '') >= monthStartISO).length;
  const quota          = limits.scans_per_month;
  const remaining      = quota === Infinity ? Infinity : Math.max(0, quota - scansThisMonth);
  const isExhausted    = quota !== Infinity && scansThisMonth >= quota;
  const pctUsed        = quota === Infinity ? 0 : Math.min(100, Math.round(scansThisMonth / quota * 100));
  const estimatedCost  = +(scansThisMonth * COST_PER_SCAN).toFixed(2);

  return {
    isLoading,
    plan,
    scansThisMonth,
    quota,
    remaining,
    isExhausted,
    pctUsed,
    estimatedCost,
    quotaLabel: quota === Infinity ? 'ללא הגבלה' : `${scansThisMonth} / ${quota}`,
  };
}

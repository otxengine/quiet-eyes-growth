/**
 * How many posts a steady-state pull may return for a plan that collects every `everyDays`: the daily
 * cap for daily plans, more for plans whose one pull has to cover a week or a month. Apify bills per
 * returned post, so a higher cap costs nothing when an account posted less.
 */
export function steadyPostsCap(everyDays: number | null | undefined, dailyCap: number, max: number): number {
  return Math.min(max, Math.max(dailyCap, Math.ceil((everyDays ?? 1) * 2.5)));
}

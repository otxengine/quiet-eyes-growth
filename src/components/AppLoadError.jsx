import { useEffect, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { retryAfterSeconds } from '@/lib/appLayoutView';

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Shown when the user, business profile or org fails to load. Deliberately offers no way
// into onboarding: a failed request says nothing about whether the account has a business.
export default function AppLoadError({ error, onRetry }) {
  const wait = retryAfterSeconds(error);
  const [left, setLeft] = useState(wait);

  // 429: count down Retry-After, then retry by ourselves
  useEffect(() => {
    if (!wait) return;
    const end = Date.now() + wait * 1000;
    setLeft(wait);
    const t = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      if (s > 0) {
        setLeft(s);
      } else {
        clearInterval(t);
        onRetry();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const Icon = wait ? Clock : AlertTriangle;

  return (
    <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-6">
      <div role="alert" className="max-w-md w-full text-center bg-card border border-border rounded-xl p-8 shadow-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 mb-5 rounded-full bg-amber-100">
          <Icon className="w-7 h-7 text-amber-600" aria-hidden="true" />
        </div>
        {wait ? (
          <>
            <h1 className="text-xl font-bold text-foreground mb-3">יותר מדי בקשות</h1>
            <p className="text-muted-foreground mb-2">
              נשלחו לשרת יותר מדי בקשות בזמן קצר. הנתונים שלך שמורים, אין צורך לעשות דבר.
            </p>
            <p className="text-foreground font-medium" aria-live="polite">
              ננסה שוב אוטומטית בעוד <span dir="ltr" className="tabular-nums">{mmss(left)}</span>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-foreground mb-3">משהו השתבש</h1>
            <p className="text-muted-foreground mb-6">
              לא הצלחנו לטעון את החשבון שלך. הנתונים שלך שמורים ולא נמחקו.
            </p>
            <Button onClick={onRetry}>נסה שוב</Button>
          </>
        )}
      </div>
    </div>
  );
}

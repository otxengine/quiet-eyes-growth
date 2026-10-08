import { useState } from 'react';
import { reactivationApi } from '@/api/orgApi';
import { toast } from 'sonner';

/**
 * "Welcome back" screen shown before the onboarding form when the signed-in
 * user's email matches one or more previously-deactivated business_profiles
 * (see server/src/routes/reactivation.ts). Each business requires an
 * explicit click to reactivate — no silent auto-relink — since the same
 * email could in principle now belong to a different real person.
 */
export default function ReactivationChoice({ candidates, onReactivated, onStartFresh }) {
  const [reactivatingId, setReactivatingId] = useState(null);

  async function handleReactivate(candidate) {
    setReactivatingId(candidate.id);
    try {
      await reactivationApi.reactivate(candidate.id);
      toast.success(`${candidate.name} שוחזר בהצלחה`);
      onReactivated(candidate.id);
    } catch (err) {
      toast.error('שחזור העסק נכשל, נסה שוב');
      setReactivatingId(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-lg w-full">
        <h1 className="text-xl font-bold text-foreground mb-2">ברוך שובך!</h1>
        <p className="text-foreground-muted text-sm mb-6">
          מצאנו עסק{candidates.length > 1 ? 'ים' : ''} שהיו מקושרים לכתובת האימייל שלך.
          תרצה לשחזר אחד מהם, או להתחיל עסק חדש?
        </p>

        <div className="flex flex-col gap-3 mb-6">
          {candidates.map((c) => (
            <div
              key={c.id}
              className="border border-border rounded-xl p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="font-medium text-foreground truncate">{c.name}</div>
                <div className="text-xs text-foreground-muted truncate">
                  {[c.category, c.city].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => handleReactivate(c)}
                disabled={reactivatingId !== null}
                className="shrink-0 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {reactivatingId === c.id ? 'משחזר...' : 'זה העסק שלי — שחזר'}
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={onStartFresh}
          disabled={reactivatingId !== null}
          className="w-full text-center text-sm text-foreground-muted underline hover:text-foreground transition-colors disabled:opacity-50"
        >
          התחל עסק חדש במקום זאת
        </button>
      </div>
    </div>
  );
}

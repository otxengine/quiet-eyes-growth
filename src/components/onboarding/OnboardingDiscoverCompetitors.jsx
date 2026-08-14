import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Loader2, Users } from 'lucide-react';
import KoriAvatar from './KoriAvatar';
import CompetitorSelectCard from './CompetitorSelectCard';

const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

export default function OnboardingDiscoverCompetitors() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state;
  const businessProfile = state?.businessProfile;
  const ranRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [competitors, setCompetitors] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);

  if (!businessProfile) { navigate('/onboarding'); return null; }

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      const bp = businessProfile;
      try {
        await base44.functions.invoke('runCompetitorIdentification', {
          businessProfileId: bp.id, name: bp.name, category: bp.category, city: bp.city,
        }, 180000);
      } catch (err) {
        console.error('runCompetitorIdentification failed:', err);
      }
      try {
        const found = await base44.entities.Competitor.filter(
          { linked_business: bp.id, tracking_status: 'pending_review' }, '-created_date',
        );
        setCompetitors(found || []);
        setCheckedIds(new Set((found || []).map(c => c.id)));
      } catch (err) {
        console.error('Failed to load discovered competitors:', err);
      }
      setLoading(false);
    };

    run();
  }, [businessProfile]);

  const toggle = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirm = async (approvedIds) => {
    setSubmitting(true);
    try {
      const rejectedIds = competitors.map(c => c.id).filter(id => !approvedIds.includes(id));
      await base44.raw.post('/onboarding/confirm-competitors', {
        businessProfileId: businessProfile.id, approvedIds, rejectedIds,
      });
    } catch (err) {
      console.error('confirm-competitors failed:', err);
    }
    navigate('/onboarding/insights', { state });
  };

  const handleConfirm = () => confirm(Array.from(checkedIds));
  const handleSkip = () => confirm(competitors.map(c => c.id));

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-4" style={BG_STYLE}>
        <div className="text-center max-w-sm w-full">
          <div className="relative w-28 h-28 mx-auto mb-6 flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full opacity-20 animate-ping"
              style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 60%, #ff9800 100%)' }}
            />
            <KoriAvatar size="md" className="relative z-10 shadow-lg" />
          </div>
          <h2 className="text-[16px] font-bold text-gray-800 mb-1">מזהה מתחרים רלוונטיים...</h2>
          <p className="text-[12px] text-gray-500">מוצא את המתחרים האמיתיים שלך בלבד</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen py-8 px-4" style={BG_STYLE}>
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center pb-2">
          <KoriAvatar size="md" className="mx-auto mb-4 shadow-md" />
          <h1 className="text-[20px] font-bold text-gray-900 mb-1">אילו מתחרים לעקוב אחריהם?</h1>
          <p className="text-[13px] text-gray-500">קורי מצא את המתחרים האלה — בחר את אלה שרלוונטיים לך</p>
        </div>

        {competitors.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-[13px]">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            לא נמצאו מתחרים כרגע — אפשר להוסיף ידנית מאוחר יותר
          </div>
        ) : (
          <div className="space-y-2">
            {competitors.map((c) => (
              <CompetitorSelectCard
                key={c.id}
                competitor={c}
                checked={checkedIds.has(c.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-white hover:opacity-90 transition-all flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #9c27b0, #e8344d)' }}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            אשר בחירה ({checkedIds.size})
          </button>
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="text-[12px] text-gray-500 underline"
          >
            מלאו אחר כך
          </button>
        </div>
      </div>
    </div>
  );
}

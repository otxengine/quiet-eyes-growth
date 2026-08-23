import React, { useState } from 'react';
import { Mail, Clock } from 'lucide-react';
import { Container, GradientText, CtaButton } from '../ui/primitives.jsx';

const FIELDS = [
  { id: 'name', label: 'שם מלא', type: 'text', required: true, autoComplete: 'name' },
  { id: 'business', label: 'שם העסק', type: 'text', required: true, autoComplete: 'organization' },
  { id: 'phone', label: 'טלפון', type: 'tel', required: true, autoComplete: 'tel' },
  { id: 'sector', label: 'תחום העסק', type: 'text', required: false, placeholder: 'מסעדה, כושר, קליניקה…' },
];

export default function Contact() {
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // TODO: wire to leads endpoint — no public contact/leads endpoint exists on the
    // server yet (see docs/midsite-content-audit.md §7). Until one is added, this
    // form does not transmit anywhere; do NOT ship to production in this state.
    setSent(true);
  };

  return (
    <Container className="pt-16 md:pt-20 pb-24">
      <div className="text-center max-w-xl mx-auto">
        <h1 className="text-[32px] md:text-[42px] leading-tight">
          בואו <GradientText>נדבר</GradientText>
        </h1>
        <p className="mt-4 text-[15.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
          שאלות, הדגמה או התאמה לעסק שלכם — נחזור אליכם תוך יום עסקים.
        </p>
      </div>

      <div className="mt-12 grid lg:grid-cols-5 gap-6 max-w-4xl mx-auto">
        {/* Form */}
        <div className="mkt-card p-6 md:p-8 lg:col-span-3">
          {sent ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center text-white text-2xl" style={{ background: 'var(--mkt-grad)' }} aria-hidden="true">✓</div>
              <h2 className="mt-5 text-[20px]">תודה! קיבלנו את הפנייה</h2>
              <p className="mt-2 text-[14px]" style={{ color: 'var(--mkt-muted)' }}>נחזור אליכם תוך יום עסקים.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {FIELDS.map((f) => (
                <div key={f.id}>
                  <label htmlFor={f.id} className="block text-[13px] font-bold mb-1.5">
                    {f.label}{f.required && <span style={{ color: '#EC1E63' }}> *</span>}
                  </label>
                  <input
                    id={f.id}
                    name={f.id}
                    type={f.type}
                    required={f.required}
                    autoComplete={f.autoComplete}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl border bg-white px-4 h-11 text-[14px] outline-none focus:ring-2"
                    style={{ borderColor: 'var(--mkt-border-strong)', color: 'var(--mkt-ink)' }}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="message" className="block text-[13px] font-bold mb-1.5">איך נוכל לעזור?</label>
                <textarea
                  id="message"
                  name="message"
                  rows={4}
                  className="w-full rounded-xl border bg-white px-4 py-3 text-[14px] outline-none focus:ring-2 resize-none"
                  style={{ borderColor: 'var(--mkt-border-strong)', color: 'var(--mkt-ink)' }}
                />
              </div>
              <button
                type="submit"
                className="w-full h-12 rounded-full text-white font-bold text-[15px] transition-transform hover:scale-[1.01]"
                style={{ background: 'var(--mkt-grad)' }}
              >
                שלחו פנייה
              </button>
            </form>
          )}
        </div>

        {/* Channels */}
        <div className="lg:col-span-2 space-y-4">
          <div className="mkt-card p-6">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#F4F4F6' }}>
                <Mail size={18} aria-hidden="true" />
              </span>
              <div>
                <div className="font-bold text-[14px]">אימייל</div>
                <a href="mailto:contact@cortexi.ai" className="text-[13.5px] underline" style={{ color: 'var(--mkt-ink-2)' }}>
                  contact@cortexi.ai
                </a>
              </div>
            </div>
          </div>

          {/* TODO: TAL — WhatsApp: אין מספר אמיתי כרגע. כשיהיה — להסיר את ההערה ולהחליף את ה-href:
          <div className="mkt-card p-6"> ... <a href="https://wa.me/972XXXXXXXXX">וואטסאפ</a> ... </div> */}

          <div className="mkt-card p-6">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#F4F4F6' }}>
                <Clock size={18} aria-hidden="true" />
              </span>
              <div>
                <div className="font-bold text-[14px]">זמינות</div>
                <div className="text-[13px]" style={{ color: 'var(--mkt-muted)' }}>
                  מענה אנושי: ימים א׳–ה׳ 9:00–18:00
                  <br />
                  המערכת עצמה עובדת 24/7
                </div>
              </div>
            </div>
          </div>

          <div className="mkt-card p-6" style={{ background: 'var(--mkt-ink)', borderColor: 'var(--mkt-ink)' }}>
            <div className="font-bold text-[14px] text-white">מעדיפים פשוט לנסות?</div>
            <p className="mt-1 text-[12.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              תוכנית חינם לתמיד, בלי כרטיס אשראי.
            </p>
            <CtaButton href="/sign-up" variant="gradient" className="mt-4 w-full !h-10 text-[13.5px]">
              התחילו בחינם
            </CtaButton>
          </div>
        </div>
      </div>
    </Container>
  );
}

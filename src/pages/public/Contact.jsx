import React, { useState } from 'react';
import { Mail, Phone, MessageSquare, Clock } from 'lucide-react';

const channels = [
  {
    icon: Mail,
    title: 'אימייל',
    value: 'support@quieteyes.co.il',
    href: 'mailto:support@quieteyes.co.il',
    note: 'מענה תוך 24 שעות',
  },
  {
    icon: Phone,
    title: 'WhatsApp',
    value: '050-123-4567',
    href: 'https://wa.me/972501234567',
    note: 'ימים א׳–ה׳, 9:00–18:00',
  },
  {
    icon: MessageSquare,
    title: 'צ׳אט במערכת',
    value: 'לקוחות רשומים',
    href: null,
    note: 'זמין ישירות בתוך הפלטפורמה',
  },
];

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', message: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    // In a real app this would POST to a backend; for now just show a thank-you
    setSent(true);
  };

  return (
    <div className="min-h-screen px-6 py-20">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-[32px] font-bold text-foreground mb-3">צור קשר</h1>
          <p className="text-[14px] text-foreground-muted">שאלות, הצעות, או פשוט רוצה לדעת עוד? נשמח לשמוע.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Contact channels */}
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-foreground mb-4">איך ליצור קשר</h2>
            {channels.map((ch) => (
              <div key={ch.title} className="card-base p-5 flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <ch.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-[12px] font-medium text-foreground-muted mb-0.5">{ch.title}</p>
                  {ch.href ? (
                    <a href={ch.href} className="text-[14px] font-semibold text-primary hover:underline">
                      {ch.value}
                    </a>
                  ) : (
                    <p className="text-[14px] font-semibold text-foreground">{ch.value}</p>
                  )}
                  <p className="text-[11px] text-foreground-muted mt-0.5">{ch.note}</p>
                </div>
              </div>
            ))}

            <div className="card-base p-5 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[12px] font-medium text-foreground-muted mb-0.5">שעות תמיכה</p>
                <p className="text-[13px] text-foreground">ימים א׳–ה׳: 9:00–18:00</p>
                <p className="text-[11px] text-foreground-muted mt-0.5">סוכני AI עובדים 24/7</p>
              </div>
            </div>
          </div>

          {/* Message form */}
          <div className="card-base p-6">
            {sent ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-6 h-6 text-success" />
                </div>
                <h3 className="text-[16px] font-semibold text-foreground mb-2">תודה!</h3>
                <p className="text-[13px] text-foreground-muted">קיבלנו את ההודעה ונחזור אליך בהקדם.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <h2 className="text-[15px] font-semibold text-foreground mb-4">שלח הודעה</h2>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-muted mb-1">שם</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="השם שלך"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-muted mb-1">אימייל</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="your@email.com"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-muted mb-1">הודעה</label>
                  <textarea
                    required
                    rows={4}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    placeholder="איך נוכל לעזור?"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-all"
                >
                  שלח הודעה
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

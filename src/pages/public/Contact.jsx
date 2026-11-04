import React, { useState } from 'react';
import { Mail, Phone, MessageSquare, Clock } from 'lucide-react';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const glassCard = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' };

const channels = [
  {
    icon: Mail,
    title: 'אימייל',
    value: 'support@cortexi.ai',
    href: 'mailto:support@cortexi.ai',
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
    setSent(true);
  };

  return (
    <div className="min-h-screen px-6 py-20" style={{ background: '#0A0A0F' }}>
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-[32px] font-bold text-white mb-3">צור קשר</h1>
          <p className="text-[14px]" style={{ color: '#9090A8' }}>שאלות, הצעות, או פשוט רוצה לדעת עוד? נשמח לשמוע.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Contact channels */}
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-white mb-4">איך ליצור קשר</h2>
            {channels.map((ch) => (
              <div key={ch.title} className="p-5 rounded-xl flex items-start gap-4" style={glassCard}>
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(232,52,77,0.15)' }}
                >
                  <ch.icon className="w-4 h-4" style={{ color: '#E8344D' }} />
                </div>
                <div>
                  <p className="text-[12px] font-medium mb-0.5" style={{ color: '#9090A8' }}>{ch.title}</p>
                  {ch.href ? (
                    <a href={ch.href} className="text-[14px] font-semibold hover:underline" style={{ color: '#E8344D' }}>
                      {ch.value}
                    </a>
                  ) : (
                    <p className="text-[14px] font-semibold text-white">{ch.value}</p>
                  )}
                  <p className="text-[11px] mt-0.5" style={{ color: '#9090A8' }}>{ch.note}</p>
                </div>
              </div>
            ))}

            <div className="p-5 rounded-xl flex items-start gap-4" style={glassCard}>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(232,52,77,0.15)' }}
              >
                <Clock className="w-4 h-4" style={{ color: '#E8344D' }} />
              </div>
              <div>
                <p className="text-[12px] font-medium mb-0.5" style={{ color: '#9090A8' }}>שעות תמיכה</p>
                <p className="text-[13px] text-white">ימים א׳–ה׳: 9:00–18:00</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#9090A8' }}>סוכני AI עובדים 24/7</p>
              </div>
            </div>
          </div>

          {/* Message form */}
          <div className="p-6 rounded-xl" style={glassCard}>
            {sent ? (
              <div className="text-center py-8">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: 'rgba(16,185,129,0.15)' }}
                >
                  <Mail className="w-6 h-6" style={{ color: '#10b981' }} />
                </div>
                <h3 className="text-[16px] font-semibold text-white mb-2">תודה!</h3>
                <p className="text-[13px]" style={{ color: '#9090A8' }}>קיבלנו את ההודעה ונחזור אליך בהקדם.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <h2 className="text-[15px] font-semibold text-white mb-4">שלח הודעה</h2>
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: '#9090A8' }}>שם</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="השם שלך"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: '#9090A8' }}>אימייל</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="your@email.com"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: '#9090A8' }}>הודעה</label>
                  <textarea
                    required
                    rows={4}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    placeholder="איך נוכל לעזור?"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-all"
                  style={{ background: G }}
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

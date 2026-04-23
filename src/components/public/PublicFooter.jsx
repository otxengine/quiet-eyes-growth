import React from 'react';
import { Link } from 'react-router-dom';

export default function PublicFooter() {
  return (
    <footer className="bg-[#fafafa] border-t border-[#f0f0f0]">
      <div className="max-w-[1120px] mx-auto px-5 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src="/logo.jpeg" alt="OTX" className="h-6 w-auto object-contain" />
              <span className="text-[15px] font-bold text-[#111]">OTX</span>
            </div>
            <p className="text-[13px] text-[#777] leading-relaxed">מודיעין עסקי AI לעסקים קטנים בישראל. דע מה קורה בשוק שלך — לפני כולם.</p>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-[12px] font-semibold text-[#111] mb-4 uppercase tracking-wider">ניווט</h4>
            <div className="flex flex-col gap-2.5">
              <Link to="/" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">דף הבית</Link>
              <Link to="/how-it-works" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">איך זה עובד</Link>
              <Link to="/features" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">תכונות</Link>
              <Link to="/pricing" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">תמחור</Link>
            </div>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-[12px] font-semibold text-[#111] mb-4 uppercase tracking-wider">משאבים</h4>
            <div className="flex flex-col gap-2.5">
              <Link to="/about" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">אודות</Link>
              <Link to="/contact" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">צור קשר</Link>
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-[12px] font-semibold text-[#111] mb-4 uppercase tracking-wider">משפטי</h4>
            <div className="flex flex-col gap-2.5">
              <Link to="/terms" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">תנאי שימוש</Link>
              <Link to="/privacy" className="text-[13px] text-[#777] hover:text-[#111] transition-colors">מדיניות פרטיות</Link>
            </div>
          </div>
        </div>

        <div className="border-t border-[#f0f0f0] pt-6 text-center">
          <p className="text-[12px] text-[#bbb]">© 2026 OTX. כל הזכויות שמורות.</p>
        </div>
      </div>
    </footer>
  );
}
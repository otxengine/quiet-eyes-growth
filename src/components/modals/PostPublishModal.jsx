import React from 'react';
import { X, Sparkles } from 'lucide-react';

const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn'];

export default function PostPublishModal({ text, reason, onConfirm, onBack, onSchedule, onClose }) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose} />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
        dir="rtl"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-[15px] font-bold text-gray-900">פוסט חדש מוכן לפרסום</h2>
          </div>

          <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
            {/* Subtitle */}
            <p className="text-[12px] text-gray-500 text-right leading-relaxed">
              המערכת יצרה עבורך תוכן חדש על בסיס הנתונים האחרונים והנושאים שמעניינים את הקהל שלך:
            </p>

            {/* Platforms */}
            <div className="flex items-center justify-end gap-1.5">
              {PLATFORMS.map(p => (
                <span key={p} className="text-[12px] text-gray-600 font-medium">
                  {p}
                  {p !== PLATFORMS[PLATFORMS.length - 1] && <span className="text-gray-300 mx-1">·</span>}
                </span>
              ))}
            </div>

            {/* Post preview */}
            <div className="border border-[#e8344d]/30 rounded-xl p-4 bg-[#fff5f6]">
              <p className="text-[11px] font-semibold text-[#e8344d] mb-2">הצגה מקדימה</p>
              <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">{text}</p>
            </div>

            {/* Why section */}
            {reason && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                <div className="flex items-center justify-end gap-1.5 mb-2">
                  <p className="text-[11px] font-semibold text-gray-700">למה המערכת ממליצה על הפוסט</p>
                  <span className="flex items-center gap-1 text-[10px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full font-medium">
                    <Sparkles className="w-3 h-3" /> AI
                  </span>
                </div>
                <p className="text-[12px] text-gray-500 leading-relaxed">{reason}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-3 border-t border-gray-100 space-y-2">
            <button
              onClick={onConfirm}
              className="w-full py-3 rounded-xl bg-[#e8344d] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
            >
              אישור ופרסום
            </button>
            <button
              onClick={onBack}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-[13px] text-gray-600 font-medium hover:bg-gray-50 transition-colors"
            >
              חזור לעריכה
            </button>
            {onSchedule && (
              <button
                onClick={onSchedule}
                className="w-full text-[12px] text-gray-400 hover:text-gray-600 transition-colors py-1"
              >
                תזמון לאוחר אחר
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

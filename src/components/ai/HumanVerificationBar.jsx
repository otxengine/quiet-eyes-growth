import React, { useState } from 'react';
import { CheckCircle, XCircle, Edit3, Eye } from 'lucide-react';

/**
 * Shows a verification/approval bar for AI-generated content.
 * Allows humans to approve, reject, or edit.
 */
export default function HumanVerificationBar({ 
  onApprove, 
  onReject, 
  onEdit,
  isVerified = false,
  verifiedBy = null,
  showPreview = false,
  onTogglePreview,
  label = 'תוכן נוצר ע"י AI'
}) {
  if (isVerified) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-[#f0fdf8] border border-[#d1fae5] rounded-lg text-[11px]">
        <CheckCircle className="w-3.5 h-3.5 text-[#10b981]" />
        <span className="text-[#10b981] font-medium">אושר</span>
        {verifiedBy && <span className="text-[#999999]">· {verifiedBy}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[#fffbeb] border border-[#fef3c7] rounded-lg text-[11px]">
      <span className="text-[#d97706] font-medium flex-shrink-0">⚡ {label}</span>
      <div className="flex items-center gap-1.5 mr-auto">
        {onTogglePreview && (
          <button onClick={onTogglePreview} className="p-1 rounded hover:bg-[#fef3c7] text-[#d97706] transition-colors">
            <Eye className="w-3.5 h-3.5" />
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} className="p-1 rounded hover:bg-[#fef3c7] text-[#d97706] transition-colors">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
        {onApprove && (
          <button onClick={onApprove} className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#10b981] text-white hover:bg-[#059669] transition-colors text-[10px] font-medium">
            <CheckCircle className="w-3 h-3" /> אשר
          </button>
        )}
        {onReject && (
          <button onClick={onReject} className="flex items-center gap-1 px-2 py-1 rounded-md bg-white text-[#dc2626] border border-[#fecaca] hover:bg-[#fef2f2] transition-colors text-[10px] font-medium">
            <XCircle className="w-3 h-3" /> דחה
          </button>
        )}
      </div>
    </div>
  );
}
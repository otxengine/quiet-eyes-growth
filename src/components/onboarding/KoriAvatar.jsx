import React from 'react';

const SIZES = {
  sm: { cls: 'w-10 h-10 text-base', px: 40 },
  md: { cls: 'w-16 h-16 text-2xl', px: 64 },
  lg: { cls: 'w-24 h-24 text-4xl', px: 96 },
};

export default function KoriAvatar({ size = 'md', className = '', pulse = false }) {
  const { cls } = SIZES[size] || SIZES.md;
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 select-none ${cls} ${pulse ? 'animate-pulse' : ''} ${className}`}
      style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 60%, #ff9800 100%)' }}
    >
      ק
    </div>
  );
}

/* eslint-disable */
import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Logo({
  className,
  variant = 'default',
  iconOnly = false,
}: {
  className?: string;
  variant?: 'default' | 'white';
  iconOnly?: boolean;
}) {
  const isWhite = variant === 'white';
  
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img
        src="/logo.png"
        alt="FireGuard Logo"
        className="shrink-0 object-contain"
        style={{ width: iconOnly ? 40 : 36, height: iconOnly ? 40 : 36 }}
      />
      {!iconOnly && (
        <span
          className={cn(
            'text-xl font-bold tracking-wider',
            isWhite ? 'text-white' : 'text-navy-900'
          )}
        >
          FIREGUARD
        </span>
      )}
    </div>
  );
}

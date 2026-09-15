'use client';

import React from 'react';
import type { ButtonVariant, ButtonSize } from './Button';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  loading?: boolean;
  variant?: Extract<ButtonVariant, 'ghost' | 'secondary'>;
  size?: Extract<ButtonSize, 'sm' | 'md'>;
}

const variantClass = {
  ghost: 'text-gray-600 hover:bg-gray-100',
  secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
};

const sizeClass = {
  sm: 'h-9 w-9 sm:h-8 sm:w-8',
  md: 'h-11 w-11 sm:h-10 sm:w-10',
};

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  disabled,
  loading = false,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-label={label}
      aria-disabled={disabled || loading}
      aria-busy={loading}
      data-loading-indicator
      className={[
        'inline-flex items-center justify-center rounded-lg transition-colors',
        variantClass[variant],
        sizeClass[size],
        disabled || loading ? 'opacity-50 cursor-not-allowed' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? <span aria-hidden="true" className="action-loading-spinner h-4 w-4 rounded-full border-2 border-current border-t-transparent" /> : icon}
    </button>
  );
}

'use client';

import React from 'react';
import type { ButtonVariant, ButtonSize } from './Button';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
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
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      aria-label={label}
      aria-disabled={disabled}
      className={[
        'inline-flex items-center justify-center rounded-lg transition-colors',
        variantClass[variant],
        sizeClass[size],
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
    </button>
  );
}

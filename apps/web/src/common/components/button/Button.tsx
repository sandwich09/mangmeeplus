'use client';

import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const variantClass: Record<ButtonVariant, string> = {
  // มั่งมี Brand Kit: primary = green gradient linear-gradient(150deg,#22C55E,#15803D)
  primary: 'bg-linear-to-br from-brand-500 to-brand-700 text-white hover:from-brand-600 hover:to-brand-800',
  secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-gray-600 hover:bg-gray-100',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 sm:h-8',
  md: 'h-11 px-4 text-sm gap-2 sm:h-10',
  lg: 'h-12 px-6 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'left',
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={loading}
      className={[
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        variantClass[variant],
        sizeClass[size],
        isDisabled ? 'opacity-50 cursor-not-allowed' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading && (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {!loading && icon && iconPosition === 'left' && icon}
      {children}
      {!loading && icon && iconPosition === 'right' && icon}
    </button>
  );
}

'use client';

import React from 'react';
import { buttonClassByLook, type ButtonLook } from './button-classes';

/** `quiet` is the frameless one; `ghost` is its old name and draws the same button. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Every size is 44 px tall on a phone and 40 px from 640 px, except `lg`: the 48 px submit of the sign-in pages. */
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const lookOf: Record<ButtonVariant, ButtonLook> = {
  primary: 'primary',
  secondary: 'secondary',
  danger: 'danger',
  quiet: 'quiet',
  ghost: 'quiet',
};

/**
 * The shared button. It draws the `.mangmee-btn*` look (app/globals.css), the same one a native
 * `<button className={primaryButtonClass}>` gets, so a dialog button and a page button match.
 * `data-variant` (`primary|secondary|quiet|danger`) lets a check count the primary buttons of a view.
 */
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
  const look = lookOf[variant];
  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={loading}
      data-loading-indicator
      data-variant={look}
      data-size={size === 'md' ? undefined : size}
      className={className ? `${buttonClassByLook[look]} ${className}` : buttonClassByLook[look]}
    >
      {loading && (
        <span aria-hidden="true" className="action-loading-spinner h-4 w-4 shrink-0 rounded-full border-2 border-current border-t-transparent" />
      )}
      {!loading && icon && iconPosition === 'left' && icon}
      {children}
      {!loading && icon && iconPosition === 'right' && icon}
    </button>
  );
}

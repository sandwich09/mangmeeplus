'use client';

import { useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useLocale } from '@/common/i18n/use-locale';
import { ThemedSelect, type ThemedSelectProps } from './ThemedSelect';

type FieldFrameProps = {
  id: string;
  label: string;
  showRequiredMark?: boolean;
  error?: string;
  hint?: string;
  hintClassName?: string;
  frameClassName?: string;
  children: ReactNode;
};

function FieldFrame({ id, label, showRequiredMark, error, hint, hintClassName, frameClassName, children }: FieldFrameProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <label htmlFor={id} className={`flex flex-col gap-1.5 text-sm font-medium text-gray-700 ${frameClassName ?? ''}`}>
      <span>{label}{showRequiredMark && <span className="text-red-600" aria-hidden="true"> *</span>}</span>
      {children}
      {hint && <span id={hintId} title={hintClassName ? hint : undefined} className={`text-xs font-normal ${hintClassName ?? 'text-gray-400'}`}>{hint}</span>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </label>
  );
}

const inputClass =
  'h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 sm:h-10 sm:text-sm';

function getFieldId(id: string | undefined, name: string | undefined, label: string) {
  return id ?? name ?? label.toLowerCase().trim().replace(/\s+/g, '-');
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  showRequiredMark?: boolean;
  error?: string;
  hint?: string;
  hintClassName?: string;
  frameClassName?: string;
}

export function TextField({ id, label, showRequiredMark, error, hint, hintClassName, frameClassName, className, ...rest }: TextFieldProps) {
  const [locale] = useLocale();
  const [revealed, setRevealed] = useState(false);
  const fieldId = getFieldId(id, rest.name, label);
  const describedBy = [hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined]
    .filter(Boolean)
    .join(' ');
  const isPassword = rest.type === 'password';

  const input = (
    <input
      id={fieldId}
      aria-invalid={!!error}
      aria-describedby={describedBy || undefined}
      {...rest}
      type={isPassword && revealed ? 'text' : rest.type}
      className={`${inputClass} ${isPassword ? 'pr-11 sm:pr-10' : ''} ${className ?? ''}`}
    />
  );

  return (
    <FieldFrame id={fieldId} label={label} showRequiredMark={showRequiredMark} error={error} hint={hint} hintClassName={hintClassName} frameClassName={frameClassName}>
      {isPassword ? (
        <span className="relative block">
          {input}
          <button
            type="button"
            onClick={() => setRevealed((visible) => !visible)}
            // ponytail: reuses the login page's eye toggle strings — same two words, no new keys.
            aria-label={t(revealed ? 'auth.login.hide_password' : 'auth.login.show_password', locale)}
            className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center text-gray-400 transition-colors hover:text-gray-600 sm:right-3 sm:inline-block sm:h-auto sm:w-auto"
          >
            {revealed ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.61 6.61A18 18 0 0 0 2 12s3 8 10 8a9 9 0 0 0 5.39-1.61" /><path d="M1 1l22 22" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            )}
          </button>
        </span>
      ) : (
        input
      )}
    </FieldFrame>
  );
}

export interface SelectFieldProps extends ThemedSelectProps {
  label: string;
  showRequiredMark?: boolean;
  error?: string;
  hint?: string;
  frameClassName?: string;
}

export function SelectField({ id, label, showRequiredMark, error, hint, frameClassName, className, children, ...rest }: SelectFieldProps) {
  const fieldId = getFieldId(id, rest.name, label);
  const describedBy = [hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <FieldFrame id={fieldId} label={label} showRequiredMark={showRequiredMark} error={error} hint={hint} frameClassName={frameClassName}>
      <ThemedSelect
        id={fieldId}
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        className={`${inputClass} ${className ?? ''}`}
        {...rest}
      >
        {children}
      </ThemedSelect>
    </FieldFrame>
  );
}

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextareaField({ id, label, error, hint, className, ...rest }: TextareaFieldProps) {
  const fieldId = getFieldId(id, rest.name, label);
  const describedBy = [hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <FieldFrame id={fieldId} label={label} error={error} hint={hint}>
      <textarea
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        className={`min-h-28 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 sm:text-sm ${className ?? ''}`}
        {...rest}
      />
    </FieldFrame>
  );
}

export interface SwitchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
  hint?: string;
}

export function SwitchField({ id, label, error, hint, className, ...rest }: SwitchFieldProps) {
  const fieldId = getFieldId(id, rest.name, label);
  const describedBy = [hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <label htmlFor={fieldId} className="flex items-start gap-3 text-sm font-medium text-gray-700">
      <span className="flex min-h-11 min-w-11 shrink-0 justify-center sm:min-h-0 sm:min-w-0">
        <input
          id={fieldId}
          type="checkbox"
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          className={`mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 ${className ?? ''}`}
          {...rest}
        />
      </span>
      <span className="flex flex-col gap-1">
        {label}
        {hint && <span id={`${fieldId}-hint`} className="text-xs font-normal text-gray-400">{hint}</span>}
        {error && <FieldError id={`${fieldId}-error`}>{error}</FieldError>}
      </span>
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} role="alert" className="text-xs font-normal text-red-600">
      {children}
    </span>
  );
}

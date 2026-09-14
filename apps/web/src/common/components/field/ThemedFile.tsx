'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/common/components/mangmee';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';

// Themed file picker — a drop-in for native <input type="file">, whose "Choose File /
// No file chosen" control is browser-drawn (un-themable) and ignores the app language.
// Controlled use: pass `file` (File, display string, or null) and take onChange(File | null);
// the native input is cleared after every pick so re-selecting the same file still fires
// (callers can drop their `key`-remount hacks). Uncontrolled use (FormData forms): pass
// `name` — the native input keeps the FileList and native `required` validation applies.

const LABELS = {
  th: { pick: 'เลือกไฟล์', change: 'เปลี่ยนไฟล์', empty: 'ยังไม่ได้เลือกไฟล์', clear: 'นำไฟล์ออก', loading: 'กำลังเตรียม/อัปโหลดไฟล์...' },
  en: { pick: 'Choose file', change: 'Change file', empty: 'No file selected', clear: 'Remove file', loading: 'Preparing/uploading file...' },
} as const;

export type ThemedFileProps = {
  /** Controlled display: a File (shows its name), a name string, or null (empty). */
  file?: File | string | null;
  onChange?: (file: File | null) => void;
  accept?: string;
  /** `capture="environment"` opens the rear camera straight away on a phone. */
  capture?: boolean | 'user' | 'environment';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  placeholder?: string;
  /** FormData forms: the native input keeps the FileList under this name. */
  name?: string;
  required?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-required'?: boolean;
};

export function ThemedFile({ file, onChange, accept, capture, disabled: disabledProp = false, loading = false, className, placeholder, name, required, id, 'aria-label': ariaLabel, 'aria-required': ariaRequired }: ThemedFileProps) {
  const disabled = disabledProp || loading;
  const locale = useWorkspaceLocale();
  const labels = LABELS[locale] ?? LABELS.th;
  const inputRef = useRef<HTMLInputElement>(null);
  const [innerName, setInnerName] = useState('');
  const controlled = file !== undefined;
  const shownName = controlled ? (typeof file === 'string' ? file : file?.name ?? '') : innerName;

  // React 19 form actions clear uncontrolled fields via form.reset(), which fires a
  // `reset` event — mirror it so the shown name doesn't outlive the emptied input.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setInnerName('');
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, []);

  function pick(next: File | null) {
    setInnerName(next?.name ?? '');
    // A controlled parent owns the File, so the input empties immediately — this is what
    // lets the same file be re-picked after the parent rejects or clears it.
    if (controlled && inputRef.current) inputRef.current.value = '';
    onChange?.(next);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = '';
    pick(null);
  }

  return (
    // A <label> so a click anywhere opens the dialog natively (the clear <button> is
    // interactive content, which the label activation behavior skips by spec).
    <label
      aria-busy={loading}
      className={cx(
        'mangmee-input flex items-center gap-2',
        disabled
          ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-500'
          : 'cursor-pointer focus-within:border-brand-700 focus-within:shadow-[var(--shadow-focus)]',
        className,
      )}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        name={name}
        required={required}
        accept={accept}
        capture={capture}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-required={ariaRequired}
        className="sr-only"
        onChange={(event) => pick(event.target.files?.[0] ?? null)}
      />
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400">
        <path d="m14.5 8.5-4.6 4.6a2.55 2.55 0 0 1-3.6-3.6l5.3-5.3a1.7 1.7 0 0 1 2.4 2.4l-5.3 5.3a.85.85 0 0 1-1.2-1.2l4.6-4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={cx('min-w-0 flex-1 truncate', shownName ? 'text-gray-800' : 'text-gray-400')}>
        {shownName || placeholder || labels.empty}
      </span>
      {shownName && !disabled && (
        <button
          type="button"
          aria-label={labels.clear}
          onClick={clear}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 sm:h-7 sm:w-7"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
            <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold', disabled ? 'bg-gray-100 text-gray-400' : 'bg-brand-50 text-brand-700')}>
        {loading ? <span aria-hidden="true" className="action-loading-spinner h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" /> : <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
          <path d="M10 13V4m0 0 3.5 3.5M10 4 6.5 7.5M4 13.5v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>}
        <span role={loading ? 'status' : undefined}>{loading ? labels.loading : shownName ? labels.change : labels.pick}</span>
      </span>
    </label>
  );
}

'use client';

import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { cx } from '@/common/components/mangmee';
import { PopoverPanel } from './PopoverPanel';

// Drop-in replacement for a native <select> whose OS-drawn option popup can't be
// themed. Keep the same call shape — `value`, `onChange(e => e.target.value)`, and
// <option> children — so migrating is just renaming the tag. The open list is our
// own themed menu (details/summary), matching the design's SelectField.

type ThemedOption = { value: string; label: ReactNode; disabled: boolean };

export type ThemedSelectProps = {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
  children?: ReactNode;
  /** Filter plain-text options by label or value inside a large dropdown. */
  searchable?: boolean;
  /** Keep long selected labels readable in narrow forms. */
  wrapLabel?: boolean;
  searchPlaceholder?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true' | 'grammar' | 'spelling';
};

function collectOptions(children: ReactNode): ThemedOption[] {
  const options: ThemedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
      options.push({ value: String(props.value ?? ''), label: props.children ?? '', disabled: !!props.disabled });
    } else if (child.type === 'optgroup' || child.type === Fragment) {
      options.push(...collectOptions((child.props as { children?: ReactNode }).children));
    }
  });
  return options;
}

export function ThemedSelect({ value, defaultValue, onChange, disabled = false, required = false, name, className, children, id, searchable = false, wrapLabel = false, searchPlaceholder = 'ค้นหาตัวเลือก', 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid }: ThemedSelectProps) {
  const triggerId = useId();
  const listboxId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue === undefined ? undefined : String(defaultValue));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Guarded so a stray Escape elsewhere on the page never yanks focus back here.
  // The option list is portaled, so it has to be named as "inside" explicitly.
  useCloseOnOutsideClick(detailsRef, useCallback(() => {
    if (detailsRef.current?.open) detailsRef.current.removeAttribute('open');
  }, []), panelRef);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => setUncontrolledValue(defaultValue === undefined ? undefined : String(defaultValue));
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue, value]);

  const options = collectOptions(children);
  const current = value === undefined ? (uncontrolledValue ?? options[0]?.value ?? '') : String(value);
  const selected = options.find((option) => option.value === current) ?? options[0];
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const visibleOptions = searchable ? options.filter((option) => terms.every((term) =>
    `${option.value} ${typeof option.label === 'string' ? option.label : ''}`.toLocaleLowerCase().includes(term))) : options;

  function select(nextValue: string) {
    if (value === undefined) setUncontrolledValue(nextValue);
    onChange?.({ target: { value: nextValue } });
    detailsRef.current?.removeAttribute('open');
    summaryRef.current?.focus();
  }

  function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      detailsRef.current?.removeAttribute('open');
      summaryRef.current?.focus();
      return;
    }
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <details ref={detailsRef} onToggle={(event) => { setOpen(event.currentTarget.open); if (!event.currentTarget.open) setQuery(''); }} className="group relative min-w-0">
      {name && (
        <input
          ref={inputRef}
          type="text"
          name={name}
          value={current}
          disabled={disabled}
          required={required}
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          onChange={() => undefined}
          onInvalid={(event) => { event.preventDefault(); summaryRef.current?.focus(); }}
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      )}
      <summary
        ref={summaryRef}
        id={id ?? triggerId}
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => { if (disabled) event.preventDefault(); }}
        className={cx(
          'mangmee-input flex list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer group-open:border-brand-700',
          className,
        )}
      >
        <span className={cx('min-w-0', wrapLabel ? 'whitespace-normal break-words' : 'truncate', selected?.label ? 'text-gray-800' : 'text-gray-400')}>{selected?.label ?? ''}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-gray-500 transition group-open:rotate-180">
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <PopoverPanel
        open={open}
        anchorRef={summaryRef}
        panelRef={panelRef}
        height={240}
        minAnchorWidth
        matchAnchorWidth={searchable}
        onKeyDown={moveOptionFocus}
        className="z-[100000] max-h-60 min-w-[10rem] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-[var(--shadow-theme-md)]"
      >
        {searchable && <input type="search" value={query} autoFocus aria-label={searchPlaceholder}
          placeholder={searchPlaceholder} onChange={(event) => setQuery(event.target.value)}
          className="mangmee-input sticky top-0 mb-1 w-full bg-white" />}
        {visibleOptions.length === 0 && <p role="status" className="px-3 py-2 text-sm text-gray-500">ไม่พบตัวเลือกที่ตรงกับคำค้น</p>}
        <div id={listboxId} role="listbox" aria-labelledby={id ?? triggerId}>
        {visibleOptions.map((option, index) => {
          const isSelected = option.value === current;
          return (
            <button
              key={`${option.value}:${index}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={option.disabled}
              onClick={() => select(option.value)}
              className={cx(
                'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[15px] font-semibold outline-none transition focus:ring-2 focus:ring-inset focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50',
                isSelected ? 'bg-brand-25 text-brand-700' : 'text-gray-700 hover:bg-gray-50',
              )}
            >
              <span className="min-w-0 break-words">{option.label}</span>
              {isSelected && <span aria-hidden="true" className="shrink-0 text-brand-600">✓</span>}
            </button>
          );
        })}
        </div>
      </PopoverPanel>
    </details>
  );
}

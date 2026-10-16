'use client';

import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { cx } from '@/common/components/mangmee';
import { PopoverPanel } from './PopoverPanel';

// Drop-in replacement for a native <select> whose OS-drawn option popup can't be
// themed. Keep the same call shape — `value`, `onChange(e => e.target.value)`, and
// <option> children — so migrating is just renaming the tag. The open list is our
// own themed menu (details/summary), matching the design's SelectField.

type ThemedOption = { value: string; label: ReactNode; disabled: boolean; hidden: boolean };

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
  /**
   * Let a long chosen value take a second line instead of ending in "…": the control grows, it never
   * clips. For values that are sentences ("ผู้รับเงินไม่สามารถออกใบเสร็จรับเงิน"), in a form column on a
   * phone. Leave it off in a filter bar or a table row, where one line keeps the row level.
   */
  wrapLabel?: boolean;
  /**
   * What the closed control says while nothing is chosen, when the options carry no empty-value
   * prompt of their own. It is never a row of the list.
   */
  placeholder?: string;
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
      const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean; hidden?: boolean };
      options.push({ value: String(props.value ?? ''), label: props.children ?? '', disabled: !!props.disabled, hidden: !!props.hidden });
    } else if (child.type === 'optgroup' || child.type === Fragment) {
      options.push(...collectOptions((child.props as { children?: ReactNode }).children));
    }
  });
  return options;
}

/**
 * The empty choice that only says "choose one" is a prompt, not an option, and is not listed
 * (HTML calls it the placeholder label option). It is told apart from a real empty choice
 * ("ทุกเดือน", "ไม่ระบุ": a filter's "all", a field's "none") by how the caller wrote it, never by its words:
 *  - the first option, with an empty value, of a `required` select: empty cannot be an answer there;
 *  - an empty-value option the caller made `disabled` or `hidden`: it could not be chosen anyway.
 * Any other empty-value option is a real choice and stays in the list.
 */
function promptOption(options: ThemedOption[], required: boolean): ThemedOption | undefined {
  return options.find((option, index) => option.value === '' && (option.disabled || option.hidden || (required && index === 0)));
}

export function ThemedSelect({ value, defaultValue, onChange, disabled = false, required = false, name, className, children, id, searchable = false, wrapLabel = false, placeholder, searchPlaceholder = 'ค้นหาตัวเลือก', 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid }: ThemedSelectProps) {
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
  const prompt = promptOption(options, required);
  const choices = prompt ? options.filter((option) => option !== prompt) : options;
  const current = value === undefined ? (uncontrolledValue ?? options[0]?.value ?? '') : String(value);
  // With `placeholder`, a value that matches no option shows the placeholder; without it, the first option as before.
  const selected = options.find((option) => option.value === current) ?? (placeholder === undefined ? options[0] : undefined);
  const showsPrompt = selected === undefined || selected === prompt;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const visibleOptions = searchable ? choices.filter((option) => terms.every((term) =>
    `${option.value} ${typeof option.label === 'string' ? option.label : ''}`.toLocaleLowerCase().includes(term))) : choices;

  function select(nextValue: string) {
    if (value === undefined) setUncontrolledValue(nextValue);
    onChange?.({ target: { value: nextValue } });
    detailsRef.current?.removeAttribute('open');
    summaryRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    // The portal is initially hidden for measurement; autofocus before placement is ignored.
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(searchable ? 'input[type="search"]' : '[role="option"][aria-selected="true"]:not(:disabled), [role="option"]:not(:disabled)')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, searchable]);

  function moveOptionFocus(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      event.stopPropagation(); // Keep an enclosing popover/dialog and its draft open.
      detailsRef.current?.removeAttribute('open');
      summaryRef.current?.focus();
      return;
    }
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
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
        onKeyDown={event => {
          if (disabled || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
          if (!detailsRef.current?.open) {
            if (event.key === 'Escape') return;
            event.preventDefault();
            if (detailsRef.current) detailsRef.current.open = true;
          } else moveOptionFocus(event);
        }}
        className={cx(
          'mangmee-input flex list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer group-open:border-brand-700',
          className,
          // A wrapped value needs the control to grow; a caller's fixed height (the shared field's h-11) would let the second line spill out.
          wrapLabel && '!h-auto',
        )}
      >
        <span data-prompt={showsPrompt || undefined} className={cx('min-w-0', wrapLabel ? 'whitespace-normal break-words' : 'truncate', showsPrompt ? 'text-gray-500' : selected?.label ? 'text-gray-800' : 'text-gray-400')}>{selected?.label ?? placeholder ?? ''}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-gray-500 transition group-open:rotate-180">
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <PopoverPanel
        open={open}
        onClose={() => { detailsRef.current?.removeAttribute('open'); setOpen(false); }}
        anchorRef={summaryRef}
        panelRef={panelRef}
        height={240}
        minAnchorWidth
        matchAnchorWidth={searchable}
        onKeyDown={moveOptionFocus}
        className="z-[100000] max-h-60 min-w-[10rem] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-[var(--shadow-theme-md)]"
      >
        {searchable && <input type="search" value={query} aria-label={searchPlaceholder}
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

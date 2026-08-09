'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { cx } from '@/common/components/mangmee';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { PopoverPanel } from './PopoverPanel';

// Themed date / month picker — a drop-in for native <input type="date"|"month">
// whose popup is OS-drawn (un-themable) and doesn't follow the app language. Keeps
// the same call shape: value is an ISO string ("YYYY-MM-DD" for date, "YYYY-MM" for
// month) and onChange emits { target: { value } }. Labels follow the workspace locale.

const MONTHS_ABBR = {
  th: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
} as const;
const MONTHS_FULL = {
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
} as const;
const DOW = {
  th: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
} as const;
const LABELS = {
  th: { pickDate: 'เลือกวันที่', pickMonth: 'เลือกเดือน', clear: 'ล้าง', today: 'วันนี้', thisMonth: 'เดือนนี้' },
  en: { pickDate: 'Select date', pickMonth: 'Select month', clear: 'Clear', today: 'Today', thisMonth: 'This month' },
} as const;

type Mode = 'date' | 'month';

export type ThemedDateProps = {
  value?: string;
  /** Uncontrolled initial value (like a native input's defaultValue). */
  defaultValue?: string;
  onChange?: (event: { target: { value: string } }) => void;
  mode?: Mode;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /** Exposes the visible picker control for validation focus management. */
  triggerRef?: Ref<HTMLButtonElement>;
  /** Renders an sr-only form input so FormData forms read the value by name. */
  name?: string;
  /** Enforced via the sr-only input when `name` is set; otherwise informational. */
  required?: boolean;
};

// ISO date/month strings compare correctly as plain strings; clamp to the picker's
// granularity so a `min`/`max` day bound also gates the month grid.
function outOfRange(iso: string, min: string | undefined, max: string | undefined, len: number): boolean {
  if (min && iso < min.slice(0, len)) return true;
  if (max && iso > max.slice(0, len)) return true;
  return false;
}

const pad = (n: number) => String(n).padStart(2, '0');

function parseParts(value: string | undefined, mode: Mode) {
  const match = mode === 'month'
    ? /^(\d{4})-(\d{2})$/.exec(value ?? '')
    : /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: match[3] ? Number(match[3]) : 1 };
}

function todayParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

export function ThemedDate({ value, defaultValue, onChange, mode = 'date', disabled = false, className, placeholder, min, max, id, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, triggerRef, name, required }: ThemedDateProps) {
  const locale = useWorkspaceLocale();
  const monthsAbbr = MONTHS_ABBR[locale] ?? MONTHS_ABBR.th;
  const monthsFull = MONTHS_FULL[locale] ?? MONTHS_FULL.th;
  const dow = DOW[locale] ?? DOW.th;
  const labels = LABELS[locale] ?? LABELS.th;
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value !== undefined ? value : inner;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const parts = parseParts(current, mode);
  const [view, setView] = useState(() => parts ?? todayParts());

  useEffect(() => {
    if (parts) setView((v) => (v.year === parts.year && v.month === parts.month ? v : parts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // The calendar is portaled out of `rootRef`, so it has to be named as "inside".
  useCloseOnOutsideClick(rootRef, useCallback(() => setOpen(false), []), panelRef);

  const label = useMemo(() => {
    if (!parts) return placeholder ?? (mode === 'month' ? labels.pickMonth : labels.pickDate);
    const year = locale === 'th' ? parts.year + 543 : parts.year;
    return mode === 'month'
      ? `${monthsAbbr[parts.month]} ${year}`
      : `${parts.day} ${monthsAbbr[parts.month]} ${year}`;
  }, [parts, mode, placeholder, monthsAbbr, labels, locale]);

  function emit(next: string) {
    setInner(next);
    onChange?.({ target: { value: next } });
    setOpen(false);
  }

  function pickDay(day: number) {
    emit(`${view.year}-${pad(view.month + 1)}-${pad(day)}`);
  }
  function pickMonth(month: number) {
    emit(`${view.year}-${pad(month + 1)}`);
  }
  function shiftView(deltaMonth: number, deltaYear = 0) {
    setView((current) => {
      const total = current.year * 12 + current.month + deltaMonth + deltaYear * 12;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12, day: current.day };
    });
  }

  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1).getDay();
    const days = new Date(view.year, view.month + 1, 0).getDate();
    const cells: (number | null)[] = Array.from({ length: first }, () => null);
    for (let d = 1; d <= days; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view.year, view.month]);

  const today = todayParts();

  return (
    <div ref={rootRef} className={cx('relative min-w-0', className?.includes('w-auto') ? 'inline-block' : '')}>
      {name && (
        // sr-only (not hidden) so FormData picks the value up by name AND native
        // `required` validation still fires; the browser focuses it on invalid
        // submit, which opens the calendar.
        <input
          type="text"
          name={name}
          value={current}
          required={required}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onFocus={() => !disabled && setOpen(true)}
        />
      )}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'mangmee-input flex items-center justify-between gap-2 text-left',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          open && 'border-brand-700',
          className,
        )}
      >
        <span className={cx('min-w-0 truncate', parts ? 'text-gray-800' : 'text-gray-400')}>{label}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-gray-500">
          <path d="M6.5 2.5v2m7-2v2M3 7.5h14M4.5 4.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Panel height fits the worst case (a 6-week month with touch-sized rows) so the
          footer lands inside the panel; when the viewport leaves less room than that,
          header and footer stay put and only the grid scrolls. */}
      <PopoverPanel
        open={open}
        anchorRef={rootRef}
        panelRef={panelRef}
        height={mode === 'month' ? 300 : 400}
        className="z-[100000] flex w-[286px] max-w-[90vw] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-[var(--shadow-theme-md)]"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <button type="button" onClick={() => shiftView(0, -1)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:h-8 sm:w-8" aria-label="ปีก่อนหน้า">‹‹</button>
          {mode === 'date' && <button type="button" onClick={() => shiftView(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:h-8 sm:w-8" aria-label="เดือนก่อนหน้า">‹</button>}
          <div className="flex-1 text-center text-[15px] font-extrabold text-gray-800">
            {mode === 'month'
              ? (locale === 'th' ? view.year + 543 : view.year)
              : `${monthsFull[view.month]} ${locale === 'th' ? view.year + 543 : view.year}`}
          </div>
          {mode === 'date' && <button type="button" onClick={() => shiftView(1)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:h-8 sm:w-8" aria-label="เดือนถัดไป">›</button>}
          <button type="button" onClick={() => shiftView(0, 1)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:h-8 sm:w-8" aria-label="ปีถัดไป">››</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === 'month' ? (
            <div className="grid grid-cols-3 gap-1.5">
              {monthsAbbr.map((name, index) => {
                const selected = !!parts && parts.year === view.year && parts.month === index;
                const isNow = today.year === view.year && today.month === index;
                const blocked = outOfRange(`${view.year}-${pad(index + 1)}`, min, max, 7);
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={blocked}
                    onClick={() => pickMonth(index)}
                    className={cx(
                      'rounded-lg py-2 text-[14px] font-bold transition disabled:cursor-not-allowed disabled:opacity-30',
                      selected ? 'bg-brand-500 text-white' : isNow ? 'bg-brand-25 text-brand-700' : 'text-gray-700 hover:bg-gray-100',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mb-1 grid grid-cols-7 text-center text-[12px] font-bold text-gray-400">
                {dow.map((d) => <span key={d} className="py-1">{d}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {grid.map((day, index) => {
                  if (day === null) return <span key={`e${index}`} />;
                  const selected = !!parts && parts.year === view.year && parts.month === view.month && parts.day === day;
                  const isNow = today.year === view.year && today.month === view.month && today.day === day;
                  const blocked = outOfRange(`${view.year}-${pad(view.month + 1)}-${pad(day)}`, min, max, 10);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={blocked}
                      onClick={() => pickDay(day)}
                      className={cx(
                        'flex h-10 items-center justify-center rounded-lg text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 sm:h-9',
                        selected ? 'bg-brand-500 text-white' : isNow ? 'bg-brand-25 text-brand-700' : 'text-gray-700 hover:bg-gray-100',
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="mt-2 flex shrink-0 items-center justify-between border-t border-gray-100 pt-2 text-[13px] font-bold">
          <button type="button" onClick={() => emit('')} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100">{labels.clear}</button>
          <button
            type="button"
            onClick={() => emit(mode === 'month' ? `${today.year}-${pad(today.month + 1)}` : `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`)}
            className="rounded-lg px-2 py-1 text-brand-600 hover:bg-brand-25"
          >
            {mode === 'month' ? labels.thisMonth : labels.today}
          </button>
        </div>
      </PopoverPanel>
    </div>
  );
}

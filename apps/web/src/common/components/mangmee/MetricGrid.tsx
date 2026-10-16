import type { ReactNode } from 'react';
import { cx } from './mangmee-design';

export type MetricGridItem = {
  key: string;
  /** The quiet name above the number. */
  label: ReactNode;
  /** The number as it is read ("614,164.00", "43"); '—' when it is not known. */
  value: string;
  /** Written small after the number: บาท, ใบ, รายการ. */
  unit?: string;
  /** One short line under the number: what it counts. */
  note?: ReactNode;
  /** The colour of the dot before the name (a Tailwind background class). */
  dot: string;
  /** The colour of the number (a Tailwind text class); dark green when left out. */
  color?: string;
};

/**
 * The owner's way of showing numbers (home page, 2026-10-15): the name quiet with a coloured dot, the number loud with its unit
 * after it, one short line under it. A phone gives each number one row (name and line left, number right); from 640 px they sit
 * side by side. No frame, no icon, no button: the menu leads to each list.
 */
export function MetricGrid({ items, columns = 3, className, phoneNotes = true }: {
  items: readonly MetricGridItem[]; columns?: 2 | 3 | 5; className?: string;
  /** false: a phone shows name and number only, so a list under the numbers starts high on the screen. */
  phoneNotes?: boolean;
}) {
  return (
    <div className={cx('grid gap-4 sm:gap-6', columns === 2 ? 'sm:grid-cols-2' : columns === 5 ? 'sm:grid-cols-3 xl:grid-cols-5' : 'sm:grid-cols-3', className)}>
      {items.map(({ key, label, value, unit, note, dot, color }) => (
        <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0 [grid-template-areas:'label_num''note_num'] sm:grid-cols-1 sm:items-start sm:[grid-template-areas:'label''num''note']">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-600 [grid-area:label]"><span aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', dot)} />{label}</span>
          <span className={cx('mangmee-unit text-right text-[1.375rem] font-semibold leading-tight [grid-area:num] sm:mt-1 sm:text-left sm:text-[1.625rem]', color ?? 'text-[#1f3b2c]')}>
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-gray-500">{unit}</span>}
          </span>
          {note && <span className={cx('mt-0.5 text-xs text-gray-500 [grid-area:note]', !phoneNotes && 'hidden sm:block')}>{note}</span>}
        </div>
      ))}
    </div>
  );
}

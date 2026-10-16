'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';

export interface FilterTab<Key extends string = string> {
  key: Key;
  label: ReactNode;
  /** Shown beside the name, e.g. how many rows the tab holds. `0` is shown; leave it out for no count. */
  count?: number | string;
  /** With `href` the tab is a link (the filter lives in the URL); without it, a button that calls `onChange`. */
  href?: string;
  disabled?: boolean;
}

export interface FilterTabsProps<Key extends string = string> {
  tabs: readonly FilterTab<Key>[];
  /** The key of the tab that is chosen now. */
  value: Key;
  /** Called for button tabs (tabs without `href`). */
  onChange?: (key: Key) => void;
  /** What the tabs filter, for a screen reader: "สถานะใบเตรียมจ่าย". */
  'aria-label': string;
  className?: string;
}

/**
 * The filter tabs above a list: "ทั้งหมด 53 · ร่าง 1 · รอจ่าย 4". One look (`.mangmee-segmented` /
 * `.mangmee-tab`), every name on one line with its count.
 * A phone shows one row that scrolls inside itself, with the chosen tab brought into view and a
 * fade where more tabs wait; from 640 px the tabs are compact and wrap. Never a grid of wide buttons.
 *
 * ```tsx
 * <FilterTabs aria-label="สถานะใบเตรียมจ่าย" value={status} onChange={setStatus}
 *   tabs={[{ key: 'all', label: 'ทั้งหมด', count: 53 }, { key: 'draft', label: 'ร่าง', count: 1 }]} />
 * // filter in the URL: give every tab an href instead of onChange
 * ```
 */
export function FilterTabs<Key extends string = string>({ tabs, value, onChange, 'aria-label': ariaLabel, className }: FilterTabsProps<Key>) {
  const track = useRef<HTMLDivElement>(null);

  // Only the track scrolls, never the page: bring the chosen tab inside it, then say which edge hides more.
  useEffect(() => {
    const row = track.current;
    if (!row) return;
    const edges = () => {
      const start = row.scrollLeft > 4;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 4;
      if (start || end) row.dataset.more = start && end ? 'both' : start ? 'start' : 'end';
      else delete row.dataset.more;
    };
    const chosen = row.querySelector<HTMLElement>('[data-active="true"]');
    if (chosen) {
      const box = row.getBoundingClientRect();
      const tab = chosen.getBoundingClientRect();
      if (tab.left < box.left) row.scrollLeft += tab.left - box.left - 24;
      else if (tab.right > box.right) row.scrollLeft += tab.right - box.right + 24;
    }
    edges();
    row.addEventListener('scroll', edges, { passive: true });
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(edges);
    resized?.observe(row);
    return () => {
      row.removeEventListener('scroll', edges);
      resized?.disconnect();
    };
  }, [value, tabs.length]);

  return (
    <div ref={track} role="group" aria-label={ariaLabel} className={className ? `mangmee-segmented mangmee-filter-tabs ${className}` : 'mangmee-segmented mangmee-filter-tabs'}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        const tabClass = active ? 'mangmee-tab mangmee-tab-active' : 'mangmee-tab';
        const body = <>{tab.label}{tab.count !== undefined && <span className="mangmee-tab-count">{tab.count}</span>}</>;
        return tab.href && !tab.disabled
          ? <Link key={tab.key} href={tab.href} aria-current={active ? 'true' : undefined} data-active={active} className={tabClass}>{body}</Link>
          : <button key={tab.key} type="button" aria-pressed={active} data-active={active} disabled={tab.disabled} className={tabClass} onClick={() => onChange?.(tab.key)}>{body}</button>;
      })}
    </div>
  );
}

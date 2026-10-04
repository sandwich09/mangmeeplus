'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { ExecutiveContext } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { SelectField } from '@/common/components/field/Field';
import { useBodyScrollLock } from '@/common/hooks/use-body-scroll-lock';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { FILTER_URL, GLOBAL_FILTERS, DIRECTORY_FILTERS } from './executive-reports.logic';
import { W, thaiLabel } from './executive-reports.words';

type FilterValues = Partial<Record<keyof typeof FILTER_URL, string>>;
export function ExecutiveFilters({ context, values, errors, apply, clear, directory = false, extra = [] }: { context: ExecutiveContext; values: FilterValues; errors: Record<string, string>; apply: (changes: Record<string, string>) => void; clear: () => void; directory?: boolean; extra?: Array<{ key: string; label: string; remove: () => void }> }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(values);
  const [position, setPosition] = useState({ left: '0px', top: '0px' });
  const panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLSpanElement>(null);
  const id = useId();
  useBodyScrollLock(open);
  const keys = directory ? [...GLOBAL_FILTERS, ...DIRECTORY_FILTERS] : GLOBAL_FILTERS;
  const applied = keys.filter(key => values[key] && values[key] !== 'ALL').map(key => ({ key, label: thaiLabel(context.filters[key].find(option => option.value === values[key])?.label ?? W.unknown, values[key]!), remove: () => apply({ [FILTER_URL[key]]: 'ALL' }) }));
  const chips = [...applied, ...extra];
  const valueKey = JSON.stringify(values);
  useEffect(() => { panel.current?.hidePopover(); }, [valueKey]);
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <span ref={trigger}><Button variant="secondary" popoverTarget={id} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" icon={<DesignIcons.filter className="size-5 text-brand-700" />} onClick={() => {
      setDraft(values);
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: `${rect.left}px`, top: `${Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - 440))}px` });
    }}>{W.filters}{' '}<span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-800 tabular-nums">{chips.length}</span></Button></span>
    {chips.map(({ key, label, remove }) => <Button key={key} variant="secondary" className="max-w-full !rounded-full !border-brand-200 !bg-brand-25 !text-brand-800" aria-label={W.removeFilter(`${Object.hasOwn(FILTER_URL, key) ? `${W.filterLabels[key as keyof typeof FILTER_URL]} · ` : ''}${label}`)} onClick={remove}>
      <span className="min-w-0 whitespace-normal">{label}</span><span aria-hidden="true">×</span>
    </Button>)}
    <div ref={panel} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.newState === 'open'); }}
      style={{ '--filter-left': position.left, '--filter-top': position.top } as CSSProperties}
      className="fixed left-0 right-0 bottom-0 top-auto m-0 w-full max-w-none max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] text-gray-900 shadow-xl [&:not(:popover-open)]:hidden backdrop:bg-gray-900/40 md:bottom-auto md:left-[min(var(--filter-left),calc(100vw_-_24rem_-_1rem))] md:right-auto md:top-[var(--filter-top)] md:max-h-[calc(100dvh_-_var(--filter-top)_-_1rem)] md:w-96 md:max-w-[calc(100vw_-_2rem)] md:rounded-xl md:backdrop:bg-transparent">
      <header className="mb-4 flex items-center justify-between gap-3"><h2 id={`${id}-title`} className="font-semibold text-brand-800">{W.reportFilters}</h2><Button autoFocus variant="secondary" onClick={() => panel.current?.hidePopover()}>{W.close}</Button></header>
      <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); apply(Object.fromEntries(keys.map(key => [FILTER_URL[key], draft[key] ?? 'ALL']))); panel.current?.hidePopover(); }}>
        {[GLOBAL_FILTERS, ...(directory ? [DIRECTORY_FILTERS] : [])].map((group, index) => <fieldset key={index} className="grid min-w-0 gap-3"><legend className="mb-2 text-sm font-semibold text-gray-600">{index ? W.companyFilters : W.reportFilters}</legend>{group.map(key => <SelectField key={key} id={`executive-filter-${key}`} label={W.filterLabels[key]} value={draft[key] ?? 'ALL'} error={errors[key]} searchable={key === 'referringSales'} wrapLabel className="!min-h-11 !text-base" onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}>
          {context.filters[key].map(option => <option key={option.value} value={option.value}>{thaiLabel(option.label, option.value)}</option>)}
        </SelectField>)}</fieldset>)}
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4"><Button type="button" variant="secondary" onClick={() => { clear(); panel.current?.hidePopover(); }}>{W.clear}</Button><Button type="submit">{W.applyFilters}</Button></div>
      </form>
    </div>
  </div>;
}

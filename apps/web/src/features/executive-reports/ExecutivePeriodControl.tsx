'use client';

import { useId, useRef, useState, type CSSProperties } from 'react';
import { EXECUTIVE_PERIOD_PRESETS, EXECUTIVE_PERIOD_WORDS as P, executiveSourceReasonText, type ExecutiveContext } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { useBodyScrollLock } from '@/common/hooks/use-body-scroll-lock';
import { periodParams, selectedPeriod, validPeriod } from './executive-reports.logic';
import { W } from './executive-reports.words';

export function ExecutivePeriodControl({ context, params, apply }: { context: ExecutiveContext; params: URLSearchParams; apply: (changes: Record<string, string>) => void }) {
  const period = selectedPeriod(params, context), canonical = periodParams(params, context);
  const [draft, setDraft] = useState({ from: period?.from ?? '', to: period?.to ?? '' });
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: '0px', top: '0px' });
  const panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLSpanElement>(null), id = useId();
  useBodyScrollLock(open);
  const valid = validPeriod(draft.from, draft.to, context, true);
  return <div data-executive-period className="flex min-w-0 items-center gap-1 overflow-x-auto">
    {EXECUTIVE_PERIOD_PRESETS.flatMap(key => {
      const preset = context.presets?.find(p => p.key === key);
      if (!preset) return [];
      const reason = preset.available ? undefined : preset.unbuiltBoundaryMonths.length ? executiveSourceReasonText('RANGE_MONTH_NOT_BUILT', preset.unbuiltBoundaryMonths) : P.noneBuilt;
      return <button key={key} type="button" disabled={!preset.available} title={reason} aria-label={reason ? `${P.presets[key]} — ${reason}` : P.presets[key]} aria-pressed={period?.appliedPreset === key} className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:text-gray-600 ${period?.appliedPreset === key ? 'bg-brand-50 text-brand-800' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => apply({ from: preset.from!, to: preset.to!, month: '', periodPreset: key })}>{P.presets[key]}</button>;
    })}
    <span ref={trigger} className="shrink-0"><Button variant="secondary" popoverTarget={id} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => {
      setDraft({ from: canonical.get('from') ?? '', to: canonical.get('to') ?? '' });
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: `${rect.left}px`, top: `${Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - 400))}px` });
    }}>{P.custom}</Button></span>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.newState === 'open'); }} style={{ '--period-left': position.left, '--period-top': position.top } as CSSProperties}
      className="fixed left-0 right-0 bottom-0 top-auto m-0 w-full max-w-none max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white px-4 pt-4 mangmee-safe-bottom text-gray-900 shadow-xl [&:not(:popover-open)]:hidden backdrop:bg-gray-900/40 md:bottom-auto md:left-[min(var(--period-left),calc(100vw_-_24rem_-_1rem))] md:right-auto md:top-[var(--period-top)] md:w-96 md:max-w-[calc(100vw_-_2rem)] md:rounded-xl md:backdrop:bg-transparent">
      <header className="mb-4 flex items-center justify-between gap-2"><h2 id={`${id}-title`} className="font-semibold text-brand-800">{P.custom}</h2><Button autoFocus variant="secondary" onClick={() => panel.current?.hidePopover()}>{W.close}</Button></header>
      <form className="grid gap-3 pb-4" onSubmit={event => { event.preventDefault(); if (valid) { apply({ ...draft, month: '', periodPreset: '' }); panel.current?.hidePopover(); } }}>
        {(['from', 'to'] as const).map(key => <label key={key} className="grid gap-1 text-sm"><span>{P[key]}</span><ThemedDate id={`executive-period-${key}`} aria-label={P[key]} mode="month" allowClear={false} value={draft[key]} min={context.months?.first} max={context.currentMonth} selectable={context.builtMonths} panelClassName="[&_button]:min-h-11 [&_button]:min-w-11" className="!min-h-11 !text-base" onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        {!valid && <p role="alert" className="text-sm text-red-700">{P.invalid}</p>}
        <div className="flex justify-end"><Button type="submit" disabled={!valid}>{P.apply}</Button></div>
      </form>
    </div>
  </div>;
}

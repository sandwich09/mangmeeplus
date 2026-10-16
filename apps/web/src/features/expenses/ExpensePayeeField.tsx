'use client';
import { useEffect, useRef, useState } from 'react';
import { listCounterparties } from '../counterparties/counterparties.api';
import type { CounterpartySummary } from '../counterparties/counterparties.model';
import { inputClass, ghostClass } from './ExpensesUi';
import { stripDisallowed } from '@/common/forms/sanitize';

export function ExpensePayeeField({ companyId, value, canRead, disabled, onChange }: {
  companyId: string; value: { name: string; id?: string }; canRead: boolean; disabled: boolean; onChange: (value: { name: string; id?: string }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<CounterpartySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setMatches([]); setFailed(false);
    if (!canRead || !value.name.trim() || value.id) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void listCounterparties(companyId, { page: 1, search: value.name.trim() })
        .then(result => { if (active) setMatches(result.data.slice(0, 8)); })
        .catch(() => { if (active) setFailed(true); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, value.name, value.id, canRead, retry]);
  return <div className="space-y-1 sm:col-span-3">
    <label htmlFor="manual-expense-payee" className="block text-sm font-medium text-gray-700">ชื่อผู้ขาย</label>
    <input ref={input} id="manual-expense-payee" className={inputClass} value={value.name} disabled={disabled}
      role="combobox" aria-autocomplete="list" aria-expanded={open && matches.length > 0} aria-controls="manual-expense-payees"
      onFocus={() => setOpen(true)} onKeyDown={event => {
        if (event.key === 'Escape') setOpen(false);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          const options = list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
          (event.key === 'ArrowDown' ? options?.[0] : options?.[options.length - 1])?.focus();
        }
      }} onChange={event => { setOpen(true); onChange({ name: stripDisallowed(event.target.value) }); }} />
    <p className="text-sm text-gray-500">ร้านหรือคนที่รับเงิน</p>
    {value.name.trim().length > 200 && <p role="alert" className="text-sm text-error-700">ชื่อผู้ขายยาวเกิน 200 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง</p>}
    {loading && <p role="status" className="text-sm text-gray-500">กำลังค้นชื่อคู่ค้า</p>}
    {failed && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-600">ค้นชื่อคู่ค้าไม่ได้ พิมพ์ชื่อเองได้</p><button type="button" className={ghostClass} disabled={disabled} onClick={() => setRetry(n => n + 1)}>ลองอีกครั้ง</button></div>}
    {open && matches.length > 0 && <div ref={list} id="manual-expense-payees" role="listbox" aria-label="ชื่อจากคู่ค้า" className="max-h-64 space-y-1 overflow-y-auto"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); input.current?.focus(); setOpen(false); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
          const index = options.indexOf(event.target as HTMLButtonElement);
          options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
        }
      }}>
      {matches.map(person => <button type="button" role="option" aria-selected={false} key={person.id} className="grid min-h-11 w-full gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)] text-left text-sm" disabled={disabled} onClick={() => { setMatches([]); input.current?.focus(); setOpen(false); onChange({ name: person.displayName, id: person.id }); }}>{person.displayName}{person.taxId ? ` · ${person.taxId}` : ''}</button>)}
    </div>}
  </div>;
}

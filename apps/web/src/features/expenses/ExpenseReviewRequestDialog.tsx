'use client';
import { useState } from 'react';
import { Modal } from '@/common/components/modal';
import { ChoiceRow } from '@/common/components/field/ChoiceRow';
import { btnClass, ghostClass } from './ExpensesUi';

export function ExpenseReviewRequestDialog({ open, people, selected, busy, error, onChoose, onSend, onClose, onRetry }: {
  open: boolean; people: Array<{ userId: string; displayName: string }> | null; selected: string; busy: boolean; error: string | null;
  onChoose: (id: string) => void; onSend: () => Promise<unknown>; onClose: () => void; onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const many = (people?.length ?? 0) > 6;
  const visible = many ? people?.filter(person => person.userId === selected || person.displayName.includes(search.trim())) : people;
  return <Modal open={open} title="ส่งให้ใครตรวจ" size="sm" onClose={() => { if (!busy) onClose(); }} footer={<>
    {people?.length !== 1 && <button type="button" className={ghostClass} disabled={busy} onClick={onClose}>ปิด</button>}
    {people?.length ? <button type="button" className={btnClass} disabled={busy || !selected} aria-busy={busy} onClick={() => void onSend()}>{busy ? 'กำลังส่ง' : 'ส่งให้ตรวจ'}</button> : null}
  </>}>
    <div className="space-y-3">
      {people === null && !error && <p role="status" className="text-sm">กำลังหาคนที่ยืนยันรายจ่ายได้</p>}
      {people?.length === 0 && <p className="text-sm">ร้านนี้ยังไม่มีคนอื่นที่ยืนยันรายจ่ายได้</p>}
      {people?.length === 1 ? <p className="text-sm font-medium">{people[0]!.displayName}</p> : <>
        {many && <label className="block text-sm">ค้นชื่อ<input type="search" className="mangmee-input" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /></label>}
        <fieldset disabled={busy} className="max-h-64 space-y-2 overflow-y-auto">
          {visible?.map(person => <ChoiceRow key={person.userId} name="expense-reviewer" value={person.userId} label={person.displayName} checked={selected === person.userId} onChange={() => onChoose(person.userId)} />)}
        </fieldset>
      </>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-error-700">{error}</p><button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={onRetry}>ลองอีกครั้ง</button></div>}
    </div>
  </Modal>;
}

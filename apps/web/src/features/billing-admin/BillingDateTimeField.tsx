'use client';
import { useId } from 'react';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { billingField } from '../billing/billing-display';

export default function BillingDateTimeField({ label, value, onChange, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const timeId = useId();
  const [day = '', time = ''] = value.split('T');
  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <legend className="font-medium text-gray-900">{label}</legend>
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
      <ThemedDate aria-label={`${label} วันที่`} value={day} disabled={disabled} className="min-h-11 w-full !text-base" onChange={e => onChange(`${e.target.value}T${time || '00:00'}`)} />
      <label className="sr-only" htmlFor={timeId}>{label} เวลา</label>
      <input id={timeId} aria-label={`${label} เวลา`} className={`${billingField} !mt-0`} type="text" inputMode="numeric" placeholder="09:00" maxLength={5} pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" value={time} onChange={e => onChange(`${day}T${e.target.value}`)} />
    </div>
    <p className="text-sm text-gray-500">เวลาประเทศไทย รูปแบบ ชั่วโมง:นาที เช่น 09:00</p>
  </fieldset>;
}

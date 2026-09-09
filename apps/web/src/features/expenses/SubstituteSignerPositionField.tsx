'use client';

import { useState } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';

export function SubstituteSignerPositionField({ value, onChange, jobTitle, className }: {
  value: string; onChange: (value: string) => void; jobTitle?: string | null; className: string;
}) {
  const options = [...new Set([jobTitle?.trim(), 'กรรมการบริษัท', 'เจ้าของกิจการ', 'ผู้จัดการ', 'ฝ่ายการเงิน', 'พนักงาน'].filter((item): item is string => Boolean(item)))];
  const [custom, setCustom] = useState(Boolean(value && !options.includes(value)));
  return <span className="block space-y-2">
    <ThemedSelect className={className} aria-label="เลือกตำแหน่งตามจริง" value={custom || (value && !options.includes(value)) ? '__custom' : value} onChange={(event) => {
      const next = event.target.value;
      setCustom(next === '__custom');
      onChange(next === '__custom' ? '' : next);
    }}>
      <option value="">ไม่ระบุตำแหน่ง</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
      <option value="__custom">ระบุเอง</option>
    </ThemedSelect>
    {(custom || (value && !options.includes(value))) && <input className={className} maxLength={120} value={value} aria-label="ระบุตำแหน่งตามจริง" placeholder="ระบุตำแหน่งตามจริง" onChange={event => onChange(event.target.value)} />}
  </span>;
}

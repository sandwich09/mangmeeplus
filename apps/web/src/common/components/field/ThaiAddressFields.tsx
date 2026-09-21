'use client';

import { useEffect, useRef, useState } from 'react';
import type { ThaiAddressOption } from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { SelectField, TextField } from './Field';
import { autofillThaiAddress, uniqueAddressValues, type ThaiAddressValue } from './thai-address.logic';

type Props = {
  companyId: string;
  value: ThaiAddressValue;
  onChange: (value: ThaiAddressValue) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

export function ThaiAddressFields({ companyId, value, onChange, disabled = false, required = false, className = 'grid gap-4 sm:grid-cols-2' }: Props) {
  const [rows, setRows] = useState<ThaiAddressOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    if (value.postalCode.length < 3) {
      setRows([]);
      setLoading(false);
      setMessage('');
      return;
    }
    setRows([]);
    setLoading(true);
    setMessage('');
    const timer = window.setTimeout(() => {
      void apiFetch<ThaiAddressOption[]>(`/companies/${companyId}/settings/address-master?postalCode=${encodeURIComponent(value.postalCode)}`)
        .then((nextRows) => {
          if (cancelled) return;
          setRows(nextRows);
          if (!nextRows.length) {
            setMessage('ไม่พบข้อมูลที่อยู่ กรุณากรอกเอง');
            return;
          }
          const next = autofillThaiAddress(valueRef.current, nextRows);
          if (Object.keys(next).some((key) => next[key as keyof ThaiAddressValue] !== valueRef.current[key as keyof ThaiAddressValue])) {
            onChangeRef.current(next);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRows([]);
            setMessage('ค้นหาที่อยู่ไม่สำเร็จ กรุณากรอกเอง');
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [companyId, value.postalCode]);

  const provinces = uniqueAddressValues([...rows.map((row) => row.provinceTh), ...(value.province ? [value.province] : [])]);
  const districts = uniqueAddressValues([
    ...rows.filter((row) => row.provinceTh === value.province).map((row) => row.districtTh),
    ...(value.district ? [value.district] : []),
  ]);
  const subdistricts = uniqueAddressValues([
    ...rows.filter((row) => row.provinceTh === value.province && row.districtTh === value.district).map((row) => row.subdistrictTh),
    ...(value.subdistrict ? [value.subdistrict] : []),
  ]);

  const chooseProvince = (province: string) => {
    const nextDistricts = uniqueAddressValues(rows.filter((row) => row.provinceTh === province).map((row) => row.districtTh));
    const district = nextDistricts.length === 1 ? nextDistricts[0]! : '';
    const nextSubdistricts = uniqueAddressValues(rows
      .filter((row) => row.provinceTh === province && row.districtTh === district)
      .map((row) => row.subdistrictTh));
    onChange({ ...value, province, district, subdistrict: nextSubdistricts.length === 1 ? nextSubdistricts[0]! : '' });
  };
  const chooseDistrict = (district: string) => {
    const nextSubdistricts = uniqueAddressValues(rows
      .filter((row) => row.provinceTh === value.province && row.districtTh === district)
      .map((row) => row.subdistrictTh));
    onChange({ ...value, district, subdistrict: nextSubdistricts.length === 1 ? nextSubdistricts[0]! : '' });
  };

  return <div className={className}>
    <TextField label="รหัสไปรษณีย์" value={value.postalCode} disabled={disabled} required={required}
      inputMode="numeric" maxLength={5} placeholder="เช่น 10330"
      onChange={(event) => onChange({ postalCode: event.target.value.replace(/\D/g, '').slice(0, 5), province: '', district: '', subdistrict: '' })} />
    {rows.length ? <>
      <SelectField label="จังหวัด" value={value.province} disabled={disabled} required={required} onChange={(event) => chooseProvince(event.target.value)}>
        <option value="">— เลือกจังหวัด —</option>{provinces.map((option) => <option key={option} value={option}>{option}</option>)}
      </SelectField>
      <SelectField label="อำเภอ / เขต" value={value.district} disabled={disabled || !value.province} required={required} onChange={(event) => chooseDistrict(event.target.value)}>
        <option value="">— เลือกอำเภอ / เขต —</option>{districts.map((option) => <option key={option} value={option}>{option}</option>)}
      </SelectField>
      <SelectField label="ตำบล / แขวง" value={value.subdistrict} disabled={disabled || !value.district} required={required} onChange={(event) => onChange({ ...value, subdistrict: event.target.value })}>
        <option value="">— เลือกตำบล / แขวง —</option>{subdistricts.map((option) => <option key={option} value={option}>{option}</option>)}
      </SelectField>
    </> : <>
      <TextField label="จังหวัด" value={value.province} disabled={disabled} required={required} onChange={(event) => onChange({ ...value, province: event.target.value })} />
      <TextField label="อำเภอ / เขต" value={value.district} disabled={disabled} required={required} onChange={(event) => onChange({ ...value, district: event.target.value })} />
      <TextField label="ตำบล / แขวง" value={value.subdistrict} disabled={disabled} required={required} onChange={(event) => onChange({ ...value, subdistrict: event.target.value })} />
    </>}
    {(loading || message) && <p role="status" className={`text-sm sm:col-span-full ${message ? 'text-amber-700' : 'text-gray-500'}`}>
      {loading ? 'กำลังค้นหาที่อยู่…' : message}
    </p>}
  </div>;
}

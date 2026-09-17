'use client';
import { billingLink, billingControl, billingLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BillingApplyInvoiceView } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import BillingOperationPanel from './BillingOperationPanel';
const time=(value:string|null)=>value?formatThaiDateTime(value):'ยังไม่มีข้อมูล';
export default function BillingApplyInvoicesPage({companyId,invoiceId}:{companyId:string;invoiceId?:string}) {
  const companyPath=`/system/billing/companies/${encodeURIComponent(companyId)}`,base=`${companyPath}/apply-invoices`;
  const [invoice,setInvoice]=useState<BillingApplyInvoiceView|null>(null),[list,setList]=useState<{items:BillingApplyInvoiceView[];nextCursor:string|null}|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const refresh=useCallback(()=>setReload(v=>v+1),[]);
  useEffect(()=>{setInvoice(null);setList(null);setCursor(null);},[base,invoiceId]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    const read=invoiceId?authedApiFetch<BillingApplyInvoiceView>(`${base}/${encodeURIComponent(invoiceId)}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setInvoice(value);}):
      authedApiFetch<{items:BillingApplyInvoiceView[];nextCursor:string|null}>(`${base}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setList(value);});
    void read.catch(cause=>{if(!active)return;if([401,403,404].includes(cause?.status)){setInvoice(null);setList(null);setError(cause.status===404?'ไม่พบรายการนี้ กลับไปเลือกรายการชำระเงินของบริษัท':'บัญชีนี้เปิดรายการนี้ไม่ได้ กลับไปเลือกรายการที่คุณมีสิทธิ์ดู');}else setError('อัปเดตข้อมูลไม่ได้ ข้อมูลที่แสดงอาจยังเป็นผลเดิม กรุณาลองอีกครั้งก่อนทำรายการ');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[base,invoiceId,cursor,reload]);
  const current=invoice?.companyId===companyId&&invoice.id===invoiceId?invoice:null;
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">
    <Link className={billingLink} href={`${companyPath}?view=payments`}>กลับรายการชำระเงินของบริษัท</Link>
    <header><h1 className="text-2xl font-semibold text-gray-900">เปิดแพ็กเกจจากยอดที่ลูกค้าจ่ายแล้ว</h1><p className="mt-2 text-gray-600">ใช้เมื่อพบยอดชำระเดิม แต่แพ็กเกจยังไม่เปิดให้ลูกค้า</p></header>
    {loading&&<p role="status">กำลังอ่านรายการชำระเงิน…</p>}{error&&<div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><button className={billingControl} disabled={loading} aria-busy={Boolean(loading)} onClick={refresh}>ลองอ่านข้อมูลอีกครั้ง</button></div>}
    {current&&<>
      <section aria-label="สิทธิ์จากใบเสร็จเดิม" className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">สถานะของรายการนี้</h2><button className="min-h-11 px-2 text-sm text-gray-600 underline" disabled={loading} aria-busy={Boolean(loading)} onClick={refresh}>อัปเดตสถานะ</button></div>
        <dl className="grid gap-5 sm:grid-cols-2">
          <div><dt className="text-gray-600">หลักฐานการชำระเงิน</dt><dd className="mt-1 font-medium">{current.paymentVerified?'มีหลักฐานว่าชำระครบแล้ว':'ยังยืนยันว่าชำระครบไม่ได้'}</dd></div>
          <div><dt className="text-gray-600">การเปิดแพ็กเกจจากยอดนี้</dt><dd className="mt-1 font-medium">{current.applyState==='APPLIED'?'เปิดแพ็กเกจแล้ว':billingLabel('apply',current.applyState)}</dd></div>
          <div><dt className="text-gray-600">ช่วงใช้งานของรายการเดิม</dt><dd className="mt-1">{time(current.periodStart)}<br/>ถึง {time(current.periodEnd)}</dd></div>
          <div><dt className="text-gray-600">{current.appliedAt?'เปิดแพ็กเกจเมื่อ':'ตรวจข้อมูลการเงินล่าสุด'}</dt><dd className="mt-1">{time(current.appliedAt??current.observedAt)}</dd></div>
        </dl>
        <p className="border-t border-gray-100 pt-4 text-sm text-gray-600">{billingLabel('mode',current.mode)} · หน้านี้ตรวจเฉพาะยอดเดิม สถานะแพ็กเกจปัจจุบันดูได้ที่ข้อมูลบริษัท</p>
      </section>
      {current.applyState==='APPLIED'?<section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-semibold">รายการนี้เปิดแพ็กเกจแล้ว</h2><p className="mt-2 text-gray-600">ไม่ต้องส่งคำสั่งซ้ำ หากลูกค้ายังใช้งานไม่ได้ ให้ตรวจสถานะบริษัทและแพ็กเกจปัจจุบัน</p><Link className={billingLink} href={companyPath}>ดูแพ็กเกจปัจจุบันของบริษัท</Link></section>:
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">สิ่งที่ต้องทำต่อ</h2><p className="text-gray-600">{current.canRetry?'ตรวจยอดเดิมก่อน แล้วอ่านผลและยืนยันเปิดแพ็กเกจ ระบบไม่เรียกเก็บเงินซ้ำ':'รายการนี้ยังไม่พร้อมส่งคำสั่งเปิดแพ็กเกจ ให้ตรวจสถานะการชำระเงินของบริษัทก่อน'}</p>{!current.canRetry&&<Link className={billingLink} href={`${companyPath}?view=payments`}>ตรวจรายการชำระเงินของบริษัท</Link>}
          <BillingOperationPanel key={current.id} companyId={companyId} companyVersion={current.accountVersion} invoiceId={current.id} invoiceSourceHash={current.sourceHash} canRetry={current.canRetry&&!loading&&!error} initialReason="ตรวจการเปิดแพ็กเกจจากรายการชำระเดิม" onCompleted={refresh}/>
        </section>}
    </>}
    {!invoiceId&&list&&<section aria-label="ใบเสร็จที่รอใช้สิทธิ์" className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">เลือกรายการชำระเงิน</h2><button className="min-h-11 px-2 text-sm text-gray-600 underline" disabled={loading} aria-busy={Boolean(loading)} onClick={refresh}>อัปเดตรายการ</button></div>
      {!list.items.length&&<p className="text-gray-600">ไม่พบรายการที่รอเปิดแพ็กเกจ ตรวจสถานะปัจจุบันได้ที่ข้อมูลบริษัท</p>}
      {list.items.map(row=><article key={row.id} className="space-y-2 rounded-lg border border-gray-200 p-4"><h3 className="font-medium">{billingLabel('apply',row.applyState)}</h3><p className="text-gray-600">ช่วงใช้งาน {time(row.periodStart)} ถึง {time(row.periodEnd)}</p><Link className={billingLink} href={`${base}/${row.id}`}>ตรวจรายการนี้</Link></article>)}
      {list.nextCursor&&<button className={billingControl} disabled={loading} onClick={()=>setCursor(list.nextCursor)}>รายการหน้าถัดไป</button>}{cursor&&<button className={billingControl} disabled={loading} onClick={()=>setCursor(null)}>กลับหน้าแรก</button>}
    </section>}
  </main>;
}

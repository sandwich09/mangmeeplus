'use client';
import { billingControl, billingLabel } from '../billing/billing-display';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BillingApplyInvoiceView } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import BillingOperationPanel from './BillingOperationPanel';
const button=billingControl;
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ยังไม่มี';
export default function BillingApplyInvoicesPage({companyId,invoiceId}:{companyId:string;invoiceId?:string}) {
  const base=`/system/billing/companies/${encodeURIComponent(companyId)}/apply-invoices`;
  const [invoice,setInvoice]=useState<BillingApplyInvoiceView|null>(null),[list,setList]=useState<{items:BillingApplyInvoiceView[];nextCursor:string|null}|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setInvoice(null);setList(null);
    const read=invoiceId?authedApiFetch<BillingApplyInvoiceView>(`${base}/${encodeURIComponent(invoiceId)}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setInvoice(value);}):
      authedApiFetch<{items:BillingApplyInvoiceView[];nextCursor:string|null}>(`${base}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setList(value);});
    void read.catch(()=>{if(active)setError('โหลดใบเสร็จไม่ได้ กรุณาตรวจสิทธิ์ โหลดใหม่ หรือกลับไปเลือกบริษัท');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[base,invoiceId,cursor,reload]);
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">ตรวจสิทธิ์จากใบเสร็จเดิม</h1>
    <p>เลือกใบเสร็จที่จ่ายแล้วแต่ยังให้สิทธิ์ไม่สำเร็จ ระบบจะตรวจหลักฐานการจ่ายและเงื่อนไขปัจจุบันของรายการเดิม</p>
    <nav className="flex flex-wrap gap-3"><Link className={button} href={`/system/billing/companies/${encodeURIComponent(companyId)}`}>กลับไปบริษัท</Link>
      <Link className={button} href="/system/billing/issues">คิวตรวจสอบ</Link>{invoiceId&&<Link className={button} href={base}>เลือกรายการใบเสร็จ</Link>}</nav>
    <button className={button} disabled={loading} onClick={()=>setReload(v=>v+1)}>โหลดใบเสร็จล่าสุด</button>
    {loading&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {invoice&&<>
      <section aria-label="สิทธิ์จากใบเสร็จเดิม" className="space-y-3 rounded-xl border p-4">
        <h2 className="font-bold">{invoice.applyState==='APPLIED'&&invoice.appliedAt?'ใบเสร็จนี้ให้สิทธิ์แล้ว':'ยังต้องตรวจการให้สิทธิ์'}</h2>
        <p>{billingLabel('mode',invoice.mode)}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงใบเสร็จ</summary><p className="break-all">อ้างอิง {invoice.id}</p></details><p>สถานะ {billingLabel('apply',invoice.applyState)} · {invoice.paymentVerified?'มีหลักฐานจ่ายครบ':'ยังไม่มีหลักฐานจ่ายครบ'}</p>
        <p>{time(invoice.periodStart)} ถึง {time(invoice.periodEnd)}</p><p>ให้สิทธิ์เมื่อ {time(invoice.appliedAt)} · ตรวจการเงินล่าสุด {time(invoice.observedAt)}</p>
        {!invoice.canRetry&&invoice.applyState!=='APPLIED'&&<p>ยังส่งคำสั่งจากใบเสร็จนี้ไม่ได้ ตรวจสิทธิ์ผู้ดูแล การเชื่อมต่อ และหลักฐานที่ข้อมูลบริษัทก่อน</p>}
        <p>ผลของใบเสร็จนี้แยกจากการคืนเงิน ข้อพิพาท และสถานะการใช้งานปัจจุบันของบริษัท</p>
      </section>
      <BillingOperationPanel key={invoice.id} companyId={companyId} companyVersion={invoice.accountVersion} invoiceId={invoice.id} invoiceSourceHash={invoice.sourceHash} canRetry={invoice.canRetry}/>
    </>}
    {list&&<section aria-label="ใบเสร็จที่รอใช้สิทธิ์" className="space-y-3">
      {!list.items.length&&<p>ไม่พบใบเสร็จที่รอให้สิทธิ์ในรายการนี้ ตรวจสถานะปัจจุบันได้ที่ข้อมูลบริษัท</p>}
      {list.items.map(row=><article key={row.id} className="space-y-2 rounded-xl border p-4"><Link className="underline" href={`${base}/${row.id}`}>ตรวจใบเสร็จ {row.id}</Link>
        <p>{billingLabel('apply',row.applyState)} · {time(row.periodStart)} ถึง {time(row.periodEnd)}</p></article>)}
      {list.nextCursor&&<button className={button} onClick={()=>setCursor(list.nextCursor)}>ใบเสร็จหน้าถัดไป</button>}
      {cursor&&<button className={button} onClick={()=>setCursor(null)}>ใบเสร็จหน้าแรก</button>}
    </section>}
  </main>;
}

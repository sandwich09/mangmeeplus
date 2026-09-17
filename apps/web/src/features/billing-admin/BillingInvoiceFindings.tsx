'use client';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingControl } from '../billing/billing-display';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {BillingInvoiceFinding} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorMessage} from '@/common/api/api-error-message';
const classification={MATCHED:'ข้อมูลสรุปตรงกันตอนตรวจ',LOCAL_MISSING:'ยังไม่พบใบแจ้งหนี้นี้ในระบบตอนตรวจ',DIFFERENT:'ข้อมูลสรุปต่างจากระบบตอนตรวจ'};
const status:Record<string,string>={draft:'ฉบับร่าง',open:'เปิดเรียกเก็บ',paid:'Stripe แสดงว่าจ่ายแล้ว',uncollectible:'หนี้ที่ตัดเก็บไม่ได้',void:'ยกเลิกใบแจ้งหนี้'};
const button=billingControl,time=(value:string)=>formatThaiDateTime(value);
export function BillingInvoiceFindings({companyId,scanId,version}:{companyId:string;scanId:string;version:number}) {
  const [list,setList]=useState<{items:BillingInvoiceFinding[];nextCursor:string|null}|null>(null),[cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[error,setError]=useState('');
  useEffect(()=>{setCursor(null);setList(null);},[companyId,scanId]);
  useEffect(()=>{
    let active=true;setError('');
    void authedApiFetch<{items:BillingInvoiceFinding[];nextCursor:string|null}>(`/system/billing/companies/${encodeURIComponent(companyId)}/invoice-scans/${encodeURIComponent(scanId)}/findings${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true})
      .then(value=>{if(active)setList(value);}).catch(error=>{if(active){setList(null);setError(apiErrorMessage(error));}});return()=>{active=false;};
  },[companyId,scanId,version,cursor,reload]);
  return <section aria-label="รายการใบแจ้งหนี้ที่ตรวจพบ" className="space-y-3">
    <h2 className="text-lg font-bold">รายการที่ตรวจพบ</h2><p>ผลสรุปตอนตรวจแยกจากหลักฐานชำระเงินและสิทธิ์ปัจจุบัน การคืนเงิน ข้อพิพาท ค่าธรรมเนียม และยอดโอนต้องตรวจเพิ่มเติม</p>
    {error&&<p role="alert">{error}</p>}{!list&&!error&&<p role="status">กำลังโหลดผลตรวจ…</p>}
    {list?.items.length===0&&<p>ยังไม่มีผลตรวจในงานนี้ งานที่ยังไม่จบอาจมีรายการเพิ่มภายหลัง</p>}
    {list?.items.map(row=><article key={row.id} className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white">
      <h3 className="font-semibold">{classification[row.classification]}</h3><p>{status[row.providerStatus]??'ต้องตรวจสถานะเพิ่มเติม'}</p>
      <p>สร้างใบแจ้งหนี้ {time(row.invoiceCreatedAt)} · ตรวจพบ {time(row.observedAt)}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงผลตรวจ</summary><p className="break-all">อ้างอิงผลตรวจ {row.id}</p></details>
      {row.localInvoiceId?<><p>ปัจจุบันมีใบแจ้งหนี้ในระบบ · {row.localApplyState==='APPLIED'?'บันทึกการให้สิทธิ์แล้ว':'ยังต้องตรวจการให้สิทธิ์'}</p>
        <Link className="block underline" href={`/system/billing/companies/${encodeURIComponent(companyId)}/apply-invoices/${encodeURIComponent(row.localInvoiceId)}`}>ตรวจใบแจ้งหนี้เดิมและผลให้สิทธิ์</Link></>:<p>ยังไม่มีใบแจ้งหนี้ที่ผูกกับรายการนี้ ให้ผู้ดูแลตรวจเคสก่อนดำเนินการ ไม่ให้ลูกค้าซื้อซ้ำเพื่อแก้ปัญหานี้</p>}
      <Link className="block underline" href={`/system/billing/companies/${encodeURIComponent(companyId)}/invoice-findings/${row.id}`}>ตรวจหลักฐานใบแจ้งหนี้รายการนี้</Link>
      {row.reviewCaseId&&<Link className="block underline" href={`/system/billing/issues/${row.reviewCaseId}`}>เปิดเคสตรวจใบแจ้งหนี้ของบริษัท</Link>}
    </article>)}
    <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>setReload(v=>v+1)}>โหลดผลตรวจใบแจ้งหนี้ล่าสุด</button>
      {list?.nextCursor&&<button className={button} onClick={()=>setCursor(list.nextCursor)}>ผลตรวจใบแจ้งหนี้หน้าถัดไป</button>}
      {cursor&&<button className={button} onClick={()=>setCursor(null)}>กลับผลตรวจหน้าแรก</button>}</div>
  </section>;
}

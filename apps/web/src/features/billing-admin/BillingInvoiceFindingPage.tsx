'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {BillingInvoiceFindingReview} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorMessage} from '@/common/api/api-error-message';
import BillingOperationPanel from './BillingOperationPanel';
export default function BillingInvoiceFindingPage({companyId,findingId}:{companyId:string;findingId:string}) {
  const [finding,setFinding]=useState<BillingInvoiceFindingReview|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const base=`/system/billing/companies/${encodeURIComponent(companyId)}`;
  useEffect(()=>{let active=true;setFinding(null);setError('');
    void authedApiFetch<BillingInvoiceFindingReview>(`${base}/invoice-findings/${encodeURIComponent(findingId)}`,{cache:'no-store',suppressErrorToast:true})
      .then(value=>{if(active)setFinding(value);}).catch(error=>{if(active)setError(apiErrorMessage(error));});return()=>{active=false;};
  },[base,findingId,reload]);
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 sm:p-8"><h1 className="text-2xl font-bold">ตรวจหลักฐานใบแจ้งหนี้ที่พบ</h1>
    <p>ตรวจการจ่ายฉบับเต็มกับสัญญาเดิมก่อนบันทึก การบันทึกหลักฐานกับการให้สิทธิ์เป็นคนละขั้น ใบแจ้งหนี้เก่าหรือมีข้อพิพาทยังต้องตรวจเงื่อนไข</p>
    <nav className="flex flex-wrap gap-3"><Link className="underline" href={base}>กลับไปบริษัท</Link><Link className="underline" href={`${base}/invoice-scans`}>ประวัติงานตรวจ</Link></nav>
    <button className="min-h-11 rounded-xl border px-4 py-2" onClick={()=>setReload(v=>v+1)}>โหลดหลักฐานล่าสุด</button>
    {error&&<p role="alert">{error}</p>}{!finding&&!error&&<p role="status">กำลังโหลด…</p>}
    {finding&&<><section className="space-y-3 rounded-xl border p-4"><h2 className="font-bold">ผลตรวจต้นทาง</h2><p className="break-all">อ้างอิง {finding.id}</p>
      <p>สร้างใบแจ้งหนี้ {new Date(finding.invoiceCreatedAt).toLocaleString('th-TH')} · ตรวจพบ {new Date(finding.observedAt).toLocaleString('th-TH')}</p>
      <p>{finding.localInvoiceId?'มีใบแจ้งหนี้เดิมในระบบแล้ว':'ยังไม่มีหลักฐานฉบับเต็มในระบบ'}</p>
      {!finding.localInvoiceId&&!finding.canImport&&<p>ยังส่งคำสั่งไม่ได้ ต้องมีผลตรวจว่าจ่ายครบ ตรวจสิทธิ์ผู้ดูแล การเชื่อมต่อ หรือบัญชี Stripe ที่เปลี่ยนไป แล้วเริ่มงานตรวจที่ผูกบัญชีปัจจุบัน</p>}
      {finding.localInvoiceId&&<Link className="block underline" href={`${base}/apply-invoices/${finding.localInvoiceId}`}>ตรวจการให้สิทธิ์จากใบแจ้งหนี้เดิม</Link>}
      <Link className="block underline" href={`${base}/invoice-scans/${finding.scanId}`}>กลับงานตรวจต้นทาง</Link>
      {finding.reviewCaseId&&<Link className="block underline" href={`/system/billing/issues/${finding.reviewCaseId}`}>เคสตรวจใบแจ้งหนี้ของบริษัท</Link>}
    </section><BillingOperationPanel key={finding.id} companyId={companyId} companyVersion={finding.accountVersion} findingId={finding.id} findingSourceHash={finding.sourceHash} canRetry={finding.canImport}/></>}
  </main>;
}

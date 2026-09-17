'use client';
import { billingLink, billingLeavesPage, billingControl, billingLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import type {BillingBatchView,BillingBatchList,BillingBatchExport,BillingOperatorOverview,BillingOperatorCompany} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorMessage} from '@/common/api/api-error-message';
const base='/system/billing/batches',button=billingControl;
const time=(value:string|null)=>value?formatThaiDateTime(value):'ยังไม่มีผลตรวจ';
const states:Record<string,string>={PREVIEW:'ยังไม่ส่งคำขอ',QUEUED:'รอตรวจ',RUNNING:'กำลังตรวจ',SUCCEEDED:'ตรวจแล้ว',UNKNOWN:'ยังยืนยันผลไม่ได้',BLOCKED:'ต้องตรวจเงื่อนไข',FAILED:'ตรวจไม่สำเร็จ',CANCELLED:'หยุดคำขอแล้ว',MISSING:'ไม่พบคำขอเดิม'};
const progress:Record<BillingBatchView['progress'],string>={PREVIEW:'ตรวจบริษัทที่เลือกก่อนยืนยัน',PENDING:'รอผลตรวจรายบริษัท',REVIEW:'มีรายการที่ต้องตรวจต่อ',CHECKED:'ได้ผลตรวจครบแล้ว',PARTIAL:'ตรวจแล้วบางบริษัท ส่วนที่เหลือหยุดแล้ว',STOPPED:'หยุดคำขอแล้ว'};
const read=<T,>(path:string)=>authedApiFetch<T>(path,{cache:'no-store',suppressErrorToast:true});
export default function BillingBatchPage({batchId}:{batchId?:string}){
  const router=useRouter(),generation=useRef(0),intent=useRef<{id:string;key:string}|null>(null);
  const [batch,setBatch]=useState<BillingBatchView|null>(null),[history,setHistory]=useState<BillingBatchList|null>(null),[overview,setOverview]=useState<BillingOperatorOverview|null>(null);
  const [selected,setSelected]=useState<BillingOperatorCompany[]>([]),[reason,setReason]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState('');
  const [companyCursor,setCompanyCursor]=useState<string|null>(null),[historyCursor,setHistoryCursor]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const refresh=()=>{invalidate();setLoading(true);setReload(v=>v+1);};
  useEffect(()=>{intent.current=null;setSelected([]);setReason('');setCompanyCursor(null);setHistoryCursor(null);},[batchId]);
  useEffect(()=>{
    const token=++generation.current;setLoading(true);setBusy(false);setError('');setNotice('');setBatch(null);setOverview(null);setHistory(null);
    const load=batchId?read<BillingBatchView>(`${base}/${batchId}`).then(value=>{if(generation.current===token)setBatch(value);}):
      Promise.allSettled([read<BillingOperatorOverview>(`/system/billing/overview?${new URLSearchParams({search:query,...companyCursor?{cursor:companyCursor}:{}})}`),
        read<BillingBatchList>(`${base}?${new URLSearchParams(historyCursor?{cursor:historyCursor}:{})}`)]).then(([companies,runs])=>{
          if(generation.current!==token)return;
          if(companies.status==='fulfilled')setOverview(companies.value);
          if(runs.status==='fulfilled')setHistory(runs.value);
          if(companies.status==='rejected'||runs.status==='rejected')setError('โหลดข้อมูลบางส่วนไม่ได้ ตรวจสิทธิ์แล้วกดโหลดผลล่าสุด เปิดงานเดิมที่แสดงอยู่ได้');
        });
    void load.catch(e=>{if(generation.current===token)setError(apiErrorMessage(e));}).finally(()=>{if(generation.current===token)setLoading(false);});
    return invalidate;
  },[batchId,query,companyCursor,historyCursor,reload]);
  const preview=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy||!selected.length)return;const token=generation.current;setBusy(true);setError('');
    try{const value=await authedApiFetch<BillingBatchView>(`${base}/preview`,{method:'POST',suppressErrorToast:true,body:JSON.stringify({companies:selected.map(c=>({companyId:c.companyId,expectedVersion:c.version})),reason})});
      if(token===generation.current)router.push(`${base}/${value.id}`);
    }catch(e){if(token===generation.current)setError(`${apiErrorMessage(e)} หากข้อมูลบริษัทเปลี่ยน ให้เริ่มเลือกใหม่ หรือเปิดงานเดิมจากประวัติ`);}finally{if(token===generation.current)setBusy(false);}
  };
  const act=async(action:'submit'|'cancel')=>{
    if(!batch||busy)return;const token=generation.current;setBusy(true);setError('');
    if(intent.current?.id!==batch.id)intent.current={id:batch.id,key:crypto.randomUUID()};
    try{await authedApiFetch<BillingBatchView>(`${base}/${batch.id}/${action}`,{method:'POST',suppressErrorToast:true,headers:action==='submit'?{'idempotency-key':intent.current.key}:{},
      body:JSON.stringify({expectedVersion:batch.version,...action==='submit'?{previewHash:batch.previewHash}:{}})});if(token===generation.current)refresh();
    }catch(e){if(token===generation.current)setError(apiErrorMessage(e));}finally{if(token===generation.current)setBusy(false);}
  };
  const download=async()=>{
    if(!batch||busy)return;const token=generation.current;setBusy(true);setError('');setNotice('กำลังเตรียมไฟล์ผลตรวจ');
    try{const value=await read<BillingBatchExport>(`${base}/${batch.id}/export`);if(token!==generation.current)return;
      const url=URL.createObjectURL(new Blob([value.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=value.fileName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
      setNotice(`ส่งออกผลตรวจ ${value.rowCount} บริษัทแล้ว`);
    }catch(e){if(token===generation.current){setNotice('');setError(apiErrorMessage(e));}}finally{if(token===generation.current)setBusy(false);}
  };
  const canCreate=overview?.mode!=='DISABLED'&&overview?.capabilities.includes('system.billing.reconcile.run');
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">ตรวจรายการหลายบริษัท</h1>
    <p>ตรวจหลักฐานล่าสุดและดำเนินการรายการเดิมตามนโยบาย เลือกได้ครั้งละ 25 บริษัท ผลตรวจแต่ละบริษัทแยกกัน</p>
    <nav className="flex flex-wrap gap-3"><Link className={billingLink} onClick={leaving} href="/system/billing">บริษัท</Link><Link className={billingLink} onClick={leaving} href="/system/billing/issues">ปัญหาการชำระเงิน</Link>
      {batchId&&<Link className={billingLink} onClick={leaving} href={base}>กลับรายการงานตรวจ</Link>}</nav>
    <button className={button} disabled={loading||busy} aria-busy={Boolean(loading || busy)} onClick={refresh}>โหลดผลล่าสุด</button>
    {loading&&<p role="status">กำลังโหลด…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {!batchId&&overview&&<section className="space-y-4" aria-label="เลือกบริษัทเพื่อตรวจ">
      <h2 className="text-lg font-bold">เลือกบริษัท</h2><p>{billingLabel('mode',overview.mode)}</p>
      <form className="space-y-2" onSubmit={e=>{e.preventDefault();invalidate();setLoading(true);setCompanyCursor(null);setQuery(search.trim());setReload(v=>v+1);}}>
        <label className="block">ค้นหาบริษัท<input className="mangmee-input !text-base mt-1 block min-h-11 w-full rounded-lg border border-gray-200 p-2" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)}>ค้นหา</button></form>
      {!canCreate&&<p>ดูผลเดิมได้ แต่ยังเริ่มงานใหม่ไม่ได้ ให้ผู้ดูแลตรวจสิทธิ์และการเชื่อมต่อ Stripe</p>}
      {!overview.companies.length&&<p>ไม่พบบริษัทตามคำค้นในขอบเขตนี้</p>}
      {overview.companies.map(c=><label key={c.companyId} className="flex min-h-11 items-start gap-3 rounded-xl border border-gray-200 p-3 bg-white">
        <input type="checkbox" className="mt-1 size-5 shrink-0" checked={selected.some(s=>s.companyId===c.companyId)} disabled={!canCreate||busy||loading||!c.accountId||(selected.length>=25&&!selected.some(s=>s.companyId===c.companyId))}
          onChange={e=>setSelected(current=>e.target.checked?[...current,c]:current.filter(s=>s.companyId!==c.companyId))}/>
        <span>{c.companyName}{!c.accountId&&<span className="block text-gray-600">ยังไม่มีบัญชีชำระเงินให้ตรวจ</span>}</span></label>)}
      <div className="flex flex-wrap gap-3">{overview.nextCursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>{invalidate();setCompanyCursor(overview.nextCursor);}}>บริษัทหน้าถัดไป</button>}
        {companyCursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>{invalidate();setCompanyCursor(null);}}>บริษัทหน้าแรก</button>}</div>
      {canCreate&&<form className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" onSubmit={e=>void preview(e)}>
        <h3 className="font-bold">เลือกไว้ {selected.length} บริษัท</h3>{selected.length>0&&<details><summary className="min-h-11 cursor-pointer py-2">ดูบริษัทที่เลือกและนำออก</summary>
          {selected.map(c=><div key={c.companyId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{c.companyName}</span><button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>setSelected(rows=>rows.filter(row=>row.companyId!==c.companyId))}>นำ {c.companyName} ออก</button></div>)}</details>}
        <div><label className="block" htmlFor="billing-batch-reason">เหตุผลการตรวจ</label><textarea id="billing-batch-reason" className="mangmee-input !text-base mt-1 block w-full rounded-lg border border-gray-200 p-2" required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></div>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||loading||!selected.length||!reason.trim()} aria-busy={Boolean(busy || loading)}>ตรวจบริษัทที่เลือกก่อนยืนยัน</button>
          <button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>{setSelected([]);refresh();}}>เริ่มเลือกใหม่</button></div>
      </form>}
    </section>}
    {batch&&<section className="space-y-4 rounded-xl border border-gray-200 p-4 bg-white" aria-label="ผลตรวจรายบริษัท">
      <h2 className="text-lg font-bold" aria-live="polite">{progress[batch.progress]}</h2><p>{billingLabel('mode',batch.mode)} · {batch.reason}</p>
      <p>ตรวจแล้ว {batch.checked} · รอผล {batch.pending} · ต้องตรวจต่อ {batch.review} · หยุดแล้ว {batch.stopped}</p>
      <p>ตรวจแล้วหมายถึงได้ผลของคำขอนี้ สถานะจ่ายเงิน สิทธิ์ และเคสค้างให้เปิดดูที่บริษัท</p>
      {batch.state==='PREVIEW'&&<p>{batch.canSubmit?`ยืนยันได้ถึง ${time(batch.expiresAt)}`:'ยังยืนยันไม่ได้ ข้อมูลหรือสิทธิ์อาจเปลี่ยน ให้ตรวจบริษัทแล้วเริ่มงานใหม่'}</p>}
      <div className="flex flex-wrap gap-3">{batch.canSubmit&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('submit')}>ยืนยันตรวจ {batch.items.length} บริษัท</button>}
        {batch.canCancel&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('cancel')}>{batch.state==='PREVIEW'?'ยกเลิกคำขอนี้':'หยุดเฉพาะบริษัทที่ยังไม่เริ่ม'}</button>}
        {batch.canExport&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void download()}>ดาวน์โหลดผลตรวจ</button>}</div>
      {batch.canExport&&<p className="text-gray-600">ไฟล์ผลตรวจเปิดใน Excel ได้</p>}
      {batch.items.map(item=><article key={item.companyId} className="space-y-2 rounded-lg bg-slate-50 p-3" aria-label={item.companyName}>
        <h3 className="font-semibold">{item.companyName}</h3><p>{Object.hasOwn(states,item.state)?states[item.state]:'ต้องตรวจสอบสถานะ'} · {time(item.observedAt)}</p>
        {item.pendingAttempt!==null&&<p>{item.pendingAttempt?'ยังมีรายการซื้อค้าง ต้องตามผล':'ไม่พบรายการซื้อค้างจากผลคำขอนี้'}{item.issueCount!==null&&` · เคสที่ยังเปิด ${item.issueCount}`}</p>}
        <div className="flex flex-wrap gap-3">{item.operationId&&<Link className={button} onClick={leaving} href={`/system/billing/operations/${item.operationId}?batch=${batch.id}`}>เปิดคำขอเดิม</Link>}
          {item.reviewCaseId&&<Link className={button} onClick={leaving} href={`/system/billing/issues/${item.reviewCaseId}`}>เปิดเคสที่ต้องตรวจ</Link>}
          <Link className={button} onClick={leaving} href={`/system/billing/companies/${encodeURIComponent(item.companyId)}`}>เปิดบริษัท</Link></div>
      </article>)}
      <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงงานตรวจ</summary><p className="break-all">{batch.id} · สร้าง {time(batch.createdAt)}</p></details>
    </section>}
    {!batchId&&history&&<section className="space-y-3" aria-label="ประวัติงานตรวจหลายบริษัท"><h2 className="text-lg font-bold">งานตรวจเดิม</h2>
      {!history.items.length&&<p>ไม่พบงานที่ยังมีสิทธิ์ดูในหน้านี้</p>}{history.items.map(item=><article className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white" key={item.id}><p>{item.reason}</p><p>{progress[item.progress]} · {item.items.length} บริษัท · {time(item.createdAt)}</p><Link className={button} onClick={leaving} href={`${base}/${item.id}`}>เปิดงานตรวจเดิม</Link></article>)}
      <div className="flex flex-wrap gap-3">{history.nextCursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>{invalidate();setHistoryCursor(history.nextCursor);}}>ประวัติหน้าถัดไป</button>}
        {historyCursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>{invalidate();setHistoryCursor(null);}}>ประวัติหน้าแรก</button>}</div>
    </section>}
  </main>;
}

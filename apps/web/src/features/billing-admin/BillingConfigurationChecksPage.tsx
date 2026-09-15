'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { billingOffer, type BillingConfigurationCheck as Check, type BillingConfigurationCheckHistory as History, type BillingConfigurationCheckItem as Item } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';

const base='/system/billing/configuration-checks',button='inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-base font-semibold disabled:opacity-50';
const resultName=(state:Item['state'])=>({MATCH:'ตรงตามที่ตั้งไว้',DIFFERENT:'ต้องแก้ไข',UNAVAILABLE:'ยังตรวจไม่ได้',NOT_CONFIGURED:'ยังไม่ได้ตั้งค่า'}[state]);
const stateName=(check:Check)=>check.state==='SUCCEEDED'&&check.result?resultName(check.result):({QUEUED:'รอเริ่มตรวจ',RUNNING:'กำลังตรวจ',BLOCKED:'ต้องเริ่มตรวจใหม่',CANCELLED:'ยกเลิกแล้ว',SUCCEEDED:'ตรวจเสร็จแล้ว'}[check.state]);
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ยังไม่มีผล';
const itemName=(item:Item)=>{
  const name={POLICY:'นโยบายการขาย',ACCOUNT:'บัญชี Stripe',PRICE:'ราคาขาย',PREPAID_PRICE:'ช่วงที่ชำระเงินล่วงหน้า',PORTAL:'หน้าแก้บัตร',TAX:'การคิดภาษี'}[item.kind];
  if(!item.offerKey)return name;
  const [tier,interval]=item.offerKey.split(':');
  return `${name} · ${billingOffer(tier as Parameters<typeof billingOffer>[0],interval as 'month'|'year').label} · ${interval==='year'?'รายปี':'รายเดือน'}`;
};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(path,{cache:'no-store',suppressErrorToast:true,
  ...body===undefined?{}:{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}}}});

export default function BillingConfigurationChecksPage({checkId}:{checkId?:string}){
  const router=useRouter(),intent=useRef<{body:{expectedVersion:number;reason:string};key:string}|null>(null),generation=useRef(0);
  const [history,setHistory]=useState<History|null>(null),[check,setCheck]=useState<Check|null>(null),[cursor,setCursor]=useState<string|null>(null);
  const [reload,setReload]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('');
  useEffect(()=>{
    const current=++generation.current;setLoading(true);setError('');setHistory(null);setCheck(null);
    const read=checkId?api<Check>(`${base}/${encodeURIComponent(checkId)}`).then(value=>{if(current===generation.current)setCheck(value);}):
      api<History>(`${base}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`).then(value=>{if(current===generation.current)setHistory(value);});
    void read.catch(()=>{if(current===generation.current)setError('โหลดผลตรวจไม่ได้ ตรวจสิทธิ์และลองโหลดอีกครั้ง');}).finally(()=>{if(current===generation.current)setLoading(false);});
    return()=>{generation.current++;};
  },[checkId,cursor,reload]);
  const pending=check?.state==='QUEUED'||check?.state==='RUNNING';
  useEffect(()=>{
    if(!checkId||!pending)return;let active=true,count=0;
    const timer=setInterval(()=>{if(++count>24){clearInterval(timer);return;}
      void api<Check>(`${base}/${encodeURIComponent(checkId)}`).then(value=>{if(active)setCheck(prior=>prior&&prior.version>value.version?prior:value);})
        .catch(()=>{clearInterval(timer);if(active){setCheck(null);setError('ยังโหลดผลล่าสุดไม่ได้ กดโหลดผลล่าสุดหรือกลับมาเปิดลิงก์เดิม');}});
    },5000);return()=>{active=false;clearInterval(timer);};
  },[checkId,pending,reload]);
  const create=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy||!history)return;const current=generation.current;setBusy(true);setError('');
    intent.current??={body:{expectedVersion:history.settingsVersion,reason:reason.trim()},key:crypto.randomUUID()};
    try{const value=await api<Check>(base,intent.current.body,intent.current.key);if(current===generation.current){intent.current=null;router.push(`${base}/${value.id}`);}}
    catch(failure){if(current===generation.current){const stale=(failure as {code?:string}).code==='CONTROL_PREVIEW_STALE';if(stale)intent.current=null;setError(stale?'การตั้งค่าเปลี่ยนแล้ว กรุณาตรวจข้อมูลล่าสุดและเริ่มใหม่':'ยังยืนยันการรับคำขอไม่ได้ ลองคำขอเดิม หรือโหลดประวัติเพื่อเปิดรายการที่รับไว้แล้ว');
      try{const latest=await api<History>(base);if(current===generation.current)setHistory(latest);}catch{if(current===generation.current)setHistory(null);}}}
    finally{if(current===generation.current)setBusy(false);}
  };
  const act=async(action:'run'|'cancel')=>{
    if(!check||busy)return;const current=generation.current;setBusy(true);setError('');
    try{const value=await api<Check>(`${base}/${check.id}/${action}`,{expectedVersion:check.version});if(current===generation.current)setCheck(value);}
    catch{if(current===generation.current){setCheck(null);setError('ยังยืนยันผลไม่ได้ โหลดผลล่าสุดก่อนทำต่อ รายการเดิมยังอยู่ที่ลิงก์นี้');}}
    finally{if(current===generation.current)setBusy(false);}
  };
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">ตรวจการเชื่อมต่อ Stripe</h1>
    <p>ตรวจบัญชี ราคา หน้าแก้บัตร และภาษีกับค่าที่อนุมัติไว้ การตรวจนี้ไม่เรียกเก็บเงินหรือเปลี่ยนสิทธิ์ลูกค้า</p>
    <nav className="flex flex-wrap gap-3"><Link className={button} href="/system/billing/settings">แก้การตั้งค่าการจ่ายเงิน</Link><Link className={button} href="/system/billing/issues">คิวตรวจสอบ</Link>
      {checkId&&<Link className={button} href={base}>กลับประวัติการตรวจ</Link>}</nav>
    <button className={button} disabled={loading||busy} onClick={()=>setReload(value=>value+1)}>โหลดผลล่าสุด</button>
    {loading&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-4">{error}</p>}
    {history&&<>
      <p>{history.mode==='DISABLED'?'ยังไม่เปิดการเชื่อมต่อ':history.mode==='TEST'?'โหมดทดสอบ · ไม่มีการตัดเงินจริง':'โหมดเงินจริง'}</p>
      {history.activeCheck&&<Link className={button} href={`${base}/${history.activeCheck.id}`}>เปิดรายการที่กำลังตรวจ</Link>}
      {history.canCreate&&<form onSubmit={event=>void create(event)} className="space-y-3 rounded-xl border p-4">
        <div><label className="block" htmlFor="configuration-check-reason">เหตุผลการตรวจ</label><textarea id="configuration-check-reason" className="mt-1 block min-h-11 w-full rounded-lg border p-2" required maxLength={500} disabled={busy||!!intent.current} value={reason} onChange={event=>setReason(event.target.value)}/></div>
        <button className={button} disabled={busy||!reason.trim()} aria-busy={Boolean(busy)}>{intent.current?'ลองคำขอเดิมอีกครั้ง':'เริ่มตรวจการเชื่อมต่อ'}</button>
      </form>}
      <section aria-label="ประวัติการตรวจ" className="space-y-3"><h2 className="text-lg font-bold">ประวัติการตรวจ</h2>
        {!history.items.length&&<p>ยังไม่มีรายการตรวจ</p>}
        {history.items.map(item=><Link key={item.id} className="block min-h-11 rounded-xl border p-4" href={`${base}/${item.id}`}><strong>{stateName(item)}</strong><p>{item.reason}</p><p>{time(item.createdAt)}{!item.isCurrent?' · การตั้งค่าเปลี่ยนแล้ว':''}</p></Link>)}
        {history.nextCursor&&<button className={button} onClick={()=>setCursor(history.nextCursor)}>ประวัติก่อนหน้า</button>}
        {cursor&&<button className={button} onClick={()=>setCursor(null)}>กลับประวัติล่าสุด</button>}
      </section>
    </>}
    {check&&<section aria-label="ผลตรวจการเชื่อมต่อ" className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-bold" role="status">{stateName(check)}</h2><p>{check.reason}</p><p>{check.mode==='TEST'?'โหมดทดสอบ · ไม่มีการตัดเงินจริง':'โหมดเงินจริง'}</p>
      {!check.isCurrent&&<p role="alert">การตั้งค่าเปลี่ยนแล้ว ผลนี้ใช้กับค่าชุดเก่า ให้ตรวจใหม่จากหน้าประวัติ</p>}
      {check.state==='SUCCEEDED'&&<p>ตรวจเมื่อ {time(check.observedAt)} · เวลาตามเครื่องนี้</p>}
      {check.result==='MATCH'&&<p>ค่าที่ตรวจตรงกันแล้ว การรับชำระ การส่งข้อความ และเงินเข้าบัญชีต้องตรวจผลของแต่ละรายการ</p>}
      {check.items.filter(item=>!(item.kind==='PREPAID_PRICE'&&['MATCH','NOT_CONFIGURED'].includes(item.state))&&!(item.kind==='PRICE'&&item.state==='NOT_CONFIGURED')).map((item,index)=><div key={index} className="rounded-lg bg-gray-50 p-3"><h3 className="font-semibold">{itemName(item)}</h3><p>{resultName(item.state)}</p>
        {item.state==='DIFFERENT'&&<p>เปิดการตั้งค่าเพื่อตรวจและขออนุมัติค่าที่ถูกต้อง แล้วตรวจใหม่</p>}
        {item.state==='UNAVAILABLE'&&<p>ยังยืนยันกับ Stripe ไม่ได้ ให้ลองตรวจใหม่ภายหลัง</p>}
        {item.state==='NOT_CONFIGURED'&&<p>{item.kind==='POLICY'?'เติมการตั้งค่าและขออนุมัติก่อนเริ่มตรวจใหม่':'ตัวเลือกนี้ยังไม่เปิดขาย'}</p>}
      </div>)}
      {check.state==='BLOCKED'&&<p role="alert">ข้อมูลหรือสิทธิ์เปลี่ยนระหว่างตรวจ ยกเลิกรายการนี้ แล้วเริ่มตรวจใหม่จากหน้าประวัติ</p>}
      {check.items.some(item=>item.kind==='PRICE'&&item.state==='NOT_CONFIGURED')&&<details><summary className="min-h-11 cursor-pointer py-2">แพ็กเกจที่ยังไม่เปิดขาย</summary><ul className="space-y-3">
        {check.items.filter(item=>item.kind==='PRICE'&&item.state==='NOT_CONFIGURED').map(item=><li key={item.offerKey}>{itemName(item).replace('ราคาขาย · ','')}</li>)}
      </ul><p>เติมราคาจากหน้าการตั้งค่าและขออนุมัติก่อนเปิดขาย</p></details>}
      <div className="flex flex-wrap gap-3">{check.canRun&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('run')}>ตรวจรายการนี้ตอนนี้</button>}
        {check.canCancel&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('cancel')}>ยกเลิกรายการตรวจนี้</button>}
        {check.reviewCaseId&&<Link className={button} href={`/system/billing/issues/${check.reviewCaseId}`}>เปิดเคสที่เกี่ยวข้อง</Link>}</div>
      <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงสำหรับทีมช่วยเหลือ</summary><p>รายการ {check.id}</p><p>รุ่นการตั้งค่า {check.sourceVersion}</p>{check.items.filter(item=>item.kind==='PREPAID_PRICE').map(item=><p key={item.offerKey}>{itemName(item)}: {resultName(item.state)}</p>)}{check.errorCode&&<p>{check.errorCode}</p>}</details>
    </section>}
  </main>;
}

'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {BillingDeliveryView} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import BillingOperationPanel from './BillingOperationPanel';
const button='inline-block rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50';
const reasons:Record<string,string>={transport_unknown:'เคยไม่ได้รับคำตอบจากผู้ให้บริการ',authentication:'ข้อมูลรับรองการส่งอีเมลใช้ไม่ได้',prior_generation_accepted:'พบว่ารุ่นก่อนหน้าส่งสำเร็จแล้ว',delivery_unconfirmed_possible_duplicate:'ยังยืนยันผลการส่งเดิมไม่ได้ อาจได้รับซ้ำ',MAIL_CONFIGURATION_CHANGED:'ตรวจการตั้งค่า Postmark ให้ตรงกับรายการเดิม',VERIFIED_EMAIL_REQUIRED:'ผู้รับต้องมีอีเมลที่ยืนยันแล้ว',MAIL_RECIPIENT_CHANGED:'อีเมลผู้รับเปลี่ยน ต้องตรวจรายการเดิม',MAIL_LOOKUP_REQUIRED:'ตรวจผลกับ Postmark ก่อนส่งใหม่',MAIL_PROOF_EXPIRED:'หลักฐานอีเมลหมดอายุ',MAIL_RETRY_EXHAUSTED:'ครบจำนวนรุ่นอีเมลที่อนุญาต ต้องให้เจ้าหน้าที่ตรวจ',MAIL_BACKOFF:'รอเวลาตรวจหรือส่งอีกครั้งตามที่แสดง',MAIL_BINDING_CHANGED:'ผู้รับหรือเนื้อหาอีเมลเปลี่ยน ต้องตรวจสอบใหม่',NOTIFICATION_PAUSED:'ระบบพักการส่งข้อความอยู่',SOURCE_HELD:'สิทธิ์หรือข้อมูลต้นทางยังต้องตรวจสอบ',WEB_DELIVERY_AUTOMATIC:'ระบบอัปเดตการแจ้งเตือนบนเว็บอัตโนมัติ',
  ALREADY_ACCEPTED:'ผู้ให้บริการรับคำขอแล้ว ไม่ส่งซ้ำ',DELIVERY_NOT_RETRYABLE:'รายการยังอยู่ในคิวหรือไม่สามารถส่งซ้ำได้',RECIPIENT_OR_EVENT_INACTIVE:'ผู้รับหรือเหตุการณ์เดิมไม่พร้อมใช้งาน',
  PREFERENCE_SUPPRESSED:'ผู้ใช้ปิดรับการแจ้งเตือน',LINE_CONFIGURATION_MISSING:'การตั้งค่า LINE ยังไม่พร้อม ให้ผู้ดูแลระบบตรวจการเชื่อมต่อ LINE แล้วโหลดรายการส่งเดิมอีกครั้ง',NO_LINE_DELIVERY_TARGET:'ไม่พบบัญชี LINE ที่ใช้ส่งได้',LINE_BINDING_CHANGED:'ผู้รับหรือข้อความเปลี่ยน ต้องตรวจรายการเดิม',
  LINE_UNKNOWN_REVIEW:'พ้นเวลาที่ส่งซ้ำอย่างปลอดภัยได้ ต้องตรวจผลกับผู้ให้บริการ',LINE_RETRY_EXHAUSTED:'ครบจำนวนครั้งที่อนุญาต ต้องให้เจ้าหน้าที่ตรวจ',CONTROL_PERMISSION_CHANGED:'สิทธิ์ผู้สั่งกู้คืนเปลี่ยนแล้ว ต้องตรวจสอบใหม่'};
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ยังไม่มี';
export default function BillingDeliveryPanel({companyId,deliveryId}:{companyId:string;deliveryId?:string}){
  const [items,setItems]=useState<BillingDeliveryView[]>([]),[cursor,setCursor]=useState<string|null>(null),[next,setNext]=useState<string|null>(null);
  const [reload,setReload]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;setBusy(true);setError('');setItems([]);setNext(null);
    const base=`/system/billing/companies/${encodeURIComponent(companyId)}/deliveries`;
    const work=deliveryId?authedApiFetch<BillingDeliveryView>(`${base}/${encodeURIComponent(deliveryId)}`,{cache:'no-store',suppressErrorToast:true}).then(item=>({items:[item],nextCursor:null})):
      authedApiFetch<{items:BillingDeliveryView[];nextCursor:string|null}>(`${base}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true});
    work.then(result=>{if(active){setItems(result.items);setNext(result.nextCursor);}}).catch(()=>{if(active)setError('โหลดรายการส่งไม่ได้ กรุณาตรวจสิทธิ์หรือกลับไปบริษัทแล้วลองใหม่');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[companyId,deliveryId,cursor,reload]);
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8"><h1 className="text-2xl font-bold">รายการแจ้งเตือนแพ็กเกจ</h1>
    <p className="break-all">บริษัท {companyId}</p><Link className={button} href={`/system/billing/companies/${encodeURIComponent(companyId)}`}>กลับไปบริษัท</Link>
    {deliveryId&&<Link className={button} href={`/system/billing/companies/${encodeURIComponent(companyId)}/deliveries`}>รายการส่งทั้งหมด</Link>}
    <button className={button} disabled={busy} onClick={()=>setReload(v=>v+1)}>โหลดรายการส่งล่าสุด</button>
    <p>หน้านี้แสดงการแจ้งเตือนบนเว็บ LINE และอีเมล สถานะผู้ให้บริการรับคำขอแล้ว ยังไม่ยืนยันว่าผู้ใช้เห็นข้อความ</p>
    {busy&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert">{error}</p>}{!busy&&!error&&!items.length&&<p>ไม่พบรายการส่งในหน้านี้</p>}
    {items.map(item=><article key={item.id} className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">{item.mode} · {item.channel} · {item.state}</h2>
      <p className="break-all">รายการส่ง {item.id}</p><p className="break-all">ผู้รับในระบบ {item.recipientUserId}</p><p className="break-all">ใบชำระเงิน {item.invoiceId}</p>
      <p>พยายามส่ง {item.attemptCount} ครั้ง · อัปเดต {time(item.updatedAt)}</p><p>รับคำขอ {time(item.acceptedAt)}{item.channel==='EMAIL'&&<> · เซิร์ฟเวอร์อีเมลปลายทางรับ {time(item.confirmedAt)}</>}</p><p>ตรวจอีกครั้ง {time(item.nextAttemptAt)}</p>
      {item.possibleDuplicate&&<p role="alert">ยังยืนยันผลการส่งเดิมไม่ได้ หากส่งใหม่ผู้รับอาจได้รับซ้ำ</p>}{item.errorCode&&<p>ผลล่าสุด: {reasons[item.errorCode]??item.errorCode}</p>}
      <p>{item.recoveryBlockedReason?reasons[item.recoveryBlockedReason]??item.recoveryBlockedReason:item.canRetry?'พร้อมให้ตรวจสอบก่อนนำรายการเดิมกลับเข้าคิว':'ต้องมีสิทธิ์กู้คืนการแจ้งเตือนแพ็กเกจ'}</p>
      {!deliveryId&&<Link className="underline" href={`/system/billing/companies/${encodeURIComponent(companyId)}/deliveries/${item.id}`}>เปิดรายการส่งเดิม</Link>}
      {item.retryOperationId&&<Link className="block underline" href={`/system/billing/operations/${item.retryOperationId}`}>เปิดคำสั่งกู้คืนเดิม</Link>}
      {deliveryId&&item.mailHistory&&<section aria-label="ประวัติการส่งอีเมล" className="space-y-2"><h3 className="font-bold">ประวัติการส่งอีเมล</h3>{item.mailHistory.map(attempt=><p key={attempt.id}>
        รุ่น {attempt.generation} · {attempt.state} · รับคำขอ {time(attempt.acceptedAt)} · เซิร์ฟเวอร์ปลายทางรับ {time(attempt.deliveredAt)}{attempt.possibleDuplicate?' · อาจได้รับซ้ำ':''}{attempt.errorCode?` · ${reasons[attempt.errorCode]??attempt.errorCode}`:''}</p>)}</section>}
      {deliveryId&&<BillingOperationPanel companyId={companyId} companyVersion={item.accountVersion} deliveryId={item.id} canRetry={item.canRetry} canCheckDelivery={item.canReconcile}/>}</article>)}
    {!deliveryId&&next&&<button className={button} disabled={busy} onClick={()=>setCursor(next)}>รายการส่งหน้าถัดไป</button>}{cursor&&<button className={button} disabled={busy} onClick={()=>setCursor(null)}>รายการส่งหน้าแรก</button>}
  </main>;
}

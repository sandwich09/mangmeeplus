'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminSignupClaimHistoryDto } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
const button='inline-block rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50';
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ยังไม่มีหลักฐาน';
const states:Record<string,string>={READY:'รอส่ง',SENDING:'กำลังส่งหรือตรวจผล',UNKNOWN:'ยังยืนยันผลส่งไม่ได้',ACCEPTED:'ผู้ให้บริการรับคำขอส่งแล้ว',RETRY:'รอตรวจและลองใหม่',CONFIG:'ต้องตรวจการตั้งค่า',PERMANENT:'ส่งไม่สำเร็จ ต้องตรวจรายการ',SUPPRESSED:'ระงับการส่งไปผู้รับนี้'};
export default function SignupClaimHistoryPage({requestId}:{requestId:string}) {
  const [data,setData]=useState<AdminSignupClaimHistoryDto|null>(null),[cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(null);
    void authedApiFetch<AdminSignupClaimHistoryDto>(`/system/signup-requests/${encodeURIComponent(requestId)}/claim-deliveries${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true})
      .then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('โหลดประวัติไม่ได้ กรุณาตรวจสิทธิ์และลองโหลดใหม่ หรือกลับไปคิวสมัคร');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[requestId,cursor,reload]);
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">ประวัติอีเมลรับบัญชี</h1>
    <nav className="flex flex-wrap gap-3"><Link className={button} href="/system/signup-requests">กลับคิวสมัคร</Link><button className={button} disabled={loading} onClick={()=>setReload(value=>value+1)}>โหลดประวัติล่าสุด</button></nav>
    <p className="break-all">คำขอ {requestId}</p>
    <p>ผู้ให้บริการรับคำขอส่ง และเซิร์ฟเวอร์ผู้รับรับอีเมล เป็นคนละสถานะกับการเปิดบัญชีหรือการอ่านอีเมลของลูกค้า</p>
    {loading&&<p role="status">กำลังโหลดประวัติ…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {data&&<><section className="space-y-2 rounded-xl border bg-white p-4" aria-label="สถานะคำขอสมัคร">
      <p>{data.state} · เวอร์ชัน {data.version}</p><p>บันทึกส่งลิงก์ครั้งล่าสุด {time(data.lastClaimSentAt)}</p>
      {data.hasLegacySesReference&&<p>มีเลขอ้างอิง SES เดิม การมีเลขอ้างอิงไม่ยืนยันว่าอีเมลถึงผู้รับแล้ว</p>}
      <p>หากต้องส่งลิงก์ใหม่ ให้กลับคิวสมัครเพื่อตรวจสถานะและใช้คำสั่งเดิม ลิงก์เก่าจะถูกยกเลิกตามขั้นตอน reissue</p>
    </section><section aria-label="รายการส่งอีเมล" className="space-y-3">
      {!data.items.length&&<p>ไม่มีประวัติการส่งในหน้านี้ ไม่ได้หมายความว่าอีเมลถูกส่งถึงผู้รับแล้ว</p>}
      {data.items.map(item=><article className="space-y-2 rounded-xl border bg-white p-4" key={item.id}>
        <h2 className="font-bold">{item.provider} · รุ่นที่ {item.generation}{item.latest?' · รายการปัจจุบันของคำขอ':''}</h2>
        <p>{states[item.state]??'ต้องตรวจสถานะรายการ'}</p><p className="break-all">อ้างอิง {item.id}</p>
        <p>สร้าง {time(item.createdAt)}</p><p>รับคำขอส่ง {time(item.submittedAt)}</p><p>เซิร์ฟเวอร์ผู้รับรับอีเมล {time(item.deliveredAt)}</p>
        {item.suppressedAt&&<p>ระงับการส่ง {time(item.suppressedAt)}</p>}{item.deadlineAt&&<p>กำหนดหมดอายุของรายการ {time(item.deadlineAt)}</p>}
        {item.nextRecoveryAt&&<p>กำหนดตรวจผล/ลองใหม่ {time(item.nextRecoveryAt)}</p>}
        {item.possibleDuplicate&&<p>การส่งก่อนหน้ายังยืนยันไม่ได้ ผู้รับอาจได้รับอีเมลซ้ำ</p>}{item.needsReview&&<p>ตรวจข้อมูลรายการเดิมก่อนขอส่งลิงก์ใหม่</p>}
      </article>)}</section></>}
    <div className="flex flex-wrap gap-3">{data?.nextCursor&&<button className={button} disabled={loading} onClick={()=>setCursor(data.nextCursor)}>ประวัติหน้าถัดไป</button>}
      {cursor&&<button className={button} disabled={loading} onClick={()=>setCursor(null)}>ประวัติหน้าแรก</button>}</div>
  </main>;
}

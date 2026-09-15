'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SharedLineMessagingSettings } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getSharedLineMessagingSettings, setSharedLineMessagingSettings } from './system-partners.api';

export default function SharedLineSettingsPage() {
  const [current,setCurrent]=useState<SharedLineMessagingSettings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [secret,setSecret]=useState(''),[token,setToken]=useState(''),[password,setPassword]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false);
  const [rotationId,setRotationId]=useState(''),[reviewVersion,setReviewVersion]=useState<number|null>(null);
  const load=async()=>{setBusy(true);setError('');try{setCurrent(await getSharedLineMessagingSettings());}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}};
  useEffect(()=>{void load();},[]);
  const edit=()=>{setRotationId('');setReviewVersion(null);setAck(false);setNotice('');};
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(!current||!ack||reviewVersion===null)return;setBusy(true);setError('');setNotice('');
    const id=rotationId||crypto.randomUUID();setRotationId(id);
    try{const next=await setSharedLineMessagingSettings({channelId:current.channelId!,channelSecret:secret,accessToken:token,password,reason,expectedVersion:reviewVersion,rotationId:id});
      setCurrent(next);setSecret('');setToken('');setPassword('');setReason('');setAck(false);setRotationId('');setReviewVersion(null);
      setNotice('บันทึกกุญแจรุ่นใหม่แล้ว คำขอ LINE ครั้งถัดไปใช้รุ่นนี้ การรับ webhook ต้องตรวจแยก');
    }catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}};
  return <main className="mx-auto max-w-2xl space-y-5 p-4">
    <Link href="/system/partners" className="underline">กลับไปรายชื่อบริษัท</Link>
    <h1 className="text-xl font-semibold">การเชื่อมต่อ LINE ของระบบ</h1>
    <p>เปลี่ยนกุญแจ Messaging ของ OA เดิม ใช้ร่วมกันสำหรับ webhook, AI, ใบเสร็จ และข้อความแจ้งเตือนของทุกบริษัท</p>
    <button type="button" className="mangmee-btn" disabled={busy} aria-busy={busy} onClick={()=>void load()}>โหลดสถานะ LINE ล่าสุด</button>
    {busy&&<p role="status">กำลังตรวจสอบ…</p>}{error&&<p role="alert" className="break-words text-red-700">{error} หากผลบันทึกไม่ชัดเจน ให้โหลดสถานะล่าสุดหรือลองคำขอเดิมอีกครั้ง</p>}
    {notice&&<p role="status">{notice}</p>}
    {current&&<>
      <section aria-label="สถานะ LINE ปัจจุบัน" className="space-y-2 rounded border p-4">
        <p>อ่านกุญแจปัจจุบัน: {current.runtimeStatus==='AVAILABLE'?'อ่านได้':current.runtimeStatus==='INCOMPLETE'?'ตั้งค่ายังไม่ครบ':'อ่านไม่ได้หรือ token หมดอายุ กรุณาบันทึกกุญแจปัจจุบันใหม่'}</p>
        <p>Channel ID: {current.channelId??'ยังไม่ได้ตั้งค่า'}</p><p>รุ่นที่บันทึก: {current.version} · แหล่งที่ใช้: {current.source==='DATABASE'?'ค่าจากหน้า Admin':'ค่าตั้งต้นระบบ'}</p>
        <p>เผยแพร่: {current.publishedAt?formatThaiDateTime(current.publishedAt):'ยังไม่เคยเผยแพร่จากหน้านี้'}</p>
        <p>ตรวจ token กับ LINE: {current.tokenValidatedAt?formatThaiDateTime(current.tokenValidatedAt):'ยังไม่มีหลักฐานจากหน้านี้'}</p>
        <p>รับลายเซ็น webhook ของรุ่นนี้: {current.inboundVerifiedAt?formatThaiDateTime(current.inboundVerifiedAt):'ยังไม่พบ'}</p>
        <p>เวลาที่ตรวจ token และลายเซ็นเป็นหลักฐานคนละส่วน ไม่ยืนยันว่าผู้ใช้ได้รับหรืออ่านข้อความแล้ว</p>
      </section>
      {!current.canReplace?<p>ยังไม่มี Channel ID ตั้งต้น กรุณาตั้งค่า OA ของระบบก่อนเปิดใช้การเปลี่ยนกุญแจ</p>:<form onSubmit={save} className="space-y-4 rounded border p-4">
        <h2 className="font-semibold">เปลี่ยนกุญแจของ OA เดิม</h2>
        <p>คำขอครั้งถัดไปใช้กุญแจใหม่โดยไม่ restart งานที่ส่งไปแล้วอาจใช้กุญแจเดิม การออก Channel Secret ใหม่ที่ LINE ทำให้ secret เดิมใช้ไม่ได้ หน้านี้ไม่ออกหรือเพิกถอน token ให้</p>
        <label className="block">Channel Secret ใหม่<input className="mangmee-input w-full" type="password" autoComplete="new-password" value={secret} minLength={16} maxLength={1024} required disabled={busy} onChange={e=>{setSecret(e.target.value);edit();}}/></label>
        <label className="block">Channel Access Token ใหม่<input className="mangmee-input w-full" type="password" autoComplete="new-password" value={token} minLength={16} maxLength={4096} required disabled={busy} onChange={e=>{setToken(e.target.value);edit();}}/></label>
        <p>รองรับ short-lived และ long-lived token จาก <a className="underline" href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">LINE Developers Console</a></p>
        <label className="block">เหตุผลการเปลี่ยน<input className="mangmee-input w-full" value={reason} minLength={5} maxLength={500} required disabled={busy} onChange={e=>{setReason(e.target.value);edit();}}/></label>
        <label className="block">รหัสผ่านปัจจุบันของผู้ดูแล<input className="mangmee-input w-full" type="password" autoComplete="current-password" value={password} required disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>{setAck(e.target.checked);setReviewVersion(e.target.checked?current.version:null);setRotationId('');}}/>ยืนยันเปลี่ยนกุญแจรุ่น {current.version} ของ OA เดิมสำหรับทุกบริษัท และตรวจ webhook หลังบันทึก</label>
        {reviewVersion!==null&&reviewVersion!==current.version&&<p role="status">สถานะเปลี่ยนจากที่ตรวจไว้ หากคำขอก่อนหน้าบันทึกแล้ว การลองซ้ำด้วยข้อมูลเดิมจะอ่านผลเดิมเท่านั้น</p>}
        <button className="mangmee-btn mangmee-btn-primary" type="submit" disabled={busy||!ack} aria-busy={busy}>ตรวจ token และบันทึกกุญแจ LINE</button>
        <p>กุญแจไม่ถูกเก็บใน URL หรือ storage ของเบราว์เซอร์ และไม่แสดงคืนหลังบันทึก</p>
      </form>}
      <p>LINE Login / LIFF และการเปลี่ยน OA ยังต้องดำเนินการแยก เพื่อรักษาบัญชีที่ผูกไว้ การแก้กุญแจในหน้านี้ไม่เปลี่ยนส่วนนั้น</p>
    </>}
  </main>;
}

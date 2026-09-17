'use client';
import { Button } from '@/common/components/button';
import { useEffect, useState } from 'react';
import type { SharedLineMessagingSettings } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getSharedLineMessagingSettings, setSharedLineMessagingSettings } from './system-partners.api';

export default function SharedLineSettingsPage() {
  const [current,setCurrent]=useState<SharedLineMessagingSettings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [secret,setSecret]=useState(''),[token,setToken]=useState(''),[password,setPassword]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false);
  const [rotationId,setRotationId]=useState(''),[reviewVersion,setReviewVersion]=useState<number|null>(null);
  const load=async()=>{setBusy(true);setError('');try{setCurrent(await getSharedLineMessagingSettings());}catch(e){setCurrent(null);setError(apiErrorMessage(e));}finally{setBusy(false);}};
  useEffect(()=>{void load();},[]);
  const edit=()=>{setRotationId('');setReviewVersion(null);setAck(false);setNotice('');};
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy||!current||!ack||reviewVersion===null)return;setBusy(true);setError('');setNotice('');
    const id=rotationId||crypto.randomUUID();setRotationId(id);
    try{const next=await setSharedLineMessagingSettings({channelId:current.channelId!,channelSecret:secret,accessToken:token,password,reason,expectedVersion:reviewVersion,rotationId:id});
      setCurrent(next);setSecret('');setToken('');setPassword('');setReason('');setAck(false);setRotationId('');setReviewVersion(null);
      setNotice('บันทึกกุญแจรุ่นใหม่แล้ว คำขอ LINE ครั้งถัดไปใช้รุ่นนี้ การรับ webhook ต้องตรวจแยก');
    }catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}};
  return <main className="mx-auto max-w-6xl space-y-6 break-words p-4 text-base sm:p-6 lg:p-8">
    <header><p className="mb-1 text-sm text-gray-500">ตั้งค่าระบบ</p><h1 className="text-2xl font-semibold text-gray-900">ตั้งค่า LINE</h1><p className="mt-2 text-gray-600">ตรวจการเชื่อมต่อบัญชี LINE OA ที่มั่งมีใช้รับข้อความและแจ้งเตือนลูกค้าทุกบริษัท</p></header>
    <section aria-label="สถานะ LINE ปัจจุบัน" className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-gray-900">สถานะการเชื่อมต่อ</h2><Button variant="ghost" className="!min-h-11 !text-base" loading={busy} onClick={()=>void load()}>อัปเดตสถานะ</Button></div>
      {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error} หากผลบันทึกไม่ชัดเจน ให้อัปเดตสถานะก่อนลองคำขอเดิมอีกครั้ง</p>}
      {notice&&<p role="status" className="rounded-lg bg-brand-50 p-4 text-brand-800">{notice}</p>}
      {!current&&busy&&<p role="status" className="text-gray-600">กำลังอ่านสถานะ…</p>}
      {current&&<><div className={`rounded-lg border p-4 ${current.runtimeStatus==='AVAILABLE'?'border-gray-200 bg-gray-50':'border-amber-200 bg-amber-50 text-amber-900'}`}><h3 className="font-semibold">{current.runtimeStatus==='AVAILABLE'?'ระบบอ่านค่าการเชื่อมต่อได้':current.runtimeStatus==='INCOMPLETE'?'ยังตั้งค่า LINE ไม่ครบ':'ระบบยังอ่านค่าการเชื่อมต่อไม่ได้'}</h3><p className="mt-1">{!current.canReplace?'ต้องตั้งค่า Channel ID ของ LINE OA ในระบบก่อน จึงจะเปลี่ยนกุญแจจากหน้านี้ได้':current.runtimeStatus==='AVAILABLE'?'ตรวจผลการยืนยันกับ LINE และการรับข้อความด้านล่างก่อนสรุปว่าใช้งานได้ครบ':'ตรวจค่าการเชื่อมต่อของ OA เดิมก่อนบันทึกกุญแจใหม่'}</p></div>
        <dl className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg bg-gray-50 p-4"><dt className="text-sm text-gray-600">ตรวจสิทธิ์ส่งข้อความกับ LINE</dt><dd className="mt-2 font-medium text-gray-900">{current.tokenValidatedAt?formatThaiDateTime(current.tokenValidatedAt):'ยังไม่มีผลตรวจจากหน้านี้'}</dd></div><div className="rounded-lg bg-gray-50 p-4"><dt className="text-sm text-gray-600">รับข้อมูลจาก LINE ด้วยกุญแจรุ่นนี้</dt><dd className="mt-2 font-medium text-gray-900">{current.inboundVerifiedAt?formatThaiDateTime(current.inboundVerifiedAt):'ยังไม่พบบันทึกการรับข้อมูล'}</dd></div></dl>
        <p className="text-sm text-gray-600">ผลตรวจสองส่วนนี้ยังไม่ยืนยันว่าลูกค้าได้รับหรืออ่านข้อความแจ้งเตือนแล้ว</p>
        <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">ข้อมูลบัญชีและประวัติการตั้งค่า</summary><dl className="grid gap-4 py-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Channel ID</dt><dd className="mt-1 break-all">{current.channelId??'ยังไม่ได้ตั้งค่า'}</dd></div><div><dt className="text-gray-500">ค่าที่ระบบใช้</dt><dd className="mt-1">{current.source==='DATABASE'?'บันทึกจากหน้าแอดมิน':'ค่าตั้งต้นของระบบ'} · รุ่น {current.version}</dd></div><div><dt className="text-gray-500">เริ่มใช้ค่าจากหน้านี้</dt><dd className="mt-1">{current.publishedAt?formatThaiDateTime(current.publishedAt):'ยังไม่เคยบันทึกจากหน้านี้'}</dd></div></dl></details>
      </>}
    </section>
    {current?.canReplace&&<section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6"><details><summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">เปลี่ยนกุญแจเชื่อมต่อ LINE</summary><form onSubmit={save} className="space-y-5 pt-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900"><p className="font-semibold">มีผลกับทุกบริษัทที่ใช้ LINE OA นี้</p><p className="mt-1">ใช้เมื่อต้องเปลี่ยนกุญแจของ OA เดิม ระบบจะใช้ค่าใหม่กับคำขอถัดไป งานที่ส่งไปแล้วอาจยังใช้ค่าเดิม</p></div>
      <h2 className="font-semibold text-gray-900">1. ระบุกุญแจใหม่และเหตุผล</h2>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium text-gray-700">Channel Secret ใหม่<input className="mangmee-input mt-2 min-h-11 w-full !text-base" type="password" autoComplete="new-password" value={secret} minLength={16} maxLength={1024} required disabled={busy} onChange={e=>{setSecret(e.target.value);edit();}}/></label>
      <label className="block text-sm font-medium text-gray-700">Channel Access Token ใหม่<input className="mangmee-input mt-2 min-h-11 w-full !text-base" type="password" autoComplete="new-password" value={token} minLength={16} maxLength={4096} required disabled={busy} onChange={e=>{setToken(e.target.value);edit();}}/></label></div>
      <p className="text-sm text-gray-600">นำค่าจาก <a className="text-brand-800 underline underline-offset-4" href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">LINE Developers Console</a> ของ OA เดิม รองรับ token แบบ short-lived และ long-lived การออก Channel Secret ใหม่ที่ LINE ทำให้ค่าเดิมใช้ไม่ได้</p>
      <label className="block text-sm font-medium text-gray-700">เหตุผลการเปลี่ยน<input className="mangmee-input mt-2 min-h-11 w-full !text-base" value={reason} minLength={5} maxLength={500} required disabled={busy} onChange={e=>{setReason(e.target.value);edit();}}/></label>
      <div className="space-y-4 border-t border-gray-100 pt-5"><h2 className="font-semibold text-gray-900">2. ยืนยันก่อนใช้ค่าใหม่</h2><label className="block text-sm font-medium text-gray-700">รหัสผ่านปัจจุบันของผู้ดูแล<input className="mangmee-input mt-2 min-h-11 w-full !text-base" type="password" autoComplete="current-password" value={password} required disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
      <label className="flex min-h-11 items-start gap-3 text-gray-700"><input className="mt-1 h-4 w-4 shrink-0 accent-green-700" type="checkbox" checked={ack} disabled={busy} onChange={e=>{setAck(e.target.checked);setReviewVersion(e.target.checked?current.version:null);setRotationId('');}}/>ยืนยันเปลี่ยนกุญแจรุ่น {current.version} ของ OA เดิมสำหรับทุกบริษัท และตรวจการรับข้อความหลังบันทึก</label>
      {reviewVersion!==null&&reviewVersion!==current.version&&<p role="status" className="rounded-lg bg-amber-50 p-4 text-amber-900">สถานะเปลี่ยนจากที่ตรวจไว้ หากคำขอก่อนหน้าบันทึกแล้ว การลองซ้ำด้วยข้อมูลเดิมจะอ่านผลเดิมเท่านั้น</p>}
      <Button type="submit" className="!h-auto !min-h-11 !text-base" disabled={!ack} loading={busy}>ตรวจและบันทึกกุญแจ LINE</Button></div>
      <p className="text-sm text-gray-600">หลังบันทึก ให้ทดสอบส่งข้อความเข้า OA แล้วอัปเดตสถานะการรับข้อความ กุญแจจะไม่แสดงคืนและไม่เก็บใน URL หรือ storage ของเบราว์เซอร์</p>
    </form></details></section>}
    <p className="text-sm text-gray-600">หน้านี้ดูแลการรับและส่งข้อความของ OA เดิม ส่วน LINE Login, LIFF และการเปลี่ยน OA ต้องตั้งค่าแยก เพื่อรักษาบัญชีลูกค้าที่ผูกไว้</p>
  </main>;
}

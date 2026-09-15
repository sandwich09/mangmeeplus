'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {PLAN_TIER_PRESETS,type BillingPlanAdjustments,type BillingPlanAdjustmentOperation,type BillingPlanAdjustmentInput,type CompanyPlanCapacity} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorCode,apiErrorMessage} from '@/common/api/api-error-message';
import {statusOf} from '@/common/i18n/error-message.logic';
import {billingControl as button} from '@/features/billing/billing-display';

const field='mt-2 block min-h-11 w-full rounded-lg border border-slate-500 bg-white p-3';
const date=(v:string)=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'});
const state:Record<string,string>={PREVIEW:'ตรวจสิทธิ์ก่อนส่งคำขอ',AWAITING_APPROVAL:'รอผู้อนุมัติอีกคน',SUCCEEDED:'ปรับสิทธิ์แล้ว',CANCELLED:'ยกเลิกคำขอแล้ว'};
const label=(v:CompanyPlanCapacity)=>`${PLAN_TIER_PRESETS[v.tierKey]?.labelTh??'แพ็กเกจ'} · ${v.branchLimit} สาขา · ${v.employeeLimit} ผู้ใช้`;
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing${path}`,{cache:'no-store',suppressErrorToast:true,...body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}},body:JSON.stringify(body)}});
const errors:Record<string,string>={CONTROL_PAID_PLAN_REQUIRED:'หน้านี้ปรับสิทธิ์ชั่วคราวให้แพ็กเกจที่ชำระเงินและยังไม่หมดอายุ กลับไปดูสถานะแพ็กเกจเพื่อดำเนินการต่อ',CONTROL_COMPANY_HELD:'บริษัทถูกพักใช้งาน กรุณาตรวจสถานะบริษัทก่อน',CONTROL_OPERATION_IN_PROGRESS:'มีรายการชำระเงินกำลังดำเนินการ กลับไปตรวจรายการเดิมก่อน',CONTROL_PREVIEW_STALE:'แพ็กเกจหรือจำนวนสาขา/ผู้ใช้เปลี่ยนแล้ว ยกเลิกคำขอเดิมและตรวจข้อมูลล่าสุดอีกครั้ง'};
const message=(error:unknown)=>errors[apiErrorCode(error)??'']??apiErrorMessage(error);

export default function BillingPlanAdjustmentsPage({companyId,operationId}:{companyId?:string;operationId?:string}){
  const router=useRouter(),generation=useRef(0),key=useRef<string|null>(null);
  const [data,setData]=useState<BillingPlanAdjustments|null>(null),[operation,setOperation]=useState<BillingPlanAdjustmentOperation|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [tier,setTier]=useState<'STARTER_249'|'BASIC_499'|'PRO_999'>('PRO_999'),[branches,setBranches]=useState('5'),[members,setMembers]=useState('10');
  const [reason,setReason]=useState(''),[expires,setExpires]=useState(''),[password,setPassword]=useState(''),[cursor,setCursor]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const target=companyId??(operation?.scope.kind==='COMPANY'?operation.scope.companyId:undefined);
  const companyPath=target?`/system/billing/companies/${encodeURIComponent(target)}`:'/system/billing';
  const leaving=()=>{generation.current++;};
  useEffect(()=>{const token=++generation.current;setLoading(true);setBusy(false);setError('');setData(null);setOperation(null);setPassword('');key.current=null;
    const load=operationId?api<BillingPlanAdjustmentOperation>(`/plan-adjustments/${encodeURIComponent(operationId)}`).then(v=>{if(token===generation.current)setOperation(v);}):
      api<BillingPlanAdjustments>(`/companies/${encodeURIComponent(companyId!)}/plan-adjustments${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`).then(v=>{if(token===generation.current)setData(v);});
    load.catch(e=>{if(token===generation.current)setError(message(e));}).finally(()=>{if(token===generation.current)setLoading(false);});return leaving;
  },[companyId,operationId,cursor,refresh]);
  async function preview(revoke=false){
    if(!data||busy)return;if(!reason.trim()){setError('กรุณาระบุเหตุผลที่ปรับสิทธิ์');return;}
    if(!revoke&&![branches,members].every(n=>/^\d{1,10}$/.test(n)&&Number(n)>0&&Number(n)<=2147483647)){setError('กรุณากรอกจำนวนสาขาและผู้ใช้เป็นจำนวนเต็มตั้งแต่ 1');return;}
    const token=generation.current;setBusy(true);setError('');
    try{
      const input:BillingPlanAdjustmentInput=revoke?{type:'REVOKE_OVERRIDE',overrideId:data.current?.temporary?.operationId,sourceHash:data.sourceHash,reason}:
        {type:'GRANT_OVERRIDE',tierKey:tier,branchLimit:Number(branches),employeeLimit:Number(members),expiresAt:expires?new Date(`${expires}+07:00`).toISOString():data.maxExpiresAt!,sourceHash:data.sourceHash,reason};
      const result=await api<BillingPlanAdjustmentOperation>(`/companies/${encodeURIComponent(data.companyId)}/plan-adjustments/preview`,input);
      if(token===generation.current){leaving();router.push(`/system/billing/plan-adjustments/${encodeURIComponent(result.id)}`);}
    }catch(e){if(token===generation.current)setError(message(e));}finally{if(token===generation.current)setBusy(false);}
  }
  async function act(action:'submit'|'approve'|'cancel'|'reauthenticate'){
    if(!operation||!target||busy)return;const token=generation.current;setBusy(true);setError('');setNotice('');
    try{
      if(action==='reauthenticate'){
        await api(`/companies/${encodeURIComponent(target)}/reauthenticate`,{password});if(token===generation.current){setPassword('');setNotice('ยืนยันรหัสผ่านแล้ว ดำเนินการต่อได้ภายใน 5 นาที');}
      }else{
        if(action==='submit')key.current??=crypto.randomUUID();
        const result=await api<BillingPlanAdjustmentOperation>(`/plan-adjustments/${encodeURIComponent(operation.id)}/${action}`,{expectedVersion:operation.version,previewHash:operation.previewHash},action==='submit'?key.current!:undefined);
        if(token===generation.current){setOperation(result);setNotice(state[result.state]??'บันทึกคำขอแล้ว');}
      }
    }catch(e){if(token===generation.current){setError(message(e));if(statusOf(e)===403){setData(null);setOperation(null);}}}finally{if(token===generation.current)setBusy(false);}
  }
  return <main className="mx-auto max-w-3xl space-y-5 p-4 text-base">
    <Link onClick={leaving} className={button} href={companyPath}>กลับไปสถานะแพ็กเกจ</Link><h1 className="text-2xl font-bold">ปรับแพ็กเกจชั่วคราว</h1>
    <p>ปรับแพ็กเกจและจำนวนสาขา/ผู้ใช้ โดยผู้มีสิทธิ์อีกคนตรวจและอนุมัติ ไม่มีการเรียกเก็บเงินจากรายการนี้</p>
    <button className={button} disabled={busy||loading} onClick={()=>{leaving();setData(null);setOperation(null);setLoading(true);setRefresh(n=>n+1);}}>โหลดข้อมูลล่าสุด</button>
    {loading&&<p role="status">กำลังโหลดข้อมูล…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-3">{notice}</p>}
    {(data?.unchanged??operation?.unchanged)&&(()=>{const v=(data?.unchanged??operation?.unchanged)!;return <details className="rounded-xl border p-4"><summary className="min-h-11 cursor-pointer font-semibold">ดูวันใช้งาน ใบเสร็จ และ AI ที่คงเดิม</summary><div className="space-y-2"><p>ใช้งานได้ถึง {date(v.termEndsAt)} · เก็บเงินครั้งถัดไป {v.nextChargeAt?date(v.nextChargeAt):'ยังไม่กำหนด'}</p><p>ใบเสร็จคงเหลือ {v.remainingReceipts} ใบ</p><p>อ่านเอกสารด้วย AI: {v.ocrEnabled?'เปิด':'ปิด'} · จำกัด {v.ocrMonthlyLimit===null?'ตามแพ็กเกจ':`${v.ocrMonthlyLimit} ครั้งต่อเดือน`}</p><p>งบ AI เดือนนี้ {(v.aiBudgetSatang/100).toLocaleString('th-TH')} บาท · ใช้แล้ว {(v.aiUsedSatang/100).toLocaleString('th-TH')} บาท</p></div></details>;})()}
    {data&&<>
      <section className="space-y-3 rounded-xl border p-4"><h2 className="font-bold">{data.companyName}</h2>
        {data.baseline&&<p>แพ็กเกจที่ซื้อ: {label(data.baseline)}</p>}{data.current&&<p>สิทธิ์ขณะนี้: {label(data.current)}</p>}
        {data.current?.temporary&&<p>สิทธิ์ชั่วคราวใช้ได้ถึง {date(data.current.temporary.expiresAt)} เมื่อครบกำหนดจะกลับไปใช้แพ็กเกจที่ซื้ออยู่ล่าสุด</p>}
        <p>ใช้งานอยู่ {data.activeBranches} สาขา · {data.activeMembers} ผู้ใช้ รวมเจ้าของร้าน</p>
        {data.blockedReason&&<p>{errors[data.blockedReason]??'กรุณาตรวจสถานะแพ็กเกจก่อนดำเนินการ'}</p>}
        {data.canCreate&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void preview();}}>
          <label htmlFor="temporary-plan" className="block">แพ็กเกจชั่วคราว</label><select id="temporary-plan" className={field} value={tier} disabled={busy} onChange={e=>{const t=e.target.value as typeof tier;setTier(t);setBranches(String(PLAN_TIER_PRESETS[t].branchLimit));setMembers(String(PLAN_TIER_PRESETS[t].employeeLimit));}}>{(['STARTER_249','BASIC_499','PRO_999'] as const).map(t=><option key={t} value={t}>{PLAN_TIER_PRESETS[t].labelTh}</option>)}</select>
          <label className="block">จำนวนสาขาสูงสุด<input className={field} inputMode="numeric" value={branches} disabled={busy} onChange={e=>setBranches(e.target.value)} maxLength={10}/></label>
          <label className="block">จำนวนผู้ใช้สูงสุด รวมเจ้าของ<input className={field} inputMode="numeric" value={members} disabled={busy} onChange={e=>setMembers(e.target.value)} maxLength={10}/></label>
          <label className="block">ใช้ได้ถึง (เวลาประเทศไทย)<input className={field} type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} disabled={busy}/></label><p>ไม่ระบุวัน: ใช้ได้ถึง {data.maxExpiresAt?date(data.maxExpiresAt):'วันหมดอายุแพ็กเกจปัจจุบัน'}</p>
          <div><label className="block" htmlFor="plan-adjustment-reason">เหตุผลที่ปรับสิทธิ์</label><textarea id="plan-adjustment-reason" className={`${field} min-h-24`} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></div>
          <p>หากลดต่ำกว่าจำนวนที่ใช้อยู่ ข้อมูลและผู้ใช้เดิมยังอยู่ครบ ระบบจะจำกัดการเพิ่มใหม่ตามเพดาน การซื้อแพ็กเกจเพิ่มจะไม่ยืดอายุสิทธิ์ชั่วคราวนี้</p>
          <button className={button} disabled={busy}>ตรวจสิทธิ์ก่อนส่งคำขอ</button>{data.current?.temporary&&<button type="button" className={button} disabled={busy} onClick={()=>void preview(true)}>ขอคืนสิทธิ์ตามแพ็กเกจที่ซื้อ</button>}
        </form>}
      </section>
      <section className="space-y-3" aria-label="ประวัติการปรับแพ็กเกจ"><h2 className="font-bold">ประวัติคำขอและผู้แก้</h2>{!data.items.length&&<p>ยังไม่มีคำขอ</p>}
        {data.items.map(item=><article key={item.id} className="space-y-2 rounded-xl border p-4"><Link onClick={leaving} className="block min-h-11 underline" href={`/system/billing/plan-adjustments/${encodeURIComponent(item.id)}`}>{item.type==='GRANT_OVERRIDE'?'ปรับสิทธิ์ชั่วคราว':'คืนสิทธิ์ตามแพ็กเกจที่ซื้อ'} · {state[item.state]??'ต้องตรวจสอบ'}</Link>
          <p>จาก {label(item.before)}</p><p>เป็น {label(item.after)}</p><p>ผู้ขอ: {item.requesterName??'ไม่พบชื่อ'} · {date(item.createdAt)}</p><p>ผู้อนุมัติ: {item.approverName??'ยังไม่มี'}</p><p>เหตุผล: {item.reason}</p>
        </article>)}
        <div className="flex flex-wrap gap-3">{cursor&&<button className={button} disabled={busy} onClick={()=>{leaving();setData(null);setLoading(true);setCursor(null);}}>กลับหน้าแรก</button>}{data.nextCursor&&<button className={button} disabled={busy} onClick={()=>{leaving();setLoading(true);setCursor(data.nextCursor);setData(null);}}>ประวัติหน้าถัดไป</button>}</div>
      </section>
    </>}
    {operation&&<>
      <section className="space-y-3 rounded-xl border p-4" aria-label="ผลกระทบการปรับแพ็กเกจ"><h2 className="font-bold">{state[operation.state]??'ต้องตรวจสอบคำขอ'}</h2><p>{operation.companyName}</p>
        <p>จาก {label(operation.before)}</p><p>เป็น {label(operation.after)}</p><p>{operation.overrideExpiresAt?`สิทธิ์ชั่วคราวใช้ได้ถึง ${date(operation.overrideExpiresAt)}`:'คืนสิทธิ์ตามแพ็กเกจที่ซื้อเมื่ออนุมัติ'}</p>
        <p>ตอนตรวจคำขอ มี {operation.activeBranches} สาขา · {operation.activeMembers} ผู้ใช้</p>
        {(operation.activeBranches>operation.after.branchLimit||operation.activeMembers>operation.after.employeeLimit)&&<p className="rounded-lg bg-amber-50 p-3">จำนวนที่ใช้อยู่เกินเพดานใหม่ รายการเดิมยังใช้งานได้ แต่จะเพิ่มใหม่ไม่ได้ในส่วนที่เต็มแล้ว</p>}
        <p>ผู้ขอ: {operation.requesterName??'ไม่พบชื่อ'} · ผู้อนุมัติ: {operation.approverName??'ยังไม่มี'}</p><p>เหตุผล: {operation.reason}</p>
        <p>จำนวนใบเสร็จ งบ AI วันหมดอายุการใช้งาน และวันเก็บเงินคงเดิม ไม่มีใบเสร็จรับเงินใหม่จากรายการนี้</p>
        {operation.state==='SUCCEEDED'&&operation.current&&<p>สิทธิ์ปัจจุบัน: {label(operation.current)}{operation.current.temporary?` ถึง ${date(operation.current.temporary.expiresAt)}`:' ตามแพ็กเกจที่ซื้อ'}</p>}
        {['PREVIEW','AWAITING_APPROVAL'].includes(operation.state)&&Date.parse(operation.expiresAt)<=Date.now()&&<p>คำขอนี้หมดเวลาตรวจแล้ว กลับไปประวัติและสร้างคำขอใหม่จากข้อมูลล่าสุด</p>}
        {!operation.current&&<p>ยังไม่พบแพ็กเกจปัจจุบัน ประวัติคำขอนี้ยังเก็บไว้</p>}
        {operation.state==='AWAITING_APPROVAL'&&<p>เปิดลิงก์คำขอนี้ให้ผู้มีสิทธิ์อีกคนตรวจ ผู้ขออนุมัติรายการตัวเองไม่ได้</p>}
        {operation.referenceId&&<Link onClick={leaving} className={button} href={`/system/billing/plan-adjustments/${encodeURIComponent(operation.referenceId)}`}>ดูสิทธิ์ชั่วคราวรายการก่อน</Link>}
        <Link className={button} href={`/system/billing/plan-adjustments/${encodeURIComponent(operation.id)}`}>เปิดลิงก์คำขอนี้</Link>
      </section>
      {!!operation.allowedActions.length&&<section className="space-y-3 rounded-xl border p-4"><h2 className="font-bold">ยืนยันตัวตนก่อนดำเนินการ</h2>
        <form onSubmit={e=>{e.preventDefault();void act('reauthenticate');}} className="space-y-3"><label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" maxLength={1024} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label><button className={button} disabled={busy||!password}>ยืนยันรหัสผ่าน</button><Link onClick={leaving} className={button} href="/forgot-password">กู้รหัสผ่าน</Link></form>
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action=><button key={action} className={button} disabled={busy} onClick={()=>void act(action)}>{({submit:'ส่งคำขอให้ผู้อนุมัติ',approve:'อนุมัติและปรับสิทธิ์',cancel:'ยกเลิกคำขอ'})[action]}</button>)}</div>
      </section>}
      <Link onClick={leaving} className={button} href={`${companyPath}/plan-adjustments`}>กลับไปประวัติการปรับแพ็กเกจ</Link>
    </>}
  </main>;
}

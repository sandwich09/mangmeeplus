'use client';
import BillingDateTimeField from './BillingDateTimeField';
import { billingTimeIso } from './billing-date-time';
import { billingLink, billingField } from '../billing/billing-display';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {PLAN_TIER_PRESETS,type BillingPlanAdjustments,type BillingPlanAdjustmentOperation,type BillingPlanAdjustmentInput,type CompanyPlanCapacity} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorCode,apiErrorMessage} from '@/common/api/api-error-message';
import {statusOf} from '@/common/i18n/error-message.logic';
import {billingApprovalLabel, billingControl as button} from '@/features/billing/billing-display';

const field=billingField;
const date=(v:string)=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'});
const state:Record<string,string>={QUEUED:'รอปรับวันกับ Stripe',RUNNING:'กำลังตรวจตารางต่ออายุ',UNKNOWN:'ยังยืนยันผลไม่ได้ โหลดสถานะรายการเดิมเพื่อตรวจอีกครั้ง',BLOCKED:'ต้องตรวจสถานะก่อนดำเนินการ',PREVIEW:'ตรวจสิทธิ์ก่อนส่งคำขอ',AWAITING_APPROVAL:'รอยืนยันรายการ',SUCCEEDED:'ปรับสิทธิ์แล้ว',CANCELLED:'ยกเลิกคำขอแล้ว'};
const label=(v:CompanyPlanCapacity)=>`${PLAN_TIER_PRESETS[v.tierKey]?.labelTh??'แพ็กเกจ'} · ${v.branchLimit} สาขา · ${v.employeeLimit} ผู้ใช้`;
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing${path}`,{cache:'no-store',suppressErrorToast:true,...body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}},body:JSON.stringify(body)}});
const errors:Record<string,string>={CONTROL_COLLECTION_REVIEW:'ข้อมูลการเก็บเงินเปลี่ยนหรือยังยืนยันไม่ได้ ตรวจรายการเดิมและวันกลับมาเก็บเงิน แล้วโหลดข้อมูลล่าสุด',CONTROL_PAID_PLAN_REQUIRED:'ต้องมีแพ็กเกจที่ชำระเงินแล้วและยังไม่หมดอายุก่อน หากลูกค้าจ่ายแล้ว ให้ตรวจรายการชำระเงินและเปิดแพ็กเกจให้เรียบร้อย',CONTROL_COMPANY_HELD:'บริษัทถูกพักใช้งาน กรุณาตรวจสถานะบริษัทก่อน',CONTROL_OPERATION_IN_PROGRESS:'มีรายการชำระเงินกำลังดำเนินการ กลับไปตรวจรายการเดิมก่อน',CONTROL_FREE_DAYS_REVIEW:'ตรวจรายการต่ออายุเดิมให้เสร็จก่อน แล้วกลับมาลองรายการวันแถมอีกครั้ง',CONTROL_PREVIEW_STALE:'แพ็กเกจหรือจำนวนสาขา/ผู้ใช้เปลี่ยนแล้ว ยกเลิกคำขอเดิมและตรวจข้อมูลล่าสุดอีกครั้ง'};
const message=(error:unknown)=>errors[apiErrorCode(error)??'']??apiErrorMessage(error);

export default function BillingPlanAdjustmentsPage({companyId,operationId}:{companyId?:string;operationId?:string}){
  const [task,setTask]=useState('');
  const [collectionAction,setCollectionAction]=useState<'PAUSE'|'RESUME'>('PAUSE'),[resumesAt,setResumesAt]=useState('');
  const router=useRouter(),generation=useRef(0),key=useRef<string|null>(null);
  const [data,setData]=useState<BillingPlanAdjustments|null>(null),[operation,setOperation]=useState<BillingPlanAdjustmentOperation|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [tier,setTier]=useState<'STARTER_249'|'BASIC_499'|'PRO_999'>('PRO_999'),[branches,setBranches]=useState('5'),[members,setMembers]=useState('10'),[days,setDays]=useState('7');
  const [reason,setReason]=useState(''),[expires,setExpires]=useState(''),[password,setPassword]=useState(''),[cursor,setCursor]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const target=companyId??(operation?.scope.kind==='COMPANY'?operation.scope.companyId:undefined);
  const companyPath=target?`/system/billing/companies/${encodeURIComponent(target)}`:'/system/billing';
  const leaving=()=>{generation.current++;};
  useEffect(()=>{const token=++generation.current;setLoading(true);setBusy(false);setError('');setData(null);setOperation(null);setPassword('');key.current=null;
    const load=operationId?api<BillingPlanAdjustmentOperation>(`/plan-adjustments/${encodeURIComponent(operationId)}`).then(v=>{if(token===generation.current)setOperation(v);}):
      api<BillingPlanAdjustments>(`/companies/${encodeURIComponent(companyId!)}/plan-adjustments${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`).then(v=>{if(token===generation.current)setData(v);});
    load.catch(e=>{if(token===generation.current)setError(message(e));}).finally(()=>{if(token===generation.current)setLoading(false);});return leaving;
  },[companyId,operationId,cursor,refresh]);
  async function preview(revoke=false,gift=false){
    if(!data||busy)return;if(!reason.trim()){setError('กรุณาระบุเหตุผลที่ปรับสิทธิ์');return;}
    if(!revoke&&!gift&&![branches,members].every(n=>/^\d{1,10}$/.test(n)&&Number(n)>0&&Number(n)<=2147483647)){setError('กรุณากรอกจำนวนสาขาและผู้ใช้เป็นจำนวนเต็มตั้งแต่ 1');return;}
    if(gift&&(!/^\d{1,4}$/.test(days)||Number(days)<1||Number(days)>3650)){setError('กรอกวันแถมเป็นจำนวนเต็มตั้งแต่ 1 ถึง 3,650');return;}
    if(!revoke&&!gift&&expires&&!billingTimeIso(expires)){setError('ระบุวันที่และเวลาสิ้นสุดให้ครบ เช่น 09:00');return;}
    const token=generation.current;setBusy(true);setError('');
    try{
      const input:BillingPlanAdjustmentInput=gift?{type:'GRANT_FREE_DAYS',days:Number(days),sourceHash:data.sourceHash,reason}:revoke?{type:'REVOKE_OVERRIDE',overrideId:data.current?.temporary?.operationId,sourceHash:data.sourceHash,reason}:
        {type:'GRANT_OVERRIDE',tierKey:tier,branchLimit:Number(branches),employeeLimit:Number(members),expiresAt:expires?billingTimeIso(expires)!:data.maxExpiresAt!,sourceHash:data.sourceHash,reason};
      const result=await api<BillingPlanAdjustmentOperation>(`/companies/${encodeURIComponent(data.companyId)}/plan-adjustments/preview`,input);
      if(token===generation.current){leaving();router.push(`/system/billing/plan-adjustments/${encodeURIComponent(result.id)}`);}
    }catch(e){if(token===generation.current)setError(message(e));}finally{if(token===generation.current)setBusy(false);}
  }
  async function previewCollection(){
    if(!data||busy)return;
    if(!reason.trim()||(collectionAction==='PAUSE'&&!billingTimeIso(resumesAt))){setError('ระบุเหตุผลและวันกลับมาเก็บเงินให้ครบ');return;}
    const token=generation.current;setBusy(true);setError('');
    try{
      const input:BillingPlanAdjustmentInput={type:'CHANGE_COLLECTION',collectionAction,sourceHash:data.sourceHash,reason,
        ...(collectionAction==='PAUSE'?{resumesAt:billingTimeIso(resumesAt)!}:{})};
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
  const refreshControl=<button className="min-h-11 px-2 text-sm text-gray-600 underline" disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>{leaving();setData(null);setOperation(null);setLoading(true);setRefresh(n=>n+1);}}>อัปเดตสถานะ</button>;
  return <main className="mx-auto max-w-4xl space-y-5 p-4 text-base sm:p-8">
    <Link onClick={leaving} className={billingLink} href={companyPath}>กลับข้อมูลบริษัท</Link><h1 className="text-2xl font-bold">{operation?.collectionChange?'พักหรือกลับมาเก็บเงิน':operation?.dayExtension?'แถมวันใช้งาน':operationId?'ปรับแพ็กเกจชั่วคราว':'ดูแลแพ็กเกจและการเก็บเงิน'}</h1>
    <p>{operation?.collectionChange?'ปรับการเก็บเงินของบริษัทนี้ โดยตรวจผลกระทบและยืนยันก่อน':operation?.dayExtension?'เพิ่มวันใช้งานและเลื่อนวันเก็บเงิน โดยตรวจผลกระทบและยืนยันก่อน':operationId?'ปรับแพ็กเกจและจำนวนสาขา/ผู้ใช้ โดยตรวจผลกระทบและยืนยันก่อน ไม่มีการเรียกเก็บเงินจากรายการนี้':data?.blockedReason?'ตรวจสถานะแพ็กเกจด้านล่างเพื่อดูว่าต้องดำเนินการอะไรต่อ':'เลือกงานที่ต้องการและระบุเหตุผล ระบบจะแสดงผลกระทบให้ตรวจก่อนส่งคำขอ'}</p>

    {loading&&<p role="status">กำลังโหลดข้อมูล…</p>}{error&&<div role="alert" className="space-y-3 rounded-lg bg-red-50 p-3 text-red-800"><p>{error}</p>{refreshControl}</div>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-3">{notice}</p>}
    {(data?.unchanged??operation?.unchanged)&&(()=>{const v=(data?.unchanged??operation?.unchanged)!;return <details className="rounded-xl border border-gray-200 p-4 bg-white"><summary className="min-h-11 cursor-pointer font-semibold">{operation?.dayExtension?'ดูวันใช้งาน ใบเสร็จ และ AI ปัจจุบัน':'ดูวันใช้งาน ใบเสร็จ และ AI ที่คงเดิม'}</summary><div className="space-y-2"><p>ใช้งานได้ถึง {date(v.termEndsAt)} · เก็บเงินครั้งถัดไป {v.nextChargeAt?date(v.nextChargeAt):'ยังไม่กำหนด'}</p><p>ใบเสร็จคงเหลือ {v.remainingReceipts} ใบ</p><p>อ่านเอกสารด้วย AI: {v.ocrEnabled?'เปิด':'ปิด'} · จำกัด {v.ocrMonthlyLimit===null?'ตามแพ็กเกจ':`${v.ocrMonthlyLimit} ครั้งต่อเดือน`}</p><p>งบ AI เดือนนี้ {(v.aiBudgetSatang/100).toLocaleString('th-TH')} บาท · ใช้แล้ว {(v.aiUsedSatang/100).toLocaleString('th-TH')} บาท</p></div></details>;})()}
    {data&&<>
      <section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">{data.companyName}</h2>{refreshControl}</div>
        {data.baseline&&<p>แพ็กเกจที่ซื้อ: {label(data.baseline)}</p>}{data.current&&<p>สิทธิ์ขณะนี้: {label(data.current)}</p>}
        {data.current?.temporary&&<p>สิทธิ์ชั่วคราวใช้ได้ถึง {date(data.current.temporary.expiresAt)} เมื่อครบกำหนดจะกลับไปใช้แพ็กเกจที่ซื้ออยู่ล่าสุด</p>}
        <p>ใช้งานอยู่ {data.activeBranches} สาขา · {data.activeMembers} ผู้ใช้ รวมเจ้าของร้าน</p>
        {data.blockedReason&&<div className="space-y-3 border-t border-gray-100 pt-4"><h3 className="font-semibold">{data.blockedReason==='CONTROL_PAID_PLAN_REQUIRED'?'ยังไม่มีแพ็กเกจที่พร้อมปรับสิทธิ์':'ยังปรับรายการนี้ไม่ได้'}</h3><p className="text-gray-600">{errors[data.blockedReason]??'กรุณาตรวจสถานะแพ็กเกจก่อนดำเนินการ'}</p><Link className={billingLink} href={`${companyPath}?view=payments`}>ตรวจรายการชำระเงินของบริษัท</Link></div>}
        {(data.canCreate||data.canManageCollection)&&<div className="border-t border-gray-100 pt-4"><label htmlFor="billing-plan-task" className="mb-2 block font-medium">ต้องการทำอะไร</label><ThemedSelect aria-label="ต้องการทำอะไร" id="billing-plan-task" className={field} value={task} disabled={busy} onChange={e=>setTask(e.target.value)}><option value="">เลือกงานที่ต้องการ</option>{data.canCreate&&<><option value="plan">ปรับแพ็กเกจชั่วคราว</option><option value="days">เพิ่มวันใช้งาน</option></>}{data.canManageCollection&&<option value="collection">พักหรือกลับมาเก็บเงิน</option>}</ThemedSelect><p className="mt-2 text-sm text-gray-600">เลือกหนึ่งงาน กรอกข้อมูล แล้วตรวจผลกระทบก่อนยืนยัน</p></div>}
        {data.canCreate&&<form hidden={task!=='plan'} className="space-y-3" onSubmit={e=>{e.preventDefault();void preview();}}>
          <label htmlFor="temporary-plan" className="block">แพ็กเกจชั่วคราว</label><ThemedSelect aria-label="แพ็กเกจชั่วคราว" id="temporary-plan" className={field} value={tier} disabled={busy} onChange={e=>{const t=e.target.value as typeof tier;setTier(t);setBranches(String(PLAN_TIER_PRESETS[t].branchLimit));setMembers(String(PLAN_TIER_PRESETS[t].employeeLimit));}}>{(['STARTER_249','BASIC_499','PRO_999'] as const).map(t=><option key={t} value={t}>{PLAN_TIER_PRESETS[t].labelTh}</option>)}</ThemedSelect>
          <label className="block">จำนวนสาขาสูงสุด<input className={field} inputMode="numeric" value={branches} disabled={busy} onChange={e=>setBranches(e.target.value)} maxLength={10}/></label>
          <label className="block">จำนวนผู้ใช้สูงสุด รวมเจ้าของ<input className={field} inputMode="numeric" value={members} disabled={busy} onChange={e=>setMembers(e.target.value)} maxLength={10}/></label>
          <BillingDateTimeField label="สิทธิ์ชั่วคราวสิ้นสุดเมื่อ" value={expires} onChange={setExpires} disabled={busy}/><p>ไม่ระบุวัน: ใช้ได้ถึง {data.maxExpiresAt?date(data.maxExpiresAt):'วันหมดอายุแพ็กเกจปัจจุบัน'}</p>
          <div><label className="block" htmlFor="plan-adjustment-reason">เหตุผลที่ปรับสิทธิ์</label><textarea id="plan-adjustment-reason" className={`${field} min-h-24`} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></div>
          <p>หากลดต่ำกว่าจำนวนที่ใช้อยู่ ข้อมูลและผู้ใช้เดิมยังอยู่ครบ ระบบจะจำกัดการเพิ่มใหม่ตามเพดาน การซื้อแพ็กเกจเพิ่มจะไม่ยืดอายุสิทธิ์ชั่วคราวนี้</p>
          <button className={button} disabled={busy} aria-busy={Boolean(busy)}>ตรวจสิทธิ์ก่อนส่งคำขอ</button>{data.current?.temporary&&<button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void preview(true)}>ขอคืนสิทธิ์ตามแพ็กเกจที่ซื้อ</button>}
        </form>}
      </section>
      {data.canCreate&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="แถมวันใช้งาน" hidden={task!=='days'}><h2 className="font-bold">แถมวันใช้งาน</h2>
        <p>เพิ่มวันใช้งานและเลื่อนวันเก็บเงินเท่ากัน โดยไม่เพิ่มใบเสร็จหรืองบ AI หากลูกค้าหยุดต่ออายุไว้ ระบบจะคงการหยุดไว้</p>
        <label htmlFor="gift-days" className="block">จำนวนวันแถม</label><input id="gift-days" className={field} type="text" inputMode="numeric" value={days} disabled={busy} onChange={e=>setDays(e.target.value)}/>
        <label htmlFor="gift-days-reason" className="block">เหตุผลที่แถมวัน</label><textarea id="gift-days-reason" className={field} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/>
        <button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void preview(false,true)}>ตรวจวันใช้งานก่อนส่งคำขอ</button>
      </section>}
      {data.canManageCollection&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="พักหรือกลับมาเก็บเงิน" hidden={task!=='collection'}><h2 className="font-bold">พักหรือกลับมาเก็บเงิน</h2>
        <p>พักการเก็บเงินโดยเก็บบิลใหม่เป็นฉบับร่าง บิลเดิมอาจยังถูกเรียกเก็บ วันใช้งานและโควตาไม่เพิ่ม</p>
        <p>สถานะที่ตรวจล่าสุด: {data.collectionPause?'พักเก็บเงินอยู่':'ไม่มีรายการพักเก็บเงิน'}</p>
        <label htmlFor="collection-action" className="block">รายการที่ต้องการ</label><ThemedSelect aria-label="รายการที่ต้องการ" id="collection-action" className={field} value={collectionAction} disabled={busy} onChange={e=>setCollectionAction(e.target.value as 'PAUSE'|'RESUME')}><option value="PAUSE">พักเก็บเงิน</option><option value="RESUME">กลับมาเก็บเงิน</option></ThemedSelect>
        {collectionAction==='PAUSE'&&<><BillingDateTimeField label="กลับมาเก็บเงินเมื่อ" value={resumesAt} onChange={setResumesAt} disabled={busy}/><p>ล่วงหน้าอย่างน้อย 10 นาที และไม่เกิน 365 วัน</p></>}
        <label htmlFor="collection-reason" className="block">เหตุผลที่ปรับการเก็บเงิน</label><textarea id="collection-reason" className={field} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/>
        <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void previewCollection()}>ตรวจผลต่อบิลก่อนส่งคำขอ</button>
      </section>}
      <details className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-label="ประวัติการปรับแพ็กเกจ"><summary className="min-h-11 cursor-pointer py-2 font-semibold">ประวัติคำขอและผู้แก้</summary>{!data.items.length&&<p>ยังไม่มีคำขอ</p>}
        {data.items.map(item=><article key={item.id} className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white"><Link onClick={leaving} className="block min-h-11 underline" href={`/system/billing/plan-adjustments/${encodeURIComponent(item.id)}`}>{item.type==='CHANGE_COLLECTION'?'ปรับการเก็บเงิน':item.type==='GRANT_FREE_DAYS'?'แถมวันใช้งาน':item.type==='GRANT_OVERRIDE'?'ปรับสิทธิ์ชั่วคราว':'คืนสิทธิ์ตามแพ็กเกจที่ซื้อ'} · {item.collectionChange?(item.state==='SUCCEEDED'?'ยืนยันการปรับเก็บเงินแล้ว':['QUEUED','RUNNING'].includes(item.state)?'รอตรวจการเก็บเงิน':state[item.state]??'ต้องตรวจสอบ'):item.dayExtension&&item.state==='SUCCEEDED'?'เพิ่มวันใช้งานแล้ว':state[item.state]??'ต้องตรวจสอบ'}</Link>
          <p>จาก {label(item.before)}</p>{item.dayExtension&&<p>แถม {item.dayExtension.days} วัน · จาก {date(item.dayExtension.before)} ถึง {date(item.dayExtension.after)}</p>}<p>เป็น {label(item.after)}</p><p>ผู้ขอ: {item.requesterName??'ไม่พบชื่อ'} · {date(item.createdAt)}</p><p>ผู้อนุมัติ: {item.approverName??'ยังไม่มี'}</p>{item.approvalMode&&<p>{billingApprovalLabel(item.approvalMode)}</p>}<p>เหตุผล: {item.reason}</p>
        </article>)}
        <div className="flex flex-wrap gap-3">{cursor&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>{leaving();setData(null);setLoading(true);setCursor(null);}}>กลับหน้าแรก</button>}{data.nextCursor&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>{leaving();setLoading(true);setCursor(data.nextCursor);setData(null);}}>ประวัติหน้าถัดไป</button>}</div>
      </details>
    </>}
    {operation&&<>
      <section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="ผลกระทบการปรับแพ็กเกจ">{refreshControl}<h2 className="font-bold">{operation.collectionChange&&operation.state==='SUCCEEDED'?'ยืนยันการปรับเก็บเงินแล้ว':operation.collectionChange&&['QUEUED','RUNNING'].includes(operation.state)?'รอตรวจการเก็บเงินกับ Stripe':operation.dayExtension&&operation.state==='SUCCEEDED'?'เพิ่มวันใช้งานแล้ว':state[operation.state]??'ต้องตรวจสอบคำขอ'}</h2><p>{operation.companyName}</p>
        {!operation.dayExtension&&!operation.collectionChange&&<><p>จาก {label(operation.before)}</p><p>เป็น {label(operation.after)}</p></>}<p>{operation.collectionChange?'คำขอนี้ไม่เปลี่ยนแพ็กเกจหรือวันหมดอายุ':operation.dayExtension?`แถม ${operation.dayExtension.days} วัน จาก ${date(operation.dayExtension.before)} ถึง ${date(operation.dayExtension.after)}`:operation.overrideExpiresAt?`สิทธิ์ชั่วคราวใช้ได้ถึง ${date(operation.overrideExpiresAt)}`:'คืนสิทธิ์ตามแพ็กเกจที่ซื้อเมื่ออนุมัติ'}</p>
        {!operation.dayExtension&&!operation.collectionChange&&<p>ตอนตรวจคำขอ มี {operation.activeBranches} สาขา · {operation.activeMembers} ผู้ใช้</p>}
        {!operation.dayExtension&&!operation.collectionChange&&(operation.activeBranches>operation.after.branchLimit||operation.activeMembers>operation.after.employeeLimit)&&<p className="rounded-lg bg-amber-50 p-3">จำนวนที่ใช้อยู่เกินเพดานใหม่ รายการเดิมยังใช้งานได้ แต่จะเพิ่มใหม่ไม่ได้ในส่วนที่เต็มแล้ว</p>}
        <p>ผู้ขอ: {operation.requesterName??'ไม่พบชื่อ'} · ผู้อนุมัติ: {operation.approverName??'ยังไม่มี'}</p><p>เหตุผล: {operation.reason}</p>
        {operation.collectionChange&&<div className="space-y-2"><p>ขอ{operation.collectionChange.action==='PAUSE'?'พักเก็บเงิน':'กลับมาเก็บเงิน'}</p>
          <p>ก่อนปรับ: {operation.collectionChange.before?`พักเก็บเงิน ${operation.collectionChange.before.resumesAt?`ถึง ${date(operation.collectionChange.before.resumesAt)}`:'โดยไม่กำหนดวันกลับ'}`:'เก็บเงินตามรอบ'}</p>
          <p>กำหนดกลับมาเก็บเงิน: {operation.collectionChange.after?.resumesAt?date(operation.collectionChange.after.resumesAt):'เมื่อระบบยืนยันคำสั่งนี้'}</p>
          <p>บิลเดิมที่ยังเปิด {operation.collectionChange.openInvoices} รายการ · บิลร่าง {operation.collectionChange.draftInvoices} รายการ · ยอดคงเหลือรวม {(operation.collectionChange.outstandingSatang/100).toLocaleString('th-TH')} บาท</p>
          <p>บิลก่อนพักอาจยังถูกเรียกเก็บ การกลับมาเก็บเงินไม่เรียกเก็บบิลร่างย้อนหลัง ให้ตรวจบิลเดิมแยกจากคำขอนี้</p>
          <p>วันใช้งาน โควตา และกำหนดพักบริการเมื่อค้างชำระคงเดิม {operation.collectionChange.graceEndsAt?`กำหนดพักบริการ ${date(operation.collectionChange.graceEndsAt)}`:''} {operation.collectionChange.cancelAtPeriodEnd?'ลูกค้าหยุดต่ออายุไว้แล้ว คำขอนี้ไม่เปิดต่ออายุแทนลูกค้า':''}</p>
          <Link className={button} href={companyPath}>ดูสถานะบริษัทและตรวจบิลเดิม</Link>
        </div>}
        {operation.dayExtension?<div className="space-y-2"><p>วันเก็บเงินถัดไป: {operation.dayExtension.nextChargeBefore?date(operation.dayExtension.nextChargeBefore):'หยุดต่ออายุไว้'} → {operation.dayExtension.nextChargeAfter?date(operation.dayExtension.nextChargeAfter):'ยังคงหยุดต่ออายุ'}</p><p>ไม่เพิ่มใบเสร็จหรืองบ AI และไม่เรียกเก็บเงินจากรายการนี้ {operation.state==='SUCCEEDED'?'เพิ่มวันใช้งานเรียบร้อยแล้ว':'วันใช้งานจะเพิ่มเมื่อระบบยืนยันผลสำเร็จ'}</p></div>:operation.collectionChange?<p>รายการนี้ไม่ตัดเงินทันที และไม่ออกใบเสร็จรับเงินใหม่</p>:<p>จำนวนใบเสร็จ งบ AI วันหมดอายุการใช้งาน และวันเก็บเงินคงเดิม ไม่มีใบเสร็จรับเงินใหม่จากรายการนี้</p>}
        {operation.state==='SUCCEEDED'&&!operation.dayExtension&&!operation.collectionChange&&operation.current&&<p>สิทธิ์ปัจจุบัน: {label(operation.current)}{operation.current.temporary?` ถึง ${date(operation.current.temporary.expiresAt)}`:' ตามแพ็กเกจที่ซื้อ'}</p>}
        {['PREVIEW','AWAITING_APPROVAL'].includes(operation.state)&&Date.parse(operation.expiresAt)<=Date.now()&&<p>คำขอนี้หมดเวลาตรวจแล้ว กลับไปประวัติและสร้างคำขอใหม่จากข้อมูลล่าสุด</p>}
        {!operation.current&&<p>ยังไม่พบแพ็กเกจปัจจุบัน ประวัติคำขอนี้ยังเก็บไว้</p>}
        {operation.approvalMode&&<p>{billingApprovalLabel(operation.approvalMode)}</p>}
        {operation.state==='AWAITING_APPROVAL'&&<p>{operation.allowedActions.includes('approve')?'ตรวจข้อมูลและยืนยันรหัสผ่าน แล้วกดอนุมัติรายการนี้':'ให้ผู้ดูแลระบบหรือผู้มีสิทธิ์อีกคนเปิดลิงก์คำขอนี้เพื่อตรวจและอนุมัติ'}</p>}
        {!operation.dayExtension&&!operation.collectionChange&&operation.referenceId&&<Link onClick={leaving} className={button} href={`/system/billing/plan-adjustments/${encodeURIComponent(operation.referenceId)}`}>ดูสิทธิ์ชั่วคราวรายการก่อน</Link>}
      </section>
      {!!operation.allowedActions.length&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">ยืนยันตัวตนก่อนดำเนินการ</h2><p>ยืนยันครั้งเดียวใช้ได้ 5 นาที หากยืนยันแล้ว กดดำเนินการต่อได้เลย</p>
        <form onSubmit={e=>{e.preventDefault();void act('reauthenticate');}} className="space-y-3"><label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" maxLength={1024} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label><button className={button} disabled={busy||!password} aria-busy={Boolean(busy)}>ยืนยันรหัสผ่าน</button><Link onClick={leaving} className={button} href="/forgot-password">กู้รหัสผ่าน</Link></form>
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action=><button key={action} className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act(action)}>{({submit:'บันทึกคำขอก่อนยืนยัน',approve:operation.collectionChange?'อนุมัติปรับการเก็บเงิน':'อนุมัติและปรับสิทธิ์',cancel:'ยกเลิกคำขอ'})[action]}</button>)}</div>
      </section>}
      <Link onClick={leaving} className={button} href={`${companyPath}/plan-adjustments`}>กลับไปประวัติการปรับแพ็กเกจ</Link>
    </>}
  </main>;
}

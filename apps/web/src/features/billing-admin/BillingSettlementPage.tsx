'use client';
import BillingDateTimeField from './BillingDateTimeField';
import { billingCompletedDays, billingTimeIso } from './billing-date-time';
import { billingPrimaryControl } from '../billing/billing-display';
import { billingLink, billingLeavesPage, billingControl, billingLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import type {BillingSettlementRun,BillingSettlementFindings} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorCode,apiErrorMessage} from '@/common/api/api-error-message';
const label=(labels:Record<string,string>,value:string,fallback:string)=>Object.hasOwn(labels,value)?labels[value]!:fallback;
const base='/system/billing/settlements',button=billingControl;
const time=(v:string|null)=>v?formatThaiDateTime(v):'ยังไม่มี';
const money=(v:string|number)=>{const n=BigInt(v),a=n<0n?-n:n;return `${n<0n?'-':''}฿${(a/100n).toLocaleString('th-TH')}.${String(a%100n).padStart(2,'0')}`;};
const states:Record<string,string>={QUEUED:'รอตรวจยอด',RUNNING:'กำลังตรวจยอด',SUCCEEDED:'ตรวจครบช่วงที่เลือกแล้ว',CANCELLED:'ยกเลิกการตรวจครั้งนี้แล้ว',BLOCKED:'ยังตรวจยอดไม่สำเร็จ',UNKNOWN:'ยังยืนยันผลตรวจไม่ได้'};
const classes:Record<string,string>={MATCHED:'ข้อมูลตรงกัน',DIFFERENT:'ข้อมูลต่างกัน ต้องตรวจ',LOCAL_MISSING:'ยังไม่พบใบแจ้งหนี้ในระบบ',MANUAL:'ต้องตรวจแยก'};
const kinds:Record<string,string>={charge:'ยอดชำระ',refund:'คืนเงิน',payout:'โอนออกจาก Stripe',payout_failure:'คืนยอดโอนที่ไม่สำเร็จ',payout_cancel:'คืนยอดโอนที่ยกเลิก',stripe_fee:'ค่าธรรมเนียม Stripe'};
const refundStates:Record<string,string>={pending:'รอคืนเงิน',requires_action:'ต้องดำเนินการก่อนคืนเงิน',succeeded:'Stripe คืนเงินสำเร็จ',failed:'คืนเงินไม่สำเร็จ',canceled:'ยกเลิกการคืนเงิน'};
const payoutStates:Record<string,string>={paid:'Stripe แจ้งว่าโอนแล้ว',pending:'Stripe ยังไม่เริ่มโอน',in_transit:'กำลังโอน',failed:'โอนไม่สำเร็จ',canceled:'ยกเลิกการโอน'};
const checks:Record<string,string>={MATCHED:'ยอดรายการที่รวมในรอบโอนตรงกัน',PENDING:'ยังตรวจยอดรวมรอบโอนไม่ได้',MANUAL:'ตรวจรอบนี้ในรายงาน Stripe',INCOMPLETE:'รายการในรอบโอนยังตรวจไม่ครบ',FAILED:'ต้องติดตามยอดโอนที่ไม่สำเร็จหรือยกเลิก'};
const errors:Record<string,string>={CONTROL_PERMISSION_CHANGED:'สิทธิ์ผู้เริ่มงานเปลี่ยนแล้ว ให้ผู้มีสิทธิ์เริ่มงานใหม่',PAGE_LIMIT_REACHED:'รายการมากเกินรอบตรวจนี้ ให้เริ่มงานใหม่โดยแบ่งช่วงวันให้สั้นลง',SETTLEMENT_SOURCE_REVIEW:'ระบบยังยืนยันข้อมูลจาก Stripe ไม่ได้ ให้ตรวจการเชื่อมต่อและข้อมูลบัญชีก่อนลองใหม่',SETTLEMENT_PROVIDER_UNAVAILABLE:'ยังอ่านข้อมูลจาก Stripe ได้ไม่ครบ ต้องตรวจต่อจากรายการเดิม'};
export default function BillingSettlementPage({runId}:{runId?:string}){
  const router=useRouter(),generation=useRef(0),intent=useRef<{body:string;key:string}|null>(null);
  const [run,setRun]=useState<BillingSettlementRun|null>(null),[list,setList]=useState<{items:BillingSettlementRun[];nextCursor:string|null;canCreate:boolean}|null>(null),[findings,setFindings]=useState<BillingSettlementFindings|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [reviewedSource,setReviewedSource]=useState(false),[confirmCancel,setConfirmCancel]=useState(false);
  const [period,setPeriod]=useState('yesterday');
  const [start,setStart]=useState(()=>billingCompletedDays(1).start),[end,setEnd]=useState(()=>billingCompletedDays(1).end),[reason,setReason]=useState('ตรวจยอดรับเงินและเงินโอนของบริษัท');
  const invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const refresh=(next:string|null=cursor)=>{invalidate();setReviewedSource(false);setConfirmCancel(false);setLoading(true);setFindings(null);setList(null);setCursor(next);setReload(v=>v+1);};
  useEffect(()=>{intent.current=null;setCursor(null);setReviewedSource(false);setConfirmCancel(false);setReason('ตรวจยอดรับเงินและเงินโอนของบริษัท');},[runId]);
  useEffect(()=>{
    const token=++generation.current;setLoading(true);setBusy(false);setError('');setRun(null);setFindings(null);setList(null);
    const query=new URLSearchParams(cursor?{cursor}:{});
    const read=runId?Promise.all([authedApiFetch<BillingSettlementRun>(`${base}/${runId}`,{cache:'no-store',suppressErrorToast:true}),
      authedApiFetch<BillingSettlementFindings>(`${base}/${runId}/findings?${query}`,{cache:'no-store',suppressErrorToast:true})]).then(([r,f])=>{if(generation.current===token){setRun(r);setFindings(f);}}):
      authedApiFetch<{items:BillingSettlementRun[];nextCursor:string|null;canCreate:boolean}>(`${base}?${query}`,{cache:'no-store',suppressErrorToast:true}).then(r=>{if(generation.current===token)setList(r);});
    void read.catch(()=>{if(generation.current===token)setError('โหลดผลไม่ได้ กรุณาตรวจสิทธิ์หรือกดโหลดใหม่');}).finally(()=>{if(generation.current===token)setLoading(false);});
    return invalidate;
  },[runId,cursor,reload]);
  const report=(e:unknown,fallback:string)=>(e as {status?:number})?.status===429||apiErrorCode(e)==='BILLING_RATE_LIMIT'?apiErrorMessage(e):fallback;
  const create=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy)return;const windowStart=billingTimeIso(start),windowEnd=billingTimeIso(end);
    if(!windowStart||!windowEnd||Date.parse(windowStart)>=Date.parse(windowEnd)||Date.parse(windowEnd)-Date.parse(windowStart)>31*86400000||Date.parse(windowEnd)>Date.now()-60000){setError('เลือกวันที่และเวลาให้ครบ โดยวันสิ้นสุดต้องอยู่หลังวันเริ่มต้น ช่วงไม่เกิน 31 วัน และสิ้นสุดก่อนเวลาปัจจุบันอย่างน้อย 1 นาที');return;}
    const token=generation.current;setBusy(true);setError('');
    try{const body=JSON.stringify({windowStart,windowEnd,reason});
      if(intent.current?.body!==body)intent.current={body,key:crypto.randomUUID()};
      const r=await authedApiFetch<BillingSettlementRun>(base,{method:'POST',body,headers:{'idempotency-key':intent.current.key},suppressErrorToast:true});
      if(token===generation.current)router.push(`${base}/${r.id}`);
    }catch(e){if(token===generation.current)setError(report(e,'ยังเริ่มงานไม่ได้ ตรวจช่วงวันและเหตุผล หรือโหลดรายการเพื่อเปิดคำขอเดิม'));}finally{if(token===generation.current)setBusy(false);}
  };
  const act=async(action:'run'|'resume'|'cancel')=>{
    if(!run||busy||(action==='cancel'&&!confirmCancel)||((action==='resume'&&run.state==='BLOCKED'||action==='run'&&run.errorCode==='SETTLEMENT_SOURCE_REVIEW')&&!reviewedSource))return;const token=generation.current;setBusy(true);setError('');
    try{await authedApiFetch<BillingSettlementRun>(`${base}/${run.id}/${action}`,{method:'POST',body:JSON.stringify({expectedVersion:run.version}),suppressErrorToast:true});if(token===generation.current){setReviewedSource(false);setConfirmCancel(false);refresh(null);}}
    catch(e){if(token===generation.current)setError(report(e,'ยังทำรายการไม่ได้ งานหรือสิทธิ์อาจเปลี่ยน กดโหลดผลล่าสุดก่อนลองอีกครั้ง'));}finally{if(token===generation.current)setBusy(false);}
  };
  const next=runId?findings?.nextCursor:list?.nextCursor;
  const complete=run?.state==='SUCCEEDED',hasResults=Boolean(run&&(complete||run.seen>0)),blocked=run?.state==='BLOCKED';
  const sourceReview=Boolean(run&&!complete&&run.state!=='CANCELLED'&&(run.errorCode==='SETTLEMENT_SOURCE_REVIEW'||blocked&&!['PAGE_LIMIT_REACHED','CONTROL_PERMISSION_CHANGED'].includes(run.errorCode??'')));
  const reviewedRetry=Boolean((blocked&&run?.canResume)||(sourceReview&&run?.canRun));
  const needsReview=run?run.different+run.missing+run.manual:0;
  const waiting=Boolean(run?.retryAt&&Date.parse(run.retryAt)>Date.now());
  const outcome=run?(complete?(run.seen===0?'ตรวจครบแล้ว ไม่พบรายการในช่วงนี้':needsReview?'ตรวจครบแล้ว มีรายการต้องตรวจต่อ':'ตรวจยอดครบแล้ว'):run.state==='CANCELLED'?'ยกเลิกการตรวจครั้งนี้แล้ว':blocked||sourceReview?'ยังตรวจยอดไม่สำเร็จ':waiting?'รออ่านข้อมูลจาก Stripe อีกครั้ง':label(states,run.state,'ยังยืนยันผลตรวจไม่ได้')):'';
  const explanation=run?(complete?(run.seen===0?'Stripe ไม่พบรายการในช่วงวันที่เลือก ผลนี้ตรวจครบทั้งช่วงแล้ว':needsReview?`พบ ${needsReview.toLocaleString('th-TH')} รายการที่ต้องตรวจรายละเอียดด้านล่าง`:'ดูยอดและรายละเอียดที่ตรวจได้ด้านล่าง'):run.state==='CANCELLED'?'การตรวจครั้งนี้หยุดแล้ว หากยังต้องการยอดครบทั้งช่วง ให้เริ่มตรวจใหม่':run.errorCode?label(errors,run.errorCode,'ยังตรวจไม่ครบช่วงที่เลือก ให้ตรวจสถานะการเชื่อมต่อก่อนลองใหม่'):run.seen>0?'มีผลบางส่วนแล้ว ต้องตรวจต่อจึงจะสรุปยอดครบทั้งช่วงได้':'ยังไม่มีรายการที่ตรวจเสร็จ จึงยังบอกยอดรับเงินไม่ได้'):'';

  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">
    <Link onClick={leaving} className={billingLink} href={runId?base:"/system/billing"}>{runId?'กลับรายการตรวจยอด':'กลับหน้าการชำระเงิน'}</Link>
    <header><h1 className="text-2xl font-semibold text-gray-900">{runId?'ผลตรวจยอดรับเงิน':'ตรวจยอดรับเงิน'}</h1><p className="mt-2 text-gray-600">ดูยอดที่ลูกค้าจ่าย ค่าธรรมเนียม และยอดที่ Stripe โอนให้มั่งมี</p></header>
    {loading&&<p role="status">กำลังอ่านผลตรวจ…</p>}{error&&<div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><button type="button" className={button} disabled={loading||busy} aria-busy={Boolean(loading || busy)} onClick={()=>refresh()}>ลองอ่านผลอีกครั้ง</button></div>}
    {!runId&&list?.canCreate&&<form onSubmit={e=>void create(e)} className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">ต้องการตรวจยอดของช่วงไหน</h2>
      <fieldset className="flex flex-wrap gap-3" disabled={busy}><legend className="sr-only">ช่วงวันที่ตรวจยอด</legend>{[['yesterday','เมื่อวาน'],['week','7 วันที่ผ่านมา'],['custom','กำหนดช่วงเอง']].map(([value,title])=><label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 ${period===value?'border-brand-600 bg-brand-50 text-brand-900':'border-gray-200 text-gray-700'}`}><input type="radio" name="settlement-period" className="accent-green-700" checked={period===value} onChange={()=>{setPeriod(value!);if(value!=='custom'){const range=billingCompletedDays(value==='week'?7:1);setStart(range.start);setEnd(range.end);}}}/>{title}</label>)}</fieldset>
      {period==='custom'?<div className="grid gap-5 sm:grid-cols-2"><BillingDateTimeField label="เริ่มตรวจตั้งแต่" value={start} onChange={setStart} disabled={busy}/><BillingDateTimeField label="ตรวจถึงก่อน" value={end} onChange={setEnd} disabled={busy}/><p className="text-sm text-gray-600 sm:col-span-2">ตรวจได้ครั้งละไม่เกิน 31 วัน และไม่รวมรายการใน 1 นาทีล่าสุด</p></div>:<p className="rounded-lg bg-gray-50 p-4 text-gray-700">ตั้งแต่ {time(billingTimeIso(start))} ถึงก่อน {time(billingTimeIso(end))} (เวลาประเทศไทย)</p>}
      <p className="text-gray-600">ระบบจะเปรียบเทียบกับ Stripe และแสดงรายการที่ต้องตรวจต่อ การตรวจนี้ไม่เรียกเก็บเงินและไม่เปลี่ยนแพ็กเกจลูกค้า</p>
      <details><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">บันทึกเหตุผลการตรวจ (แก้ไขได้)</summary><label className="block" htmlFor="settlement-reason">เหตุผลที่บันทึกในประวัติ</label><textarea id="settlement-reason" className="mangmee-input mt-2 w-full !text-base" maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></details>
      <button className={billingPrimaryControl} disabled={busy||!reason.trim()} aria-busy={busy}>{busy?'กำลังเริ่มตรวจ…':'เริ่มตรวจยอดช่วงนี้'}</button>
    </form>}
    {!runId&&list&&!list.canCreate&&<section className="space-y-3 rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-semibold">ยังเริ่มตรวจยอดใหม่ไม่ได้</h2><p className="text-gray-600">บัญชีนี้ยังไม่มีสิทธิ์เริ่มตรวจ หรือการเชื่อมต่อ Stripe ยังไม่พร้อม คุณยังเปิดผลตรวจเดิมด้านล่างได้</p><Link className={billingLink} href="/system/billing/configuration-checks">ดูสถานะการเชื่อมต่อ Stripe</Link></section>}
    {run&&<>
      <section aria-label="ผลตรวจยอด Stripe" className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-gray-600">{billingLabel('mode',run.mode)}</span><button type="button" className="min-h-11 px-2 text-sm text-gray-600 underline" disabled={loading||busy} aria-busy={Boolean(loading || busy)} onClick={()=>refresh()}>อัปเดตผลตรวจ</button></div>
        <div><h2 className="text-xl font-semibold text-gray-900">{outcome}</h2><p className="mt-2 text-gray-700">{explanation}</p></div>
        <dl className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2"><div><dt className="text-sm text-gray-600">ช่วงวันที่ตรวจ (เวลาประเทศไทย)</dt><dd className="mt-1">{time(run.windowStart)}<br/>ถึงก่อน {time(run.windowEnd)}</dd></div>{run.observedAt&&<div><dt className="text-sm text-gray-600">บันทึกผลล่าสุด</dt><dd className="mt-1">{time(run.observedAt)}</dd></div>}</dl>
        {!hasResults&&<div role="status" className="rounded-lg bg-gray-50 p-4"><p className="font-semibold">ยังสรุปยอดไม่ได้</p><p className="mt-1 text-gray-600">ยังไม่มีผลที่ตรวจเสร็จ ไม่ได้หมายความว่ายอดรับเงินเป็นศูนย์</p></div>}
        {!complete&&run.state!=='CANCELLED'&&<div className="space-y-3 border-t border-gray-100 pt-4"><h3 className="font-semibold">สิ่งที่ต้องทำต่อ</h3>
          {sourceReview?<><p className="text-gray-600">ตรวจว่ามั่งมีเชื่อมกับบัญชี Stripe ที่ถูกต้องและอ่านข้อมูลได้ แล้วกลับมาลองตรวจครั้งเดิม</p><Link onClick={leaving} className={billingPrimaryControl} href="/system/billing/configuration-checks">ตรวจการเชื่อมต่อ Stripe</Link></>:
            blocked?<><p className="text-gray-600">{run.errorCode==='PAGE_LIMIT_REACHED'?'เริ่มตรวจใหม่โดยเลือกช่วงวันที่สั้นลง':'กลับไปเริ่มตรวจใหม่ด้วยบัญชีที่มีสิทธิ์ตรวจยอด'}</p><Link onClick={leaving} className={billingPrimaryControl} href={base}>เลือกช่วงวันที่และเริ่มใหม่</Link></>:
            waiting?<p className="text-gray-600">ลองตรวจต่อได้หลัง {time(run.retryAt)} จากนั้นกดอัปเดตผลตรวจเพื่อดูสถานะล่าสุด</p>:
            run.canRun?<><p className="text-gray-600">{run.seen>0?'ตรวจรายการที่เหลือต่อจากจุดเดิม โดยไม่เรียกเก็บเงินเพิ่ม':'เริ่มอ่านรายการจาก Stripe เพื่อสรุปยอดในช่วงที่เลือก'}</p><button className={billingPrimaryControl} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>void act('run')}>{run.seen>0?'ตรวจรายการที่เหลือต่อ':'เริ่มตรวจยอด'}</button></>:
            run.canResume?<button className={billingPrimaryControl} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>void act('resume')}>ลองตรวจยอดครั้งเดิมอีกครั้ง</button>:
            <p className="text-gray-600">กดอัปเดตผลตรวจเพื่อติดตามสถานะ บัญชีนี้ยังเริ่มตรวจต่อจากหน้านี้ไม่ได้</p>}
        </div>}
        {run.state==='CANCELLED'&&<Link onClick={leaving} className={billingLink} href={base}>เลือกช่วงวันที่เพื่อตรวจใหม่</Link>}
      </section>
      {hasResults&&<section aria-label="ยอดเงินที่ตรวจได้" className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{complete?'ยอดเงินในช่วงที่ตรวจครบแล้ว':'ผลบางส่วนที่ตรวจได้'}</h2>
        <p className={complete?'text-gray-600':'rounded-lg bg-amber-50 p-3 text-amber-900'}>{complete?`ตรวจครบ ${run.seen.toLocaleString('th-TH')} รายการ`:`ยอดด้านล่างรวมเฉพาะ ${run.seen.toLocaleString('th-TH')} รายการที่ตรวจแล้ว ยังไม่ใช่ยอดครบทั้งช่วง`}</p>
        <dl className="grid gap-3 sm:grid-cols-3">{[['ลูกค้าชำระเงิน',run.totals.grossCharges],['ค่าธรรมเนียม Stripe',run.totals.fees],['ยอดโอนออกจาก Stripe',run.totals.payouts]].map(([title,value])=><div key={title} className="rounded-lg bg-gray-50 p-4"><dt className="text-gray-600">{title}</dt><dd className="mt-1 text-xl font-semibold">{money(value!)}</dd></div>)}</dl>
        <p className="text-sm text-gray-600">แสดงเฉพาะเงินบาท ยอดโอนออกจาก Stripe ต้องตรวจเงินเข้าบัญชีธนาคารอีกครั้ง</p>
        <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-gray-600">รายละเอียดการเทียบยอดและภาษี</summary><div className="space-y-3 pt-3"><p>ข้อมูลตรงกัน {run.matched.toLocaleString('th-TH')} รายการ · ต้องตรวจต่อ {needsReview.toLocaleString('th-TH')} รายการ</p><dl className="grid gap-3 sm:grid-cols-3">{[['ภาษีจากรายการที่ตรวจตรงแล้ว',run.totals.knownTax],['ยอดเปลี่ยนแปลงในบัญชี Stripe',run.totals.netMovement],['ยอดโอนที่คืนกลับ Stripe',run.totals.payoutReversals]].map(([title,value])=><div key={title}><dt className="text-gray-600">{title}</dt><dd className="font-medium">{money(value!)}</dd></div>)}</dl><p className="text-sm text-gray-600">ยอดเปลี่ยนแปลงรวมเงินเข้า เงินคืน และเงินโอน จึงไม่ใช่ยอดขาย</p>{run.totals.unknownTaxCharges>0&&<p>ยังตรวจภาษีไม่ได้ {run.totals.unknownTaxCharges} รายการ จึงยังไม่รวมภาษีของรายการเหล่านั้น</p>}{run.totals.excluded>0&&<p>อีก {run.totals.excluded} รายการอยู่นอกยอดเงินบาทข้างต้น ให้ตรวจแยก</p>}</div></details>
      </section>}
      {(run.canCancel||reviewedRetry)&&<details className="rounded-xl border border-gray-200 bg-white p-5"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">{reviewedRetry?'หลังแก้สาเหตุแล้ว หรือเมื่อต้องการยกเลิก':'ยกเลิกการตรวจครั้งนี้'}</summary><div className="space-y-5 pt-3">
        {reviewedRetry&&<div className="space-y-3"><p className="text-gray-600">เมื่อตรวจและแก้สาเหตุแล้ว ให้ลองตรวจต่อจากรายการเดิม ระบบจะตรวจข้อมูลกับ Stripe อีกครั้ง</p><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="accent-green-700" checked={reviewedSource} disabled={busy} onChange={e=>setReviewedSource(e.target.checked)}/>ตรวจและแก้สาเหตุแล้ว</label><button className={button} disabled={busy||loading||!reviewedSource} aria-busy={Boolean(busy || loading)} onClick={()=>void act(run.canResume?'resume':'run')}>ลองตรวจยอดครั้งเดิมอีกครั้ง</button></div>}
        {run.canCancel&&<div className="space-y-3 border-t border-gray-100 pt-4"><p className="text-gray-600">ยกเลิกเฉพาะการตรวจครั้งนี้ ไม่ยกเลิกการชำระเงินของลูกค้า และไม่ได้แก้ยอดที่ต่างกัน ผลที่ตรวจไว้ยังอยู่ในประวัติ</p>{confirmCancel?<div className="space-y-3 rounded-lg bg-gray-50 p-4"><p className="font-medium">ยืนยันว่าจะหยุดตรวจครั้งนี้หรือไม่</p><div className="flex flex-wrap gap-3"><button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>void act('cancel')}>ยืนยันยกเลิกการตรวจ</button><button className={button} disabled={busy} onClick={()=>setConfirmCancel(false)}>ยังไม่ยกเลิก</button></div></div>:<button className={button} disabled={busy||loading} onClick={()=>setConfirmCancel(true)}>ยกเลิกการตรวจครั้งนี้</button>}</div>}
      </div></details>}
      <details className="rounded-xl border border-gray-200 bg-white p-5"><summary className="min-h-11 cursor-pointer py-2 text-gray-600">บันทึกและข้อมูลอ้างอิง</summary><div className="space-y-3 pt-3 text-sm text-gray-600"><p>เหตุผลที่เริ่มตรวจ: {run.reason}</p><p>เริ่มตรวจเมื่อ {time(run.createdAt)}</p><p className="break-all">รหัสการตรวจ ใช้ค้นประวัติในระบบ: {run.id}</p>{findings?.caseIds.map((id,index)=><Link key={id} className={billingLink} href={`/system/billing/issues/${id}`} onClick={leaving}>ดูบันทึกติดตามปัญหา{findings.caseIds.length>1?` ${index+1}`:''}</Link>)}</div></details>
    </>}
    {findings&&(findings.items.length>0||cursor)&&<section aria-label="รายการยอดที่ตรวจแล้ว" className="space-y-3"><h2 className="text-lg font-bold">รายการที่ตรวจแล้ว</h2>{!findings.items.length&&<p>ยังไม่มีรายการที่บันทึกผลไว้</p>}
      {findings.items.map(f=><article key={f.id} className="rounded-xl border border-gray-200 p-4 bg-white"><details open={Boolean(f.payout)||f.classification==='DIFFERENT'||f.classification==='LOCAL_MISSING'}><summary className="min-h-11 cursor-pointer py-2 font-bold">{label(kinds,f.kind,'รายการอื่นในบัญชี Stripe')} · {label(classes,f.classification,'ต้องตรวจแยก')}</summary><div className="space-y-2">
        <p>เกิดรายการ {time(f.createdAt)} · ตรวจเมื่อ {time(f.observedAt)}</p>{f.companyName&&<p>{f.companyName}</p>}
        {f.currency==='THB'?<p>ยอด {money(f.amountSatang)} · ค่าธรรมเนียม {money(f.feeSatang)} · สุทธิ {money(f.netSatang)}</p>:<p>สกุลเงิน {f.currency} — ตรวจแยกจากยอดบาท</p>}
        <p>{f.availability==='available'?'Stripe ระบุว่ายอดพร้อมใช้':'ยอดยังรอพร้อมใช้'} · วันที่พร้อมใช้ {time(f.availableAt)}</p>
        {f.refundState&&<p>{label(refundStates,f.refundState,'ต้องตรวจสถานะคืนเงิน')}</p>}
        {f.payout&&<><p className="font-semibold">{label(payoutStates,f.payout.status,'ต้องตรวจสถานะโอน')}</p><p>วันที่คาดว่าจะถึง {time(f.payout.expectedArrivalAt)}</p><p>{label(checks,f.payout.reconciliation,'ต้องตรวจยอดโอน')}</p><p>ต้องตรวจบัญชีธนาคารเพื่อยืนยันเงินเข้า สถานะ Stripe อาจเปลี่ยนภายหลังได้</p>
          {f.payout.reconciliation!=='MATCHED'&&<a className={button} href={`https://dashboard.stripe.com/${run?.mode==='TEST'?'test/':''}reports`} target="_blank" rel="noreferrer">เปิดรายงาน Stripe เพื่อตรวจต่อ</a>}</>}
        <div className="flex flex-wrap gap-3">{f.companyId&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(f.companyId)}`}>เปิดบริษัท</Link>}{f.companyId&&f.invoiceId&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(f.companyId)}/invoices/${f.invoiceId}`}>เปิดใบแจ้งหนี้ต้นทาง</Link>}</div>
        <details><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงรายการ</summary><p className="break-all">{f.id}</p></details>
      </div></details></article>)}</section>}
    {!runId&&list&&<section aria-label="งานตรวจยอดที่ผ่านมา" className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">ผลตรวจที่ผ่านมา</h2><button type="button" className="min-h-11 px-2 text-sm text-gray-600 underline" disabled={loading||busy} aria-busy={Boolean(loading || busy)} onClick={()=>refresh()}>อัปเดตรายการ</button></div>{!list.items.length&&<p className="text-gray-600">ยังไม่มีผลตรวจ เลือกช่วงวันที่ด้านบนแล้วเริ่มตรวจครั้งแรกได้</p>}{list.items.map(r=><article key={r.id} className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white"><p>{label(states,r.state,'ต้องตรวจสอบสถานะ')} · {r.reason}</p><p>{time(r.windowStart)} ถึงก่อน {time(r.windowEnd)}</p><Link onClick={leaving} className={button} href={`${base}/${r.id}`}>เปิดผลตรวจ</Link></article>)}</section>}
    <div className="flex flex-wrap gap-3">{next&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>refresh(next)}>หน้าถัดไป</button>}{cursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>refresh(null)}>กลับหน้าแรก</button>}</div>
  </main>;
}

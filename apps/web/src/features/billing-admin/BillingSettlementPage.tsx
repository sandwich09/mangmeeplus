'use client';
import {billingLeavesPage} from '../billing/billing-display';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import type {BillingSettlementRun,BillingSettlementFindings} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorCode,apiErrorMessage} from '@/common/api/api-error-message';
import {billingControl,billingLabel} from '../billing/billing-display';
const label=(labels:Record<string,string>,value:string,fallback:string)=>Object.hasOwn(labels,value)?labels[value]!:fallback;
const base='/system/billing/settlements',button=billingControl;
const time=(v:string|null)=>v?new Date(v).toLocaleString('th-TH'):'ยังไม่มี';
const local=(ms:number)=>new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,16);
const money=(v:string|number)=>{const n=BigInt(v),a=n<0n?-n:n;return `${n<0n?'-':''}฿${(a/100n).toLocaleString('th-TH')}.${String(a%100n).padStart(2,'0')}`;};
const states:Record<string,string>={QUEUED:'รอตรวจต่อ',RUNNING:'กำลังตรวจ',SUCCEEDED:'ตรวจครบช่วงที่เลือก',CANCELLED:'หยุดตรวจแล้ว — ผลยังไม่ครบ',BLOCKED:'ต้องตรวจข้อมูลก่อนทำต่อ',UNKNOWN:'ตรวจยังไม่จบ ต้องติดตาม'};
const classes:Record<string,string>={MATCHED:'ข้อมูลตรงกัน',DIFFERENT:'ข้อมูลต่างกัน ต้องตรวจ',LOCAL_MISSING:'ยังไม่พบใบแจ้งหนี้ในระบบ',MANUAL:'ต้องตรวจแยก'};
const kinds:Record<string,string>={charge:'ยอดชำระ',refund:'คืนเงิน',payout:'โอนออกจาก Stripe',payout_failure:'คืนยอดโอนที่ไม่สำเร็จ',payout_cancel:'คืนยอดโอนที่ยกเลิก',stripe_fee:'ค่าธรรมเนียม Stripe'};
const refundStates:Record<string,string>={pending:'รอคืนเงิน',requires_action:'ต้องดำเนินการก่อนคืนเงิน',succeeded:'Stripe คืนเงินสำเร็จ',failed:'คืนเงินไม่สำเร็จ',canceled:'ยกเลิกการคืนเงิน'};
const payoutStates:Record<string,string>={paid:'Stripe แจ้งว่าโอนแล้ว',pending:'Stripe ยังไม่เริ่มโอน',in_transit:'กำลังโอน',failed:'โอนไม่สำเร็จ',canceled:'ยกเลิกการโอน'};
const checks:Record<string,string>={MATCHED:'ยอดรายการที่รวมในรอบโอนตรงกัน',PENDING:'ยังตรวจยอดรวมรอบโอนไม่ได้',MANUAL:'ตรวจรอบนี้ในรายงาน Stripe',INCOMPLETE:'รายการในรอบโอนยังตรวจไม่ครบ',FAILED:'ต้องติดตามยอดโอนที่ไม่สำเร็จหรือยกเลิก'};
const errors:Record<string,string>={CONTROL_PERMISSION_CHANGED:'สิทธิ์ผู้เริ่มงานเปลี่ยนแล้ว ให้ผู้มีสิทธิ์เริ่มงานใหม่',PAGE_LIMIT_REACHED:'รายการมากเกินรอบตรวจนี้ ให้เริ่มงานใหม่โดยแบ่งช่วงวันให้สั้นลง',SETTLEMENT_SOURCE_REVIEW:'ข้อมูลต้นทางหรือการผูกบัญชีไม่ตรง ให้ตรวจเคสก่อนทำต่อ',SETTLEMENT_PROVIDER_UNAVAILABLE:'Stripe ยังตอบผลไม่ครบ ระบบจะตรวจต่อจากรายการเดิม'};
export default function BillingSettlementPage({runId}:{runId?:string}){
  const router=useRouter(),generation=useRef(0),intent=useRef<{body:string;key:string}|null>(null);
  const [run,setRun]=useState<BillingSettlementRun|null>(null),[list,setList]=useState<{items:BillingSettlementRun[];nextCursor:string|null;canCreate:boolean}|null>(null),[findings,setFindings]=useState<BillingSettlementFindings|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [start,setStart]=useState(()=>local(Date.now()-86400000)),[end,setEnd]=useState(()=>local(Date.now()-120000)),[reason,setReason]=useState('');
  const invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const refresh=(next:string|null=cursor)=>{invalidate();setLoading(true);setFindings(null);setList(null);setCursor(next);setReload(v=>v+1);};
  useEffect(()=>{intent.current=null;setCursor(null);setReason('');},[runId]);
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
    e.preventDefault();if(busy)return;const token=generation.current;setBusy(true);setError('');
    try{const body=JSON.stringify({windowStart:new Date(start).toISOString(),windowEnd:new Date(end).toISOString(),reason});
      if(intent.current?.body!==body)intent.current={body,key:crypto.randomUUID()};
      const r=await authedApiFetch<BillingSettlementRun>(base,{method:'POST',body,headers:{'idempotency-key':intent.current.key},suppressErrorToast:true});
      if(token===generation.current)router.push(`${base}/${r.id}`);
    }catch(e){if(token===generation.current)setError(report(e,'ยังเริ่มงานไม่ได้ ตรวจช่วงวันและเหตุผล หรือโหลดรายการเพื่อเปิดคำขอเดิม'));}finally{if(token===generation.current)setBusy(false);}
  };
  const act=async(action:'run'|'resume'|'cancel')=>{
    if(!run||busy)return;const token=generation.current;setBusy(true);setError('');
    try{await authedApiFetch<BillingSettlementRun>(`${base}/${run.id}/${action}`,{method:'POST',body:JSON.stringify({expectedVersion:run.version}),suppressErrorToast:true});if(token===generation.current)refresh(null);}
    catch(e){if(token===generation.current)setError(report(e,'ยังทำรายการไม่ได้ งานหรือสิทธิ์อาจเปลี่ยน กดโหลดผลล่าสุดก่อนลองอีกครั้ง'));}finally{if(token===generation.current)setBusy(false);}
  };
  const next=runId?findings?.nextCursor:list?.nextCursor;
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">ตรวจยอดชำระและเงินโอน Stripe</h1>
    <p>เปรียบเทียบยอดชำระ ค่าธรรมเนียม และรายการโอนตามช่วงที่เลือก ผลตรวจนี้ไม่เปลี่ยนสิทธิ์แพ็กเกจลูกค้า</p>
    <nav className="flex flex-wrap gap-3"><Link onClick={leaving} className={button} href="/system/billing">บริษัท</Link><Link onClick={leaving} className={button} href="/system/billing/issues">คิวตรวจสอบ</Link><Link onClick={leaving} className={button} href="/system/billing/settings">ตั้งค่าการจ่ายเงิน</Link>
      {runId&&<Link onClick={leaving} className={button} href={base}>กลับรายการงานตรวจ</Link>}</nav>
    <button className={button} disabled={loading||busy} aria-busy={Boolean(loading || busy)} onClick={()=>refresh()}>โหลดผลล่าสุด</button>
    {loading&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {!runId&&list?.canCreate&&<form onSubmit={e=>void create(e)} className="space-y-4 rounded-xl border p-4"><h2 className="text-lg font-bold">เริ่มตรวจยอด</h2>
      <p>เลือกช่วงไม่เกิน 31 วัน และสิ้นสุดก่อนปัจจุบันอย่างน้อย 1 นาที เวลาตามเครื่องนี้</p>
      <label className="block">เริ่มช่วงเวลา<input className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border p-2" type="datetime-local" required value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/></label>
      <label className="block">สิ้นสุดช่วงเวลา<input className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border p-2" type="datetime-local" required value={end} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label>
      <div><label className="block" htmlFor="settlement-reason">เหตุผล</label><textarea id="settlement-reason" className="mt-1 block w-full rounded-lg border p-2" required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></div>
      <button className={button} disabled={busy||!reason.trim()} aria-busy={Boolean(busy)}>เริ่มตรวจยอด</button></form>}
    {!runId&&list&&!list.canCreate&&<p>ดูงานเดิมได้ แต่ยังเริ่มงานใหม่ไม่ได้ ให้ผู้ดูแลตรวจสิทธิ์และการเชื่อมต่อ Stripe</p>}
    {run&&<section aria-label="ผลตรวจยอด Stripe" className="space-y-3 rounded-xl border p-4"><h2 className="text-lg font-bold" role="status">{label(states,run.state,'ต้องตรวจสอบสถานะ')}</h2>
      <p>{billingLabel('mode',run.mode)} · {run.reason}</p><p>{time(run.windowStart)} ถึงก่อน {time(run.windowEnd)}</p><p>อัปเดต {time(run.observedAt)}</p>
      <p>ตรวจแล้ว {run.seen.toLocaleString('th-TH')} รายการ · ตรงกัน {run.matched.toLocaleString('th-TH')} · ต้องตรวจต่อ {(run.different+run.missing+run.manual).toLocaleString('th-TH')}</p>
      {run.state!=='SUCCEEDED'&&<p className="rounded-lg bg-amber-50 p-3">ยอดด้านล่างเฉพาะรายการที่ตรวจแล้ว ยังไม่ใช่ผลครบทั้งช่วง</p>}
      <dl className="grid gap-3 sm:grid-cols-3">{[['ยอดชำระก่อนหักค่าธรรมเนียม',run.totals.grossCharges],['ค่าธรรมเนียมที่ตรวจ',run.totals.fees],['ยอดโอนออกจาก Stripe',run.totals.payouts]].map(([title,value])=><div key={title} className="rounded-lg bg-slate-50 p-3"><dt>{title}</dt><dd className="font-semibold">{money(value!)}</dd></div>)}</dl>
      <details><summary className="min-h-11 cursor-pointer py-2">ดูภาษีและยอดเปลี่ยนแปลงเพิ่มเติม</summary><dl className="space-y-3">{[['ภาษีจากใบแจ้งหนี้ที่ตรวจตรงแล้ว',run.totals.knownTax],['ยอดเปลี่ยนแปลงในบัญชี Stripe',run.totals.netMovement],['ยอดโอนที่คืนกลับ Stripe',run.totals.payoutReversals]].map(([title,value])=><div key={title}><dt>{title}</dt><dd className="font-semibold">{money(value!)}</dd></div>)}</dl></details>
      <p>แสดงเฉพาะบาทในบัญชีรับชำระ ยอดเปลี่ยนแปลงรวมเงินเข้า เงินคืน และเงินโอน จึงไม่ใช่ยอดขาย</p>
      {run.totals.unknownTaxCharges>0&&<p>ยังตรวจภาษีไม่ได้ {run.totals.unknownTaxCharges} รายการ — ไม่ได้ถือว่าภาษีเป็นศูนย์</p>}{run.totals.excluded>0&&<p>อีก {run.totals.excluded} รายการอยู่นอกยอดบาทข้างต้น ให้ตรวจแยก</p>}
      {run.errorCode&&<p role="alert">{label(errors,run.errorCode,'เปิดเคสเพื่อตรวจเงื่อนไขก่อนทำต่อ')}</p>}{run.retryAt&&<p>ตรวจต่อได้หลัง {time(run.retryAt)}</p>}
      <div className="flex flex-wrap gap-3">{run.canRun&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('run')}>ตรวจรายการถัดไป</button>}{run.canResume&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('resume')}>ทำงานเดิมต่อ</button>}{run.canCancel&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('cancel')}>หยุดงานตรวจนี้</button>}</div>
      {findings?.caseIds.map(id=><Link key={id} className={button} href={`/system/billing/issues/${id}`} onClick={leaving}>เปิดเคสที่ต้องตรวจ</Link>)}
      <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงงานตรวจ</summary><p className="break-all">{run.id}</p></details>
    </section>}
    {findings&&<section aria-label="รายการยอดที่ตรวจแล้ว" className="space-y-3"><h2 className="text-lg font-bold">รายการที่ตรวจแล้ว</h2>{!findings.items.length&&<p>ยังไม่มีรายการที่บันทึกผลไว้</p>}
      {findings.items.map(f=><article key={f.id} className="rounded-xl border p-4"><details open={Boolean(f.payout)||f.classification==='DIFFERENT'||f.classification==='LOCAL_MISSING'}><summary className="min-h-11 cursor-pointer py-2 font-bold">{label(kinds,f.kind,'รายการอื่นในบัญชี Stripe')} · {label(classes,f.classification,'ต้องตรวจแยก')}</summary><div className="space-y-2">
        <p>เกิดรายการ {time(f.createdAt)} · ตรวจเมื่อ {time(f.observedAt)}</p>{f.companyName&&<p>{f.companyName}</p>}
        {f.currency==='THB'?<p>ยอด {money(f.amountSatang)} · ค่าธรรมเนียม {money(f.feeSatang)} · สุทธิ {money(f.netSatang)}</p>:<p>สกุลเงิน {f.currency} — ตรวจแยกจากยอดบาท</p>}
        <p>{f.availability==='available'?'Stripe ระบุว่ายอดพร้อมใช้':'ยอดยังรอพร้อมใช้'} · วันที่พร้อมใช้ {time(f.availableAt)}</p>
        {f.refundState&&<p>{label(refundStates,f.refundState,'ต้องตรวจสถานะคืนเงิน')}</p>}
        {f.payout&&<><p className="font-semibold">{label(payoutStates,f.payout.status,'ต้องตรวจสถานะโอน')}</p><p>วันที่คาดว่าจะถึง {time(f.payout.expectedArrivalAt)}</p><p>{label(checks,f.payout.reconciliation,'ต้องตรวจยอดโอน')}</p><p>ต้องตรวจบัญชีธนาคารเพื่อยืนยันเงินเข้า สถานะ Stripe อาจเปลี่ยนภายหลังได้</p>
          {f.payout.reconciliation!=='MATCHED'&&<a className={button} href={`https://dashboard.stripe.com/${run?.mode==='TEST'?'test/':''}reports`} target="_blank" rel="noreferrer">เปิดรายงาน Stripe เพื่อตรวจต่อ</a>}</>}
        <div className="flex flex-wrap gap-3">{f.companyId&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(f.companyId)}`}>เปิดบริษัท</Link>}{f.companyId&&f.invoiceId&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(f.companyId)}/invoices/${f.invoiceId}`}>เปิดใบแจ้งหนี้ต้นทาง</Link>}</div>
        <details><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงรายการ</summary><p className="break-all">{f.id}</p></details>
      </div></details></article>)}</section>}
    {!runId&&list&&<section aria-label="งานตรวจยอดที่ผ่านมา" className="space-y-3"><h2 className="text-lg font-bold">งานตรวจที่ผ่านมา</h2>{!list.items.length&&<p>ยังไม่มีงานตรวจยอด</p>}{list.items.map(r=><article key={r.id} className="space-y-2 rounded-xl border p-4"><p>{label(states,r.state,'ต้องตรวจสอบสถานะ')} · {r.reason}</p><p>{time(r.windowStart)} ถึงก่อน {time(r.windowEnd)}</p><Link onClick={leaving} className={button} href={`${base}/${r.id}`}>เปิดผลตรวจ</Link></article>)}</section>}
    <div className="flex flex-wrap gap-3">{next&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>refresh(next)}>หน้าถัดไป</button>}{cursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>refresh(null)}>กลับหน้าแรก</button>}</div>
  </main>;
}

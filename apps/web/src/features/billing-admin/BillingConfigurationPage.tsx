'use client';
import { billingControl, billingLabel, billingOfferLabel, billingLeavesPage } from '../billing/billing-display';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BillingOfferTermsEditor from './BillingOfferTermsEditor';
import BillingSalesCohortPicker from './BillingSalesCohortPicker';
import { BILLING_ACTIONS, BILLING_PAID_TIERS, type BillingAction, type BillingConfiguration, type BillingConfigurationOperation, type BillingPolicy } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const button = billingControl;
const field = 'mt-1 block min-h-11 w-full rounded-lg border bg-white p-2';
const gateNames: Record<BillingAction, string> = { new_sales: 'รับรายการซื้อใหม่', plan_changes: 'ซื้อซ้ำและเปลี่ยนแพ็กเกจ',
  portal_payment_method: 'เปิดหน้าแก้บัตร', portal_change_plan: 'เปลี่ยนแพ็กเกจผ่าน Portal', portal_cancel_subscription: 'ยกเลิกหรือกลับมาต่ออายุ', notification_delivery: 'ส่งข้อความแจ้งสถานะ', refunds:'รับคำขอคืนเงินที่ต้องอนุมัติ' };
const stateNames: Record<string, string> = { DRAFT: 'ฉบับร่างที่บันทึกไว้', PREVIEW: 'ตรวจผลกระทบก่อนส่ง', AWAITING_APPROVAL: 'รอผู้อนุมัติอีกคน', SCHEDULED:'อนุมัติแล้ว รอถึงกำหนด',RUNNING:'กำลังตรวจและใช้ค่าตามกำหนด',BLOCKED:'ต้องตรวจคำขอตามกำหนดใหม่', SUCCEEDED: 'การตั้งค่านี้มีผลแล้ว', CANCELLED: 'ยกเลิกคำขอนี้แล้ว' };
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value / 100);
const api = <T,>(path: string, body?: unknown, key?: string) => authedApiFetch<T>(`/system/billing${path}`, { cache: 'no-store', suppressErrorToast: true,
  ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } }) });
export default function BillingConfigurationPage({ operationId }: { operationId?: string }) {
  const [settings, setSettings] = useState<BillingConfiguration | null>(null), [policy, setPolicy] = useState<BillingPolicy | null>(null);
  const [gates, setGates] = useState<BillingConfiguration['gates'] | null>(null), [reason, setReason] = useState(''), [password, setPassword] = useState('');
  const [scheduled,setScheduled]=useState(false),[effectiveAt,setEffectiveAt]=useState<string|null>(null);
  const [operation, setOperation] = useState<BillingConfigurationOperation | null>(null), [history, setHistory] = useState<{ items: BillingConfigurationOperation[]; nextCursor: string | null } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const offerInputs=useRef<HTMLDivElement|null>(null);
  const generation=useRef(0);
  const invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const refundLimitInput=useRef<HTMLInputElement|null>(null);
  const draftIntent=useRef<{key:string;body:unknown}|null>(null);
  const draft=operation?.state==='DRAFT'?operation:null;
  const draftChanged=Boolean(draft&&JSON.stringify([policy,gates,reason,scheduled?effectiveAt:null])!==JSON.stringify([draft.proposed.policy,draft.proposed.gates,draft.reason,draft.proposed.effectiveAt??null]));
  const closeIntent = useRef<{ key: string; body: unknown } | null>(null);
  useEffect(()=>{invalidate();draftIntent.current=null;closeIntent.current=null;setOperation(null);setCursor(null);setReason('');setScheduled(false);setEffectiveAt(null);},[operationId]);
  useEffect(() => {
    const token=++generation.current;let active = true; setLoading(true); setBusy(false);setError('');
    Promise.all([api<BillingConfiguration>('/settings'), operationId ? api<BillingConfigurationOperation>(`/configuration-changes/${encodeURIComponent(operationId)}`) : null,
      api<{ items: BillingConfigurationOperation[]; nextCursor: string | null }>(`/configuration-changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)])
      .then(([s, op, h]) => { if (active&&token===generation.current) { setSettings(s); setPolicy(op?.state==='DRAFT'?op.proposed.policy:s.policy); setGates(op?.state==='DRAFT'?op.proposed.gates:s.gates); setHistory(h); if (operationId) {setOperation(op);setReason(op?.state==='DRAFT'?op.reason:'');setScheduled(Boolean(op?.proposed.effectiveAt));setEffectiveAt(op?.proposed.effectiveAt??null);} } })
      .catch(() => { if (active&&token===generation.current) { setSettings(null); setOperation(null); setError('โหลดการตั้งค่าไม่ได้ ตรวจสอบสิทธิ์ระดับระบบแล้วลองใหม่'); } })
      .finally(() => { if (active&&token===generation.current) setLoading(false); });
    return () => { active = false;invalidate(); };
  }, [operationId, cursor, reload]);
  const canPolicy = settings?.capabilities.includes('system.billing.policy.manage'), canGates = settings?.capabilities.includes('system.billing.gate.manage');
  async function act(action: 'reauthenticate' | 'preview' | 'submit' | 'approve' | 'cancel' | 'close' | 'save' | 'copy' | 'apply') {
    if (busy || !settings || !policy || !gates) return;
    if(['save','preview'].includes(action)&&offerInputs.current&&Array.from(offerInputs.current.querySelectorAll('input')).some(input=>!input.reportValidity()))return;
    if(['save','preview'].includes(action)&&refundLimitInput.current&&!refundLimitInput.current.reportValidity())return;
    const token=generation.current;setBusy(true); setError('');
    try {
      if (action === 'reauthenticate') {
        const proof = await api<{ reauthenticatedUntil: string }>('/reauthenticate', { password });
        if(token===generation.current)setSettings({ ...settings, reauthenticatedUntil: proof.reauthenticatedUntil }); return;
      }
      let result: BillingConfigurationOperation;
      if(action==='save'||action==='copy'){
        draftIntent.current??={key:`billing-draft-${crypto.randomUUID()}`,body:action==='copy'?{type:operation!.type,expectedVersion:0,...operation!.proposed,
          policy:operation!.type==='SET_ACTION_GATE'?settings.policy:operation!.proposed.policy,reason:operation!.reason}:
          {type:draft?.type??(canPolicy?'PUBLISH_POLICY':'SET_ACTION_GATE'),expectedVersion:draft?.version??0,policy,gates,reason,effectiveAt:scheduled?(effectiveAt??''):null,...draft?{draftId:draft.id}:{}}};
        result=await api('/configuration-drafts',draftIntent.current.body,draftIntent.current.key);if(token!==generation.current)return;draftIntent.current=null;
        setPolicy(result.proposed.policy);setGates(result.proposed.gates);setReason(result.reason);setScheduled(Boolean(result.proposed.effectiveAt));setEffectiveAt(result.proposed.effectiveAt??null);
        void api<NonNullable<typeof history>>('/configuration-changes').then(value=>{if(token===generation.current)setHistory(value);}).catch(()=>{});
      } else if (action === 'preview') {
        result = await api('/configuration-changes/preview', { type: draft?.type??(canPolicy ? 'PUBLISH_POLICY' : 'SET_ACTION_GATE'), expectedVersion: settings.version, policy, gates, reason,effectiveAt:scheduled?(effectiveAt??''):null,...draft?{draftId:draft.id,draftVersion:draft.version}:{} });
      } else if (action === 'close') {
        // Keep an ambiguous transport retry attached to the original command until its result is read.
        closeIntent.current ??= { key: `billing-close-${crypto.randomUUID()}`, body: { expectedVersion: settings.version,
          gates: Object.fromEntries(BILLING_ACTIONS.map(a => [a, settings.gates[a] && gates[a]])), reason } };
        result = await api('/settings/emergency-close', closeIntent.current.body, closeIntent.current.key);
        if(token!==generation.current)return;closeIntent.current = null;
      } else {
        result = await api(`/configuration-changes/${operation!.id}/${action}`, { expectedVersion: operation!.version,
          ...(action === 'cancel' ? {} : { previewHash: operation!.previewHash }) }, action === 'submit' ? `billing-config-${operation!.id}` : undefined);
      }
      if(token!==generation.current)return;setOperation(result);
      if (['SUCCEEDED','CANCELLED','SCHEDULED','BLOCKED'].includes(result.state)) setReload(v => v + 1);
    } catch (cause) {
      if(token!==generation.current)return;
      const code = (cause as { code?: string }).code;
      const status=(cause as {status?:number}).status;if((action==='save'||action==='copy')&&status&&status>=400&&status<500)draftIntent.current=null;
      setError(code === 'CONTROL_REFUND_CONFIG_REQUIRED' ? 'กรอกวงเงินคืนเงินก่อนเปิดรับคำขอ หรือปิดสวิตช์รับคำขอคืนเงินแล้วตรวจผลกระทบอีกครั้ง' : code === 'CONTROL_REAUTH_REQUIRED' ? 'ยืนยันรหัสผ่านก่อน แล้วกดดำเนินการรายการเดิมอีกครั้ง' :
        code === 'CONTROL_PREVIEW_STALE' ? 'ข้อมูลเปลี่ยนหรือคำขอหมดอายุ โหลดข้อมูลล่าสุดและตรวจผลกระทบใหม่' :
          code ? apiErrorMessage(cause) : 'ยังยืนยันผลไม่ได้ โหลดคำขอเดิมเพื่อตรวจสอบก่อนลองใหม่');
    } finally { if(token===generation.current){if (action === 'reauthenticate') setPassword(''); setBusy(false);} }
  }
  const issuer = policy?.issuer ?? { legalName: '', address: '', thaiTaxId: '', stripeTaxId: '' };
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">ตั้งค่าการชำระเงิน</h1>
    <nav className="flex flex-wrap gap-3"><Link onClick={leaving} className={button} href="/system/billing">กลับหน้าดูแลการชำระเงิน</Link>
      <Link onClick={leaving} className={button} href="/system/billing/configuration-checks">ตรวจการเชื่อมต่อ Stripe</Link>
      {operationId && <Link onClick={leaving} className={button} href="/system/billing/settings">สร้างคำขอตั้งค่าใหม่</Link>}
      <button className={button} disabled={busy || loading} onClick={() => setReload(v => v + 1)}>โหลดการตั้งค่าล่าสุด</button></nav>
    {loading && <p role="status">กำลังโหลด…</p>}{error && <p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {!loading && settings && policy && gates && <>
      <p>{billingLabel('mode',settings.mode)} · เวอร์ชัน {settings.version} · {settings.policyRevisionId ? 'มีนโยบายที่เผยแพร่แล้ว' : 'ยังรอตั้งค่าและอนุมัตินโยบาย'}</p>
      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="ยืนยันตัวตนเพื่อเปลี่ยนการตั้งค่า">
        <h2 className="font-bold">ยืนยันรหัสผ่าน</h2>
        <p>การส่งและอนุมัติคำขอต้องยืนยันรหัสผ่านปัจจุบัน ใช้ได้ 5 นาทีในอุปกรณ์นี้</p>
        {settings.reauthenticatedUntil && <p role="status">ยืนยันแล้วถึง {new Date(settings.reauthenticatedUntil).toLocaleTimeString('th-TH')}</p>}
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act('reauthenticate'); }}>
          <label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" value={password} maxLength={1024} onChange={e => setPassword(e.target.value)} /></label>
          <button className={button} disabled={busy || !password}>ยืนยันรหัสผ่าน</button>
          <Link onClick={leaving} className="ml-3 underline" href="/login">กลับไปเข้าสู่ระบบหรือกู้บัญชี</Link>
        </form>
      </section>
      {(!operationId||operation?.canEditDraft) && settings.mode !== 'DISABLED' && (canPolicy || canGates) && <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="ร่างการตั้งค่า">
        <h2 className="text-lg font-bold">ร่างสำหรับรายการซื้อใหม่</h2>
        <p>บันทึกและกลับมาแก้ได้โดยยังไม่เปลี่ยนค่าที่ใช้งานจริง ตรวจผลกระทบและขออนุมัติเมื่อพร้อม</p>
        <p>ราคาและนโยบายของสัญญาที่จ่ายแล้วคงเดิม การเปลี่ยนนี้ไม่ย้ายสมาชิกเดิมหรือแก้เอกสารย้อนหลัง</p>
        <fieldset disabled={busy || !canPolicy} className="space-y-3">
          <div ref={offerInputs}><BillingOfferTermsEditor key={`${settings.version}:${draft?.id??''}:${draft?.version??''}`} policy={policy} onChange={setPolicy}/></div>
          <BillingSalesCohortPicker ids={policy.salesCompanyIds} companies={(draft ? draft.salesCompanies : settings.salesCompanies) ?? []} onChange={ids => setPolicy({ ...policy, salesCompanyIds: ids })} />
          <label className="block">ภาษีมูลค่าเพิ่ม<select aria-label="ภาษีมูลค่าเพิ่ม" className={field} value={policy.taxTreatment ?? ''} onChange={e => setPolicy({ ...policy,
            taxTreatment: e.target.value as BillingPolicy['taxTreatment'], taxRateId: e.target.value === 'NOT_VAT_REGISTERED' ? null : policy.taxRateId })}>
            <option value="NOT_VAT_REGISTERED">ปิด — ยังไม่จด VAT</option><option value="INCLUSIVE_VAT_7">เปิด 7% — รวมในราคา</option><option value="EXCLUSIVE_VAT_7">เปิด 7% — บวกจากราคา</option>
          </select></label>
          {policy.taxTreatment !== 'NOT_VAT_REGISTERED' && <div className="space-y-3 rounded-lg bg-gray-50 p-3">
            <p>ตรวจข้อมูลกิจการและเลขภาษีของบัญชี Stripe ก่อนอนุมัติ</p>
            {([['legalName', 'ชื่อกิจการตามทะเบียน'], ['address', 'ที่อยู่กิจการ'], ['thaiTaxId', 'เลขประจำตัวผู้เสียภาษี 13 หลัก'], ['stripeTaxId', 'Stripe Account Tax ID']] as const).map(([key, label]) =>
              <label className="block" key={key}>{label}<input className={field} value={issuer[key]} maxLength={key === 'address' ? 1000 : 250} onChange={e => setPolicy({ ...policy, issuer: { ...issuer, [key]: e.target.value } })} /></label>)}
            <label className="block">Stripe Tax Rate ID<input className={field} value={policy.taxRateId ?? ''} onChange={e => setPolicy({ ...policy, taxRateId: e.target.value || null })} /></label>
          </div>}
          <label className="block">ระยะผ่อนผันเมื่อต่ออายุไม่ผ่าน (วัน)<input className={field} type="number" min={0} max={30} value={policy.graceDays ?? ''} onChange={e => setPolicy({ ...policy, graceDays: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <section aria-label="กำหนดเวลาติดตามเคสส่วนกลาง" className="space-y-3 rounded-xl border p-3">
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={policy.supportSlaMinutes!=null} onChange={e=>setPolicy({...policy,supportSlaMinutes:e.target.checked?{NORMAL:0,HIGH:0,CRITICAL:0}:null})}/>ใช้กำหนดเวลาติดตามเคสส่วนกลาง</label>
            <p className="text-base">ใช้กับเคสใหม่หรือรอบที่เปิดอีกครั้ง กำหนดเวลาของเคสเดิมยังคงอยู่ เวลาที่ระบุเองในเคสมีผลก่อนเกณฑ์อัตโนมัติ</p>
            {policy.supportSlaMinutes&&([['NORMAL','ปกติ'],['HIGH','สูง'],['CRITICAL','วิกฤต']] as const).map(([key,label])=><label className="block" key={key}>ติดตามระดับ{label}ภายใน (นาที)<input className={field} type="number" min={1} max={525600} value={policy.supportSlaMinutes![key]||''}
              onChange={e=>setPolicy({...policy,supportSlaMinutes:{...policy.supportSlaMinutes!,[key]:Number(e.target.value)}})}/></label>)}
          </section>
          <p className="text-base">0 วันคือไม่ผ่อนผัน · เริ่มและจ่ายทันที · ยกเลิกสิ้นรอบ · คืนเงินและหนี้ค้างให้เจ้าหน้าที่ตรวจ</p>
          <section className="space-y-2 rounded-xl border p-3" aria-label="วงเงินคืนเงิน">
            <label className="block">วงเงินคืนเงินสูงสุดต่อคำขอ (บาท)<input ref={refundLimitInput} key={`${settings.version}:${draft?.id??''}:${draft?.version??''}`} className={field} inputMode="decimal"
              defaultValue={policy.refundLimitSatang==null?'':(policy.refundLimitSatang/100).toFixed(2)} onChange={e=>{
                const value=e.target.value.trim(),parts=value.split('.');
                const amount=value===''?null:/^\d{1,8}(?:\.\d{1,2})?$/.test(value)?Number(parts[0])*100+Number((parts[1]??'').padEnd(2,'0')):NaN;
                const valid=amount===null||(Number.isSafeInteger(amount)&&amount>=1&&amount<=2147483647);
                e.target.setCustomValidity(valid?'':'กรอกจำนวนเงินมากกว่า 0 ไม่เกิน 21,474,836.47 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง');
                if(valid)setPolicy({...policy,refundLimitSatang:amount});
              }}/></label>
            <p>เว้นว่างเพื่อปิดการคืนเงิน ทุกคำขอต้องมีผู้อนุมัติอีกคน การคืนเงินไม่เปลี่ยนแพ็กเกจอัตโนมัติ</p>
          </section>
          <label className="block">เวอร์ชันข้อความยินยอม<input className={field} value={policy.consentRevision} maxLength={80} onChange={e => setPolicy({ ...policy, consentRevision: e.target.value })} /></label>
          <details className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">เชื่อมราคาและ Portal ของ Stripe</summary><div className="mt-3 space-y-3">
            <label className="block">Portal Configuration ID<input className={field} value={policy.portalConfigurationId ?? ''} onChange={e => setPolicy({ ...policy, portalConfigurationId: e.target.value || null })} /></label>
            {BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => {
              const key = `${tier}:${interval}` as const;
              return <div className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2" key={key}>{(['priceIds', 'zeroPriceIds'] as const).map(kind => <label key={kind}>{billingOfferLabel(key)} · {kind === 'priceIds' ? 'ราคาเก็บเงิน' : 'ราคาศูนย์สำหรับช่วงจ่ายล่วงหน้า'}
                <input className={field} value={policy[kind]?.[key] ?? ''} onChange={e => { const mapping = { ...policy[kind] }; if (e.target.value) mapping[key] = e.target.value; else delete mapping[key]; setPolicy({ ...policy, [kind]: mapping }); }} /></label>)}</div>;
            }))}
          </div></details>
        </fieldset>
        <fieldset disabled={busy || !canGates} className="space-y-2"><legend className="mb-2 font-semibold">ช่องทางดำเนินการ</legend>
          {BILLING_ACTIONS.filter(action => action !== 'portal_change_plan').map(action => <label key={action} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={gates[action]} onChange={e => setGates({ ...gates, [action]: e.target.checked })} />{gateNames[action]}</label>)}
          <p className="text-base">ลูกค้าเปลี่ยนแพ็กเกจผ่านหน้ามั่งมี เพื่อคำนวณวันและโควตาสะสม ใช้ตัวเลือกเปลี่ยนแพ็กเกจด้านบน</p>
        </fieldset>
        <fieldset disabled={busy} className="space-y-2"><legend className="font-semibold">วันที่เริ่มใช้ค่า</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={scheduled} onChange={e=>setScheduled(e.target.checked)}/>กำหนดวันเริ่มใช้ล่วงหน้า</label>
          {scheduled?<><label className="block">วันและเวลาที่ให้มีผล<input type="datetime-local" className={field} value={localTime(effectiveAt)} onChange={e=>setEffectiveAt(Number.isFinite(Date.parse(e.target.value))?new Date(e.target.value).toISOString():null)}/></label>
            <p className="text-base">เวลาในอุปกรณ์นี้: {Intl.DateTimeFormat().resolvedOptions().timeZone} · เลือกล่วงหน้าอย่างน้อยหนึ่งนาทีและไม่เกินหนึ่งปี ต้องอนุมัติก่อนเวลาที่เลือก</p></>:<p>ใช้ค่าทันทีหลังผู้ดูแลอีกคนอนุมัติ</p>}
        </fieldset>
        <div><label className="block" htmlFor="billing-policy-reason">เหตุผลการเปลี่ยนค่า</label><textarea id="billing-policy-reason" className={field} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></div>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||!reason.trim()||(scheduled&&!effectiveAt)} onClick={()=>void act('save')}>บันทึกฉบับร่าง</button><button className={button} disabled={busy || !reason.trim() || draftChanged||(scheduled&&!effectiveAt)} onClick={() => void act('preview')}>ตรวจผลกระทบการตั้งค่า</button>
          {!draft&&canGates && <button className={button} disabled={busy || !reason.trim() || !BILLING_ACTIONS.some(a => settings.gates[a] && !gates[a])} onClick={() => void act('close')}>หยุดเฉพาะช่องทางที่เอาเครื่องหมายออกทันที</button>}</div>
        {draftChanged&&<p>มีการแก้ไขที่ยังไม่บันทึก กรุณาบันทึกฉบับร่างก่อนตรวจผลกระทบ</p>}
        <p className="text-base">หยุดรับรายการใหม่ไม่หยุดการต่ออายุเดิม หน้าชำระที่ออกไปแล้วต้องตรวจแยก การเปิดกลับต้องมีผู้อนุมัติอีกคน</p>
      </section>}
      {operation && <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="คำขอเปลี่ยนการตั้งค่า">
        <h2 className="text-lg font-bold" role="status">{stateNames[operation.state] ?? billingLabel('operation',operation.state)}</h2>
        {operation.proposed.effectiveAt&&<p>กำหนดใช้ค่า {new Date(operation.proposed.effectiveAt).toLocaleString('th-TH')} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p>}
        {operation.state==='SCHEDULED'&&<p>{operation.scheduleDue?'ถึงกำหนดแล้ว รอระบบตรวจและใช้ค่า กดดำเนินการด้านล่างได้หากยังรออยู่':'ค่าปัจจุบันยังใช้อยู่ ระบบจะตรวจข้อมูลและสิทธิ์อีกครั้งเมื่อถึงกำหนด'}</p>}
        {operation.state==='BLOCKED'&&<p role="alert">ยังใช้ค่าตามกำหนดไม่ได้ ตรวจสิทธิ์และการตั้งค่าล่าสุด แล้วสร้างฉบับร่างจากคำขอนี้เพื่อขออนุมัติใหม่</p>}
        <p>{operation.reason}</p><p className="break-all text-base">เลขคำขอ {operation.id} · เวอร์ชัน {operation.version}</p>
        {['PREVIEW', 'AWAITING_APPROVAL'].includes(operation.state) && <p>ใช้คำขอได้ถึง {new Date(operation.expiresAt).toLocaleString('th-TH')}
          {new Date(operation.expiresAt).getTime() <= Date.now() && ' · หมดอายุแล้ว กลับหน้าตั้งค่าเพื่อตรวจผลกระทบและส่งคำขอใหม่'}</p>}
        {operation.impact&&<p>สมาชิกเดิม {operation.impact.subscriptions} · รายการชำระที่กำลังดำเนินการ {operation.impact.inFlightAttempts} · ใบเสนอราคาที่ยังไม่ใช้ {operation.impact.unusedQuotes} · คำสั่งลดแพ็กเกจ {operation.impact.pendingPlanChanges} · คำสั่งต่ออายุที่ยังดำเนินการ {operation.impact.collectionCommands}</p>}
        {operation.impact&&<Link onClick={leaving} className="block underline" href={`/system/billing/configuration-changes/${operation.id}/affected`}>เปิดดูรายการที่เกี่ยวข้อง</Link>}
        <p>ภาษี {billingLabel('tax',operation.proposed.policy.taxTreatment)} · ผ่อนผัน {operation.proposed.policy.graceDays} วัน</p>
        {operation.impact?.refundLimit&&<section aria-label="ผลต่อวงเงินคืนเงิน" className="space-y-2 rounded-xl border p-3">
          <p>วงเงินต่อคำขอ เดิม: {operation.impact.refundLimit.before==null?'ปิดการคืนเงิน':money(operation.impact.refundLimit.before)} · หลังอนุมัติ: {operation.impact.refundLimit.after==null?'ปิดการคืนเงิน':money(operation.impact.refundLimit.after)}</p>
          <p>ทุกคำขอต้องอนุมัติแยกกัน สิทธิ์แพ็กเกจและเอกสารเดิมไม่เปลี่ยน</p>
        </section>}
        {operation.impact?.supportSla&&<section aria-label="ผลต่อกำหนดเวลาติดตามเคส" className="space-y-2 rounded-xl border p-3">
          <p>ใช้กับเคสใหม่หรือรอบที่เปิดอีกครั้ง กำหนดเวลาเดิมไม่เปลี่ยน</p>
          {(['before','after'] as const).map(key=><p key={key}>{key==='before'?'เดิม':'หลังอนุมัติ'}: {operation.impact!.supportSla![key]?`ปกติ ${operation.impact!.supportSla![key]!.NORMAL} · สูง ${operation.impact!.supportSla![key]!.HIGH} · วิกฤต ${operation.impact!.supportSla![key]!.CRITICAL} นาที`:'ปิดเกณฑ์อัตโนมัติ'}</p>)}
        </section>}
        {operation.proposed.policy.issuer && <p>{operation.proposed.policy.issuer.legalName} · {operation.proposed.policy.issuer.address} · เลขภาษี {operation.proposed.policy.issuer.thaiTaxId}</p>}
        {operation.impact&&<section className="space-y-3" aria-label="ยอดชำระก่อนและหลัง"><h3 className="font-semibold">ยอดชำระและใบเสร็จก่อนและหลัง</h3>
          <div className="grid gap-3 sm:grid-cols-2">{operation.impact.prices.map(p=><article key={p.offerKey} className="space-y-2 rounded-lg bg-gray-50 p-3">
            <h4 className="font-semibold">{billingOfferLabel(p.offerKey)}</h4><div className="grid grid-cols-2 gap-3">
              <div><p className="text-gray-600">เดิม</p><p>{money(p.beforeTotalSatang)}</p>{p.beforeReceiptAllowance!=null&&<p>{p.beforeReceiptAllowance.toLocaleString('th-TH')} ใบ</p>}</div>
              <div><p className="text-gray-600">ใหม่</p><p>{money(p.afterTotalSatang)}</p>{p.afterReceiptAllowance!=null&&<p>{p.afterReceiptAllowance.toLocaleString('th-TH')} ใบ</p>}</div>
            </div></article>)}</div>
        </section>}
        <section className="space-y-2" aria-label="กลุ่มบริษัทในคำขอ">
          <p>กลุ่มที่เสนอ: {operation.proposed.policy.salesCompanyIds == null ? 'ทุกบริษัท รวมบริษัทที่จะสมัครภายหลัง' : `${operation.proposed.policy.salesCompanyIds.length} บริษัทที่เลือก`}</p>
          {operation.impact?.salesCohort && <p>กลุ่มเดิม: {operation.impact.salesCohort.before == null ? 'ทุกบริษัท' : `${operation.impact.salesCohort.before.length} บริษัท`}</p>}
          <ul>{(operation.impact?.salesCohort?.companies ?? operation.salesCompanies ?? []).map(c => <li key={c.id} className="break-all">
            <Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(c.id)}`}>{c.name}</Link> · {billingLabel('company',c.status)} · {operation.proposed.policy.salesCompanyIds == null || operation.proposed.policy.salesCompanyIds.includes(c.id) ? 'อยู่ในกลุ่มใหม่' : 'ออกจากกลุ่มใหม่'}
          </li>)}</ul>
        </section>
        <ul className="space-y-1">{BILLING_ACTIONS.map(a => <li key={a}>{gateNames[a]}: {operation.proposed.gates[a] ? 'เปิด' : 'ปิด'}</li>)}</ul>
        <p>สัญญาที่จ่ายแล้วใช้เงื่อนไขเดิม {operation.state==='SUCCEEDED'?'คำขอนี้ผ่านการอนุมัติและนำไปใช้แล้ว':'การบันทึกหรือดูร่างยังไม่เปลี่ยนค่าที่ใช้งานอยู่'}</p>
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action => <button key={action} className={button} disabled={busy} onClick={() => void act(action)}>
          {action === 'submit' ? 'ส่งคำขอให้ผู้อนุมัติ' : action === 'approve' ? (operation.proposed.effectiveAt?'อนุมัติและรอวันที่กำหนด':'อนุมัติและใช้ค่าชุดนี้') : action==='apply'?'ใช้ค่าที่อนุมัติไว้ตอนนี้':'ยกเลิกคำขอนี้'}</button>)}</div>
        {operation.sourceDraftVersion!==undefined&&operation.referenceId&&<Link onClick={leaving} className="block underline" href={`/system/billing/configuration-changes/${operation.referenceId}`}>กลับฉบับร่างต้นทาง รุ่น {operation.sourceDraftVersion}</Link>}
        {operation.state!=='DRAFT'&&(operation.type==='PUBLISH_POLICY'?canPolicy:canGates)&&<div className="space-y-2">
          {operation.type==='SET_ACTION_GATE'&&<p>การสร้างร่างใหม่จะคัดลอกเฉพาะค่าสวิตช์ และใช้นโยบายล่าสุดที่โหลดไว้</p>}
          <button className={button} disabled={busy} onClick={()=>void act('copy')}>สร้างฉบับร่างจากคำขอนี้</button></div>}
        {operation.state==='DRAFT'&&<p>ฉบับร่างนี้ยังไม่มีผลกับระบบ การยกเลิกฉบับร่างไม่ยกเลิกคำขอที่สร้างไปแล้ว ให้เปิดคำขอในประวัติเพื่อตรวจแยก</p>}
        <Link onClick={leaving} className="inline-block break-all underline" href={`/system/billing/configuration-changes/${operation.id}`}>เปิดลิงก์คำขอนี้</Link>
        {operation.state === 'AWAITING_APPROVAL' && <p>ผู้ดูแลอีกคนที่มีสิทธิ์อนุมัติเปิดลิงก์นี้ ตรวจผลกระทบ และยืนยันรหัสผ่านก่อนอนุมัติได้</p>}
      </section>}
      <section className="space-y-3" aria-label="ประวัติการตั้งค่า"><h2 className="font-bold">ประวัติและคำขอที่รอ</h2>
        {history?.items.map(o => <p key={o.id}><Link onClick={leaving} className="underline" href={`/system/billing/configuration-changes/${o.id}`}>{stateNames[o.state] ?? billingLabel('operation',o.state)} · {o.reason}</Link></p>)}
        {history?.nextCursor && <button className={button} onClick={() => setCursor(history.nextCursor)}>ประวัติหน้าถัดไป</button>}
        {cursor && <button className={button} onClick={() => setCursor(null)}>ประวัติหน้าแรก</button>}
      </section>
    </>}
  </main>;
}
function localTime(value:string|null){if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}

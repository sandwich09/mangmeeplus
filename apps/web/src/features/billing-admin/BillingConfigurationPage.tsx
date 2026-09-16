'use client';
import { billingLink, billingField, billingApprovalLabel, billingControl, billingPrimaryControl, billingLabel, billingOfferLabel, billingLeavesPage } from '../billing/billing-display';
import BillingDateTimeField from './BillingDateTimeField';
import { billingLocalTime, billingTimeIso } from './billing-date-time';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BillingOfferTermsEditor from './BillingOfferTermsEditor';
import BillingSalesCohortPicker from './BillingSalesCohortPicker';
import { BILLING_ACTIONS, BILLING_PAID_TIERS, type BillingAction, type BillingConfiguration, type BillingConfigurationOperation, type BillingPolicy } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const button = billingControl;
const field = billingField;
const gateNames: Record<BillingAction, string> = { new_sales: 'รับรายการซื้อใหม่', plan_changes: 'ซื้อซ้ำและเปลี่ยนแพ็กเกจ',
  portal_payment_method: 'เปิดหน้าแก้บัตร', portal_change_plan: 'เปลี่ยนแพ็กเกจผ่าน Portal', portal_cancel_subscription: 'ยกเลิกหรือกลับมาต่ออายุ', notification_delivery: 'ส่งข้อความแจ้งสถานะ', refunds:'รับคำขอคืนเงินที่ต้องอนุมัติ' };
const stateNames: Record<string, string> = { DRAFT: 'ฉบับร่างที่บันทึกไว้', PREVIEW: '2. ตรวจผลก่อนยืนยัน', AWAITING_APPROVAL: '3. ยืนยันใช้การตั้งค่า', SCHEDULED:'อนุมัติแล้ว รอถึงกำหนด',RUNNING:'กำลังตรวจและใช้ค่าตามกำหนด',BLOCKED:'ต้องตรวจคำขอตามกำหนดใหม่', SUCCEEDED: 'การตั้งค่านี้มีผลแล้ว', CANCELLED: 'ยกเลิกคำขอนี้แล้ว' };
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value / 100);
const api = <T,>(path: string, body?: unknown, key?: string) => authedApiFetch<T>(`/system/billing${path}`, { cache: 'no-store', suppressErrorToast: true,
  ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } }) });
export default function BillingConfigurationPage({ operationId }: { operationId?: string }) {
  const [topic,setTopic]=useState('');
  const editor=useRef<HTMLElement|null>(null);
  const [settings, setSettings] = useState<BillingConfiguration | null>(null), [policy, setPolicy] = useState<BillingPolicy | null>(null);
  const [gates, setGates] = useState<BillingConfiguration['gates'] | null>(null), [reason, setReason] = useState(''), [password, setPassword] = useState('');
  const [scheduled,setScheduled]=useState(false),[effectiveAt,setEffectiveAt]=useState<string|null>(null);
  const [operation, setOperation] = useState<BillingConfigurationOperation | null>(null), [history, setHistory] = useState<{ items: BillingConfigurationOperation[]; nextCursor: string | null } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!error) return;
    const target = error.startsWith('ยืนยันรหัสผ่านก่อน') ? document.querySelector<HTMLInputElement>('#billing-reauthentication input') : document.getElementById('billing-config-error');
    target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true });
  }, [error]);
  useEffect(() => {
    if (!operation || operation.state === 'DRAFT') return;
    const target = document.getElementById('billing-config-result');
    target?.scrollIntoView({ block: 'start' }); target?.focus({ preventScroll: true });
  }, [operation?.id, operation?.state]);
  const offerInputs=useRef<HTMLDivElement|null>(null);
  const generation=useRef(0);
  const invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const refundLimitInput=useRef<HTMLInputElement|null>(null);
  const draftIntent=useRef<{key:string;body:unknown}|null>(null);
  const draft=operation?.state==='DRAFT'?operation:null;
  const draftChanged=Boolean(draft&&JSON.stringify([policy,gates,reason,scheduled?billingTimeIso(effectiveAt??''):null])!==JSON.stringify([draft.proposed.policy,draft.proposed.gates,draft.reason,draft.proposed.effectiveAt??null]));
  const closeIntent = useRef<{ key: string; body: unknown } | null>(null);
  useEffect(()=>{invalidate();draftIntent.current=null;closeIntent.current=null;setOperation(null);setCursor(null);setReason('');setScheduled(false);setEffectiveAt(null);},[operationId]);
  useEffect(() => {
    const token=++generation.current;let active = true; setLoading(true); setBusy(false);setError('');
    Promise.all([api<BillingConfiguration>('/settings'), operationId ? api<BillingConfigurationOperation>(`/configuration-changes/${encodeURIComponent(operationId)}`) : null,
      api<{ items: BillingConfigurationOperation[]; nextCursor: string | null }>(`/configuration-changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)])
      .then(([s, op, h]) => { if (active&&token===generation.current) { setSettings(s); setPolicy(op?.state==='DRAFT'?op.proposed.policy:s.policy); setGates(op?.state==='DRAFT'?op.proposed.gates:s.gates); setHistory(h); if (operationId) {setOperation(op);setReason(op?.state==='DRAFT'?op.reason:'');setScheduled(Boolean(op?.proposed.effectiveAt));setEffectiveAt(billingLocalTime(op?.proposed.effectiveAt??null));} } })
      .catch(() => { if (active&&token===generation.current) { setSettings(null); setOperation(null); setError('โหลดการตั้งค่าไม่ได้ ตรวจสอบสิทธิ์ระดับระบบแล้วลองใหม่'); } })
      .finally(() => { if (active&&token===generation.current) setLoading(false); });
    return () => { active = false;invalidate(); };
  }, [operationId, cursor, reload]);
  const canPolicy = settings?.capabilities.includes('system.billing.policy.manage'), canGates = settings?.capabilities.includes('system.billing.gate.manage');
  async function act(action: 'reauthenticate' | 'preview' | 'submit' | 'approve' | 'cancel' | 'close' | 'save' | 'copy' | 'apply') {
    if (busy || !settings || !policy || !gates) return;
    if(['save','preview'].includes(action)){
      const invalid=Array.from(editor.current?.querySelectorAll<HTMLInputElement>('input:not(:disabled)')??[]).find(input=>!input.checkValidity());
      if(invalid){
        setTopic(invalid.closest<HTMLElement>('[data-setting-topic]')?.dataset.settingTopic??topic);
        for(let node=invalid.parentElement;node;node=node.parentElement)if(node instanceof HTMLDetailsElement)node.open=true;
        requestAnimationFrame(()=>{invalid.reportValidity();invalid.focus();});return;
      }
      if(scheduled&&!billingTimeIso(effectiveAt??'')){setError('ระบุวันที่และเวลาเริ่มใช้ให้ครบ เช่น 09:00 (เวลาประเทศไทย)');return;}
    }
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
          {type:draft?.type??(canPolicy?'PUBLISH_POLICY':'SET_ACTION_GATE'),expectedVersion:draft?.version??0,policy,gates,reason,effectiveAt:scheduled?(billingTimeIso(effectiveAt??'')??''):null,...draft?{draftId:draft.id}:{}}};
        result=await api('/configuration-drafts',draftIntent.current.body,draftIntent.current.key);if(token!==generation.current)return;draftIntent.current=null;
        setPolicy(result.proposed.policy);setGates(result.proposed.gates);setReason(result.reason);setScheduled(Boolean(result.proposed.effectiveAt));setEffectiveAt(billingLocalTime(result.proposed.effectiveAt??null));
        void api<NonNullable<typeof history>>('/configuration-changes').then(value=>{if(token===generation.current)setHistory(value);}).catch(()=>{});
      } else if (action === 'preview') {
        result = await api('/configuration-changes/preview', { type: draft?.type??(canPolicy ? 'PUBLISH_POLICY' : 'SET_ACTION_GATE'), expectedVersion: settings.version, policy, gates, reason,effectiveAt:scheduled?(billingTimeIso(effectiveAt??'')??''):null,...draft?{draftId:draft.id,draftVersion:draft.version}:{} });
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
  const reauthenticated=Boolean(settings?.reauthenticatedUntil&&Date.parse(settings.reauthenticatedUntil)>Date.now());
  const reauthentication = reauthenticated?<p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">ยืนยันตัวตนแล้ว ดำเนินการได้ถึง {formatThaiDateTime(settings!.reauthenticatedUntil!)}</p>:(<section id="billing-reauthentication" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-label="ยืนยันตัวตนเพื่อเปลี่ยนการตั้งค่า">
        <h2 className="font-bold">ยืนยันรหัสผ่าน</h2>
        <p>การส่งและอนุมัติคำขอต้องยืนยันรหัสผ่านปัจจุบัน ใช้ได้ 5 นาทีในอุปกรณ์นี้</p>

        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act('reauthenticate'); }}>
          <label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" value={password} maxLength={1024} onChange={e => setPassword(e.target.value)} /></label>
          <button className={billingPrimaryControl} disabled={busy || !password} aria-busy={Boolean(busy)}>ยืนยันรหัสผ่าน</button>
          <Link onClick={leaving} className="ml-3 underline" href="/login">กลับไปเข้าสู่ระบบหรือกู้บัญชี</Link>
        </form>
      </section>);
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <Link onClick={leaving} className={billingLink} href="/system/billing">กลับหน้าการชำระเงิน</Link>
    <header><h1 className="text-2xl font-semibold text-gray-900">ตั้งค่าการชำระเงิน</h1><p className="mt-2 text-gray-600">กำหนดราคา เงื่อนไข และบริการที่ลูกค้าใช้ได้</p></header>
    {loading && <p role="status">กำลังโหลด…</p>}{error && <p id="billing-config-error" tabIndex={-1} role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {!loading && settings && policy && gates && <>
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="การตั้งค่าที่ใช้งานอยู่"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">ค่าที่ใช้งานอยู่</h2><span className="text-sm text-gray-600">{billingLabel('mode',settings.mode)}</span></div>
        {!settings.policyRevisionId&&<p className="rounded-lg bg-amber-50 p-3 text-amber-900">ยังไม่ได้ประกาศใช้นโยบายการชำระเงิน ตรวจค่าด้านล่างและยืนยันก่อนเปิดรับซื้อ</p>}
        <dl className="grid gap-4 sm:grid-cols-3"><div><dt className="text-gray-600">รับรายการซื้อใหม่</dt><dd className="mt-1 font-medium">{settings.gates.new_sales?'เปิด':'ปิด'}</dd></div><div><dt className="text-gray-600">ภาษี</dt><dd className="mt-1 font-medium">{billingLabel('tax',settings.policy.taxTreatment)}</dd></div><div><dt className="text-gray-600">ผ่อนผันเมื่อต่ออายุไม่ผ่าน</dt><dd className="mt-1 font-medium">{settings.policy.graceDays==null?'ยังไม่กำหนด':`${settings.policy.graceDays} วัน`}</dd></div></dl>
        <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">การเชื่อมต่อและการอ่านข้อมูลใหม่</summary><div className="flex flex-wrap gap-3"><Link onClick={leaving} className={billingLink} href="/system/billing/configuration-checks">ดูการเชื่อมต่อ Stripe</Link><button className={button} disabled={busy||loading} onClick={()=>setReload(v=>v+1)}>อ่านการตั้งค่าใหม่</button></div><p className="mt-2 text-sm text-gray-600">การอ่านใหม่จะนำค่าที่บันทึกแล้วกลับมาแทนร่างที่ยังไม่บันทึก</p></details>
      </section>
      {(!operation||operation.state==='DRAFT')&&(!operationId||operation?.canEditDraft) && settings.mode !== 'DISABLED' && (canPolicy || canGates) && <section ref={editor} className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="ร่างการตั้งค่า">
        <div><h2 className="text-lg font-semibold">1. เลือกเรื่องที่ต้องการแก้</h2><p className="mt-2 text-gray-600">ค่าที่แก้ยังเป็นร่าง ต้องตรวจผลกระทบและยืนยันก่อนเริ่มใช้</p></div>
        <label className="block max-w-lg">หัวข้อการตั้งค่า<ThemedSelect aria-label="หัวข้อการตั้งค่า" className={field} value={topic} disabled={busy} onChange={e=>setTopic(e.target.value)}><option value="">เลือกหัวข้อ</option>{canPolicy&&<><option value="packages">ราคาและสิทธิ์แพ็กเกจ</option><option value="policy">ภาษี ระยะผ่อนผัน และวงเงินคืนเงิน</option><option value="followup">เวลาติดตามปัญหาการชำระเงิน</option><option value="stripe">เชื่อมราคาและหน้าจัดการบัตรของ Stripe</option></>}{(canPolicy||canGates)&&<option value="sales">เปิด–ปิดการซื้อและบริการ</option>}</ThemedSelect></label>
        <fieldset hidden={topic!=='packages'} data-setting-topic="packages" disabled={busy||!canPolicy} className="space-y-4">          <div ref={offerInputs}><BillingOfferTermsEditor key={`${settings.version}:${draft?.id??''}:${draft?.version??''}`} policy={policy} onChange={setPolicy}/></div>
</fieldset>
        <fieldset hidden={topic!=='policy'} data-setting-topic="policy" disabled={busy||!canPolicy} className="space-y-4">          <label className="block">ภาษีมูลค่าเพิ่ม<ThemedSelect disabled={busy || !canPolicy} aria-label="ภาษีมูลค่าเพิ่ม" className={field} value={policy.taxTreatment ?? ''} onChange={e => setPolicy({ ...policy,
            taxTreatment: e.target.value as BillingPolicy['taxTreatment'], taxRateId: e.target.value === 'NOT_VAT_REGISTERED' ? null : policy.taxRateId })}>
            <option value="NOT_VAT_REGISTERED">ปิด — ยังไม่จด VAT</option><option value="INCLUSIVE_VAT_7">เปิด 7% — รวมในราคา</option><option value="EXCLUSIVE_VAT_7">เปิด 7% — บวกจากราคา</option>
          </ThemedSelect></label>
          {policy.taxTreatment !== 'NOT_VAT_REGISTERED' && <div className="space-y-3 rounded-lg bg-gray-50 p-3">
            <p>ตรวจข้อมูลกิจการและเลขภาษีของบัญชี Stripe ก่อนอนุมัติ</p>
            {([['legalName', 'ชื่อกิจการตามทะเบียน'], ['address', 'ที่อยู่กิจการ'], ['thaiTaxId', 'เลขประจำตัวผู้เสียภาษี 13 หลัก'], ['stripeTaxId', 'Stripe Account Tax ID']] as const).map(([key, label]) =>
              <label className="block" key={key}>{label}<input className={field} value={issuer[key]} maxLength={key === 'address' ? 1000 : 250} onChange={e => setPolicy({ ...policy, issuer: { ...issuer, [key]: e.target.value } })} /></label>)}
            <label className="block">Stripe Tax Rate ID<input className={field} value={policy.taxRateId ?? ''} onChange={e => setPolicy({ ...policy, taxRateId: e.target.value || null })} /></label>
          </div>}
          <label className="block">ระยะผ่อนผันเมื่อต่ออายุไม่ผ่าน (วัน)<input className={field} type="number" min={0} max={30} value={policy.graceDays ?? ''} onChange={e => setPolicy({ ...policy, graceDays: e.target.value === '' ? null : Number(e.target.value) })} /></label>
<p className="text-sm text-gray-600">ระยะผ่อนผันคือจำนวนวันที่ให้ลูกค้าใช้แพ็กเกจต่อได้หลังต่ออายุไม่ผ่าน ใส่ 0 เพื่อไม่ผ่อนผัน</p>
          <section className="space-y-2 rounded-xl border border-gray-200 p-3 bg-white" aria-label="วงเงินคืนเงิน">
            <label className="block">วงเงินคืนเงินสูงสุดต่อคำขอ (บาท)<input ref={refundLimitInput} key={`${settings.version}:${draft?.id??''}:${draft?.version??''}`} className={field} inputMode="decimal"
              defaultValue={policy.refundLimitSatang==null?'':(policy.refundLimitSatang/100).toFixed(2)} onChange={e=>{
                const value=e.target.value.trim(),parts=value.split('.');
                const amount=value===''?null:/^\d{1,8}(?:\.\d{1,2})?$/.test(value)?Number(parts[0])*100+Number((parts[1]??'').padEnd(2,'0')):NaN;
                const valid=amount===null||(Number.isSafeInteger(amount)&&amount>=1&&amount<=2147483647);
                e.target.setCustomValidity(valid?'':'กรอกจำนวนเงินมากกว่า 0 ไม่เกิน 21,474,836.47 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง');
                if(valid)setPolicy({...policy,refundLimitSatang:amount});
              }}/></label>
            <p>เว้นว่างเพื่อปิดการคืนเงิน ทุกคำขอต้องตรวจยอดและยืนยันก่อนคืนเงิน การคืนเงินไม่เปลี่ยนแพ็กเกจอัตโนมัติ</p>
          </section>
</fieldset>
        <fieldset hidden={topic!=='followup'} data-setting-topic="followup" disabled={busy||!canPolicy} className="space-y-4">          <section aria-label="กำหนดเวลาติดตามเคสส่วนกลาง" className="space-y-3 rounded-xl border border-gray-200 p-3 bg-white">
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={policy.supportSlaMinutes!=null} onChange={e=>setPolicy({...policy,supportSlaMinutes:e.target.checked?{NORMAL:0,HIGH:0,CRITICAL:0}:null})}/>กำหนดเวลาติดตามปัญหาอัตโนมัติ</label>
            <p className="text-base">เมื่อเกิดปัญหาใหม่ ระบบจะตั้งวันนัดติดตามให้ตามความเร่งด่วน ไม่เปลี่ยนนัดเดิม และยังเลือกนัดเองเป็นรายเรื่องได้</p>
            {policy.supportSlaMinutes&&([['NORMAL','ปกติ'],['HIGH','สูง'],['CRITICAL','วิกฤต']] as const).map(([key,label])=><label className="block" key={key}>ติดตามระดับ{label}ภายใน (นาที)<input className={field} type="number" min={1} max={525600} value={policy.supportSlaMinutes![key]||''}
              onChange={e=>setPolicy({...policy,supportSlaMinutes:{...policy.supportSlaMinutes!,[key]:Number(e.target.value)}})}/></label>)}
          </section>
</fieldset>
        <fieldset hidden={topic!=='stripe'} data-setting-topic="stripe" disabled={busy||!canPolicy} className="space-y-4"><p className="text-gray-600">ใช้รหัสจากบัญชี Stripe ที่เชื่อมอยู่ เมื่อตั้งราคาใหม่ ต้องให้ราคาทั้งสองระบบตรงกัน</p>          <details className="rounded-lg border border-gray-200 p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">เชื่อมราคาและ Portal ของ Stripe</summary><div className="mt-3 space-y-3">
          <label className="block">เวอร์ชันข้อความยินยอม<input className={field} value={policy.consentRevision} maxLength={80} onChange={e => setPolicy({ ...policy, consentRevision: e.target.value })} /></label>
            <p>ให้ผู้ดูแลระบบเปลี่ยนรหัสนี้เมื่อแก้เงื่อนไขที่ลูกค้าต้องยอมรับก่อนซื้อแพ็กเกจ</p>
            <label className="block">Portal Configuration ID<input className={field} value={policy.portalConfigurationId ?? ''} onChange={e => setPolicy({ ...policy, portalConfigurationId: e.target.value || null })} /></label>
            {BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => {
              const key = `${tier}:${interval}` as const;
              return <div className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2" key={key}>{(['priceIds', 'zeroPriceIds'] as const).map(kind => <label key={kind}>{billingOfferLabel(key)} · {kind === 'priceIds' ? 'ราคาเก็บเงิน' : 'ราคาศูนย์สำหรับช่วงจ่ายล่วงหน้า'}
                <input className={field} value={policy[kind]?.[key] ?? ''} onChange={e => { const mapping = { ...policy[kind] }; if (e.target.value) mapping[key] = e.target.value; else delete mapping[key]; setPolicy({ ...policy, [kind]: mapping }); }} /></label>)}</div>;
            }))}
          </div></details>
</fieldset>
        <div hidden={topic!=='sales'} data-setting-topic="sales" className="space-y-4"><fieldset disabled={busy||!canPolicy}>          <BillingSalesCohortPicker disabled={busy || !canPolicy} ids={policy.salesCompanyIds} companies={(draft ? draft.salesCompanies : settings.salesCompanies) ?? []} onChange={ids => setPolicy({ ...policy, salesCompanyIds: ids })} />
</fieldset>        <fieldset disabled={busy || !canGates} className="space-y-2"><legend className="mb-2 font-semibold">ช่องทางดำเนินการ</legend>
          {BILLING_ACTIONS.filter(action => action !== 'portal_change_plan').map(action => <label key={action} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={gates[action]} onChange={e => setGates({ ...gates, [action]: e.target.checked })} />{gateNames[action]}</label>)}
          <p className="text-base">ลูกค้าเปลี่ยนแพ็กเกจผ่านหน้ามั่งมี เพื่อคำนวณวันและโควตาสะสม ใช้ตัวเลือกเปลี่ยนแพ็กเกจด้านบน</p>
        </fieldset>
</div>
        <div hidden={!topic} className="space-y-5 border-t border-gray-100 pt-5">        <fieldset disabled={busy} className="space-y-2"><legend className="font-semibold">วันที่เริ่มใช้ค่า</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={scheduled} onChange={e=>setScheduled(e.target.checked)}/>กำหนดวันเริ่มใช้ล่วงหน้า</label>
          {scheduled?<><BillingDateTimeField label="เริ่มใช้การตั้งค่าเมื่อ" value={effectiveAt??''} onChange={setEffectiveAt} disabled={busy}/>
            <p className="text-base">เวลาประเทศไทย · เลือกล่วงหน้าอย่างน้อยหนึ่งนาทีและไม่เกินหนึ่งปี ต้องอนุมัติก่อนเวลาที่เลือก</p></>:<p>ใช้ค่าทันทีหลังตรวจและยืนยันรายการ</p>}
        </fieldset>
        <div><label className="block" htmlFor="billing-policy-reason">เหตุผลการเปลี่ยนค่า</label><textarea id="billing-policy-reason" className={field} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></div>

          <p className="text-sm text-gray-600">หากแก้หลายหัวข้อ ระบบจะรวมการเปลี่ยนทั้งหมดในร่างนี้ สัญญาที่ลูกค้าจ่ายแล้วและเอกสารเดิมไม่เปลี่ยนย้อนหลัง</p>
          <div className="flex flex-wrap gap-3"><button className={draftChanged?billingPrimaryControl:button} disabled={busy||!reason.trim()||(scheduled&&!billingTimeIso(effectiveAt??''))} aria-busy={Boolean(busy)} onClick={()=>void act('save')}>บันทึกฉบับร่าง</button><button className={draftChanged?button:billingPrimaryControl} disabled={busy||!reason.trim()||draftChanged||(scheduled&&!billingTimeIso(effectiveAt??''))} aria-busy={Boolean(busy)} onClick={()=>void act('preview')}>2. ตรวจผลก่อนยืนยัน</button></div>
          {draftChanged&&<p className="text-gray-600">มีการแก้ไขเพิ่มเติม บันทึกฉบับร่างก่อนตรวจผลอีกครั้ง</p>}
          {!draft&&canGates&&topic==='sales'&&<details className="rounded-lg border border-gray-200 p-4"><summary className="min-h-11 cursor-pointer py-2 font-medium">กรณีเร่งด่วน: หยุดบริการที่เลือกทันที</summary><div className="space-y-4 pt-3"><p>ใช้เฉพาะเมื่อจำเป็นต้องหยุดทันที หยุดได้เฉพาะบริการที่กำลังเปิดและคุณเอาเครื่องหมายออกด้านบน</p><ul className="list-inside list-disc">{BILLING_ACTIONS.filter(a=>settings.gates[a]&&!gates[a]).map(a=><li key={a}>{gateNames[a]}</li>)}</ul><p className="text-gray-600">การหยุดรับซื้อไม่หยุดการต่ออายุเดิมหรือหน้าชำระที่เปิดไว้ การเปิดกลับต้องตรวจผลและยืนยันใหม่</p>{BILLING_ACTIONS.some(a=>settings.gates[a]&&!gates[a])&&reauthentication}<button className={button} disabled={busy||!reason.trim()||!reauthenticated||!BILLING_ACTIONS.some(a=>settings.gates[a]&&!gates[a])} aria-busy={Boolean(busy)} onClick={()=>void act('close')}>ยืนยันหยุดบริการที่เลือกทันที</button></div></details>}
        </div>
      </section>}
      {draft&&<div className="flex flex-wrap items-center gap-3 rounded-lg bg-green-50 p-4"><p role="status" className="text-green-800">บันทึกฉบับร่างแล้ว ยังไม่เปลี่ยนค่าที่ลูกค้าใช้งาน</p>{draft.allowedActions.includes('cancel')&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('cancel')}>ยกเลิกฉบับร่างนี้</button>}</div>}
      {operation&&operation.state!=='DRAFT' && <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-label="คำขอเปลี่ยนการตั้งค่า">
        <h2 id="billing-config-result" tabIndex={-1} className="scroll-mt-40 text-lg font-bold">{stateNames[operation.state] ?? billingLabel('operation',operation.state)}</h2>
        {operation.proposed.effectiveAt&&<p>กำหนดใช้ค่า {formatThaiDateTime(operation.proposed.effectiveAt)} (เวลาประเทศไทย)</p>}
        {operation.state==='SCHEDULED'&&<p>{operation.scheduleDue?'ถึงกำหนดแล้ว รอระบบตรวจและใช้ค่า กดดำเนินการด้านล่างได้หากยังรออยู่':'ค่าปัจจุบันยังใช้อยู่ ระบบจะตรวจข้อมูลและสิทธิ์อีกครั้งเมื่อถึงกำหนด'}</p>}
        {operation.state==='BLOCKED'&&<p role="alert">ยังใช้ค่าตามกำหนดไม่ได้ ตรวจสิทธิ์และการตั้งค่าล่าสุด แล้วสร้างฉบับร่างจากคำขอนี้เพื่อขออนุมัติใหม่</p>}
        <p>{operation.reason}</p><details className="text-sm text-gray-600"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงคำขอตั้งค่า</summary><p className="break-all">เลขคำขอ {operation.id} · รุ่นข้อมูล {operation.version}</p></details>
        {['PREVIEW', 'AWAITING_APPROVAL'].includes(operation.state) && <p>ใช้คำขอได้ถึง {formatThaiDateTime(operation.expiresAt)}
          {new Date(operation.expiresAt).getTime() <= Date.now() && ' · หมดอายุแล้ว กลับหน้าตั้งค่าเพื่อตรวจผลกระทบและส่งคำขอใหม่'}</p>}
        {operation.impact&&<details className="rounded-lg border border-gray-200 p-3"><summary className="min-h-11 cursor-pointer py-2 font-medium">ลูกค้าและรายการที่เกี่ยวข้อง</summary><dl className="grid gap-3 py-3 sm:grid-cols-2">{[['สมาชิกเดิม',operation.impact.subscriptions],['รายการชำระที่ยังดำเนินการ',operation.impact.inFlightAttempts],['ใบเสนอราคาที่ยังไม่ใช้',operation.impact.unusedQuotes],['รายการลดแพ็กเกจที่รอ',operation.impact.pendingPlanChanges],['รายการต่ออายุที่รอ',operation.impact.collectionCommands]].map(([title,count])=><div key={title}><dt className="text-gray-600">{title}</dt><dd className="font-medium">{count} รายการ</dd></div>)}</dl><Link onClick={leaving} className={billingLink} href={`/system/billing/configuration-changes/${operation.id}/affected`}>ดูรายละเอียดรายการที่เกี่ยวข้อง</Link></details>}
        <p>ภาษี {billingLabel('tax',operation.proposed.policy.taxTreatment)} · ผ่อนผัน {operation.proposed.policy.graceDays} วัน</p>
        {operation.impact?.refundLimit&&<section aria-label="ผลต่อวงเงินคืนเงิน" className="space-y-2 rounded-xl border border-gray-200 p-3 bg-white">
          <p>วงเงินต่อคำขอ เดิม: {operation.impact.refundLimit.before==null?'ปิดการคืนเงิน':money(operation.impact.refundLimit.before)} · หลังอนุมัติ: {operation.impact.refundLimit.after==null?'ปิดการคืนเงิน':money(operation.impact.refundLimit.after)}</p>
          <p>ทุกคำขอต้องอนุมัติแยกกัน สิทธิ์แพ็กเกจและเอกสารเดิมไม่เปลี่ยน</p>
        </section>}
        {operation.impact?.supportSla&&<section aria-label="ผลต่อกำหนดเวลาติดตามเคส" className="space-y-2 rounded-xl border border-gray-200 p-3 bg-white">
          <p>ใช้กับเคสใหม่หรือรอบที่เปิดอีกครั้ง กำหนดเวลาเดิมไม่เปลี่ยน</p>
          {(['before','after'] as const).map(key=><p key={key}>{key==='before'?'เดิม':'หลังอนุมัติ'}: {operation.impact!.supportSla![key]?`ปกติ ${operation.impact!.supportSla![key]!.NORMAL} · สูง ${operation.impact!.supportSla![key]!.HIGH} · วิกฤต ${operation.impact!.supportSla![key]!.CRITICAL} นาที`:'ปิดเกณฑ์อัตโนมัติ'}</p>)}
        </section>}
        {operation.proposed.policy.issuer && <p>{operation.proposed.policy.issuer.legalName} · {operation.proposed.policy.issuer.address} · เลขภาษี {operation.proposed.policy.issuer.thaiTaxId}</p>}
        {operation.impact&&<details className="space-y-3 rounded-lg border border-gray-200 p-3" aria-label="ยอดชำระก่อนและหลัง" open={operation.impact.prices.some(p=>p.beforeTotalSatang!==p.afterTotalSatang||p.beforeReceiptAllowance!==p.afterReceiptAllowance||p.beforeBranchLimit!==p.afterBranchLimit||p.beforeEmployeeLimit!==p.afterEmployeeLimit)}><summary className="min-h-11 cursor-pointer py-2 font-semibold">ราคาและสิทธิ์แพ็กเกจก่อน–หลัง</summary>
          <div className="grid gap-3 sm:grid-cols-2">{operation.impact.prices.map(p=><article key={p.offerKey} className="space-y-2 rounded-lg bg-gray-50 p-3">
            <h4 className="font-semibold">{billingOfferLabel(p.offerKey)}</h4><div className="grid grid-cols-2 gap-3">
              <div><p className="text-gray-600">เดิม</p><p>{money(p.beforeTotalSatang)}</p>{p.beforeReceiptAllowance!=null&&<p>{p.beforeReceiptAllowance.toLocaleString('th-TH')} ใบ</p>}</div>
              <div><p className="text-gray-600">ใหม่</p><p>{money(p.afterTotalSatang)}</p>{p.afterReceiptAllowance!=null&&<p>{p.afterReceiptAllowance.toLocaleString('th-TH')} ใบ</p>}</div>
            </div>{p.afterBranchLimit!=null&&<div className="grid grid-cols-2 gap-3"><p>{p.beforeBranchLimit} สาขา · {p.beforeEmployeeLimit} ผู้ใช้</p><p>{p.afterBranchLimit} สาขา · {p.afterEmployeeLimit} ผู้ใช้</p></div>}</article>)}</div>
          <p>เพดานใหม่ไม่ลดสิทธิ์ที่ซื้อไว้แล้ว การซื้อซ้ำหรืออัปเกรดคงเพดานเดิมที่สูงกว่า การลดแพ็กเกจยังมีผลตามวันสิ้นรอบที่ยืนยัน</p>
        </details>}
        <section className="space-y-2" aria-label="กลุ่มบริษัทในคำขอ">
          <p>กลุ่มที่เสนอ: {operation.proposed.policy.salesCompanyIds == null ? 'ทุกบริษัท รวมบริษัทที่จะสมัครภายหลัง' : `${operation.proposed.policy.salesCompanyIds.length} บริษัทที่เลือก`}</p>
          {operation.impact?.salesCohort && <p>กลุ่มเดิม: {operation.impact.salesCohort.before == null ? 'ทุกบริษัท' : `${operation.impact.salesCohort.before.length} บริษัท`}</p>}
          <ul>{(operation.impact?.salesCohort?.companies ?? operation.salesCompanies ?? []).map(c => <li key={c.id} className="break-all">
            <Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(c.id)}`}>{c.name}</Link> · {billingLabel('company',c.status)} · {operation.proposed.policy.salesCompanyIds == null || operation.proposed.policy.salesCompanyIds.includes(c.id) ? 'อยู่ในกลุ่มใหม่' : 'ออกจากกลุ่มใหม่'}
          </li>)}</ul>
        </section>
        <ul className="grid gap-2 rounded-lg bg-gray-50 p-4 sm:grid-cols-2">{BILLING_ACTIONS.filter(a=>a!=='portal_change_plan').map(a => <li key={a}>{gateNames[a]}: {operation.proposed.gates[a] ? 'เปิด' : 'ปิด'}</li>)}</ul>
        <p>สัญญาที่จ่ายแล้วใช้เงื่อนไขเดิม {operation.state==='SUCCEEDED'?'คำขอนี้ผ่านการอนุมัติและนำไปใช้แล้ว':'การบันทึกหรือดูร่างยังไม่เปลี่ยนค่าที่ใช้งานอยู่'}</p>
        {operation.approvalMode&&<p>{billingApprovalLabel(operation.approvalMode)}</p>}
        <p>ผู้ดูแลระบบยืนยันคำขอของตนเองได้ โดยต้องตรวจข้อมูลและยืนยันรหัสผ่านก่อน</p>
        {operation.allowedActions.some(action => ['submit', 'approve', 'apply'].includes(action)) && reauthentication}
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action => <button key={action} className={action === 'cancel' ? button : billingPrimaryControl} disabled={busy||(action!=='cancel'&&!reauthenticated)} aria-busy={Boolean(busy)} onClick={() => void act(action)}>
          {action === 'submit' ? 'บันทึกคำขอก่อนยืนยัน' : action === 'approve' ? (operation.proposed.effectiveAt?'อนุมัติและรอวันที่กำหนด':'อนุมัติและใช้ค่าชุดนี้') : action==='apply'?'ใช้ค่าที่อนุมัติไว้ตอนนี้':'ยกเลิกคำขอนี้'}</button>)}</div>
        {operation.sourceDraftVersion!==undefined&&operation.referenceId&&<Link onClick={leaving} className="block underline" href={`/system/billing/configuration-changes/${operation.referenceId}`}>กลับฉบับร่างต้นทาง รุ่น {operation.sourceDraftVersion}</Link>}
        {(operation.type==='PUBLISH_POLICY'?canPolicy:canGates)&&<div className="space-y-2">
          {operation.type==='SET_ACTION_GATE'&&<p>การสร้างร่างใหม่จะคัดลอกเฉพาะค่าสวิตช์ และใช้นโยบายล่าสุดที่โหลดไว้</p>}
          <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('copy')}>สร้างฉบับร่างจากคำขอนี้</button></div>}
        {operation.state === 'AWAITING_APPROVAL' && <p>ผู้มีสิทธิ์อนุมัติเปิดลิงก์นี้ ตรวจผลกระทบ และยืนยันรหัสผ่านก่อนอนุมัติได้</p>}
      </section>}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5" aria-label="ประวัติการตั้งค่า"><h2 className="font-semibold">ฉบับร่างและประวัติคำขอ</h2>
        {history?.items.map(o => <p key={o.id}><Link onClick={leaving} className="underline" href={`/system/billing/configuration-changes/${o.id}`}>{stateNames[o.state] ?? billingLabel('operation',o.state)} · {o.reason}</Link></p>)}
        {history?.nextCursor && <button className={button} onClick={() => setCursor(history.nextCursor)}>ประวัติหน้าถัดไป</button>}
        {cursor && <button className={button} onClick={() => setCursor(null)}>ประวัติหน้าแรก</button>}
      </section>
    </>}
  </main>;
}

'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLAN_TIER_PRESETS, type PlanTierKey, type BillingCatalog, type BillingQuote, type BillingStatus, type BillingAttemptView } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { PLAN_TERM_CONTACT_EMAIL, PLAN_TERM_RENEW_PHONE } from '@/features/plan-term/plan-term.logic';
import { billingApi, type BillingHistory } from './billing.api';
import BillingCollectionPanel from './BillingCollectionPanel';
import BillingCapacityPicker from './BillingCapacityPicker';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

const money = (satang: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const button = 'min-h-11 rounded-xl border border-gray-300 px-4 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50';
function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown };
  const status = value.status ?? value.statusCode;
  return typeof status === 'number' ? status : undefined;
}
function errorText(error: unknown): string {
  const status = errorStatus(error), code = apiErrorCode(error);
  if (status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'เฉพาะเจ้าของบริษัทเท่านั้นที่จัดการการชำระเงินได้';
  if (status === 429) return 'กรุณารอสักครู่แล้วลองใหม่';
  if (code === 'BILLING_QUOTE_STALE') return 'รายการหมดอายุหรือข้อมูลเปลี่ยน กรุณาเลือกราคาและยืนยันใหม่';
  if (code === 'BILLING_PLAN_CHANGE_REQUIRED') return 'การซื้อซ้ำใช้แพ็กเกจและรอบชำระเดิม หากต้องการเปลี่ยนแพ็กเกจ กรุณาติดต่อทีมงาน';
  if (code === 'BILLING_REPEAT_NOT_READY') return 'การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน';
  if (code === 'BILLING_RESTART_REVIEW') return 'ต้องตรวจสมาชิกหรือยอดค้างเดิมก่อนเริ่มแพ็กเกจใหม่ กรุณาติดต่อทีมงานพร้อมเลขบริษัท';
  if (code === 'BILLING_CAP_SELECTION_REQUIRED') return 'จำนวนสาขาหรือผู้ใช้เกินแพ็กเกจที่เลือก กรุณาจัดการสิทธิ์หรือติดต่อทีมงานก่อนยืนยัน';
  if (code === 'BILLING_DOCUMENT_PENDING') return 'Stripe กำลังเตรียมเอกสาร กรุณาลองเปิดอีกครั้ง';
  if (code === 'BILLING_PORTAL_UNAVAILABLE') return 'ยังเปิดหน้าแก้บัตรไม่ได้ กรุณาโหลดสถานะล่าสุดแล้วลองอีกครั้ง';
  if (code === 'BILLING_PORTAL_CONFIG_MISMATCH') return 'ทีมงานต้องตรวจการตั้งค่าหน้าแก้บัตรก่อน กรุณาติดต่อทีมมั่งมี';
  if (code === 'BILLING_COMPANY_HELD') return 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมมั่งมี';
  if (code === 'BILLING_REFUND_PENDING') return 'กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ กรุณาโหลดสถานะล่าสุดหรือติดต่อทีมมั่งมี';
  if (code === 'BILLING_SALES_CLOSED' || code === 'BILLING_NOT_READY') return 'ยังไม่เปิดรับชำระเงินใหม่ กรุณาติดต่อทีมงาน';
  return 'ยังยืนยันผลรายการไม่ได้ กรุณาตรวจสอบสถานะหรือติดต่อทีมงานพร้อมเลขอ้างอิง';
}
function navigateProvider(url: string, kind: 'checkout' | 'portal' | 'document') {
  const parsed = new URL(url);
  const hosts = kind === 'checkout' ? ['checkout.stripe.com'] : kind === 'portal' ? ['billing.stripe.com'] : ['invoice.stripe.com', 'pay.stripe.com', 'payments.stripe.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !hosts.includes(parsed.hostname)) throw new Error('Unexpected provider URL');
  window.location.assign(parsed.href);
}

export default function BillingPage({ companyId, returning = false, returnAttemptId = null, collectionId }: { companyId: string; returning?: boolean; returnAttemptId?: string | null; collectionId?: string }) {
  const api = useMemo(() => billingApi(companyId), [companyId]);
  const [data, setData] = useState<{ status: BillingStatus; catalog: BillingCatalog; history: BillingHistory } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const collectionChanged = useCallback(() => setReload(value => value + 1), []);
  const [email, setEmail] = useState(''), [interval, setInterval] = useState<'month' | 'year'>('month');
  const [quote, setQuote] = useState<BillingQuote | null>(null), [accepted, setAccepted] = useState(false);
  const [capacity, setCapacity] = useState<{ options: BillingCapacityOptions; billingEmail: string; repair?: { attemptId: string; attemptVersion: number }; key: string } | null>(null);
  const [capacityNotice, setCapacityNotice] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [returnAttempt, setReturnAttempt] = useState<BillingAttemptView | null>(null), [returnError, setReturnError] = useState('');
  const key = useRef(''), running = useRef(false), intervalInitialized = useRef(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, [companyId]);
  const returnComplete = returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState === 'APPLIED';
  useEffect(() => {
    if (data && !intervalInitialized.current) {
      if (!new URLSearchParams(window.location.search).has('interval') && data.status.interval) setInterval(data.status.interval);
      intervalInitialized.current = true;
    }
  }, [data]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('interval') === 'year') setInterval('year'); }, []);
  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([api.status(), api.catalog(), api.history()]).then(([status, catalog, history]) => {
      if (active) setData({ status, catalog, history });
    }).catch(e => { if (active) { setData(null); setError(errorText(e)); } });
    if (returning) {
      if (!returnAttemptId) setReturnError('ลิงก์ไม่มีเลขรายการที่ถูกต้อง กรุณาดูสถานะและประวัติการชำระเงินของบริษัท');
      else void api.attempt(returnAttemptId).then(value => { if (active) { setReturnAttempt(value); setReturnError(''); } })
        .catch(e => { if (active) { setReturnAttempt(null); setReturnError(errorStatus(e) === 404 ? 'ไม่พบรายการนี้ในบริษัทที่เลือก กรุณาดูประวัติหรือติดต่อทีมงาน' : errorText(e)); } });
    }
    return () => { active = false; };
  }, [api, reload, returning, returnAttemptId]);
  useEffect(() => {
    if (!data?.catalog) return;
    setCatalogUnavailable(Date.parse(data.catalog.validUntil) <= Date.now());
    let active = true, loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const catalog = await api.catalog();
        if (active) { setData(current => current && ({ ...current, catalog })); setCatalogUnavailable(false); }
      } catch { if (active) setCatalogUnavailable(true); }
      finally { loading = false; }
    };
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    const expiry = window.setTimeout(() => setCatalogUnavailable(true), Math.max(0, Date.parse(data.catalog.validUntil) - Date.now()));
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(expiry); document.removeEventListener('visibilitychange', visible); };
  }, [api, data?.catalog]);
  useEffect(() => {
    if (quote && data && (quote.policyRevision !== data.catalog.policyRevision ||
        !data.catalog.offers.some(offer => offer.offerKey === quote.offer.offerKey && offer.interval === quote.offer.interval && offer.availability === 'AVAILABLE'))) {
      setQuote(null); setAccepted(false); setError('ราคา หรือสถานะขายเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่');
    }
  }, [data?.catalog, quote]);
  useEffect(() => {
    if (!returning || !returnAttemptId || returnComplete || returnError || returnAttempt?.paymentState === 'FAILED') return;
    let active = true, polls = 0;
    void api.refresh().catch(e => { if (active) setError(errorText(e)); });
    const timer = window.setInterval(() => {
      if (++polls >= 8) { window.clearInterval(timer); if (active) setTimedOut(true); }
      if (active) setReload(value => value + 1);
    }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, returning, returnAttemptId, returnComplete, returnError, returnAttempt?.paymentState]);
  async function action(work: (navigate: typeof navigateProvider) => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    const current = generation.current;
    try { await work((url, kind) => { if (current === generation.current) navigateProvider(url, kind); }); }
    catch (e) { if (current === generation.current) { if ([401, 403].includes(errorStatus(e) ?? 0)) setData(null); setError(errorText(e)); } }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }
  async function requestQuote(offerKey: string, selectedInterval: string, billingEmail: string, selection?: BillingCapacitySelection) {
    try {
      const result = await api.quote(offerKey, selectedInterval, billingEmail, selection);
      key.current = crypto.randomUUID(); setAccepted(false); setQuote(result); setCapacity(null);
    } catch (error) {
      if (apiErrorCode(error) !== 'BILLING_CAP_SELECTION_REQUIRED' || selection) throw error;
      setQuote(null); setCapacity({ options: await api.capacity(offerKey, selectedInterval), billingEmail, key: crypto.randomUUID() });
    }
  }
  const status = data?.status;
  const quotaReset = status?.usage.cadence === 'LEGACY_MONTH' && status.usage.resetsAt && status.termEndsAt &&
    Date.parse(status.usage.resetsAt) < Date.parse(status.termEndsAt) ? status.usage.resetsAt : null;
  const quotaExpiry = status?.usage.expiresAt ?? status?.termEndsAt;
  const confirmed = status?.accessState === 'ACTIVE' && (returning ? returnComplete : status.paymentState === 'PAID' && status.applyState === 'APPLIED');
  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <header><p className="text-sm text-gray-500">{status?.companyName ?? 'มั่งมี'}</p><h1 className="mt-1 text-2xl font-bold">แพ็กเกจและการชำระเงิน</h1></header>
    <Link className="inline-flex min-h-11 items-center text-base underline" href="/billing/companies">เลือกบริษัทอื่น</Link>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">{error}<button className={`${button} ml-3`} disabled={busy} onClick={() => setReload(value => value + 1)}>ลองใหม่</button></div>}
    {!data && !error && <p role="status">กำลังตรวจสอบสิทธิ์และรายการชำระเงิน…</p>}
    {data && status && <>
      {status.mode === 'TEST' && <p className="rounded-xl bg-amber-50 p-3 font-semibold">โหมดทดสอบ — ไม่มีการรับเงินจริง</p>}
      {returnError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">{returnError}</p>}
      {returning && returnAttempt && <p role="status">รายการที่กลับมา: {returnAttempt.paymentState === 'FAILED' ? 'ไม่ได้ชำระสำเร็จหรือรายการหมดอายุ' : returnComplete ? 'ตรวจสอบการชำระและเปิดสิทธิ์สำเร็จ' : returnAttempt.paymentState === 'PAID' ? 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์' : 'กำลังตรวจสอบการชำระเงิน'} · <span className="break-all">{returnAttempt.attemptId}</span></p>}
      <section aria-label="สถานะแพ็กเกจ" className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">{confirmed ? 'ชำระแล้ว เปิดใช้งานแล้ว' : (returning ? returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState !== 'APPLIED' : status.paymentState === 'PAID' && status.applyState !== 'APPLIED') ? 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์' : status.paymentState === 'FAILED' ? 'เรียกเก็บเงินไม่สำเร็จ' : status.attemptId ? 'กำลังตรวจสอบรายการชำระเงิน' : status.accessState === 'EXPIRED' ? 'ครบกำหนดใช้งานแล้ว' : 'สิทธิ์ปัจจุบัน'}</h2>
        <p>แพ็กเกจ {status.tierKey && status.tierKey in PLAN_TIER_PRESETS ? PLAN_TIER_PRESETS[status.tierKey as PlanTierKey].labelTh : 'อยู่ระหว่างตรวจสอบ'} · ใช้งานได้ถึง {date(status.termEndsAt)}</p>
        <p>ใบเสร็จคงเหลือ {status.usage.remaining ?? 'ไม่จำกัด'} {status.usage.remaining !== null && 'ใบ'}{quotaReset ? ` · รอบใหม่ ${date(quotaReset)}` : quotaExpiry ? ` · ใช้ได้ถึง ${date(quotaExpiry)}` : ''}</p>
        {status.nextChargeAt && <p>เรียกเก็บเงินครั้งถัดไป {date(status.nextChargeAt)}</p>}
        {status.graceEndsAt && <p>ระยะผ่อนผันถึง {date(status.graceEndsAt)} · ใช้ยอดใบเสร็จเดิมที่เหลือได้ ไม่มีการเติมโควตาจนกว่าจะชำระสำเร็จ</p>}
        {status.purchaseEligibility === 'COMPANY_SALES_CLOSED' && <p role="status">ยังไม่เปิดรับรายการซื้อใหม่สำหรับบริษัทนี้ กรุณาติดต่อทีมงาน คุณยังตรวจสอบสถานะและรายการเดิมด้านล่างได้</p>}
        {status.refundReviewPending && <p role="status" className="rounded-xl bg-amber-50 p-3">กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ คำขอนี้ไม่เปลี่ยนสิทธิ์แพ็กเกจเดิม คุณตรวจรายการเดิมด้านล่าง หรือ <a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมมั่งมี</a> ได้</p>}
        {status.accessState === 'HELD' && <p>บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน ข้อมูลยังอยู่ครบ</p>}
        {status.reference && <p className="break-all text-xs text-gray-500">เลขอ้างอิง {status.reference}</p>}
        {returning && !confirmed && timedOut && <p role="status">ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง</p>}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={() => action(async () => { await api.refresh(); setReload(value => value + 1); })}>ตรวจสอบสถานะ</button>
          {status.attemptId && <button className={button} disabled={busy} onClick={() => action(async navigate => { const result = await api.resume(status.attemptId!); if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout'); else setReload(value => value + 1); })}>กลับไปยังรายการเดิม</button>}
          {status.allowedActions.includes('portal_payment_method') && <button className={button} disabled={busy} onClick={() => action(async navigate => navigate((await api.portal()).url, 'portal'))}>จัดการบัตรชำระเงิน</button>}
          {status.accessState === 'ACTIVE' && <a className={button} href={`/companies/${companyId}/dashboard`}>กลับไปใช้งาน</a>}
        </div>
      </section>
      <BillingCollectionPanel companyId={companyId} status={status} catalog={data.catalog} operationId={collectionId} onChange={collectionChanged} />
      {capacityNotice && status.attemptId && <p role="status">{capacityNotice}</p>}
      {status.capacityRepair && !capacity && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>ชำระสำเร็จแล้ว แต่ข้อมูลสาขาหรือผู้ใช้เปลี่ยน กรุณาเลือกสิทธิ์ล่าสุดเพื่อเปิดใช้งานจากรายการเดิม</p>
        <button className={button} disabled={busy} onClick={() => action(async () => { const repair = status.capacityRepair!; setCapacity({ options: await api.capacity(repair.offerKey, repair.interval), billingEmail: email, repair, key: crypto.randomUUID() }); })}>เลือกสิทธิ์สำหรับรายการที่จ่ายแล้ว</button></section>}
      {capacity && <BillingCapacityPicker key={capacity.options.sourceHash + capacity.key} options={capacity.options} repair={!!capacity.repair} onCancel={() => setCapacity(null)}
        onRefresh={async () => { const latest = await api.status(), options = await api.capacity(capacity.options.offerKey, capacity.options.interval);
          if (capacity.repair && !latest.capacityRepair) { setCapacity(null); setReload(v => v+1); return; }
          setCapacity({ ...capacity, options, ...(capacity.repair ? { repair: latest.capacityRepair! } : {}), key: crypto.randomUUID() }); }}
        onConfirm={async selection => {
          if (capacity.repair) {
            await api.repairCapacity(capacity.repair.attemptId, capacity.repair.attemptVersion, selection, capacity.key);
            setCapacity(null); setCapacityNotice('บันทึกการเลือกแล้ว กำลังตรวจสอบและเปิดสิทธิ์จากรายการที่จ่ายเดิม'); setReload(v => v+1);
          } else await requestQuote(capacity.options.offerKey, capacity.options.interval, capacity.billingEmail, selection);
        }} />}
      {status.allowedActions.includes('new_sales') && <section className="space-y-4" aria-label="เลือกแพ็กเกจ">
        <h2 className="text-lg font-bold">เลือกแพ็กเกจ</h2>
        {catalogUnavailable && <p role="status">ยังตรวจสอบราคาปัจจุบันไม่ได้ กรุณาลองใหม่ คุณยังดูประวัติและจัดการรายการเดิมได้</p>}
        <label className="block">อีเมลรับเอกสาร<input aria-label="อีเมลรับเอกสาร" className="mt-2 block w-full rounded-xl border p-3" type="email" value={email} maxLength={320} onChange={event => { setEmail(event.target.value); setQuote(null); setCapacity(null); }} /></label>
        <div className="flex gap-2">{(['month', 'year'] as const).map(value => <button key={value} className={button} aria-pressed={interval === value} onClick={() => { setInterval(value); setQuote(null); setCapacity(null); }}>{value === 'month' ? 'รายเดือน' : 'รายปี'}</button>)}</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.catalog.offers.filter(offer => offer.interval === interval).map(offer => <article key={offer.offerKey} className="space-y-3 rounded-2xl border bg-white p-4">
          <h3 className="font-bold">{offer.label}</h3><p className="text-xl font-bold">{money(offer.priceSatang)} / {interval === 'month' ? 'เดือน' : 'ปี'}</p>
          <p>{offer.branchLimit} สาขา · {offer.employeeLimit} ผู้ใช้</p><p>{offer.availability === 'COMING_SOON' ? 'แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน' : `${offer.receiptAllowance.toLocaleString('th-TH')} ใบ ได้ทันทีเมื่อชำระสำเร็จ`}</p>
          <button className={`${button} w-full`} disabled={busy || catalogUnavailable || Date.parse(data.catalog.validUntil) <= Date.now() || offer.availability !== 'AVAILABLE' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => action(async () => {
            await requestQuote(offer.offerKey, interval, email);
          })}>{offer.availability === 'COMING_SOON' ? 'Coming soon' : offer.availability === 'AVAILABLE' ? 'ตรวจสอบราคา' : 'ยังไม่เปิดขาย'}</button>
        </article>)}</div>
      </section>}
      {quote && <section aria-label="ยืนยันซื้อแพ็กเกจ" className="space-y-3 rounded-2xl border-2 border-green-700 bg-white p-5">
        <h2 className="text-lg font-bold">ยืนยันซื้อ {quote.offer.label} {quote.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}</h2>
        <p>{quote.companyName} · {quote.billingEmail}</p><p>ราคาก่อนภาษี {money(quote.subtotalSatang)} · ภาษี {money(quote.taxSatang)}</p>
        <p className="text-xl font-bold">ชำระวันนี้ {money(quote.totalSatang)}</p>
        <p>{quote.taxTreatment === 'NOT_VAT_REGISTERED' ? 'บริษัทผู้ให้บริการยังไม่ได้จด VAT จึงไม่มีการเรียกเก็บ VAT' : quote.taxTreatment === 'INCLUSIVE_VAT_7' ? 'ราคารวม VAT 7% แล้ว' : 'ราคาเพิ่ม VAT 7%'}</p>
        {quote.purchase?.kind === 'UPGRADE' ? <div className="space-y-2"><p>ชำระส่วนต่างและเริ่ม {quote.offer.label} เมื่อยืนยันการชำระสำเร็จ วันหมดอายุคงเดิม {date(quote.purchase.projectedPaidThrough)} เพิ่ม {quote.purchase.receiptUnitsAdded} ใบ รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts} ใบ</p><p>สาขาสูงสุด {quote.offer.branchLimit} · ผู้ใช้สูงสุด {quote.offer.employeeLimit} รวมเจ้าของ · รอบถัดไป {money(quote.upgrade!.nextRenewalTotalSatang)}</p><p>คำนวณส่วนต่าง ณ {date(quote.upgrade!.prorationAt)} · จำนวนคงเหลือเปลี่ยนตามการใช้งานระหว่างชำระ</p><ul className="space-y-1">{quote.upgrade!.segments.map((segment,index)=><li key={index}>{date(segment.start)} ถึง {date(segment.end)}: {money(segment.amountSatang)} · เพิ่ม {segment.receiptUnitsAdded} ใบ</li>)}</ul></div> : quote.purchase?.kind === 'REPEAT' ? <p>ชำระทันที เพิ่ม {quote.purchase.receiptUnitsAdded} ใบ รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts} ใบ ต่ออายุจาก {date(quote.purchase.previousPaidThrough)} เป็น {date(quote.purchase.projectedPaidThrough)} · จำนวนคงเหลือเปลี่ยนตามการใช้งานระหว่างชำระ</p> : quote.purchase?.kind === 'RESTART' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ รับ {quote.offer.receiptAllowance} ใบ วันและโควตาที่หมดอายุไปแล้วไม่ทบ ประวัติชำระเงินเดิมยังดูได้</p> : <p>เริ่มแพ็กเกจและชำระทันที วันทดลองที่เหลือไม่ทบ รับโควตา {quote.offer.receiptAllowance} ใบทันทีเมื่อชำระสำเร็จ</p>}
        {quote.pendingPlanChange && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>คำสั่งลดเป็น {quote.pendingPlanChange.offer.label} จะมีผลจาก {date(quote.pendingPlanChange.oldEffectiveAt)} เป็น {date(quote.pendingPlanChange.newEffectiveAt)}</p><p>ยอดต่ออายุหลังวันนั้น {money(quote.pendingPlanChange.totalSatang)} · คงสาขา {quote.pendingPlanChange.capacity.retainedBranches.join(', ')} · คงผู้ใช้ {quote.pendingPlanChange.capacity.retainedMembers.join(', ')}</p><p>ซื้อสำเร็จจึงยืนยันวันเปลี่ยนใหม่ หากชำระไม่สำเร็จคำสั่งเดิมคงอยู่</p></div>}
        <p>ต่ออายุอัตโนมัติทุก{quote.offer.interval === 'year' ? 'ปี' : 'เดือน'}ตามแพ็กเกจ ยกเลิกมีผลสิ้นรอบ</p>
        {quote.capacity && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>เมื่อเริ่มแพ็กเกจใหม่ คงสาขา: {quote.capacity.retainedBranches.join(', ')} · พักสาขา: {quote.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p>
          <p>คงผู้ใช้: {quote.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {quote.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p>
          {quote.capacity.defaults.map((item,index) => <p key={index}>สาขาเริ่มต้นของ {item.member}: {item.branch ?? 'เลือกเมื่อเข้าใช้งาน'}</p>)}<p>ข้อมูลและประวัติยังอยู่ครบ ระบบตรวจสิทธิ์อีกครั้งก่อนเปิดใช้งาน</p></div>}
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={accepted} onChange={event => setAccepted(event.target.checked)} />ฉันตรวจสอบข้อมูลและยืนยันเงื่อนไขการชำระเงินและต่ออายุอัตโนมัติ</label>
        <div className="flex gap-2"><button className={`${button} bg-green-800 text-white`} disabled={busy || catalogUnavailable || !accepted || Date.parse(quote.expiresAt) <= Date.now()} onClick={() => action(async navigate => {
          const params = new URLSearchParams(window.location.search);
          const result = await api.checkout({ quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: params.get('channel') === 'line' ? 'line' : 'web' }, key.current);
          if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout'); else { setQuote(null); setReload(value => value + 1); }
        })}>{busy ? 'กำลังตรวจสอบ…' : 'ยืนยันและไปชำระที่ Stripe'}</button><button className={button} disabled={busy} onClick={() => setQuote(null)}>ย้อนกลับ</button></div>
      </section>}
      <section aria-label="ประวัติการชำระเงิน" className="space-y-3"><h2 className="text-lg font-bold">ประวัติและเอกสารการชำระเงิน</h2>
        {data.history.items.length === 0 && <p>ยังไม่มีรายการชำระเงิน</p>}
        {data.history.items.map(invoice => <article key={invoice.id} className="space-y-2 rounded-xl border bg-white p-4"><p>{invoice.number ?? 'รายการชำระเงิน'} · {money(invoice.amountSatang)} · {date(invoice.createdAt)}</p>
          {(invoice.refundedSatang > 0 || invoice.disputed) && <p className="text-sm text-amber-900">{invoice.refundedSatang > 0 && `ยอดคืนเงินที่ Stripe บันทึก ${money(invoice.refundedSatang)} · `}{invoice.disputed && 'มีข้อพิพาทการชำระเงิน · '}ทีมงานตรวจสิทธิ์เป็นรายกรณี · ตรวจล่าสุด {date(invoice.financialObservedAt)}</p>}
          <Link className="inline-block underline" href={`/companies/${encodeURIComponent(companyId)}/billing/invoices/${encodeURIComponent(invoice.id)}`}>ตรวจการคืนเงินและเอกสารปรับยอด</Link>
          {invoice.hasDocuments && <div className="flex flex-wrap gap-2">{(['invoice', 'receipt', 'pdf'] as const).map(kind => <button key={kind} className={button} disabled={busy} onClick={() => action(async navigate => navigate((await api.document(invoice.id, kind)).url, 'document'))}>{kind === 'invoice' ? 'เปิดใบแจ้งหนี้' : kind === 'receipt' ? 'เปิดใบเสร็จ' : 'ดาวน์โหลด PDF'}</button>)}</div>}
        </article>)}
        {data.history.nextCursor && <button className={button} disabled={busy} onClick={() => action(async () => { const page = await api.history(data.history.nextCursor!); setData(current => current && ({ ...current, history: { items: [...current.history.items, ...page.items], nextCursor: page.nextCursor } })); })}>รายการก่อนหน้า</button>}
      </section>
    </>}
    <footer className="space-y-2 border-t pt-5 text-sm"><p>ต้องการความช่วยเหลือ ติดต่อทีมมั่งมี พร้อมเลขอ้างอิงรายการ</p><div className="flex flex-wrap gap-4"><a className="underline" href={`tel:${PLAN_TERM_RENEW_PHONE.replaceAll('-', '')}`}>{PLAN_TERM_RENEW_PHONE}</a><a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>{PLAN_TERM_CONTACT_EMAIL}</a></div></footer>
  </main>;
}

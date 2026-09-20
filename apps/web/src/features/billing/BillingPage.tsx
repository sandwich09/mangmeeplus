'use client';
import Link from 'next/link';
import { Modal } from '@/common/components/modal';
import { BILLING_PROFILE_FIELD_LABELS, type BillingProfileField } from '@watchdog-bms/contracts';
import { billingProfileHref, billingProfileSelection } from './billing-profile-navigation';
import { useRouter } from 'next/navigation';
import { MangmeeBadge } from '@/common/components/mangmee';
import BillingCustomerFrame from './BillingCustomerFrame';
import { BillingEmailRecipientPanel } from './BillingEmailRecipientPanel';
import { getAccountEmailOtp, type AccountEmailOtpState } from '@/features/auth/account-email-otp.api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BILLING_PAID_TIERS, PLAN_TIER_PRESETS, type PlanTierKey, type BillingCatalog, type BillingQuote, type BillingStatus, type BillingAttemptView } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { PLAN_LOCK_COPY, PLAN_TERM_CONTACT_EMAIL, PLAN_TERM_RENEW_PHONE, planLockReason } from '@/features/plan-term/plan-term.logic';
import type { PlanLockReason } from '@/features/plan-term/plan-term.api';
import { billingApi, type BillingHistory } from './billing.api';
import BillingCollectionPanel from './BillingCollectionPanel';
import BillingCapacityPicker from './BillingCapacityPicker';
import {billingMonthlyAllowanceText, billingBackControl, billingControl, billingPrimaryControl} from './billing-display';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

const money = (satang: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const button = billingControl;
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
  if (code === 'BILLING_COMPANY_PROFILE_REQUIRED') return 'กรุณากรอกข้อมูลบริษัทให้ครบก่อนซื้อแพ็กเกจ';
  if (code === 'BILLING_PLAN_CHANGE_REQUIRED') return 'กรุณากลับไปเลือกแพ็กเกจ เพื่อตรวจสอบวิธีเปลี่ยนแพ็กเกจและรอบชำระ';
  if (code === 'BILLING_CADENCE_PENDING_CHANGE') return 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป กรุณาตรวจสอบและยกเลิกรายการนั้นในแท็บการต่ออายุและชำระเงิน ก่อนซื้อรายปี';
  if (code === 'BILLING_REPEAT_NOT_READY') return 'การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน';
  if (code === 'BILLING_RESTART_REVIEW') return 'ต้องตรวจสมาชิกหรือยอดค้างเดิมก่อนเริ่มแพ็กเกจใหม่ กรุณาติดต่อทีมงานพร้อมเลขบริษัท';
  if (code === 'BILLING_RECIPIENT_UPDATE_REQUIRED') return 'กรุณาตรวจและยืนยันเปลี่ยนผู้รับเอกสารของบริษัทนี้ในส่วนอีเมล แล้วตรวจสรุปการชำระเงินใหม่';
  if (['BILLING_EMAIL_CHANGED', 'BILLING_EMAIL_VERIFICATION_REQUIRED'].includes(code ?? '')) return 'กรุณาผูกและยืนยันอีเมลให้เรียบร้อย แล้วตรวจสรุปการชำระเงินใหม่';
  if (code === 'BILLING_CAP_SELECTION_REQUIRED') return 'จำนวนสาขาหรือผู้ใช้เกินแพ็กเกจที่เลือก กรุณาจัดการสิทธิ์หรือติดต่อทีมงานก่อนยืนยัน';
  if (code === 'BILLING_DOCUMENT_PENDING') return 'Stripe กำลังเตรียมเอกสาร กรุณาลองเปิดอีกครั้ง';
  if (code === 'BILLING_PORTAL_UNAVAILABLE') return 'ยังเปิดหน้าแก้บัตรไม่ได้ กรุณาโหลดสถานะล่าสุดแล้วลองอีกครั้ง';
  if (code === 'BILLING_PORTAL_CONFIG_MISMATCH') return 'ทีมงานต้องตรวจการตั้งค่าหน้าแก้บัตรก่อน กรุณาติดต่อทีมมั่งมี';
  if (code === 'BILLING_COMPANY_HELD') return 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมมั่งมี';
  if (code === 'BILLING_LEGACY_REVIEW_REQUIRED') return 'ทีมงานต้องตรวจแพ็กเกจเดิมก่อนซื้อ กรุณาติดต่อทีมมั่งมี คุณยังกลับไปใช้งานหรือเลือกบริษัทอื่นได้';
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

export default function BillingPage({ companyId, returning = false, returnAttemptId = null, collectionId, previewHref, preview }: { companyId: string; returning?: boolean; returnAttemptId?: string | null; collectionId?: string; previewHref?: string;
  preview?: { api: ReturnType<typeof billingApi>; readAccountEmail: typeof getAccountEmailOtp; navigate: typeof navigateProvider; openDocumentHistory: () => void; startWithPlans?: boolean; initialSection?: 'package' | 'payment' | 'history' };
}) {
  const router = useRouter();
  const [previewCollectionId, setPreviewCollectionId] = useState<string>();
  const [profileMissing, setProfileMissing] = useState<BillingProfileField[] | null>(null);
  const pendingPurchase = useRef<{ offer: string; interval: string; channel: string } | null>(null);
  const resumedProfile = useRef(false);
  const activeCollectionId = collectionId ?? previewCollectionId;
  const [cadenceNotice, setCadenceNotice] = useState<'upgrade' | 'pending' | false>(false);
  const api = useMemo(() => preview?.api ?? billingApi(companyId), [companyId, preview]);
  const [data, setData] = useState<{ status: BillingStatus; catalog: BillingCatalog; history: BillingHistory } | null>(null);
  const [section, setSection] = useState<'package' | 'payment' | 'history'>(collectionId ? 'payment' : preview?.initialSection ?? 'package');
  useEffect(() => { if (collectionId) setSection('payment'); }, [collectionId]);
  const cadenceNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (cadenceNotice) { cadenceNoticeRef.current?.scrollIntoView({ block: 'start' }); cadenceNoticeRef.current?.focus({ preventScroll: true }); } }, [cadenceNotice]);
  const [choosing, setChoosing] = useState(preview?.startWithPlans ?? false);
  useEffect(() => {
    const selectHash = () => { if (window.location.hash === '#billing-history') setSection('history'); };
    selectHash(); window.addEventListener('hashchange', selectHash);
    return () => window.removeEventListener('hashchange', selectHash);
  }, []);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const collectionChanged = useCallback(() => setReload(value => value + 1), []);
  const [emailState, setEmailState] = useState<AccountEmailOtpState | null>(null), [emailReadError, setEmailReadError] = useState(false);
  const email = emailState?.email ?? '', emailReady = emailState?.emailRequirement === 'READY';
  useEffect(() => {
    if (resumedProfile.current || !data || !emailReady) return;
    const params = new URLSearchParams(window.location.search), selection = billingProfileSelection(window.location.search);
    if (!selection || params.get('profile') !== 'updated') return;
    resumedProfile.current = true;
    setChoosing(true); setSection('package'); setInterval(selection.interval === 'year' ? 'year' : 'month');
    void action(async () => { await requestQuote(selection.offer, selection.interval, email); });
  }, [data, emailReady, email]);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const emailFingerprint = useRef('');
  const [quote, setQuote] = useState<BillingQuote | null>(null), [accepted, setAccepted] = useState(false);
  const [capacity, setCapacity] = useState<{ options: BillingCapacityOptions; billingEmail: string; scheduledAt?: string; repair?: { attemptId: string; attemptVersion: number }; key: string; initialSelection?: BillingCapacitySelection } | null>(null);
  const capacityDraft = useRef<(NonNullable<typeof capacity> & { collectionId?: string }) | null>(null);
  const [capacityNotice, setCapacityNotice] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [returnAttempt, setReturnAttempt] = useState<BillingAttemptView | null>(null), [returnError, setReturnError] = useState('');
  const [refreshNotice, setRefreshNotice] = useState('');
  const emailSettings = useRef<HTMLDivElement>(null), quoteHeading = useRef<HTMLHeadingElement>(null), backNavigation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (quote || choosing) { backNavigation.current?.scrollIntoView({ block: 'start' }); quoteHeading.current?.focus({ preventScroll: true }); } }, [quote, choosing]);
  useEffect(() => { if (error.includes('อีเมล') || error.includes('ผู้รับเอกสาร')) { setSection('payment'); emailSettings.current?.scrollIntoView({ block: 'start' }); } }, [error]);
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
    let active = true, loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await (preview?.readAccountEmail ?? getAccountEmailOtp)();
        if (!active) return;
        const fingerprint = JSON.stringify([next.email, next.emailRevision, next.emailRequirement]);
        if (emailFingerprint.current !== fingerprint) { setQuote(null); setAccepted(false); emailFingerprint.current = fingerprint; }
        setEmailState(next); setEmailReadError(false);
      } catch {
        if (active) { setEmailState(null); setEmailReadError(true); setQuote(null); setAccepted(false); }
      } finally { loading = false; }
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const timer = window.setInterval(visible, 15_000);
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [companyId, reload, preview]);
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
    try { await work((url, kind) => { if (current === generation.current) (preview?.navigate ?? navigateProvider)(url, kind); }); }
    catch (e) { if (current === generation.current) {
      if (apiErrorCode(e) === 'BILLING_COMPANY_PROFILE_REQUIRED') {
        const details = (e as { details?: { missingFields?: unknown } }).details;
        const fields = details?.missingFields ?? (e as { missingFields?: unknown }).missingFields;
        setProfileMissing(Array.isArray(fields) ? fields.filter((field): field is BillingProfileField => typeof field === 'string' && Object.hasOwn(BILLING_PROFILE_FIELD_LABELS, field)) : []);
        setQuote(null); setAccepted(false);
      } else { if ([401, 403].includes(errorStatus(e) ?? 0)) setData(null); setError(errorText(e)); }
    } }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }
  async function requestQuote(offerKey: string, selectedInterval: string, billingEmail: string, selection?: BillingCapacitySelection) {
    pendingPurchase.current = { offer: offerKey, interval: selectedInterval,
      channel: new URLSearchParams(window.location.search).get('channel') === 'line' ? 'line' : 'web' };
    setCadenceNotice(false);
    const paid = data?.status;
    if (paid?.paidThrough && Date.parse(paid.paidThrough) > Date.now()) {
      const targetRank = BILLING_PAID_TIERS.findIndex(tier => tier === offerKey);
      const currentRank = BILLING_PAID_TIERS.findIndex(tier => tier === paid.tierKey);
      if ((targetRank >= 0 && targetRank < currentRank) || (offerKey === paid.tierKey && paid.interval === 'year' && selectedInterval === 'month')) {
        setQuote(null);
        const options = await api.capacity(offerKey, selectedInterval);
        setCapacity({ options, billingEmail, scheduledAt: paid.paidThrough, key: crypto.randomUUID(), initialSelection: capacityDraft.current?.initialSelection });
        return;
      }
      if (paid.interval && selectedInterval !== paid.interval) {
        if (targetRank > currentRank) { setCadenceNotice('upgrade'); return; }
        if (paid.pendingPlanChange) { setCadenceNotice('pending'); return; }
      }
    }
    try {
      const latest = await api.status();
      setData(value => value && { ...value, status: latest });
      if (!latest.billingProfile) throw new Error('billing_company_profile_unavailable');
      if (latest.billingProfile.missingFields.length) { setProfileMissing(latest.billingProfile.missingFields); setQuote(null); return; }
      const result = await api.quote(offerKey, selectedInterval, billingEmail, selection);
      if (!selection) capacityDraft.current = null;
      key.current = crypto.randomUUID(); setAccepted(false); setQuote(result); setCapacity(null);
    } catch (error) {
      if (apiErrorCode(error) !== 'BILLING_CAP_SELECTION_REQUIRED' || selection) throw error;
      setQuote(null); setCapacity({ options: await api.capacity(offerKey, selectedInterval), billingEmail, key: crypto.randomUUID(), initialSelection: capacityDraft.current?.initialSelection });
    }
  }
  const annualConversion = quote?.purchase?.kind === 'REPEAT' && quote.purchase.previousInterval === 'month' && quote.offer.interval === 'year';
  const status = data?.status;
  const accountHref = status?.accessState === 'ACTIVE' ? `/companies/${encodeURIComponent(companyId)}/settings/profile#account`
    : `/account/email?company=${encodeURIComponent(companyId)}&interval=${interval}`;
  const quotaReset = status?.usage.cadence === 'LEGACY_MONTH' && status.usage.resetsAt && status.termEndsAt &&
    Date.parse(status.usage.resetsAt) < Date.parse(status.termEndsAt) ? status.usage.resetsAt : null;
  const quotaExpiry = status?.usage.expiresAt ?? status?.termEndsAt;
  const confirmed = status?.accessState === 'ACTIVE' && (returning ? returnComplete : status.paymentState === 'PAID' && status.applyState === 'APPLIED');
  // S04/R10: a shop with nothing to run on was described by three fallbacks that added up to an
  // unlimited plan — "ยังไม่มีข้อมูลแพ็กเกจ · ใช้งานได้ถึง ยังไม่ระบุ · ใบเสร็จคงเหลือ ไม่จำกัด" — to a shop
  // that cannot open one screen. The cast keeps the page compiling before the API ships `lockReason`.
  const lockReason: PlanLockReason = planLockReason(status as { lockReason?: PlanLockReason } | undefined);
  // An active shop keeps its real numbers, whatever it was sold; a held one with a term still has a
  // package under review to describe. Only a locked shop, and a shop with no term at all, has none.
  const noPackage = !!status && status.accessState !== 'ACTIVE' && (status.accessState === 'EXPIRED' || !status.termEndsAt);
  const packageHeading = status?.accessState === 'EXPIRED' ? PLAN_LOCK_COPY[lockReason].title
    : noPackage ? PLAN_LOCK_COPY.no_package.title : 'แพ็กเกจปัจจุบัน';
  const returnFailed = returning && returnAttempt?.paymentState === 'FAILED';
  const hasPaymentToCheck = status && (!confirmed || ['past_due', 'unpaid'].includes(status.subscriptionState)) && (status.paymentState !== 'NONE' || status.attemptId || returnAttemptId || status.subscriptionState !== 'NONE');
  const canResumePayment = status?.attemptId && ['PENDING', 'FAILED'].includes(returnAttempt?.paymentState ?? status.paymentState) && !['APPLIED', 'HELD'].includes(status.applyState);
  const purchasing = choosing || !!quote || !!capacity;
  const showOverview = section === 'package' && !purchasing;
  return <BillingCustomerFrame title="แพ็กเกจและการชำระเงิน" description="ดูแพ็กเกจ จัดการการต่ออายุ และเปิดเอกสารชำระเงิน"
    actions={previewHref && <Link className="mangmee-btn mangmee-btn-secondary" href={previewHref}>พรีวิวขั้นตอน (local)</Link>}
    backHref={status?.accessState === 'ACTIVE' ? `/companies/${encodeURIComponent(companyId)}/dashboard` : '/billing/companies'}
    backLabel={status?.accessState === 'ACTIVE' ? 'กลับแดชบอร์ด' : 'กลับหน้าเลือกบริษัท'}>
    <Modal open={profileMissing !== null} title="กรอกข้อมูลบริษัทก่อนซื้อแพ็กเกจ" onClose={() => setProfileMissing(null)} size="sm"
      footer={<><button className={button} onClick={() => setProfileMissing(null)}>ไว้ก่อน</button>
        <Link className="mangmee-btn mangmee-btn-primary" href={pendingPurchase.current
          ? billingProfileHref(companyId, pendingPurchase.current) : `/companies/${encodeURIComponent(companyId)}/settings/profile#shop`}>กรอกข้อมูลบริษัท</Link></>}>
      <p>กรุณากรอกข้อมูลสำหรับออกใบแจ้งหนี้และใบเสร็จก่อนชำระเงิน</p>
      {!!profileMissing?.length && <ul className="mt-3 list-disc space-y-1 pl-5">{profileMissing.map(field => <li key={field}>{BILLING_PROFILE_FIELD_LABELS[field]}</li>)}</ul>}
      <p className="mt-4 text-sm text-gray-600">ใช้ชื่อจดทะเบียนบนเอกสาร หากเว้นว่างจะใช้ชื่อร้านที่สมัครไว้</p>
    </Modal>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">{error}<button className={`${button} ml-3`} disabled={busy} onClick={() => setReload(value => value + 1)}>ลองใหม่</button></div>}
    {!data && !error && <p role="status">กำลังตรวจสอบสิทธิ์และรายการชำระเงิน…</p>}
    {data && status && <>
      {status.mode === 'TEST' && !preview && <div><MangmeeBadge tone="amber">โหมดทดสอบ · ไม่มีการรับเงินจริง</MangmeeBadge></div>}
      {returnError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">{returnError}</p>}
      <nav aria-label="หมวดแพ็กเกจและการชำระเงิน" className="flex border-b border-gray-200">
        {([['package', 'แพ็กเกจ'], ['payment', 'การต่ออายุและชำระเงิน'], ['history', 'ประวัติ']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} disabled={busy}
          onClick={() => setSection(value)} className={`min-h-12 flex-1 border-b-2 px-2 py-3 text-sm font-semibold sm:flex-none sm:px-5 sm:text-base ${section === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-brand-700'}`}>{label}</button>)}
      </nav>
      {showOverview && <>
      <section aria-label="สถานะแพ็กเกจ" className="mangmee-card space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{returnFailed ? 'รายการชำระเงินนี้ไม่สำเร็จ' : confirmed ? returning ? 'ชำระแล้ว เปิดใช้งานแล้ว' : 'แพ็กเกจปัจจุบัน' : (returning ? returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState !== 'APPLIED' : status.paymentState === 'PAID' && status.applyState !== 'APPLIED') ? 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์' : status.paymentState === 'FAILED' ? 'เรียกเก็บเงินไม่สำเร็จ' : status.attemptId ? 'กำลังตรวจสอบรายการชำระเงิน' : packageHeading}</h2>
          <MangmeeBadge tone={status.accessState === 'ACTIVE' ? 'brand' : 'amber'}>{status.accessState === 'ACTIVE' ? 'ใช้งานได้' : status.accessState !== 'EXPIRED' ? 'อยู่ระหว่างตรวจสอบ' : lockReason === 'no_package' ? 'ยังไม่มีแพ็กเกจ' : 'ครบกำหนดใช้งาน'}</MangmeeBadge>
        </div>
        {noPackage ? <dl className="grid gap-5 rounded-xl bg-gray-50 p-4">
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">ยังไม่มีแพ็กเกจ</dd>
            <p className="mt-1 text-sm text-gray-600">เลือกแพ็กเกจเพื่อเริ่มใช้งาน</p>
            {/* Only when a term really ran out: a shop that never had one starts and ends today. */}
            {lockReason === 'trial_ended' && status.termEndsAt && <p className="mt-1 text-sm text-gray-500">ครบกำหนดเมื่อ {date(status.termEndsAt)}</p>}</div>
        </dl> : <dl className="grid gap-5 rounded-xl bg-gray-50 p-4 sm:grid-cols-3">
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.tierKey && status.tierKey in PLAN_TIER_PRESETS ? PLAN_TIER_PRESETS[status.tierKey as PlanTierKey].labelTh : status.tierKey ? 'ต้องตรวจสอบข้อมูล' : 'ยังไม่มีข้อมูลแพ็กเกจ'}</dd></div>
          <div><dt className="text-sm text-gray-500">ใช้งานได้ถึง</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.termEndsAt ? date(status.termEndsAt) : 'ยังไม่ระบุ'}</dd></div>
          <div><dt className="text-sm text-gray-500">ใบเสร็จคงเหลือ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.usage.remaining ?? 'ไม่จำกัด'} {status.usage.remaining !== null && 'ใบ'}</dd>{(quotaReset || (quotaExpiry && date(quotaExpiry) !== date(status.termEndsAt))) && <p className="mt-1 text-sm text-gray-500">{quotaReset ? `เริ่มรอบใหม่ ${date(quotaReset)}` : `ใบที่หมดอายุก่อนใช้ได้ถึง ${date(quotaExpiry)}`}</p>}</div>
        </dl>}
        {status.effectiveCapacity?.temporary&&<section className="space-y-2 rounded-xl border border-emerald-300 p-3" aria-label="สิทธิ์แพ็กเกจชั่วคราว"><p>ผู้ดูแลให้สิทธิ์ {PLAN_TIER_PRESETS[status.effectiveCapacity.tierKey].labelTh} ชั่วคราว</p><p>{status.effectiveCapacity.branchLimit} สาขา · {status.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {date(status.effectiveCapacity.temporary.expiresAt)}</p><p>เมื่อครบกำหนดจะใช้แพ็กเกจที่ซื้ออยู่ล่าสุด การซื้อเพิ่มด้านล่างคิดจากแพ็กเกจที่ชำระเงิน</p></section>}

        {status.usage.monthlyAllowance&&<p>{billingMonthlyAllowanceText(status.usage)}</p>}
        {status.cancelAtPeriodEnd ? <p className="text-sm text-gray-600">หยุดต่ออายุแล้ว ใช้งานได้ถึงวันที่ระบุข้างต้น</p> : status.nextChargeAt && !status.collectionPause && <p className="text-sm text-gray-600">ต่ออายุอัตโนมัติวันที่ {date(status.nextChargeAt)}</p>}
        {status.graceEndsAt && <p>ระยะผ่อนผันถึง {date(status.graceEndsAt)} · ใช้ยอดใบเสร็จเดิมที่เหลือได้ ไม่มีการเติมโควตาจนกว่าจะชำระสำเร็จ</p>}
        {status.purchaseEligibility === 'COMPANY_SALES_CLOSED' && <p role="status" className="text-sm leading-7 text-gray-600">บริษัทนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ กรุณาติดต่อทีมมั่งมี</p>}
        {status.refundReviewPending && <p role="status" className="rounded-xl bg-amber-50 p-3">กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ คำขอนี้ไม่เปลี่ยนสิทธิ์แพ็กเกจเดิม คุณตรวจรายการเดิมด้านล่าง หรือ <a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมมั่งมี</a> ได้</p>}
        {status.accessState === 'HELD' && <p>บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน ข้อมูลยังอยู่ครบ</p>}
        {(status.reference || returnAttemptId) && !confirmed && <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงสำหรับแจ้งทีมงาน</summary><p className="break-all">{returning ? returnAttemptId : status.reference}</p></details>}
        {returnFailed && <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">รายการนี้ไม่ได้ชำระสำเร็จหรือรายการหมดอายุ สิทธิ์แพ็กเกจเดิมยังคงเดิม</p>}
        {returning && !confirmed && timedOut && <p role="status">ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง</p>}
        {canResumePayment && <button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => { const result = await api.resume(status.attemptId!); if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout'); else setReload(value => value + 1); })}>กลับไปยังรายการเดิม</button>}
        {hasPaymentToCheck && <div className="space-y-3 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async () => {
            const result = await api.refresh();
            setRefreshNotice(result.queued ? 'ส่งคำขอตรวจสอบแล้ว ยังไม่ใช่ผลยืนยันการชำระเงิน กดอัปเดตข้อมูลเพื่อดูผลภายหลัง' : 'ยังไม่มีรายการที่ต้องตรวจสอบกับผู้ให้บริการ');
            setReload(value => value + 1);
          })}>ตรวจผลการชำระเงินอีกครั้ง</button>
          {refreshNotice && <button className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>อัปเดตข้อมูล</button>}</div>
          {refreshNotice && <p role="status" className="text-sm text-gray-600">{refreshNotice}</p>}
        </div>}
        {status.allowedActions.includes('new_sales') && <button className="mangmee-btn mangmee-btn-primary" onClick={() => setChoosing(true)}>{status.subscriptionState === 'NONE' ? 'เลือกแพ็กเกจ' : 'ซื้อหรือเปลี่ยนแพ็กเกจ'}</button>}
      </section>
      </>}
      <div hidden={section !== 'payment'} className="space-y-6">
      {status.subscriptionState === 'NONE' && !status.collection && !status.pendingPlanChange && <p className="mangmee-card p-5 text-gray-500">ยังไม่มีการต่ออายุอัตโนมัติ</p>}
      <BillingCollectionPanel key={activeCollectionId ?? 'renewal'} companyId={companyId} status={status} operationId={activeCollectionId} onChange={collectionChanged} apiOverride={preview?.api}
        onEdit={activeCollectionId && capacityDraft.current?.collectionId === activeCollectionId ? () => { if (preview) setPreviewCollectionId(undefined); else router.push(`/companies/${encodeURIComponent(companyId)}/billing`); setCapacity(capacityDraft.current); setChoosing(true); setSection('package'); } : undefined}
        onBack={() => { if (preview) setPreviewCollectionId(undefined); else router.push(`/companies/${encodeURIComponent(companyId)}/billing`); setChoosing(false); setSection('package'); }} />
      {!activeCollectionId && <>
      {status.allowedActions.includes('portal_payment_method') && <section className="mangmee-card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" aria-label="วิธีชำระเงิน"><div><h2 className="text-lg font-bold">บัตรชำระเงิน</h2><p className="mt-1 text-sm text-gray-500">เปลี่ยนบัตรสำหรับการต่ออายุผ่าน Stripe</p></div><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate((await api.portal()).url, 'portal'))}>จัดการบัตรชำระเงิน</button></section>}
      <div ref={emailSettings} className="scroll-mt-24 space-y-4">
        {emailReadError && <p role="alert">ยังตรวจสอบอีเมลบัญชีไม่ได้ <button className="min-h-11 font-semibold underline" onClick={() => setReload(value => value + 1)}>ลองใหม่</button></p>}
        <BillingEmailRecipientPanel companyId={companyId} email={email} ready={emailReady} accountHref={accountHref} apiOverride={preview?.api} />
      </div>
      </>}
      </div>
      {(purchasing || status.capacityRepair) && <div hidden={section !== 'package'} className="space-y-6">
        {!capacity && <div ref={backNavigation} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-1"><button type="button" className={billingBackControl} disabled={busy} onClick={() => {
          if (quote) { setQuote(null); setCapacity(capacityDraft.current); setAccepted(false); }
          else { setChoosing(false); setAccepted(false); }
        }}><span className="text-base leading-none" aria-hidden="true">←</span>{quote ? capacityDraft.current ? 'กลับไปเลือกสาขาและผู้ใช้' : 'กลับไปเลือกแพ็กเกจ' : 'กลับไปแพ็กเกจปัจจุบัน'}</button>
          <h2 ref={quoteHeading} tabIndex={-1} className="text-xl font-bold text-gray-900 sm:text-2xl">{quote ? <>{annualConversion ? 'เปลี่ยนเป็นรายปี:' : quote.purchase?.kind === 'REPEAT' ? 'ยืนยันซื้อแพ็กเกจเดิมเพิ่ม:' : 'ยืนยันซื้อ'} {quote.offer.label}{!annualConversion && ` ${quote.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}`}</> : status.capacityRepair ? 'ตรวจสอบสิทธิ์จากรายการชำระเงิน' : 'เลือกแพ็กเกจ'}</h2></div>}
      {capacityNotice && status.attemptId && <p role="status">{capacityNotice}</p>}
      {status.capacityRepair && !capacity && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>ชำระสำเร็จแล้ว แต่ข้อมูลสาขาหรือผู้ใช้เปลี่ยน กรุณาเลือกสิทธิ์ล่าสุดเพื่อเปิดใช้งานจากรายการเดิม</p>
        <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { const repair = status.capacityRepair!; setCapacity({ options: await api.capacity(repair.offerKey, repair.interval), billingEmail: email, repair, key: crypto.randomUUID() }); })}>เลือกสิทธิ์สำหรับรายการที่จ่ายแล้ว</button></section>}
      {capacity && <BillingCapacityPicker key={capacity.options.sourceHash + capacity.key} options={capacity.options} initialSelection={capacity.initialSelection} repair={!!capacity.repair} scheduledAt={capacity.scheduledAt} currentTierKey={status.tierKey} currentInterval={status.interval} onCancel={selection => { if (!capacity.repair) capacityDraft.current = { ...capacity, initialSelection: selection }; setCapacity(null); }}
        onRefresh={async () => { const latest = await api.status(), options = await api.capacity(capacity.options.offerKey, capacity.options.interval);
          if (capacity.repair && !latest.capacityRepair) { setCapacity(null); setReload(v => v+1); return; }
          capacityDraft.current = null;
          setCapacity({ ...capacity, options, initialSelection: undefined, ...(capacity.scheduledAt ? { scheduledAt: latest.paidThrough ?? undefined } : {}), ...(capacity.repair ? { repair: latest.capacityRepair! } : {}), key: crypto.randomUUID() }); }}
        onConfirm={async selection => {
          if (!capacity.repair) capacityDraft.current = { ...capacity, initialSelection: selection };
          if (capacity.repair) {
            await api.repairCapacity(capacity.repair.attemptId, capacity.repair.attemptVersion, selection, capacity.key);
            setCapacity(null); setCapacityNotice('บันทึกการเลือกแล้ว กำลังตรวจสอบและเปิดสิทธิ์จากรายการที่จ่ายเดิม'); setReload(v => v+1);
          } else if (capacity.scheduledAt) {
            const operation = await api.collectionPreview('SCHEDULE_DOWNGRADE', { offerKey: capacity.options.offerKey, interval: capacity.options.interval, capacity: selection });
            capacityDraft.current = { ...capacity, initialSelection: selection, collectionId: operation.id };
            if (preview) setPreviewCollectionId(operation.id);
            else router.push(`/companies/${encodeURIComponent(companyId)}/billing?collection=${encodeURIComponent(operation.id)}`);
            setCapacity(null); setChoosing(false); setSection('payment');
          } else await requestQuote(capacity.options.offerKey, capacity.options.interval, capacity.billingEmail, selection);
        }} />}
      {status.allowedActions.includes('new_sales') && !quote && !capacity && <section className="space-y-4" aria-label="เลือกแพ็กเกจ">
        {emailReadError && <p role="alert">ยังตรวจสอบอีเมลบัญชีไม่ได้ <button className="min-h-11 font-semibold underline" onClick={() => setReload(value => value + 1)}>ลองใหม่</button></p>}
        {!emailReady && !emailReadError && <p role="status">{emailState ? <>ยืนยันอีเมลบัญชีก่อนซื้อแพ็กเกจ <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={accountHref}>ไปที่บัญชีของฉัน</Link></> : 'กำลังตรวจสอบอีเมลบัญชี…'}</p>}
        {catalogUnavailable && <p role="status">ยังตรวจสอบราคาปัจจุบันไม่ได้ กรุณาลองใหม่ คุณยังดูประวัติและจัดการรายการเดิมได้</p>}
        <div className="flex gap-2">{(['month', 'year'] as const).map(value => <button key={value} className={interval === value ? billingPrimaryControl : button} aria-pressed={interval === value} onClick={() => { setInterval(value); setQuote(null); setCapacity(null); setCadenceNotice(false); }}>{value === 'month' ? 'รายเดือน' : 'รายปี'}</button>)}</div>
        {cadenceNotice && <div ref={cadenceNoticeRef} tabIndex={-1} role="status" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-3 rounded-xl bg-amber-50 p-4">
          <p>{cadenceNotice === 'pending' ? 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป กรุณาตรวจสอบและยกเลิกรายการนั้นก่อนซื้อรายปี' : 'หากต้องการเพิ่มระดับและเปลี่ยนรอบชำระ ให้เพิ่มระดับในรอบเดิมก่อน แล้วจึงเลือกรอบชำระใหม่ ระบบจะแสดงยอดให้ตรวจสอบแยกแต่ละรายการ'}</p>
          <button className={button} onClick={() => { if (cadenceNotice === 'pending') setSection('payment'); else setInterval(status.interval!); setCadenceNotice(false); }}>{cadenceNotice === 'pending' ? 'ดูรายการเปลี่ยนแพ็กเกจ' : `เลือกแพ็กเกจ${status.interval === 'year' ? 'รายปี' : 'รายเดือน'}`}</button>
        </div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.catalog.offers.filter(offer => offer.interval === interval).map(offer => {
          const monthly = data.catalog.offers.find(item => item.offerKey === offer.offerKey && item.interval === 'month');
          const saving = interval === 'year' && monthly ? monthly.priceSatang * 12 - offer.priceSatang : 0;
          const current = status.accessState === 'ACTIVE' && status.tierKey === offer.offerKey && status.interval === offer.interval;
          return <article key={offer.offerKey} className={`mangmee-card relative flex flex-col gap-4 p-5${current ? ' !border-brand-500' : ''}`}>
          {current && <MangmeeBadge className="absolute -top-3 right-4 border">แพ็กเกจปัจจุบัน</MangmeeBadge>}
          <h3 className="font-bold">{offer.label}</h3><p className="text-xl font-bold">{money(offer.priceSatang)} / {interval === 'month' ? 'เดือน' : 'ปี'}</p>
          <p className="text-sm text-brand-700">{interval === 'year' ? `ใช้งาน 12 เดือน${saving > 0 ? ` · ประหยัด ${money(saving)}` : ''}` : 'ชำระรายเดือน'}</p><p>{offer.branchLimit} สาขา · {offer.employeeLimit} ผู้ใช้</p><p>{offer.availability === 'COMING_SOON' ? 'แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน' : `${offer.receiptAllowance.toLocaleString('th-TH')} ใบ ได้ทันทีเมื่อชำระสำเร็จ`}</p>
          <button className="mangmee-btn mangmee-btn-primary mt-auto w-full" disabled={busy || !emailReady || catalogUnavailable || Date.parse(data.catalog.validUntil) <= Date.now() || offer.availability !== 'AVAILABLE' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} aria-busy={Boolean(busy)} onClick={() => action(async () => {
            await requestQuote(offer.offerKey, interval, email);
          })}>{offer.availability === 'COMING_SOON' ? 'เร็ว ๆ นี้' : offer.availability === 'AVAILABLE' ? current ? 'ซื้อแพ็กเกจเดิมเพิ่ม' : status.paidThrough && Date.parse(status.paidThrough) > Date.now() && status.tierKey === offer.offerKey && status.interval === 'month' && interval === 'year' ? 'เปลี่ยนเป็นรายปี' : status.paidThrough && Date.parse(status.paidThrough) > Date.now() && status.tierKey === offer.offerKey && status.interval === 'year' && interval === 'month' ? 'เปลี่ยนเป็นรายเดือนรอบถัดไป' : 'เลือกแพ็กเกจนี้' : 'ยังไม่เปิดขาย'}</button>
        </article>; })}</div>
      </section>}
      {quote && <section aria-label="ยืนยันซื้อแพ็กเกจ" className="mangmee-card space-y-5 p-5 sm:p-6">
        <p>{quote.purchase?.kind === 'REPEAT' ? 'สิทธิ์คงเดิม:' : 'สิทธิ์หลังชำระสำเร็จ:'} สูงสุด {quote.offer.branchLimit} สาขา · {quote.offer.employeeLimit} ผู้ใช้ รวมเจ้าของ</p>
        <div className="rounded-xl border border-gray-200 p-4" aria-label="ข้อมูลออกเอกสาร">
          <p className="font-semibold">ข้อมูลออกเอกสาร</p>
          <p className="mt-2 break-words">{quote.billingProfile?.name ?? quote.companyName}</p>
          {quote.billingProfile && <p className="mt-1 break-words">{Object.values(quote.billingProfile.address).filter(Boolean).join(' ')}</p>}
          <p className="mt-1 break-words">{quote.billingEmail}</p>
          <Link className="mt-2 inline-flex min-h-11 items-center text-brand-700 underline" href={billingProfileHref(companyId, {
            offer: quote.offer.offerKey, interval: quote.offer.interval, channel: pendingPurchase.current?.channel ?? 'web',
          })}>แก้ไขข้อมูลบริษัท</Link>
        </div><p>ราคาก่อนภาษี {money(quote.subtotalSatang)} · ภาษี {money(quote.taxSatang)}</p>
        {quote.purchase?.kind === 'REPEAT' ? <dl className={`grid gap-5 rounded-xl bg-brand-50 p-5 ${annualConversion ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div><dt className="text-sm text-brand-800">ชำระวันนี้</dt><dd className="mt-1 text-2xl font-bold text-brand-800">{money(quote.totalSatang)}</dd></div>
          <div><dt className="text-sm text-gray-600">โควตาที่เพิ่ม</dt><dd className="mt-1 text-xl font-bold">{quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบ<span className="mt-1 block text-sm font-normal text-gray-600">ใช้ได้ทันทีเมื่อชำระสำเร็จ</span></dd></div>
          <div><dt className="text-sm text-gray-600">วันหมดอายุใหม่</dt><dd className="mt-1 text-xl font-bold">{date(quote.purchase.projectedPaidThrough)}<span className="mt-1 block text-sm font-normal text-gray-600">{annualConversion ? 'เพิ่ม 12 เดือนจาก' : 'ต่อจากเดิม'} {date(quote.purchase.previousPaidThrough)}</span></dd></div>
          {annualConversion && <div><dt className="text-sm text-gray-600">ต่ออายุรายปีครั้งถัดไป</dt><dd className="mt-1 text-xl font-bold">{money(quote.totalSatang)}<span className="mt-1 block text-sm font-normal text-gray-600">วันที่ {date(quote.purchase.projectedPaidThrough)}</span></dd></div>}
        </dl> : <p className="rounded-xl bg-brand-50 p-5 text-2xl font-bold text-brand-800">ชำระวันนี้ {money(quote.totalSatang)}</p>}
        <p>{quote.taxTreatment === 'NOT_VAT_REGISTERED' ? 'บริษัทผู้ให้บริการยังไม่ได้จด VAT จึงไม่มีการเรียกเก็บ VAT' : quote.taxTreatment === 'INCLUSIVE_VAT_7' ? 'ราคารวม VAT 7% แล้ว' : 'ราคาเพิ่ม VAT 7%'}</p>
        {quote.purchase?.kind === 'UPGRADE' ? <div className="space-y-2"><p>ชำระส่วนต่างและเริ่ม {quote.offer.label} เมื่อยืนยันการชำระสำเร็จ วันหมดอายุคงเดิม {date(quote.purchase.projectedPaidThrough)} เพิ่ม {quote.purchase.receiptUnitsAdded} ใบ รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts} ใบ</p><p>ยอดต่ออายุรอบถัดไป {money(quote.upgrade!.nextRenewalTotalSatang)}</p><details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">รายละเอียดส่วนต่าง</summary><p>คำนวณส่วนต่าง ณ {date(quote.upgrade!.prorationAt)} · จำนวนคงเหลือเปลี่ยนตามการใช้งานระหว่างชำระ</p><ul className="space-y-1">{quote.upgrade!.segments.map((segment,index)=><li key={index}>{date(segment.start)} ถึง {date(segment.end)}: {money(segment.amountSatang)} · เพิ่ม {segment.receiptUnitsAdded} ใบ</li>)}</ul></details></div> : quote.purchase?.kind === 'REPEAT' ? <p className="text-sm text-gray-600">หลังซื้อคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ รวมโควตาเดิมที่ยังไม่หมดอายุ · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</p> : quote.purchase?.kind === 'RESTART' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ รับ {quote.offer.receiptAllowance} ใบ วันและโควตาที่หมดอายุไปแล้วไม่ทบ ประวัติชำระเงินเดิมยังดูได้</p> : <div className="space-y-2">
          {quote.purchase?.trialCarryover && <dl className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
            <div className="flex justify-between gap-3"><dt>โควตาแพ็กเกจ</dt><dd>{quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</dd></div>
            <div className="flex justify-between gap-3"><dt>ยกยอดจากทดลองใช้</dt><dd>{quote.purchase.trialCarryover.receiptUnits.toLocaleString('th-TH')} ใบ</dd></div>
            {quote.purchase.projectedRemainingReceipts > quote.offer.receiptAllowance + quote.purchase.trialCarryover.receiptUnits && <div className="flex justify-between gap-3"><dt>โควตาเพิ่มเติมเดิมที่ยังใช้ได้</dt><dd>{(quote.purchase.projectedRemainingReceipts - quote.offer.receiptAllowance - quote.purchase.trialCarryover.receiptUnits).toLocaleString('th-TH')} ใบ</dd></div>}
            <div className="flex justify-between gap-3 font-semibold"><dt>รวมหลังชำระสำเร็จโดยประมาณ</dt><dd>{quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ</dd></div>
            <div className="text-gray-600">ยอดจากทดลองใช้หมดอายุวันที่ {date(quote.purchase.trialCarryover.expiresAt)} · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</div>
          </dl>}
          <p>ชำระสำเร็จแล้ว ใช้งานได้ {quote.offer.interval === 'year' ? '12 เดือน' : '1 เดือน'} {!quote.purchase?.trialCarryover && <>พร้อมโควตา {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</>}</p>
          {quote.purchase?.kind === 'INITIAL' && quote.trialEndsAt && <p className="text-sm text-gray-600">การทดลองใช้จะสิ้นสุดเมื่อชำระสำเร็จ วันทดลองที่เหลือจะไม่บวกเพิ่มในแพ็กเกจนี้</p>}
        </div>}
        {quote.pendingPlanChange && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>รายการเปลี่ยนเป็น {quote.pendingPlanChange.offer.label} ({quote.pendingPlanChange.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}) จะมีผลจาก {date(quote.pendingPlanChange.oldEffectiveAt)} เป็น {date(quote.pendingPlanChange.newEffectiveAt)}</p><p>ยอดต่ออายุหลังวันนั้น {money(quote.pendingPlanChange.totalSatang)} · คงสาขา {quote.pendingPlanChange.capacity.retainedBranches.join(', ')} · คงผู้ใช้ {quote.pendingPlanChange.capacity.retainedMembers.join(', ')}</p><p>ซื้อสำเร็จจึงยืนยันวันเปลี่ยนใหม่ หากชำระไม่สำเร็จคำสั่งเดิมคงอยู่</p></div>}
        {annualConversion ? <p className="text-sm text-gray-600">ชำระค่ารายปีเต็มจำนวนครั้งนี้ แล้วหยุดตัดเงินรายเดือน ไม่มีการตัดเงินต่ออายุก่อนวันหมดอายุใหม่ ปิดการต่ออายุอัตโนมัติได้โดยยังใช้เวลาที่ชำระไว้ได้ครบ</p> : <p>{quote.purchase?.kind === 'REPEAT' && `เลื่อนการตัดเงินครั้งถัดไปเป็น ${date(quote.purchase.projectedPaidThrough)} · `}ต่ออายุอัตโนมัติทุก{(quote.pendingPlanChange?.offer.interval ?? quote.offer.interval) === 'year' ? 'ปี' : 'เดือน'}ตามแพ็กเกจ ยกเลิกมีผลสิ้นรอบ</p>}
        {quote.capacity && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>เมื่อเริ่มแพ็กเกจใหม่ คงสาขา: {quote.capacity.retainedBranches.join(', ')} · พักสาขา: {quote.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p>
          <p>คงผู้ใช้: {quote.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {quote.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p>
          {quote.capacity.defaults.map((item,index) => <p key={index}>สาขาเริ่มต้นของ {item.member}: {item.branch ?? 'เลือกเมื่อเข้าใช้งาน'}</p>)}<p>ข้อมูลและประวัติยังอยู่ครบ ระบบตรวจสิทธิ์อีกครั้งก่อนเปิดใช้งาน</p></div>}
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={accepted} onChange={event => setAccepted(event.target.checked)} />ฉันตรวจสอบข้อมูลและยืนยันเงื่อนไขการชำระเงินและต่ออายุอัตโนมัติ</label>
        <div className="flex flex-wrap gap-3"><button className="mangmee-btn mangmee-btn-primary" disabled={busy || !emailReady || catalogUnavailable || !accepted || Date.parse(quote.expiresAt) <= Date.now()} aria-busy={Boolean(busy)} onClick={() => action(async navigate => {
          const params = new URLSearchParams(window.location.search);
          const result = await api.checkout({ quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: params.get('channel') === 'line' ? 'line' : 'web' }, key.current);
          if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout'); else { setQuote(null); setReload(value => value + 1); }
        })}>{busy ? 'กำลังตรวจสอบ…' : 'ยืนยันและไปชำระที่ Stripe'}</button></div>
      </section>}
      </div>}
      <section hidden={section !== 'history'} id="billing-history" aria-label="ประวัติการชำระเงิน" className="mangmee-card space-y-4 p-5 sm:p-6"><h2 className="text-lg font-bold">ประวัติและเอกสารการชำระเงิน</h2>
        {data.history.items.length === 0 && <p className="rounded-xl bg-gray-50 p-5 text-gray-500">ยังไม่มีรายการชำระเงิน</p>}
        {data.history.items.map(invoice => <article key={invoice.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4"><p>{invoice.number ?? 'รายการชำระเงิน'} · {money(invoice.amountSatang)} · {date(invoice.createdAt)}</p>
          {(invoice.refundedSatang > 0 || invoice.disputed) && <p className="text-sm text-amber-900">{invoice.refundedSatang > 0 && `ยอดคืนเงินที่ Stripe บันทึก ${money(invoice.refundedSatang)} · `}{invoice.disputed && 'มีข้อพิพาทการชำระเงิน · '}ทีมงานตรวจสิทธิ์เป็นรายกรณี · ตรวจล่าสุด {date(invoice.financialObservedAt)}</p>}
          {preview ? <button className={button} onClick={preview.openDocumentHistory}>ดูเอกสาร</button> : <Link className={button} href={`/companies/${encodeURIComponent(companyId)}/billing/invoices/${encodeURIComponent(invoice.id)}`}>ดูเอกสาร</Link>}
        </article>)}
        {data.history.nextCursor && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { const page = await api.history(data.history.nextCursor!); setData(current => current && ({ ...current, history: { items: [...current.history.items, ...page.items], nextCursor: page.nextCursor } })); })}>รายการก่อนหน้า</button>}
      </section>
    </>}
    <footer className="space-y-2 border-t border-gray-200 pt-5 text-sm text-gray-500"><p>ต้องการความช่วยเหลือเรื่องแพ็กเกจ</p><div className="flex flex-wrap gap-4"><a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`tel:${PLAN_TERM_RENEW_PHONE.replaceAll('-', '')}`}>{PLAN_TERM_RENEW_PHONE}</a><a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>{PLAN_TERM_CONTACT_EMAIL}</a></div></footer>
  </BillingCustomerFrame>;
}

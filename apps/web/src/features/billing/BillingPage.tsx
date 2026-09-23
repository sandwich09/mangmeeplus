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
import { BILLING_PAID_TIERS, DEFAULT_CHAT_CREDIT_SATANG, PLAN_TIER_PRESETS, TIER_FEATURE_PRESETS, type PlanTierKey, type BillingCatalog, type BillingQuote, type BillingStatus, type BillingAttemptView, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { PLAN_LOCK_COPY, PLAN_TERM_CONTACT_EMAIL, PLAN_TERM_RENEW_PHONE, planLockReason } from '@/features/plan-term/plan-term.logic';
import type { PlanLockReason } from '@/features/plan-term/plan-term.api';
import { billingApi, type BillingHistory } from './billing.api';
import BillingCollectionPanel from './BillingCollectionPanel';
import BillingCapacityPicker from './BillingCapacityPicker';
import {billingMonthlyAllowanceText, billingBackControl, billingControl, billingPrimaryControl, billingPurchaseModeLabel, billingSupportReference} from './billing-display';
import { billingDeal, billingQuoteDeal, dealAiCreditText, dealConfirmText, dealMenuLabels, dealRenewalText } from './billing-deal';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

const money = (satang: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const button = billingControl;
const catalogCardMenus = dealMenuLabels(TIER_FEATURE_PRESETS.STARTER_249);
const enterpriseMenuSummary = 'เมนูหลัก: ค่าใช้จ่ายและใบเสร็จ · การเบิกจ่าย · ผู้ช่วย AI ทาง LINE · พนักงานและสิทธิ์';
function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown };
  const status = value.status ?? value.statusCode;
  return typeof status === 'number' ? status : undefined;
}
function errorText(error: unknown): string {
  const status = errorStatus(error), code = apiErrorCode(error);
  if (status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจและการชำระเงินของบริษัท';
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
  if (code === 'BILLING_SOURCE_REVIEW_REQUIRED') return 'ข้อมูลการชำระเงินเดิมของบริษัทนี้ยังไม่ตรงกัน กรุณาติดต่อทีมมั่งมีก่อนเริ่มรายการใหม่';
  if (code === 'BILLING_ENTITLEMENT_REVIEW_REQUIRED') return 'ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมมั่งมีก่อนชำระเงิน';
  if (code === 'BILLING_REFUND_PENDING') return 'กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ กรุณาโหลดสถานะล่าสุดหรือติดต่อทีมมั่งมี';
  if (code === 'BILLING_DEAL_EXPIRED') return 'ข้อเสนอพิเศษนี้หมดอายุแล้ว กรุณาติดต่อทีมขายเพื่อขอข้อเสนอใหม่ คุณยังเลือกแพ็กเกจปกติได้';
  if (code === 'BILLING_DEAL_NOT_FOUND') return 'ไม่พบข้อเสนอพิเศษนี้แล้ว กรุณาโหลดหน้านี้ใหม่ หรือติดต่อทีมขาย';
  if (code === 'BILLING_DEAL_SNAPSHOT_MISMATCH') return 'ข้อเสนอพิเศษนี้เปลี่ยนแล้ว กรุณาโหลดหน้านี้ใหม่เพื่อดูข้อเสนอล่าสุดก่อนชำระเงิน';
  // D-P5-3: an auto-renewing deal's own price is created at approval; until it exists the offer
  // cannot be quoted. A wait, not a refusal — and nothing the shop can do except try again.
  if (code === 'SALES_DEAL_PRICE_PENDING') return 'ระบบกำลังเตรียมราคาของข้อเสนอนี้ กรุณารอสักครู่แล้วลองอีกครั้ง';
  if (code === 'CONTROL_DEAL_SUBSCRIPTION_REVIEW') return 'ร้านนี้มีสมาชิกที่ยังใช้งานอยู่ ทีมงานจะติดต่อกลับเพื่อเปลี่ยนให้ สิทธิ์เดิมยังใช้ได้ตามปกติ';
  if (code === 'BILLING_MODE_NOT_READY') return 'ยังไม่เปิดวิธีชำระเงินที่เลือก กรุณาเลือกวิธีอื่น หรือติดต่อทีมงาน';
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
  const pendingPurchase = useRef<{ offer: string; interval: string; channel: string; purchaseMode: BillingPurchaseMode; dealId?: string; purchaseIntent?: 'FULL_PACKAGE' } | null>(null);
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
  const [checkoutCancelNotice, setCheckoutCancelNotice] = useState('');
  const [confirmCheckoutCancel, setConfirmCheckoutCancel] = useState(false);
  const collectionChanged = useCallback(() => setReload(value => value + 1), []);
  const [emailState, setEmailState] = useState<AccountEmailOtpState | null>(null), [emailReadError, setEmailReadError] = useState(false);
  const email = emailState?.email ?? '', emailReady = emailState?.emailRequirement === 'READY';
  useEffect(() => {
    if (resumedProfile.current || !data || !emailReady) return;
    const params = new URLSearchParams(window.location.search), selection = billingProfileSelection(window.location.search);
    if (!selection || params.get('profile') !== 'updated') return;
    resumedProfile.current = true;
    setChoosing(true); setSection('package'); setInterval(selection.interval === 'year' ? 'year' : 'month');
    if (selection.purchaseMode) { setPurchaseMode(selection.purchaseMode); if (selection.dealId) setDealMode(selection.purchaseMode); }
    void action(async () => { await requestQuote(selection.offer, selection.interval, email, undefined, selection.purchaseMode, selection.dealId, selection.purchaseIntent); });
  }, [data, emailReady, email]);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [purchaseMode, setPurchaseMode] = useState<BillingPurchaseMode>('CARD_AUTO');
  // The deal card carries its own choice: its modes are the deal's (S39), not the catalog's.
  const [dealMode, setDealMode] = useState<BillingPurchaseMode | null>(null);
  const emailFingerprint = useRef('');
  const [quote, setQuote] = useState<BillingQuote | null>(null), [accepted, setAccepted] = useState(false);
  const [capacity, setCapacity] = useState<{ options: BillingCapacityOptions; billingEmail: string; scheduledAt?: string; repair?: { attemptId: string; attemptVersion: number }; key: string; initialSelection?: BillingCapacitySelection } | null>(null);
  const capacityDraft = useRef<(NonNullable<typeof capacity> & { collectionId?: string }) | null>(null);  const [capacityNotice, setCapacityNotice] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [returnAttempt, setReturnAttempt] = useState<BillingAttemptView | null>(null), [returnError, setReturnError] = useState('');
  const [refreshNotice, setRefreshNotice] = useState('');
  const emailSettings = useRef<HTMLDivElement>(null), quoteHeading = useRef<HTMLHeadingElement>(null), backNavigation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (quote || choosing) { backNavigation.current?.scrollIntoView({ block: 'start' }); quoteHeading.current?.focus({ preventScroll: true }); } }, [quote, choosing]);  useEffect(() => { if (error.includes('อีเมล') || error.includes('ผู้รับเอกสาร')) { setSection('payment'); emailSettings.current?.scrollIntoView({ block: 'start' }); } }, [error]);
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
    // A deal's offer is priced from its own snapshot and is not in the catalog (S36), so only its
    // policy revision is checked here — matching it against a catalog row would drop every quote.
    if (quote && data && (quote.policyRevision !== data.catalog.policyRevision || (!billingQuoteDeal(quote) &&
        !data.catalog.offers.some(offer => offer.offerKey === quote.offer.offerKey && offer.interval === quote.offer.interval && offer.availability === 'AVAILABLE')))) {
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
  async function requestQuote(offerKey: string, selectedInterval: string, billingEmail: string, selection?: BillingCapacitySelection, requestedMode?: BillingPurchaseMode, dealId?: string, purchaseIntent?: 'FULL_PACKAGE') {
    // A deal is paid with one of ITS modes: falling back to the catalog's choice here would send
    // CARD_AUTO on a deal quote, which the API refuses.
    const mode = requestedMode ?? (dealId ? chosenDealMode ?? chosenMode : chosenMode);
    pendingPurchase.current = { offer: offerKey, interval: selectedInterval,
      channel: new URLSearchParams(window.location.search).get('channel') === 'line' ? 'line' : 'web', purchaseMode: mode, ...(dealId ? { dealId } : {}), ...(purchaseIntent ? { purchaseIntent } : {}) };
    setCadenceNotice(false);
    const paid = data?.status;
    // S45: a deal skips the capacity and cadence detours. Its limits may sit below what the shop
    // runs today — nothing is deleted, the shop just cannot add more — and its term is N months,
    // so neither the downgrade picker nor the monthly/yearly rules apply.
    if (!dealId && paid?.paidThrough && Date.parse(paid.paidThrough) > Date.now()) {
      const targetRank = BILLING_PAID_TIERS.findIndex(tier => tier === offerKey);
      const currentRank = BILLING_PAID_TIERS.findIndex(tier => tier === paid.tierKey);
      const scheduledSubscriptionChange = paid.renewalMode === 'CARD_AUTO' && paid.subscriptionState === 'active';
      if (scheduledSubscriptionChange && ((targetRank >= 0 && targetRank < currentRank) || (offerKey === paid.tierKey && paid.interval === 'year' && selectedInterval === 'month'))) {
        setQuote(null);
        const options = await api.capacity(offerKey, selectedInterval);
        setCapacity({ options, billingEmail, scheduledAt: paid.paidThrough, key: crypto.randomUUID(), initialSelection: capacityDraft.current?.initialSelection });
        return;
      }
      if (scheduledSubscriptionChange && paid.interval && selectedInterval !== paid.interval) {
        if (targetRank > currentRank) { setCadenceNotice('upgrade'); return; }
        if (paid.pendingPlanChange) { setCadenceNotice('pending'); return; }
      }
    }
    try {
      const latest = await api.status();
      setData(value => value && { ...value, status: latest });
      if (!latest.billingProfile) throw new Error('billing_company_profile_unavailable');
      if (latest.billingProfile.missingFields.length) { setProfileMissing(latest.billingProfile.missingFields); setQuote(null); return; }
      const result = await api.quote(offerKey, selectedInterval, billingEmail, selection, mode, dealId, purchaseIntent);
      if (!selection) capacityDraft.current = null;
      key.current = crypto.randomUUID(); setAccepted(false); setQuote(result); setCapacity(null);
    } catch (error) {
      if (apiErrorCode(error) !== 'BILLING_CAP_SELECTION_REQUIRED' || selection || dealId) throw error;
      setQuote(null); setCapacity({ options: await api.capacity(offerKey, selectedInterval), billingEmail, key: crypto.randomUUID(), initialSelection: capacityDraft.current?.initialSelection });    }
  }
  const annualConversion = quote?.purchase?.kind === 'REPEAT' && quote.purchase.previousInterval === 'month' && quote.offer.interval === 'year';
  // Phase 7: a package bought for the NEXT round moves the menus on the day it starts, not today.
  const menusMoveLater = quote?.advanceDeal ? date(quote.advanceDeal.startsAt)
    : quote?.purchase?.kind === 'SCHEDULED_CHANGE' ? date(quote.purchase.previousPaidThrough) : null;
  const status = data?.status;
  const availableModes = status?.availablePurchaseModes ?? ['CARD_AUTO'];
  const displayedModes = status?.enabledPurchaseModes ?? availableModes;
  const modeAvailabilityKey = `${availableModes.join('|')}::${displayedModes.join('|')}`;
  useEffect(() => {
    const [available = '', displayed = ''] = modeAvailabilityKey.split('::');
    const modes = available.split('|').filter(Boolean) as BillingPurchaseMode[];
    const shown = displayed.split('|').filter(Boolean) as BillingPurchaseMode[];
    setPurchaseMode(current => modes.includes(current) ? current : modes[0] ?? shown[0] ?? 'CARD_AUTO');
  }, [modeAvailabilityKey]);
  const chosenMode = purchaseMode;
  const modeUnavailable = !availableModes.includes(chosenMode);
  const deal = billingDeal(status);
  const dealModes = deal?.purchaseModes ?? [];
  const chosenDealMode = dealMode && dealModes.includes(dealMode) ? dealMode : dealModes[0];
  const dealQuote = billingQuoteDeal(quote);
  // D-P5-1: the quote's own ride-along carries no cadence, and the offer being confirmed is the one
  // still on the status — so the auto-renew wording comes from there, matched by id.
  const autoDeal = dealQuote && deal?.dealId === dealQuote.dealId && deal.autoRenew ? deal : null;
  // The attempt says what this Checkout paid for, so the return page names the offer by itself.
  const dealReturn = returning && billingQuoteDeal(returnAttempt);
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
  const canResumePayment = status?.attemptId && status.canCancelCheckout && ['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'].includes(status.paymentState);
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
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{returnFailed ? 'รายการชำระเงินนี้ไม่สำเร็จ' : status.pendingDeal ? status.pendingDeal.state === 'HELD' ? 'ชำระแล้ว ต้องตรวจสอบก่อนเริ่มดีล' : status.pendingDeal.state === 'PAID' ? 'ชำระดีลแล้ว รอเริ่มสิทธิ์' : 'ชำระแล้ว กำลังยืนยันการต่ออายุ' : confirmed ? returning ? dealReturn ? 'ใช้งานข้อเสนอพิเศษแล้ว' : 'ชำระแล้ว เปิดใช้งานแล้ว' : 'แพ็กเกจปัจจุบัน' : (returning ? returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState !== 'APPLIED' : status.paymentState === 'PAID' && status.applyState !== 'APPLIED') ? 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์' : status.paymentState === 'FAILED' ? 'เรียกเก็บเงินไม่สำเร็จ' : status.attemptId ? 'กำลังตรวจสอบรายการชำระเงิน' : packageHeading}</h2>
          <MangmeeBadge tone={status.accessState === 'ACTIVE' ? 'brand' : 'amber'}>{status.accessState === 'ACTIVE' ? 'ใช้งานได้' : status.accessState !== 'EXPIRED' ? 'อยู่ระหว่างตรวจสอบ' : lockReason === 'no_package' ? 'ยังไม่มีแพ็กเกจ' : 'ครบกำหนดใช้งาน'}</MangmeeBadge>
        </div>
        {noPackage ? <dl className="grid gap-5 rounded-xl bg-gray-50 p-4">
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">ยังไม่มีแพ็กเกจ</dd>
            <p className="mt-1 text-sm text-gray-600">เลือกแพ็กเกจเพื่อเริ่มใช้งาน</p>
            {/* Only when a term really ran out: a shop that never had one starts and ends today. */}
            {lockReason === 'trial_ended' && status.termEndsAt && <p className="mt-1 text-sm text-gray-500">ครบกำหนดเมื่อ {date(status.termEndsAt)}</p>}</div>
        </dl> : <dl className="grid gap-5 rounded-xl bg-gray-50 p-4 sm:grid-cols-3">
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.tierKey && status.tierKey in PLAN_TIER_PRESETS ? PLAN_TIER_PRESETS[status.tierKey as PlanTierKey].labelTh : status.tierKey ? 'ต้องตรวจสอบข้อมูล' : 'ยังไม่มีข้อมูลแพ็กเกจ'}</dd></div>
          <div><dt className="text-sm text-gray-500">{status.pendingPlanChange?.action === 'PREPAID_PLAN_CHANGE' ? 'แพ็กเกจปัจจุบันใช้ถึง' : 'ใช้งานได้ถึง'}</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.pendingPlanChange?.action === 'PREPAID_PLAN_CHANGE' ? date(status.pendingPlanChange.effectiveAt) : status.termEndsAt ? date(status.termEndsAt) : 'ยังไม่ระบุ'}</dd></div>
          <div><dt className="text-sm text-gray-500">ใบเสร็จคงเหลือ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.purchaseSource === 'NO_TERM' && status.usage.remaining === null ? 'ยังไม่ได้กำหนดโควตาแพ็กเกจ' : status.usage.remaining ?? 'ไม่จำกัด'} {status.usage.remaining !== null && 'ใบ'}</dd>{(quotaReset || (quotaExpiry && date(quotaExpiry) !== date(status.termEndsAt))) && <p className="mt-1 text-sm text-gray-500">{quotaReset ? `เริ่มรอบใหม่ ${date(quotaReset)}` : `ใบที่หมดอายุก่อนใช้ได้ถึง ${date(quotaExpiry)}`}</p>}</div>
        </dl>}
        {status.effectiveCapacity?.temporary&&<section className="space-y-2 rounded-xl border border-emerald-300 p-3" aria-label="สิทธิ์แพ็กเกจชั่วคราว"><p>ผู้ดูแลให้สิทธิ์ {PLAN_TIER_PRESETS[status.effectiveCapacity.tierKey].labelTh} ชั่วคราว</p><p>{status.effectiveCapacity.branchLimit} สาขา · {status.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {date(status.effectiveCapacity.temporary.expiresAt)}</p><p>เมื่อครบกำหนดจะใช้แพ็กเกจที่ซื้ออยู่ล่าสุด การซื้อเพิ่มด้านล่างคิดจากแพ็กเกจที่ชำระเงิน</p></section>}

        {status.usage.monthlyAllowance&&<p>{billingMonthlyAllowanceText(status.usage)}</p>}
        {!status.pendingDeal && (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && status.paidThrough && <p className="text-sm text-gray-600">จ่ายครั้งเดียว ใช้ได้ถึง {date(status.paidThrough)} · ไม่มีการตัดเงินงวดถัดไป ซื้อใหม่เมื่ออยากใช้ต่อ</p>}
        {status.pendingDeal && <section role="status" aria-label="สถานะดีลล่วงหน้า" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">{status.pendingDeal.state === 'HELD' ? 'ชำระแล้ว รายการนี้ต้องให้ทีมงานตรวจสอบก่อนเริ่มดีล' : status.pendingDeal.state === 'PAID' ? 'ชำระดีลแล้ว รอเริ่มสิทธิ์' : 'ชำระดีลแล้ว กำลังยืนยันการต่ออายุ'}</p>
          <p>สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง {date(status.pendingDeal.startsAt)} แล้วจึงเริ่มสิทธิ์ดีล</p>
          <p>งวดแรกสิ้นสุด {date(status.pendingDeal.firstCycleEndsAt)} · {status.pendingDeal.purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'ตัดบัตรรอบถัดไป'} วันที่ {date(status.pendingDeal.nextChargeAt)}</p>
        </section>}
        {status.renewalMode === 'PROMPTPAY_RENEW' && status.attemptId && status.applyState === 'APPLIED' && <p role="status" className="rounded-xl bg-amber-50 p-3">ชำระงวดแรกสำเร็จแล้ว กำลังยืนยันการตั้งบิล QR รอบถัดไป กรุณาตรวจสถานะอีกครั้ง</p>}
        {status.cancelAtPeriodEnd ? <p className="text-sm text-gray-600">หยุดต่ออายุแล้ว ใช้งานได้ถึงวันที่ระบุข้างต้น</p> : status.nextChargeAt && !status.collectionPause && <p className="text-sm text-gray-600">{status.renewalMode === 'PROMPTPAY_RENEW' ? 'ระบบจะออกบิล QR วันที่ ' : 'ต่ออายุอัตโนมัติวันที่ '}{date(status.nextChargeAt)}</p>}
        {status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <div className="space-y-2 rounded-xl border border-brand-200 p-4"><p>บิลต่ออายุรอชำระ{status.renewalInvoiceDueAt ? ` · ครบกำหนด ${date(status.renewalInvoiceDueAt)}` : ''}</p><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate(status.renewalInvoiceUrl!, 'document'))}>เปิดบิลและสแกน QR</button></div>}
        {status.graceEndsAt && <p>ระยะผ่อนผันถึง {date(status.graceEndsAt)} · ใช้ยอดใบเสร็จเดิมที่เหลือได้ ไม่มีการเติมโควตาจนกว่าจะชำระสำเร็จ</p>}
        {status.purchaseEligibility === 'COMPANY_SALES_CLOSED' && <p role="status" className="text-sm leading-7 text-gray-600">บริษัทนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ กรุณาติดต่อทีมมั่งมี</p>}
        {status.purchaseEligibility === 'SOURCE_REVIEW_REQUIRED' && <p role="status" className="text-sm leading-7 text-gray-600">ข้อมูลการชำระเงินเดิมของบริษัทนี้ยังไม่ตรงกัน กรุณาติดต่อทีมมั่งมีก่อนเริ่มรายการใหม่</p>}
        {status.purchaseEligibility === 'ENTITLEMENT_REVIEW_REQUIRED' && <p role="status" className="text-sm leading-7 text-gray-600">ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมมั่งมีก่อนชำระเงิน</p>}
        {status.refundReviewPending && <p role="status" className="rounded-xl bg-amber-50 p-3">กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ คำขอนี้ไม่เปลี่ยนสิทธิ์แพ็กเกจเดิม คุณตรวจรายการเดิมด้านล่าง หรือ <a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมมั่งมี</a> ได้</p>}
        {status.accessState === 'HELD' && <p>บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน ข้อมูลยังอยู่ครบ</p>}
        {(status.reference || returnAttemptId) && !confirmed && <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงสำหรับแจ้งทีมงาน</summary><p className="break-all">{billingSupportReference(returning ? returnAttemptId : status.reference)}</p></details>}
        {returnFailed && <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">รายการนี้ไม่ได้ชำระสำเร็จหรือรายการหมดอายุ สิทธิ์แพ็กเกจเดิมยังคงเดิม</p>}
        {returning && !confirmed && timedOut && <p role="status">ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง</p>}
        {canResumePayment && <button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => { const result = await api.resume(status.attemptId!); if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout'); else setReload(value => value + 1); })}>กลับไปยังรายการเดิม</button>}
        {status.canCancelCheckout && status.attemptId && (confirmCheckoutCancel ? <div className="space-y-2 rounded-xl border border-amber-300 p-3">
          <p>ยุติหน้าชำระเงินรายการนี้ใช่ไหม? ระบบจะตรวจผลกับ Stripe ก่อนให้เริ่มรายการใหม่</p>
          <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async () => {
            const result = await api.cancelCheckout(status.attemptId!);
            setConfirmCheckoutCancel(false);
            setCheckoutCancelNotice(result.state === 'EXPIRED' ? 'ยุติหน้าชำระเงินแล้ว เลือกแพ็กเกจใหม่ได้' : 'กำลังตรวจผลรายการเดิม กรุณาอัปเดตข้อมูลก่อนเริ่มรายการใหม่');
            setReload(value => value + 1);
          })}>ยืนยันยุติหน้าชำระเงิน</button><button className={button} disabled={busy} onClick={() => setConfirmCheckoutCancel(false)}>ยังไม่ยุติ</button></div>
        </div> : <button className={button} disabled={busy} onClick={() => setConfirmCheckoutCancel(true)}>ยุติรายการที่ยังไม่ชำระ</button>)}
        {checkoutCancelNotice && <p role="status" className="rounded-xl bg-gray-50 p-3">{checkoutCancelNotice}</p>}
        {hasPaymentToCheck && <div className="space-y-3 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async () => {
            const result = await api.refresh();
            setRefreshNotice(result.queued ? 'ส่งคำขอตรวจสอบแล้ว ยังไม่ใช่ผลยืนยันการชำระเงิน กดอัปเดตข้อมูลเพื่อดูผลภายหลัง' : 'ยังไม่มีรายการที่ต้องตรวจสอบกับผู้ให้บริการ');
            setReload(value => value + 1);
          })}>ตรวจผลการชำระเงินอีกครั้ง</button>
          {refreshNotice && <button className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>อัปเดตข้อมูล</button>}</div>
          {refreshNotice && <p role="status" className="text-sm text-gray-600">{refreshNotice}</p>}
        </div>}
        {/* R10: the offer is the first card behind this button, so the button itself has to say so —
            a locked shop with a three-day deal must not have to guess that "เลือกแพ็กเกจ" holds it. */}
        {status.allowedActions.includes('new_sales') && <button className="mangmee-btn mangmee-btn-primary" onClick={() => setChoosing(true)}>{deal ? 'ดูข้อเสนอพิเศษสำหรับร้านคุณ' : status.subscriptionState === 'NONE' ? 'เลือกแพ็กเกจ' : 'ซื้อหรือเปลี่ยนแพ็กเกจ'}</button>}
      </section>
      </>}
      <div hidden={section !== 'payment'} className="space-y-6">
      {status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <section className="mangmee-card space-y-3 p-5" aria-label="บิล QR รอบปัจจุบัน"><h2 className="text-lg font-bold">บิล PromptPay รอบปัจจุบัน</h2><p>สแกน QR เพื่อชำระบิลเดิม ระบบไม่หักเงินอัตโนมัติ</p><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate(status.renewalInvoiceUrl!, 'document'))}>เปิดบิลและสแกน QR</button></section>}
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
          <h2 ref={quoteHeading} tabIndex={-1} className="text-xl font-bold text-gray-900 sm:text-2xl">{quote ? dealQuote ? <>ยืนยันข้อเสนอพิเศษ: {quote.offer.label} · {dealQuote.months} เดือน</>
            : <>{annualConversion ? 'เปลี่ยนเป็นรายปี:' : quote.purchase?.kind === 'REPEAT' ? 'ยืนยันซื้อแพ็กเกจเดิมเพิ่ม:' : quote.purchase?.kind === 'SCHEDULED_CHANGE' ? 'ยืนยันแพ็กเกจรอบถัดไป:' : 'ยืนยันซื้อ'} {quote.offer.label}{!annualConversion && ` ${quote.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}`}</> : status.capacityRepair ? 'ตรวจสอบสิทธิ์จากรายการชำระเงิน' : 'เลือกแพ็กเกจ'}</h2></div>}
      {capacityNotice && status.attemptId && <p role="status">{capacityNotice}</p>}
      {status.capacityRepair && !capacity && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>ชำระสำเร็จแล้ว แต่ข้อมูลสาขาหรือผู้ใช้เปลี่ยน กรุณาเลือกสิทธิ์ล่าสุดเพื่อเปิดใช้งานจากรายการเดิม</p>
        <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { const repair = status.capacityRepair!; setCapacity({ options: await api.capacity(repair.offerKey, repair.interval), billingEmail: email, repair, key: crypto.randomUUID() }); })}>เลือกสิทธิ์สำหรับรายการที่จ่ายแล้ว</button></section>}
      {capacity && <BillingCapacityPicker key={capacity.options.sourceHash + capacity.key} options={capacity.options} initialSelection={capacity.initialSelection} repair={!!capacity.repair} scheduledAt={capacity.scheduledAt} currentTierKey={status.tierKey} currentInterval={status.interval} onCancel={selection => { if (!capacity.repair) capacityDraft.current = { ...capacity, initialSelection: selection }; setCapacity(null); }}        onRefresh={async () => { const latest = await api.status(), options = await api.capacity(capacity.options.offerKey, capacity.options.interval);
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
          } else await requestQuote(capacity.options.offerKey, capacity.options.interval, capacity.billingEmail, selection);        }} />}
      {status.allowedActions.includes('new_sales') && !quote && !capacity && <section className="space-y-4" aria-label="เลือกแพ็กเกจ">
        {emailReadError && <p role="alert">ยังตรวจสอบอีเมลบัญชีไม่ได้ <button className="min-h-11 font-semibold underline" onClick={() => setReload(value => value + 1)}>ลองใหม่</button></p>}
        {!emailReady && !emailReadError && <p role="status">{emailState ? <>ยืนยันอีเมลบัญชีก่อนซื้อแพ็กเกจ <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={accountHref}>ไปที่บัญชีของฉัน</Link></> : 'กำลังตรวจสอบอีเมลบัญชี…'}</p>}
        {catalogUnavailable && <p role="status">ยังตรวจสอบราคาปัจจุบันไม่ได้ กรุณาลองใหม่ คุณยังดูประวัติและจัดการรายการเดิมได้</p>}
        {/* R10: the deal is the first card, above the catalog, and the catalog stays selectable. */}
        {deal && <section aria-label="ข้อเสนอพิเศษสำหรับร้านคุณ" className="mangmee-card space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold">ข้อเสนอพิเศษสำหรับร้านคุณ</h3>
            <MangmeeBadge tone="brand">ข้อเสนอพิเศษ</MangmeeBadge>
          </div>
          <p className="font-bold">{deal.baseLabel}</p>
          <p className="text-2xl font-bold text-brand-800">{money(deal.priceSatang)}</p>
          <p>{deal.autoRenew ? `ราคานี้${deal.cadence === 'year' ? 'ทุกปี' : 'ทุกเดือน'}` : `รวม ${deal.months} เดือน`}</p>
          <p>{deal.branchLimit} สาขา · {deal.employeeLimit} ผู้ใช้ · {deal.monthlySlipLimit.toLocaleString('th-TH')} ใบต่อเดือน</p>
          {dealMenuLabels(deal.featureKeys).length > 0 && <p>เมนูที่ได้: {dealMenuLabels(deal.featureKeys).join(' · ')}</p>}
          <p>{deal.creditScope === 'CHAT' ? 'เครดิตแชต' : 'เพดาน AI รวม'}: {dealAiCreditText(deal.aiMonthlyBudgetSatang, deal.creditScope)}</p>
          {deal.creditScope === 'CHAT' && <p className="text-sm text-gray-600">หากร้านมีค่าเครดิตพิเศษที่ผู้ดูแลตั้งไว้ จะคงค่านั้น</p>}
          {deal.description && <p className="text-sm text-gray-600">{deal.description}</p>}
          <p className="text-sm text-gray-600">ใช้ได้ถึง {date(deal.offerExpiresAt)}</p>
          {/* S37: both one-time gates closed means nobody can pay this offer on the web today. */}
          {!chosenDealMode ? <p role="status" className="rounded-xl bg-amber-50 p-4">ติดต่อทีมงานเพื่อชำระข้อเสนอนี้ โทร {PLAN_TERM_RENEW_PHONE}</p> : <>
            <fieldset className="space-y-2"><legend className="font-semibold">วิธีชำระข้อเสนอนี้</legend>
              {dealModes.map(mode => <label key={mode} className="flex min-h-11 items-center gap-3"><input type="radio" name="dealPurchaseMode" checked={chosenDealMode === mode}
                onChange={() => { setDealMode(mode); setQuote(null); setCapacity(null); }} />{billingPurchaseModeLabel(mode)}</label>)}
            </fieldset>
            <p className="text-sm text-gray-600">{dealRenewalText(deal, chosenDealMode)}</p>
            {/* An auto-renewing deal's offer IS its cadence (D-P5-2), so that is the interval the
                quote is asked for — a yearly deal priced as a month would bill the wrong period. */}
            <button className="mangmee-btn mangmee-btn-primary w-full" disabled={busy || !emailReady || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} aria-busy={Boolean(busy)}
              onClick={() => action(async () => { await requestQuote(deal.base, deal.autoRenew && deal.cadence === 'year' ? 'year' : 'month', email, undefined, chosenDealMode, deal.dealId); })}>เลือกข้อเสนอนี้</button>
          </>}
        </section>}
        {deal && <h3 className="text-lg font-bold">หรือเลือกแพ็กเกจปกติ</h3>}
        <fieldset className="space-y-2"><legend className="font-semibold">วิธีชำระและต่ออายุ</legend>
          {displayedModes.map(mode => <label key={mode} className="flex min-h-11 items-center gap-3"><input type="radio" name="purchaseMode" checked={chosenMode === mode}
            onChange={() => { setPurchaseMode(mode); setQuote(null); setCapacity(null); }} />{billingPurchaseModeLabel(mode)}</label>)}
        </fieldset>
        {status.renewalMode === 'CARD_AUTO' && status.subscriptionState === 'active' && status.paidThrough && Date.parse(status.paidThrough) > Date.now() && !availableModes.includes('CARD_ONCE') &&
          <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm leading-7">{modeUnavailable ? 'เลือกวิธีจ่ายใหม่นี้ได้ แต่ยังชำระซ้อนกับสมาชิกเดิมไม่ได้' : 'บริษัทนี้มีสมาชิกบัตรที่ต่ออายุอัตโนมัติอยู่'} หากต้องการเปลี่ยน ให้<button className="mx-1 font-semibold text-brand-700 underline" onClick={() => { setChoosing(false); setSection('payment'); }}>หยุดต่ออายุอัตโนมัติ</button>ก่อน สิทธิ์ที่จ่ายไว้ใช้ได้ถึง {date(status.paidThrough)} แล้วจึงซื้อด้วยวิธีใหม่</p>}
        {(status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && modeUnavailable &&
          <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm leading-7">แพ็กเกจปัจจุบันเป็นแบบจ่ายครั้งเดียว ระหว่างที่ยังไม่หมดอายุ ซื้อแพ็กเกจอื่นได้ด้วยบัตรจ่ายครั้งเดียวหรือ PromptPay จ่ายครั้งเดียว หากต้องการต่ออายุอัตโนมัติให้เริ่มหลังแพ็กเกจนี้หมดอายุ</p>}
        <div className="flex gap-2">{(['month', 'year'] as const).map(value => <button key={value} className={interval === value ? billingPrimaryControl : button} aria-pressed={interval === value} onClick={() => { setInterval(value); setQuote(null); setCapacity(null); setCadenceNotice(false); }}>{value === 'month' ? 'รายเดือน' : 'รายปี'}</button>)}</div>
        {cadenceNotice && <div ref={cadenceNoticeRef} tabIndex={-1} role="status" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-3 rounded-xl bg-amber-50 p-4">
          <p>{cadenceNotice === 'pending' ? 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป กรุณาตรวจสอบและยกเลิกรายการนั้นก่อนซื้อรายปี' : 'หากต้องการเพิ่มระดับและเปลี่ยนรอบชำระ ให้เพิ่มระดับในรอบเดิมก่อน แล้วจึงเลือกรอบชำระใหม่ ระบบจะแสดงยอดให้ตรวจสอบแยกแต่ละรายการ'}</p>
          <button className={button} onClick={() => { if (cadenceNotice === 'pending') setSection('payment'); else setInterval(status.interval!); setCadenceNotice(false); }}>{cadenceNotice === 'pending' ? 'ดูรายการเปลี่ยนแพ็กเกจ' : `เลือกแพ็กเกจ${status.interval === 'year' ? 'รายปี' : 'รายเดือน'}`}</button>
        </div>}        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.catalog.offers.filter(offer => offer.interval === interval).map(offer => {
          const monthly = data.catalog.offers.find(item => item.offerKey === offer.offerKey && item.interval === 'month');
          const saving = interval === 'year' && monthly ? monthly.priceSatang * 12 - offer.priceSatang : 0;
          const current = status.accessState === 'ACTIVE' && status.tierKey === offer.offerKey && status.interval === offer.interval;
          const currentRank = BILLING_PAID_TIERS.indexOf(status.tierKey as typeof BILLING_PAID_TIERS[number]);
          const fullPackageUpgrade = status.accessState === 'ACTIVE' && currentRank >= 0 && status.paidThrough && Date.parse(status.paidThrough) > Date.now() &&
            (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') &&
            (chosenMode === 'CARD_ONCE' || chosenMode === 'PROMPTPAY_ONCE') && status.interval === offer.interval &&
            BILLING_PAID_TIERS.indexOf(offer.offerKey as typeof BILLING_PAID_TIERS[number]) > currentRank;
          // Every card compares the same six baseline entrances; Enterprise names its additional
          // full-package coverage separately without reducing the entitlement snapshot it grants.
          const menus = catalogCardMenus;
          return <article key={offer.offerKey} className={`mangmee-card relative flex flex-col gap-4 p-5${current ? ' !border-brand-500' : ''}`}>
          {current && <MangmeeBadge className="absolute -top-3 right-4 border">แพ็กเกจปัจจุบัน</MangmeeBadge>}
          <h3 className="font-bold">{offer.label}</h3><p className="text-xl font-bold">{money(offer.priceSatang)} / {interval === 'month' ? 'เดือน' : 'ปี'}</p>
          <p className="text-sm text-brand-700">{interval === 'year' ? `ใช้งาน 12 เดือน${saving > 0 ? ` · ประหยัด ${money(saving)}` : ''}` : 'ชำระรายเดือน'}</p><p>{offer.branchLimit} สาขา · {offer.employeeLimit} ผู้ใช้</p>
          <p>{offer.receiptAllowance.toLocaleString('th-TH')} ใบ ได้ทันทีเมื่อชำระสำเร็จ</p>
          <p>เครดิตแชตเริ่มต้น {DEFAULT_CHAT_CREDIT_SATANG / 100} credit / เดือน · ใบเสร็จคิดตามจำนวนที่อ่านสำเร็จ</p>
          {offer.offerKey === 'ENTERPRISE_1999' && <p className="text-sm text-gray-600">{enterpriseMenuSummary}</p>}
          {menus.length > 0 && <details className="text-sm text-gray-600"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand-700">ดูรายละเอียดทั้งหมด · {menus.length} เมนู</summary>
            <ul className="space-y-1 break-words">{menus.map(label => <li key={label}><span aria-hidden="true">✓ </span>{label}</li>)}</ul></details>}
          {offer.availability === 'COMING_SOON' && <p className="text-sm text-gray-600">แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน</p>}
          <button className="mangmee-btn mangmee-btn-primary mt-auto w-full" disabled={modeUnavailable || busy || !emailReady || catalogUnavailable || Date.parse(data.catalog.validUntil) <= Date.now() || offer.availability !== 'AVAILABLE' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} aria-busy={Boolean(busy)} onClick={() => action(async () => {
            await requestQuote(offer.offerKey, interval, email);
          })}>{offer.availability === 'COMING_SOON' ? 'เร็ว ๆ นี้' : offer.availability === 'AVAILABLE' ? current ? 'ซื้อแพ็กเกจเดิมเพิ่ม' : fullPackageUpgrade ? 'อัปเกรดจ่ายส่วนต่าง' : status.paidThrough && Date.parse(status.paidThrough) > Date.now() && status.tierKey === offer.offerKey && status.interval === 'month' && interval === 'year' ? 'เปลี่ยนเป็นรายปี' : status.paidThrough && Date.parse(status.paidThrough) > Date.now() && status.tierKey === offer.offerKey && status.interval === 'year' && interval === 'month' ? 'เปลี่ยนเป็นรายเดือนรอบถัดไป' : 'เลือกแพ็กเกจนี้' : 'ยังไม่เปิดขาย'}</button>
          {fullPackageUpgrade && <button className={button} disabled={modeUnavailable || busy || !emailReady || catalogUnavailable || Date.parse(data.catalog.validUntil) <= Date.now() || offer.availability !== 'AVAILABLE'} onClick={() => action(async () => {
            await requestQuote(offer.offerKey, interval, email, undefined, chosenMode, undefined, 'FULL_PACKAGE');
          })}>ซื้อ {offer.label} เต็มแพ็ก {money(offer.priceSatang)}</button>}
        </article>; })}</div>
      </section>}
      {quote && <section aria-label="ยืนยันซื้อแพ็กเกจ" className="mangmee-card space-y-5 p-5 sm:p-6">
        {dealQuote && <p className="rounded-xl bg-brand-50 p-4 text-brand-800">ข้อเสนอพิเศษ · {autoDeal ? dealConfirmText(autoDeal) : `จ่ายครั้งเดียว ไม่มีหักอัตโนมัติ · ใช้ได้ ${dealQuote.months} เดือน`}{dealQuote.description ? ` · ${dealQuote.description}` : ''}</p>}
        <p>{quote.advanceDeal ? `สิทธิ์ดีลตั้งแต่ ${date(quote.advanceDeal.startsAt)}:` : quote.purchase?.kind === 'REPEAT' ? 'สิทธิ์คงเดิม:' : quote.purchase?.kind === 'SCHEDULED_CHANGE' ? `สิทธิ์ตั้งแต่ ${date(quote.purchase.previousPaidThrough)}:` : 'สิทธิ์หลังชำระสำเร็จ:'} สูงสุด {quote.offer.branchLimit} สาขา · {quote.offer.employeeLimit} ผู้ใช้ รวมเจ้าของ</p>
        {quote.advanceDeal && <section aria-label="กำหนดการเริ่มดีลล่วงหน้า" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">ชำระดีลงวดแรกวันนี้ · สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง {date(quote.advanceDeal.startsAt)}</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-sm text-gray-600">วันเริ่มสิทธิ์ดีล</dt><dd className="font-semibold">{date(quote.advanceDeal.startsAt)}</dd></div>
            <div><dt className="text-sm text-gray-600">งวดแรกสิ้นสุด</dt><dd className="font-semibold">{date(quote.advanceDeal.firstCycleEndsAt)}</dd></div>
            <div><dt className="text-sm text-gray-600">{quote.purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'เก็บเงินรอบถัดไป'}</dt><dd className="font-semibold">{date(quote.advanceDeal.nextChargeAt)}</dd></div>
          </dl>
          <p>สิทธิ์และโควตาของดีลจะเริ่มในวันเริ่มสิทธิ์ดีล</p>
        </section>}
        <div className="rounded-xl border border-gray-200 p-4" aria-label="ข้อมูลออกเอกสาร">
          <p className="font-semibold">ข้อมูลออกเอกสาร</p>
          <p className="mt-2 break-words">{quote.billingProfile?.name ?? quote.companyName}</p>
          {quote.billingProfile && <p className="mt-1 break-words">{Object.values(quote.billingProfile.address).filter(Boolean).join(' ')}</p>}
          <p className="mt-1 break-words">{quote.billingEmail}</p>
          <Link className="mt-2 inline-flex min-h-11 items-center text-brand-700 underline" href={billingProfileHref(companyId, {
            offer: quote.offer.offerKey, interval: quote.offer.interval, channel: pendingPurchase.current?.channel ?? 'web', purchaseMode: quote.purchaseMode,
            ...(dealQuote ? { dealId: dealQuote.dealId } : {}),
            ...(quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? { purchaseIntent: 'FULL_PACKAGE' as const } : {}),
          })}>แก้ไขข้อมูลบริษัท</Link>
        </div><p>ราคาก่อนภาษี {money(quote.subtotalSatang)} · ภาษี {money(quote.taxSatang)}</p>
        {quote.purchase && ['REPEAT', 'FULL_PACKAGE_UPGRADE'].includes(quote.purchase.kind) ? <dl className={`grid gap-5 rounded-xl bg-brand-50 p-5 ${annualConversion ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div><dt className="text-sm text-brand-800">ชำระวันนี้</dt><dd className="mt-1 text-2xl font-bold text-brand-800">{money(quote.totalSatang)}</dd></div>
          <div><dt className="text-sm text-gray-600">โควตาที่เพิ่ม</dt><dd className="mt-1 text-xl font-bold">{quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบ<span className="mt-1 block text-sm font-normal text-gray-600">ใช้ได้ทันทีเมื่อชำระสำเร็จ</span></dd></div>
          <div><dt className="text-sm text-gray-600">วันหมดอายุใหม่</dt><dd className="mt-1 text-xl font-bold">{date(quote.purchase.projectedPaidThrough)}<span className="mt-1 block text-sm font-normal text-gray-600">{annualConversion ? 'เพิ่ม 12 เดือนจาก' : 'ต่อจากเดิม'} {date(quote.purchase.previousPaidThrough)}</span></dd></div>
          {annualConversion && <div><dt className="text-sm text-gray-600">ต่ออายุรายปีครั้งถัดไป</dt><dd className="mt-1 text-xl font-bold">{money(quote.totalSatang)}<span className="mt-1 block text-sm font-normal text-gray-600">วันที่ {date(quote.purchase.projectedPaidThrough)}</span></dd></div>}
        </dl> : <p className="rounded-xl bg-brand-50 p-5 text-2xl font-bold text-brand-800">ชำระวันนี้ {money(quote.totalSatang)}</p>}
        <p>{quote.taxTreatment === 'NOT_VAT_REGISTERED' ? 'บริษัทผู้ให้บริการยังไม่ได้จด VAT จึงไม่มีการเรียกเก็บ VAT' : quote.taxTreatment === 'INCLUSIVE_VAT_7' ? 'ราคารวม VAT 7% แล้ว' : 'ราคาเพิ่ม VAT 7%'}</p>
        {quote.purchase?.kind === 'UPGRADE' ? <div className="space-y-2"><p>ชำระส่วนต่างและเริ่ม {quote.offer.label} เมื่อยืนยันการชำระสำเร็จ วันหมดอายุคงเดิม {date(quote.purchase.projectedPaidThrough)} เพิ่ม {quote.purchase.receiptUnitsAdded} ใบ รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts} ใบ</p><p>{quote.purchaseMode === 'CARD_AUTO' ? 'ยอดต่ออายุรอบถัดไป' : 'ราคาเต็มเมื่อซื้อรอบใหม่'} {money(quote.upgrade!.nextRenewalTotalSatang)}</p>{(quote.purchaseMode === 'CARD_ONCE' || quote.purchaseMode === 'PROMPTPAY_ONCE') && <button className={button} disabled={busy} onClick={() => action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, email, undefined, quote.purchaseMode, undefined, 'FULL_PACKAGE'); })}>ดูทางเลือกซื้อ {quote.offer.label} เต็มแพ็ก {money(quote.upgrade!.nextRenewalTotalSatang)}</button>}<details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">รายละเอียดส่วนต่าง</summary><p>คำนวณส่วนต่าง ณ {date(quote.upgrade!.prorationAt)} · จำนวนคงเหลือเปลี่ยนตามการใช้งานระหว่างชำระ</p><ul className="space-y-1">{quote.upgrade!.segments.map((segment,index)=><li key={index}>{date(segment.start)} ถึง {date(segment.end)}: {money(segment.amountSatang)} · เพิ่ม {segment.receiptUnitsAdded} ใบ</li>)}</ul></details></div> : quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? <div className="space-y-2"><p>ซื้อ {quote.offer.label} เต็มแพ็กเพิ่มจากแพ็กเดิม จ่ายราคาเต็ม {money(quote.totalSatang)} ไม่หักค่าแพ็กเดิม เริ่มสิทธิ์แพ็กใหม่และเพิ่มโควตาเต็ม {quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบทันทีหลังชำระสำเร็จ</p><p>รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ (รวมยอดเดิมที่ยังใช้ได้) · วันหมดอายุใหม่ {date(quote.purchase.projectedPaidThrough)} · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</p><button className={button} disabled={busy} onClick={() => action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, email, undefined, quote.purchaseMode); })}>กลับไปดูราคาอัปเกรดจ่ายส่วนต่าง</button></div> : quote.purchase?.kind === 'SCHEDULED_CHANGE' ? <div className="space-y-2"><p>ชำระแพ็กเกจเต็มล่วงหน้า สิทธิ์เดิมยังใช้ได้ถึง {date(quote.purchase.previousPaidThrough)} จากนั้นเริ่ม {quote.offer.label} และรับโควตา {quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบ</p><p>แพ็กเกจรอบใหม่ใช้ได้ถึง {date(quote.purchase.projectedPaidThrough)} ไม่มีการตัดเงินงวดถัดไป</p></div> : quote.purchase?.kind === 'REPEAT' ? <p className="text-sm text-gray-600">หลังซื้อคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ รวมโควตาเดิมที่ยังไม่หมดอายุ · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</p> : quote.purchase?.kind === 'RESTART' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ รับ {quote.offer.receiptAllowance} ใบ วันและโควตาที่หมดอายุไปแล้วไม่ทบ ประวัติชำระเงินเดิมยังดูได้</p> : <div className="space-y-2">
          {quote.purchase?.trialCarryover && <dl className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
            <div className="flex justify-between gap-3"><dt>โควตาแพ็กเกจ</dt><dd>{quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</dd></div>
            <div className="flex justify-between gap-3"><dt>ยกยอดจากทดลองใช้</dt><dd>{quote.purchase.trialCarryover.receiptUnits.toLocaleString('th-TH')} ใบ</dd></div>
            {quote.purchase.projectedRemainingReceipts > quote.offer.receiptAllowance + quote.purchase.trialCarryover.receiptUnits && <div className="flex justify-between gap-3"><dt>โควตาเพิ่มเติมเดิมที่ยังใช้ได้</dt><dd>{(quote.purchase.projectedRemainingReceipts - quote.offer.receiptAllowance - quote.purchase.trialCarryover.receiptUnits).toLocaleString('th-TH')} ใบ</dd></div>}
            <div className="flex justify-between gap-3 font-semibold"><dt>รวมหลังชำระสำเร็จโดยประมาณ</dt><dd>{quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ</dd></div>
            <div className="text-gray-600">ยอดจากทดลองใช้หมดอายุวันที่ {date(quote.purchase.trialCarryover.expiresAt)} · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</div>
          </dl>}
          {quote.previousSource === 'ADMIN_MANUAL' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ แพ็กเกจเดิมที่ผู้ดูแลให้ไว้ถึง {date(quote.previousTermEndsAt)} จะถูกแทนที่ วันคงเหลือ (ถ้ามี) ไม่ทบและไม่ลดราคา รับโควตาใหม่ {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</p>
            : quote.previousSource === 'NO_TERM' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ รับโควตา {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ ไม่มีวันแพ็กเกจเดิมให้ทบ</p>
            /* An auto-renewing deal opens ONE cycle per payment, so its snapshot `months` — which
               the deal itself ignores — must not be read as the term: the offer's interval is. */
            : quote.advanceDeal ? <p>ชำระงวดแรกวันนี้ ใช้แพ็กเกจปัจจุบันต่อถึง {date(quote.advanceDeal.startsAt)} แล้วจึงเริ่มดีลและรับโควตา {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</p>
              : <p>ชำระสำเร็จแล้ว ใช้งานได้ {dealQuote && !autoDeal ? `${dealQuote.months} เดือน` : quote.offer.interval === 'year' ? '12 เดือน' : '1 เดือน'} {!quote.purchase?.trialCarryover && <>พร้อมโควตา {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</>}</p>}
          {quote.purchase?.kind === 'INITIAL' && quote.trialEndsAt && <p className="text-sm text-gray-600">การทดลองใช้จะสิ้นสุดเมื่อชำระสำเร็จ วันทดลองที่เหลือจะไม่บวกเพิ่มในแพ็กเกจนี้</p>}
        </div>}
        {/* Per-tier menu sets make this list long in both directions, so what is gained is read the
            same way as what is lost, and only a package that really takes a menu away warns. */}
        {quote.featureImpact && (quote.featureImpact.removed.length > 0 || quote.featureImpact.added.length > 0 || quote.featureImpact.preservedAdmin > 0) && <section className={`space-y-2 rounded-xl border p-4 ${quote.featureImpact.removed.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`} aria-label={menusMoveLater ? 'การเปลี่ยนสิทธิ์เมนูเมื่อเริ่มแพ็กเกจรอบถัดไป' : 'การเปลี่ยนสิทธิ์เมนูหลังชำระ'}>
          <p className="font-semibold">{menusMoveLater ? `สิทธิ์เมนูตั้งแต่ ${menusMoveLater}` : 'สิทธิ์เมนูเมื่อชำระสำเร็จ'}</p>
          {quote.featureImpact.removed.length > 0 && <><p>{menusMoveLater ? `เมนูต่อไปนี้จะหยุดใช้ตั้งแต่ ${menusMoveLater} โดยข้อมูลเดิมยังเก็บไว้:` : 'เมนูต่อไปนี้จะหยุดใช้หลังชำระ โดยข้อมูลเดิมยังเก็บไว้:'}</p><ul className="list-disc space-y-1 break-words pl-6">{quote.featureImpact.removed.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
          {quote.featureImpact.added.length > 0 && <><p>{menusMoveLater ? `เมนูที่จะเปิดใช้เพิ่มตั้งแต่ ${menusMoveLater}:` : 'เมนูที่จะเปิดใช้เพิ่มหลังชำระ:'}</p><ul className="list-disc space-y-1 break-words pl-6">{quote.featureImpact.added.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
          {quote.featureImpact.preservedAdmin > 0 && <p>สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะบริษัทยังคงอยู่</p>}
        </section>}
        {quote.pendingPlanChange && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>รายการเปลี่ยนเป็น {quote.pendingPlanChange.offer.label} ({quote.pendingPlanChange.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}) จะมีผลจาก {date(quote.pendingPlanChange.oldEffectiveAt)} เป็น {date(quote.pendingPlanChange.newEffectiveAt)}</p><p>ยอดต่ออายุหลังวันนั้น {money(quote.pendingPlanChange.totalSatang)} · คงสาขา {quote.pendingPlanChange.capacity.retainedBranches.join(', ')} · คงผู้ใช้ {quote.pendingPlanChange.capacity.retainedMembers.join(', ')}</p><p>ซื้อสำเร็จจึงยืนยันวันเปลี่ยนใหม่ หากชำระไม่สำเร็จคำสั่งเดิมคงอยู่</p></div>}
        {quote.purchaseMode === 'PROMPTPAY_RENEW' ? <p>สแกน QR เพื่อจ่ายครั้งแรก จากนั้นระบบออกบิลใหม่ทุกงวด ต้องเปิดบิลและสแกน QR เอง ไม่มีการหักเงินอัตโนมัติ</p>
          : quote.purchaseMode === 'CARD_ONCE' || quote.purchaseMode === 'PROMPTPAY_ONCE' ? <p>จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป ต้องซื้อใหม่เมื่ออยากใช้ต่อ</p>
          : annualConversion ? <p className="text-sm text-gray-600">ชำระค่ารายปีเต็มจำนวนครั้งนี้ แล้วหยุดตัดเงินรายเดือน ไม่มีการตัดเงินต่ออายุก่อนวันหมดอายุใหม่ ปิดการต่ออายุอัตโนมัติได้โดยยังใช้เวลาที่ชำระไว้ได้ครบ</p>
          : <p>{quote.purchase?.kind === 'REPEAT' && `เลื่อนการตัดเงินครั้งถัดไปเป็น ${date(quote.purchase.projectedPaidThrough)} · `}ต่ออายุอัตโนมัติทุก{(quote.pendingPlanChange?.offer.interval ?? quote.offer.interval) === 'year' ? 'ปี' : 'เดือน'}ตามแพ็กเกจ ยกเลิกมีผลสิ้นรอบ</p>}        {quote.capacity && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>เมื่อเริ่มแพ็กเกจใหม่ คงสาขา: {quote.capacity.retainedBranches.join(', ')} · พักสาขา: {quote.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p>
          <p>คงผู้ใช้: {quote.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {quote.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p>
          {quote.capacity.defaults.map((item,index) => <p key={index}>สาขาเริ่มต้นของ {item.member}: {item.branch ?? 'เลือกเมื่อเข้าใช้งาน'}</p>)}<p>ข้อมูลและประวัติยังอยู่ครบ ระบบตรวจสิทธิ์อีกครั้งก่อนเปิดใช้งาน</p></div>}
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={accepted} onChange={event => setAccepted(event.target.checked)} />ฉันตรวจสอบข้อมูลและยืนยันเงื่อนไข{quote.purchaseMode === 'PROMPTPAY_RENEW' ? 'จ่ายบิลด้วย QR ทุกงวด' :
          quote.purchaseMode === 'CARD_ONCE' || quote.purchaseMode === 'PROMPTPAY_ONCE' ? 'จ่ายครั้งเดียว' : 'การชำระเงินและต่ออายุอัตโนมัติ'}</label>
        {/* A stale catalog does not stop a deal: its price is the approved snapshot's, not a row's. */}
        <div className="flex flex-wrap gap-3"><button className="mangmee-btn mangmee-btn-primary" disabled={busy || !emailReady || (catalogUnavailable && !dealQuote) || !accepted || Date.parse(quote.expiresAt) <= Date.now()} aria-busy={Boolean(busy)} onClick={() => action(async navigate => {
          const params = new URLSearchParams(window.location.search);
          const result = await api.checkout({ quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: params.get('channel') === 'line' ? 'line' : 'web' }, key.current);
          if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout'); else { setQuote(null); setChoosing(false); setReload(value => value + 1); }
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

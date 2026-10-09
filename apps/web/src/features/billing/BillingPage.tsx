'use client';
import Link from 'next/link';
import { billingProfileHref, billingProfileSelection } from './billing-profile-navigation';
import { useRouter } from 'next/navigation';
import { MangmeeBadge } from '@/common/components/mangmee';
import BillingCustomerFrame from './BillingCustomerFrame';
import { BillingEmailRecipientPanel } from './BillingEmailRecipientPanel';
import { errorStatus, errorText } from './billing-error-text';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { THAI_SYSTEM_ROLE_NAMES, BILLING_PAID_TIERS, DEFAULT_CHAT_CREDIT_SATANG, PLAN_TIER_PRESETS, planTermStateLabel, type PlanTierKey, type BillingCatalog, type BillingQuote, type BillingStatus, type BillingAttemptView, type BillingPurchaseMode, type BillingBenefitChoice } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { PLAN_LOCK_COPY, PLAN_TERM_CONTACT_EMAIL, PLAN_TERM_RENEW_PHONE, claimUnlockReload, planLockReason } from '@/features/plan-term/plan-term.logic';
import { notifyPlanTermChanged, type PlanLockReason } from '@/features/plan-term/plan-term.api';
import { useLockedShell } from '@/features/plan-term/LockedShellScope';
import { billingApi, type BillingHistory } from './billing.api';
import BillingCollectionPanel from './BillingCollectionPanel';
import BillingCapacityPicker from './BillingCapacityPicker';
import {BILLING_RECIPIENT_WAIT_TEXT, billingMonthlyAllowanceText, billingBackControl, billingControl, billingPrimaryControl, billingPurchaseModeLabel, billingRecipientLocked, billingSupportReference} from './billing-display';
import { billingDeal, billingQuoteDeal, dealAiCreditText, dealConfirmText, dealMenuLabels, dealRenewalText } from './billing-deal';
import { eventDiscountBlockedText, eventDiscountCard, eventDiscountCardText, eventDiscountChoiceLabel, eventDiscountChoices, eventDiscountFirstBillOnly, eventDiscountHeldNotice,
  eventDiscountMode, eventDiscountNextRoundText, eventDiscountOneTimeOnlyText, eventDiscountSerial, eventDiscountUsable } from './billing-event-discount';
import { PROMOTION_NOT_PICKED, promotionCard, promotionCardBenefit, promotionCardShowsPlainFacts, promotionChoiceCopy, promotionChoiceLabel, promotionInvoiceLine, promotionLostNotice, promotionOffered,
  promotionPageBenefit, promotionQuoteBenefit, promotionQuoteFields, promotionReasonText, promotionReceipts, promotionReview, promotionRow, promotionStatus, promotionSwitchLabel, promotionUpgradeNote,
  statusDeadlines, type PromotionLostNotice, type QuoteBenefit, type QuoteFields } from './billing-promotion';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

const money = (satang: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const button = billingControl;
const enterpriseMenuSummary = 'เพิ่มสิทธิ์ออก ภ.ง.ด.53 และพิมพ์หนังสือรับรอง 50 ทวิในระบบ';
/** Codes whose fix lives beside the document recipient, on the renewal tab (G16: routed by code, not by wording). */
const RECIPIENT_ERROR_CODES = ['BILLING_EMAIL_UPDATE_PENDING', 'BILLING_RECIPIENT_UPDATE_REQUIRED', 'BILLING_EMAIL_CHANGED', 'BILLING_RECIPIENT_BOUNCED'];
const RETURN_NOT_FOUND = 'ไม่พบรายการนี้ในร้านที่เลือก กรุณาดูประวัติหรือติดต่อทีมงาน';
function navigateProvider(url: string, kind: 'checkout' | 'portal' | 'document') {
  const parsed = new URL(url);
  const hosts = kind === 'checkout' ? ['checkout.stripe.com'] : kind === 'portal' ? ['billing.stripe.com'] : ['invoice.stripe.com', 'pay.stripe.com', 'payments.stripe.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !hosts.includes(parsed.hostname)) throw new Error('Unexpected provider URL');
  window.location.assign(parsed.href);
}

export default function BillingPage({ companyId, returning = false, returnAttemptId = null, collectionId, previewHref, preview, canOpenProfile = false }: { companyId: string; returning?: boolean; returnAttemptId?: string | null; collectionId?: string; previewHref?: string;
  preview?: { api: ReturnType<typeof billingApi>; navigate: typeof navigateProvider; openDocumentHistory: () => void; startWithPlans?: boolean; initialSection?: 'package' | 'payment' | 'history' };
  /** `/settings/profile` needs `company.setup.read` (route-permissions.ts); without it the profile links would open a refusal. */
  canOpenProfile?: boolean;
}) {
  const router = useRouter();
  const [previewCollectionId, setPreviewCollectionId] = useState<string>();
  const pendingPurchase = useRef<{ offer: string; interval: string; channel: string; purchaseMode: BillingPurchaseMode; dealId?: string; purchaseIntent?: 'FULL_PACKAGE' } | null>(null);
  const resumedProfile = useRef(false);
  const activeCollectionId = collectionId ?? previewCollectionId;
  const [cadenceNotice, setCadenceNotice] = useState<'upgrade' | 'pending' | false>(false);
  const api = useMemo(() => preview?.api ?? billingApi(companyId), [companyId, preview]);
  const [data, setData] = useState<{ status: BillingStatus; catalog: BillingCatalog; history: BillingHistory } | null>(null);
  // RV05/R-A9: the document recipient on file, if any. Empty is fine — Stripe Checkout asks for it.
  const recipientEmail = data?.status.recipient?.email ?? '';
  const [section, setSection] = useState<'package' | 'payment' | 'history'>(collectionId ? 'payment' : preview?.initialSection ?? 'package');
  useEffect(() => { if (collectionId) setSection('payment'); }, [collectionId]);
  const cadenceNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (cadenceNotice) { cadenceNoticeRef.current?.scrollIntoView({ block: 'start' }); cadenceNoticeRef.current?.focus({ preventScroll: true }); } }, [cadenceNotice]);
  const [choosing, setChoosing] = useState(preview?.startWithPlans ?? false);
  const [recipientOpen, setRecipientOpen] = useState(0);
  useEffect(() => {
    const selectHash = () => {
      if (window.location.hash === '#billing-history') setSection('history');
      if (window.location.hash === '#billing-recipient') { setSection('payment'); setRecipientOpen(value => value + 1); }
    };
    selectHash(); window.addEventListener('hashchange', selectHash);
    return () => window.removeEventListener('hashchange', selectHash);
  }, []);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState<string | null>(null), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [historyError, setHistoryError] = useState(''), [historyLoading, setHistoryLoading] = useState(false);
  // Item 6: a notice about a Checkout still being checked carries its own "อัปเดตข้อมูล" and goes away once
  // the status has no attempt left to check; a finished outcome ("ยุติ…แล้ว") stays until the next action.
  const [checkoutCancelNotice, setCheckoutCancelNotice] = useState<{ text: string; checking: boolean } | null>(null);
  const [confirmCheckoutCancel, setConfirmCheckoutCancel] = useState(false);
  const collectionChanged = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => {
    if (resumedProfile.current || !data) return;
    const params = new URLSearchParams(window.location.search), selection = billingProfileSelection(window.location.search);
    if (!selection || params.get('profile') !== 'updated') return;
    resumedProfile.current = true;
    setChoosing(true); setSection('package'); setInterval(selection.interval === 'year' ? 'year' : 'month');
    if (selection.purchaseMode) { setPurchaseMode(selection.purchaseMode); if (selection.dealId) setDealMode(selection.purchaseMode); }
    // F30: the detour's selection has done its job; a reload must not quote it again. The interval
    // was just chosen here, so the status's own interval must not replace it once the URL is clean.
    intervalInitialized.current = true;
    const url = new URL(window.location.href);
    for (const key of ['profile', 'offer', 'interval', 'purchaseMode', 'deal', 'purchaseIntent', 'returnTo']) url.searchParams.delete(key);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    void action(async () => { await requestQuote(selection.offer, selection.interval, recipientEmail, undefined, selection.purchaseMode, selection.dealId, selection.purchaseIntent); });
    // Resumes once, when the first status arrives; the recipient is read at that moment only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [purchaseMode, setPurchaseMode] = useState<BillingPurchaseMode>('CARD_AUTO');
  // The deal card carries its own choice: its modes are the deal's (S39), not the catalog's.
  const [dealMode, setDealMode] = useState<BillingPurchaseMode | null>(null);
  const [quote, setQuote] = useState<BillingQuote | null>(null), [accepted, setAccepted] = useState(false);
  // Promotion spec Q4 / sales-event spec §4.3: the ONE benefit this purchase takes, for this purchase only. null = the default, chosen for the
  // buyer: the promotion on a card that has one, else the held discount ("ใช้", as before), else a normal purchase.
  const [benefitPick, setBenefitPick] = useState<BillingBenefitChoice | null>(null);
  // Promotion spec §3: a promotion that stopped being available at quote or pay time. Shown until the buyer asks again on purpose.
  const [promotionLost, setPromotionLost] = useState<PromotionLostNotice | null>(null);
  // Owner 2026-09-29: which held discount this payment uses; null = the default, the best one for each card.
  const [eventSerial, setEventSerial] = useState<string | null>(null);
  // Spec §8.1: the holder's tickets when this shop is not starting a package (owner-only read; refused = no line).
  const [heldDiscount, setHeldDiscount] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.eventDiscount().then(view => { if (live) setHeldDiscount(eventDiscountHeldNotice(view)); }, () => { if (live) setHeldDiscount(null); });
    return () => { live = false; };
  }, [api, reload]);
  const [capacity, setCapacity] = useState<{ options: BillingCapacityOptions; billingEmail: string; scheduledAt?: string; repair?: { attemptId: string; attemptVersion: number }; key: string; initialSelection?: BillingCapacitySelection } | null>(null);
  const capacityDraft = useRef<(NonNullable<typeof capacity> & { collectionId?: string }) | null>(null);  const [capacityNotice, setCapacityNotice] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [returnAttempt, setReturnAttempt] = useState<BillingAttemptView | null>(null), [returnError, setReturnError] = useState('');
  const [refreshNotice, setRefreshNotice] = useState('');
  // Back from Stripe the browser may restore this page from its back-forward cache, frozen on the quote
  // that was just spent: read everything again and leave the chooser.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setChoosing(false); setQuote(null); setCapacity(null); setAccepted(false); setReload(value => value + 1);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  const emailSettings = useRef<HTMLDivElement>(null), quoteHeading = useRef<HTMLHeadingElement>(null), backNavigation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (quote || choosing) { backNavigation.current?.scrollIntoView({ block: 'start' }); quoteHeading.current?.focus({ preventScroll: true }); } }, [quote, choosing]);
  useEffect(() => { if (error && RECIPIENT_ERROR_CODES.includes(errorCode ?? '')) { setSection('payment'); emailSettings.current?.scrollIntoView({ block: 'start' }); } }, [error, errorCode]);
  // The renewal tab renders first; only then is there a recipient panel to scroll to.
  useEffect(() => { if (recipientOpen) emailSettings.current?.scrollIntoView({ block: 'start' }); }, [recipientOpen]);
  const openRecipientEditor = () => { setSection('payment'); setRecipientOpen(value => value + 1); };
  const key = useRef(''), running = useRef(false), intervalInitialized = useRef(false);
  const generation = useRef(0);
  const statusRead = useRef(0), statusCatalogRevision = useRef<string | null>(null);
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, [companyId]);
  const returnComplete = returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState === 'APPLIED';
  // G12: Stripe's cancel_url adds `checkout=canceled`. Read after mount, so the server render matches.
  const [checkoutCanceled, setCheckoutCanceled] = useState(false);
  useEffect(() => { setCheckoutCanceled(returning && new URLSearchParams(window.location.search).get('checkout') === 'canceled'); }, [returning]);
  const reopenChooser = useRef(false);
  useEffect(() => {
    if (data && !intervalInitialized.current) {
      if (!new URLSearchParams(window.location.search).has('interval') && data.status.interval) setInterval(data.status.interval);
      intervalInitialized.current = true;
    }
  }, [data]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('interval') === 'year') setInterval('year'); }, []);
  useEffect(() => {
    let active = true, historyDenied = false;
    let history: BillingHistory = { items: [], nextCursor: null };
    setError(''); setErrorCode(null);
    setHistoryError(''); setHistoryLoading(true);
    const read = ++statusRead.current;
    // History is independent: an unavailable or slow document service must not delay purchase.
    void api.history().then(value => {
      if (!active) return;
      history = value; setData(current => current && { ...current, history }); setHistoryLoading(false);
    }).catch(e => {
      if (!active) return;
      setHistoryLoading(false);
      if (errorStatus(e) === 401 || errorStatus(e) === 403) {
        historyDenied = true; setData(null); setError(errorText(e)); setErrorCode(apiErrorCode(e));
      } else setHistoryError(errorText(e));
    });
    Promise.all([api.status(), api.catalog()]).then(([status, catalog]) => {
      if (!active || historyDenied) return;
      setData(current => read === statusRead.current ? { status, catalog, history } : current && { ...current, catalog, history });
      if (read !== statusRead.current) return;
      if (!status.attemptId) setCheckoutCancelNotice(notice => notice?.checking ? null : notice);
      // F09/F10: after a one-tap cancel, the chooser opens only on a status that allows a new sale.
      if (reopenChooser.current && status.allowedActions.includes('new_sales') && !status.attemptId) { reopenChooser.current = false; setChoosing(true); setSection('package'); }
    }).catch(e => { if (active) { setData(null); setError(errorText(e)); setErrorCode(apiErrorCode(e)); } });
    if (returning) {
      if (!returnAttemptId) setReturnError('ลิงก์ไม่มีเลขรายการที่ถูกต้อง กรุณาดูสถานะและประวัติการชำระเงินของร้าน');
      else void api.attempt(returnAttemptId).then(value => { if (active) { setReturnAttempt(value); setReturnError(''); } })
        .catch(e => { if (active) { setReturnAttempt(null); setReturnError(errorStatus(e) === 404 ? RETURN_NOT_FOUND : errorText(e)); } });
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
      setQuote(null); setAccepted(false); setError('ราคา หรือสถานะขายเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่'); setErrorCode(null);
    }
  }, [data?.catalog, quote]);
  // G13/F12: the return page reads only the attempt — every 2 s for 30 s, then every 5 s, for 3 minutes —
  // pauses while the page is hidden, stops at APPLIED/HELD/FAILED, and asks Stripe at most every 30 s.
  // It also stops for a paid advance deal (it applies on its start date, not now), and never starts on
  // a canceled return unless the old Checkout turned out paid. A failed read retries; only 403/404 end
  // it. The 3 minutes are judged after a read, so a tab hidden longer still looks once before giving up.
  const pendingDeal = !!data?.status.pendingDeal;
  useEffect(() => {
    if (!returning || !returnAttemptId || returnError || pendingDeal) return;
    if (checkoutCanceled && returnAttempt?.paymentState !== 'PAID') return;
    if (returnComplete || returnAttempt?.paymentState === 'FAILED' || ['HELD', 'FAILED'].includes(returnAttempt?.applyState ?? '')) return;
    let active = true, inFlight = false, timer = 0, lastRefresh = 0, lastPayment: string | null = returnAttempt?.paymentState ?? null;
    const startedAt = Date.now();
    setTimedOut(false);
    const schedule = () => {
      window.clearTimeout(timer);
      if (active && document.visibilityState === 'visible') timer = window.setTimeout(() => void tick(), Date.now() - startedAt < 30_000 ? 2_000 : 5_000);
    };
    const tick = async () => {
      if (!active || inFlight) return;
      if (Date.now() - lastRefresh >= 30_000) { lastRefresh = Date.now(); void api.refresh().catch(() => {}); }
      inFlight = true;
      try {
        const value = await api.attempt(returnAttemptId);
        if (!active) return;
        setReturnAttempt(value); setReturnError('');
        // Status and history are re-read only when the answer moved (recipient, heading, documents).
        if (value.paymentState !== lastPayment || value.applyState === 'APPLIED') { lastPayment = value.paymentState; setReload(current => current + 1); }
      } catch (e) {
        const code = errorStatus(e);
        if (code === 403 || code === 404) { if (active) setReturnError(code === 404 ? RETURN_NOT_FOUND : errorText(e)); return; }
      } finally { inFlight = false; }
      if (!active) return;
      if (Date.now() - startedAt >= 180_000) { setTimedOut(true); return; }
      schedule();
    };
    const visible = () => { window.clearTimeout(timer); if (document.visibilityState === 'visible') void tick(); };
    void tick();
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [api, returning, returnAttemptId, returnComplete, returnError, returnAttempt?.paymentState, returnAttempt?.applyState, checkoutCanceled, pendingDeal]);
  async function action(work: (navigate: typeof navigateProvider) => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setErrorCode(null);
    const current = generation.current;
    try { await work((url, kind) => { if (current === generation.current) (preview?.navigate ?? navigateProvider)(url, kind); }); }
    catch (e) { if (current === generation.current) {
      if ([401, 403].includes(errorStatus(e) ?? 0)) setData(null);
      // Promotion spec §3: a promotion that cannot be used any more is never swapped for a normal purchase here — say why, drop the old quote, and let the buyer ask again.
      const lost = promotionLostNotice(e);
      if (lost) { setPromotionLost(lost); setQuote(null); setAccepted(false); if (!lost.canRecheck) setChoosing(false); setReload(value => value + 1); }
      else { setError(errorText(e)); setErrorCode(apiErrorCode(e)); }
    } }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }
  async function requestQuote(offerKey: string, selectedInterval: string, billingEmail: string, selection?: BillingCapacitySelection, requestedMode?: BillingPurchaseMode, dealId?: string, purchaseIntent?: 'FULL_PACKAGE', benefit?: QuoteBenefit) {
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
      const read = ++statusRead.current, latest = await api.status();
      if (read === statusRead.current) setData(value => value && { ...value, status: latest });
      const modes = dealId ? latest.deal?.purchaseModes : latest.availablePurchaseModes;
      if ((!dealId && !latest.allowedActions.includes('new_sales')) || (modes && !modes.includes(mode)))
        throw { code: latest.purchaseBlockCode ?? 'BILLING_MODE_NOT_READY' };
      // SD-O12/SD-O13: every one-time package payment carries the choice, and the first bill of a package started in a renewing mode.
      // Promotion spec Q4: the ONE benefit is decided from the rows the buyer SAW (`paid.promotions`), so a promotion that went away
      // since is refused by the API (PROMOTION_UNAVAILABLE) and never quietly replaced by a normal purchase.
      const ticket = !dealId && eventDiscountMode(mode, latest.purchaseSource) && eventDiscountUsable(latest.eventDiscount);
      const cardOffer = data?.catalog.offers.find(item => item.offerKey === offerKey && item.interval === selectedInterval), serial = ticket ? eventDiscountSerial(latest.eventDiscount, eventSerial) : null;
      const fields: QuoteFields = dealId ? {} : promotionQuoteFields({ pick: benefitPick, explicit: benefit, promotions: paid?.promotions, card: { offerKey, interval: selectedInterval },
        ticket, ticketOnCard: ticket && !!cardOffer && !!eventDiscountCard(latest.eventDiscount, cardOffer, serial), serial: serial ?? undefined });
      const result = await api.quote(offerKey, selectedInterval, billingEmail, selection, mode, dealId, purchaseIntent, fields.eventDiscountChoice, fields.eventDiscountTicketSerial, fields.benefitChoice, fields.promotionCampaignId);
      if (!selection) capacityDraft.current = null;
      key.current = crypto.randomUUID(); setAccepted(false); setQuote(result); setCapacity(null); setPromotionLost(null);
    } catch (error) {
      if (apiErrorCode(error) !== 'BILLING_CAP_SELECTION_REQUIRED' || selection || dealId) throw error;
      setQuote(null); setCapacity({ options: await api.capacity(offerKey, selectedInterval), billingEmail, key: crypto.randomUUID(), initialSelection: capacityDraft.current?.initialSelection });    }
  }
  const annualConversion = quote?.purchase?.kind === 'REPEAT' && quote.purchase.previousInterval === 'month' && quote.offer.interval === 'year';
  // Promotion spec §3: the quote's promotion terms (paid period, free time, receipts, next round), or null for a quote without one.
  const promoReview = promotionReview(quote, money);
  // Phase 7: a package bought for the NEXT round moves the menus on the day it starts, not today.
  const menusMoveLater = quote?.advanceDeal ? date(quote.advanceDeal.startsAt)
    : quote?.purchase?.kind === 'SCHEDULED_CHANGE' ? date(quote.purchase.previousPaidThrough) : null;
  const status = data?.status;
  useEffect(() => {
    if (!status || preview) return;
    let active = true, loading = false, refreshAgain = false, deadlineTimer: number | undefined, retryTimer: number | undefined;
    const refresh = async () => {
      if (running.current) return false;
      if (loading) { refreshAgain = true; return false; }
      loading = true;
      const scope = generation.current;
      let read = statusRead.current;
      try {
        let latest: BillingStatus;
        // A focus/visibility event during the read must not lose a newer completed operation/gate change.
        do { refreshAgain = false; read = ++statusRead.current; latest = await api.status(); } while (active && refreshAgain);
        if (scope === generation.current && read === statusRead.current) setData(current => current && { ...current, status: latest });
        return true;
      } catch (e) {
        if (scope === generation.current && read === statusRead.current && (errorStatus(e) === 401 || errorStatus(e) === 403)) { setData(null); setError(errorText(e)); setErrorCode(apiErrorCode(e)); }
        return errorStatus(e) === 401 || errorStatus(e) === 403;
      } finally { loading = false; }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh().then(ok => {
      if (!ok && active) { window.clearTimeout(retryTimer); retryTimer = window.setTimeout(onVisible, 5000); }
    }); };
    // The term deadlines and the end of each promotion on offer: a campaign that ends by the clock stops being offered without a click.
    const deadlines = statusDeadlines(status);
    const atDeadline = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!await refresh() && active) deadlineTimer = window.setTimeout(atDeadline, 5000);
    };
    if (deadlines.length) deadlineTimer = window.setTimeout(atDeadline, Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now() + 150)));
    const revision = data?.catalog.catalogRevision ?? null, changed = statusCatalogRevision.current !== null && revision !== statusCatalogRevision.current;
    statusCatalogRevision.current = revision;
    if (changed) onVisible();
    window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearTimeout(deadlineTimer); window.clearTimeout(retryTimer); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [api, status, preview, data?.catalog.catalogRevision]);
  // The picked discount while this page still offers it; a ticket used or gone since falls back to the default.
  const chosenEventSerial = eventDiscountSerial(status?.eventDiscount, eventSerial);
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
  // Promotion spec Q4: what this page offers as the ONE benefit of a purchase, and which radio the buyer's pick (or the default) turns on.
  const ticketView = status && eventDiscountMode(chosenMode, status.purchaseSource) && eventDiscountUsable(status.eventDiscount) ? status.eventDiscount : undefined;
  const offered = promotionOffered(status?.promotions, interval, !!ticketView);
  const pageBenefit = promotionPageBenefit(benefitPick, offered);
  const choiceCopy = promotionChoiceCopy({ promotion: offered.PROMOTION, ticket: !!ticketView, firstBillOnly: eventDiscountFirstBillOnly(chosenMode) });
  const promotionChoice = promotionChoiceLabel(status?.promotions, data?.catalog.offers ?? [], interval);
  const deal = billingDeal(status);
  const dealModes = deal?.purchaseModes ?? [];
  const chosenDealMode = dealMode && dealModes.includes(dealMode) ? dealMode : dealModes[0];
  const dealQuote = billingQuoteDeal(quote);
  // D-P5-1: the quote's own ride-along carries no cadence, and the offer being confirmed is the one
  // still on the status — so the auto-renew wording comes from there, matched by id.
  const autoDeal = dealQuote && deal?.dealId === dealQuote.dealId && deal.autoRenew ? deal : null;
  // The attempt says what this Checkout paid for, so the return page names the offer by itself.
  const dealReturn = returning && billingQuoteDeal(returnAttempt);
  const quotaReset = status?.usage.cadence === 'LEGACY_MONTH' && status.usage.resetsAt && status.termEndsAt &&
    Date.parse(status.usage.resetsAt) < Date.parse(status.termEndsAt) ? status.usage.resetsAt : null;
  const quotaExpiry = status?.usage.expiresAt ?? status?.termEndsAt;
  // F34: the return page trusts its own attempt; the status can lag the apply by a poll.
  const confirmed = returning ? returnComplete : status?.accessState === 'ACTIVE' && status.paymentState === 'PAID' && status.applyState === 'APPLIED';
  const lockedShell = useLockedShell();
  // RV30: the moment a purchase confirms inside the locked shell, tell WorkspaceLayoutClient so it
  // re-reads the notice and switches shells in place, instead of waiting on the next focus/reload.
  // If the shell is still locked 5 s later (no listener, or the notice not yet ACTIVE), reload — once
  // per attempt across page loads (`claimUnlockReload`), so a notice that keeps lagging cannot loop;
  // the shell switch unmounts this page first and clears the timer.
  const unlockAttempt = returnAttemptId ?? status?.attemptId ?? status?.reference ?? null;
  useEffect(() => {
    if (!confirmed || !lockedShell) return;
    notifyPlanTermChanged();
    const timer = window.setTimeout(() => {
      if (unlockAttempt && claimUnlockReload(() => window.sessionStorage, unlockAttempt)) window.location.reload();
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [confirmed, lockedShell, unlockAttempt]);
  // G10/F16: the quote's own clock (10 minutes), said out loud instead of a button that silently greys out.
  const [quoteExpired, setQuoteExpired] = useState(false);
  useEffect(() => {
    setQuoteExpired(false);
    if (!quote) return;
    const remaining = Date.parse(quote.expiresAt) - Date.now();
    if (remaining <= 0) { setQuoteExpired(true); return; }
    const timer = window.setTimeout(() => setQuoteExpired(true), Math.min(2_147_483_647, remaining));
    return () => window.clearTimeout(timer);
  }, [quote?.quoteId, quote?.expiresAt]);
  const requoteSame = () => action(async () => {
    if (!quote) return;
    await requestQuote(quote.offer.offerKey, quote.offer.interval, recipientEmail, capacityDraft.current?.initialSelection, quote.purchaseMode, dealQuote?.dealId,
      quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? 'FULL_PACKAGE' : undefined, promotionQuoteBenefit(quote));
  });
  // Promotion spec §3: "ตรวจสอบรายการใหม่" asks again for the purchase that just lost its promotion. What is quoted is what the chooser now
  // shows picked, and the buyer still reads the review and confirms before any payment step.
  const recheckPromotion = () => action(async () => {
    const last = pendingPurchase.current;
    if (last) await requestQuote(last.offer, last.interval, recipientEmail, capacityDraft.current?.initialSelection, last.purchaseMode, last.dealId, last.purchaseIntent);
  });
  // R-A5: Checkout refuses a quote whose document recipient changed since it was priced
  // (assertRecipientUnchanged: a recipient on file that differs from the one the quote pinned), so a
  // change made from the confirm box's "แก้อีเมลรับเอกสาร" quotes the same choice again.
  const staleRecipient = !!quote && !!status?.recipient?.email && status.recipient.email !== quote.billingEmail;
  // Fires once per change; a failed re-quote shows its error rather than retrying on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (staleRecipient) void requoteSame(); }, [staleRecipient]);
  // G24: card auto-renew first; the other ways to pay fold under "วิธีชำระอื่น", open whenever the
  // chosen mode is one of them (or the card is not offered at all).
  const otherModesId = useId();
  const [otherModesOpen, setOtherModesOpen] = useState(false);
  const otherModes = displayedModes.filter(mode => mode !== 'CARD_AUTO');
  const otherModesExpanded = otherModesOpen || !displayedModes.includes('CARD_AUTO') || chosenMode !== 'CARD_AUTO';
  const modeRadio = (mode: BillingPurchaseMode) => <label key={mode} className="flex min-h-11 items-center gap-3"><input type="radio" name="purchaseMode" checked={chosenMode === mode}
    onChange={() => { setPurchaseMode(mode); setQuote(null); setCapacity(null); }} />{billingPurchaseModeLabel(mode)}</label>;
  const latestInvoice = data?.history.items[0] ?? null;
  // S04/R10: a shop with nothing to run on was described by three fallbacks that added up to an
  // unlimited plan — "ยังไม่มีข้อมูลแพ็กเกจ · ใช้งานได้ถึง ยังไม่ระบุ · ใบเสร็จคงเหลือ ไม่จำกัด" — to a shop
  // that cannot open one screen.
  const lockReason: PlanLockReason = planLockReason(status);
  // An active shop keeps its real numbers, whatever it was sold; a held one with a term still has a
  // package under review to describe. Only a locked shop, and a shop with no term at all, has none.
  const noPackage = !!status && status.accessState !== 'ACTIVE' && (status.accessState === 'EXPIRED' || !status.termEndsAt);
  const packageHeading = status?.accessState === 'EXPIRED' ? PLAN_LOCK_COPY[lockReason].title
    : noPackage ? PLAN_LOCK_COPY.no_package.title : 'แพ็กเกจปัจจุบัน';
  const returnFailed = returning && returnAttempt?.paymentState === 'FAILED';
  // Stripe sent the customer back after paying, and the API keeps the attempt OPEN until the reconciler
  // applies it (the drain runs about every 10 s). While that answer is pending, nothing here may offer to
  // end, resume or redo the payment — only after the 3-minute wait gives up do those come back.
  const awaitingStripe = returning && !checkoutCanceled && !returnError && !timedOut && (!returnAttempt || returnAttempt.paymentState === 'PENDING');
  // Promotion spec §7: the right this shop holds. On the return page the attempt's own right wins; a renewal still being set up
  // brings the same "check again" control as any other unfinished payment (`checking`), and never an invitation to pay again.
  // A right already opened is told only while the package runs (on the return page, once the attempt itself is applied); an ended or lapsed package is not "using" it.
  const promotionBlock = promotionStatus((returning ? returnAttempt?.promotion : undefined) ?? status?.promotion, status?.accessState === 'ACTIVE' || (returning && returnComplete));
  const hasPaymentToCheck = status && (!confirmed || ['past_due', 'unpaid'].includes(status.subscriptionState) || promotionBlock?.checking) && (status.paymentState !== 'NONE' || status.attemptId || returnAttemptId || status.subscriptionState !== 'NONE');
  const canEndCheckout = !awaitingStripe && Boolean(status?.canCancelCheckout && status.attemptId);
  const canResumePayment = canEndCheckout && ['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'].includes(status!.paymentState);
  // F09/F10: an unpaid Checkout is ended and replaced in one tap; the two-step confirm stays for
  // attempts whose outcome is unknown or needs action.
  const oneTapCancel = canEndCheckout && status!.paymentState === 'PENDING';
  // Paid, then held for the team (not a capacity choice, not a deal waiting for its start date).
  const applyHeld = !!status && !status.capacityRepair && !status.pendingDeal && (returning ? returnAttempt?.applyState : status.applyState) === 'HELD';
  const supportReference = billingSupportReference(returning ? returnAttemptId : status?.reference);
  // Item 17: a no-package box saying "เลือกแพ็กเกจ…" with no button under it, and no other line saying
  // why, was a dead end (sales closed, collection paused, policy not ready).
  const canBuy = !!status?.allowedActions.includes('new_sales');
  const saleClosedUnexplained = !!status && !status.purchaseBlockCode && !canBuy && !status.attemptId && !status.refundReviewPending
    && status.purchaseEligibility === 'ELIGIBLE' && status.accessState !== 'HELD';
  const purchaseHint = canBuy || oneTapCancel ? lockReason === 'no_package' ? 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน' : 'เลือกแพ็กเกจเพื่อใช้งานต่อ'
    : saleClosedUnexplained ? 'ยังเปิดรับชำระไม่ได้ชั่วคราว กรุณาลองใหม่ภายหลัง' : null;
  const recipientLocked = !!status && billingRecipientLocked(status);
  const purchasing = (choosing && canBuy) || !!quote || !!capacity;
  const showOverview = section === 'package' && !purchasing;
  // R-A7: a document bounced — said on the overview and above the recipient panel.
  const bounceBanner = status?.recipient?.bouncedAt ? <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <p className="font-semibold">อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่</p>
    <p className="break-all text-sm">ระบบส่งเอกสารไปที่ {status.recipient.email} ไม่สำเร็จ กรุณาแก้อีเมลรับเอกสาร แล้วกดส่งเอกสารอีกครั้ง</p>
    <button className={button} onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>
  </div> : null;
  return <BillingCustomerFrame title="แพ็กเกจและการชำระเงิน" description="ดูแพ็กเกจ จัดการการต่ออายุ และเปิดเอกสารชำระเงิน"
    actions={previewHref && <Link className="mangmee-btn mangmee-btn-secondary" href={previewHref}>พรีวิวขั้นตอน (local)</Link>}
    backHref={status?.accessState === 'ACTIVE' ? `/companies/${encodeURIComponent(companyId)}/dashboard` : lockedShell ? `/companies/${encodeURIComponent(companyId)}/settings` : '/billing/companies'}
    backLabel={status?.accessState === 'ACTIVE' ? 'กลับแดชบอร์ด' : lockedShell ? 'กลับหน้าตั้งค่า' : 'กลับหน้าเลือกบริษัท'}>
    {error && <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="break-words">{error}<button className={`${button} ml-3`} disabled={busy} onClick={() => setReload(value => value + 1)}>ลองใหม่</button></p>
      {/* The error text itself asks people to contact the team "with the reference" — so show it here
          instead of leaving that instruction with nothing on screen to read out. */}
      {error.includes('ติดต่อทีมงานพร้อมเลขอ้างอิง') && supportReference &&
        <p className="break-all text-sm">เลขอ้างอิงสำหรับแจ้งทีมงาน: {supportReference}</p>}
    </div>}
    {checkoutCancelNotice && <div role="status" className="space-y-2 rounded-xl bg-gray-50 p-3"><p>{checkoutCancelNotice.text}</p>
      {checkoutCancelNotice.checking && <button className={button} disabled={busy} onClick={() => setReload(value => value + 1)}>อัปเดตข้อมูล</button>}</div>}
    {!data && !error && <p role="status">กำลังตรวจสอบสิทธิ์และรายการชำระเงิน…</p>}
    {data && status && <>
      {status.purchaseBlockCode && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p>{errorText({ code: status.purchaseBlockCode })}</p>
        {supportReference && <p className="break-all text-sm">เลขอ้างอิงสำหรับแจ้งทีมงาน: {supportReference}</p>}
        {status.purchaseBlockCode === 'BILLING_EMAIL_UPDATE_PENDING'
          ? <button className={button} onClick={() => { setChoosing(false); openRecipientEditor(); }}>จัดการผู้รับเอกสาร</button>
          : <button className={button} disabled={busy} onClick={() => { setChoosing(false); setSection('payment'); setReload(value => value + 1); }}>ตรวจสถานะล่าสุด</button>}
      </div>}
      {status.mode === 'TEST' && !preview && <div><MangmeeBadge tone="amber">โหมดทดสอบ · ไม่มีการรับเงินจริง</MangmeeBadge></div>}
      {returnError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">{returnError}</p>}
      {promotionLost && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-semibold">{promotionLost.title}</p>
        <p className="break-words">{promotionLost.text}</p>
        <p className="text-sm leading-7">{promotionLost.hint}</p>
        <div className="flex flex-wrap gap-3">
          {promotionLost.canRecheck && <button className={billingPrimaryControl} disabled={busy} aria-busy={busy} onClick={() => recheckPromotion()}>ตรวจสอบรายการใหม่</button>}
          <button className={button} onClick={() => setPromotionLost(null)}>ปิดข้อความนี้</button>
        </div>
      </div>}
      <nav aria-label="หมวดแพ็กเกจและการชำระเงิน" className="flex border-b border-gray-200">
        {([['package', 'แพ็กเกจ'], ['payment', 'การต่ออายุและชำระเงิน'], ['history', 'ประวัติ']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} disabled={busy}
          onClick={() => setSection(value)} className={`min-h-12 flex-1 border-b-2 px-2 py-3 text-sm font-semibold sm:flex-none sm:px-5 sm:text-base ${section === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-brand-700'}`}>{label}</button>)}
      </nav>
      {showOverview && <>
      {heldDiscount && <p role="note" className="break-words rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm leading-7">{heldDiscount}</p>}
      {status.allowedActions.includes('new_sales') && !!status.billingProfile?.missingFields.length && <p role="note" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7 text-gray-700">
        เอกสารจะออกในชื่อ <strong className="break-words">{status.billingProfile.name || status.companyName}</strong> · ที่อยู่กรอกได้ที่หน้าชำระเงิน{canOpenProfile && <> หรือ <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={`/companies/${encodeURIComponent(companyId)}/settings/profile#shop`}>เติมล่วงหน้าที่ข้อมูลร้าน</Link></>}
      </p>}
      {bounceBanner}
      <section aria-label="สถานะแพ็กเกจ" className="mangmee-card space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{returnFailed ? 'รายการชำระเงินนี้ไม่สำเร็จ' : status.pendingDeal ? status.pendingDeal.state === 'HELD' ? 'ชำระแล้ว ต้องตรวจสอบก่อนเริ่มดีล' : status.pendingDeal.state === 'PAID' ? 'ชำระดีลแล้ว รอเริ่มสิทธิ์' : 'ชำระแล้ว กำลังยืนยันการต่ออายุ' : confirmed ? returning ? dealReturn ? 'ใช้งานข้อเสนอพิเศษแล้ว' : 'ชำระแล้ว เปิดใช้งานแล้ว' : 'แพ็กเกจปัจจุบัน' : (returning ? returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState !== 'APPLIED' : status.paymentState === 'PAID' && status.applyState !== 'APPLIED') ? 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์' : status.paymentState === 'FAILED' ? 'เรียกเก็บเงินไม่สำเร็จ' : checkoutCanceled && returnAttempt?.paymentState !== 'PAID' && !confirmed ? 'ยังไม่ได้ชำระ' : status.attemptId ? 'กำลังตรวจสอบรายการชำระเงิน' : packageHeading}</h2>
          <MangmeeBadge tone={status.accessState === 'ACTIVE' ? 'brand' : 'amber'}>{status.accessState === 'HELD' ? 'ถูกพักใช้งานโดยผู้ดูแล' : planTermStateLabel(status.accessState === 'ACTIVE' ? 'ACTIVE' : lockReason === 'no_package' ? 'NO_PACKAGE' : 'EXPIRED')}</MangmeeBadge>
        </div>
        {noPackage && awaitingStripe ? <div className="space-y-1 rounded-xl bg-gray-50 p-4">
          <p className="text-lg font-bold text-gray-900">กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน</p>
          <p className="text-sm text-gray-600">ระบบตรวจผลให้อัตโนมัติ ไม่ต้องชำระซ้ำ</p>
        </div> : noPackage ? <dl className="grid gap-5 rounded-xl bg-gray-50 p-4">
          {/* R2/R10: the same title PLAN_LOCK_COPY gives the heading above, on an expired shop — never
              a second, hardcoded "ยังไม่มีแพ็กเกจ" that would say something else under "แพ็กเกจหมดอายุแล้ว". */}
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{PLAN_LOCK_COPY[lockReason].title}</dd>
            {purchaseHint && <p className="mt-1 text-sm text-gray-600">{purchaseHint}</p>}
            {/* Only when a term really ran out: a shop that never had one starts and ends today. */}
            {lockReason === 'trial_ended' && status.termEndsAt && <p className="mt-1 text-sm text-gray-500">หมดอายุเมื่อ {date(status.termEndsAt)}</p>}</div>
        </dl> : <dl className="grid gap-5 rounded-xl bg-gray-50 p-4 sm:grid-cols-3">
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.tierKey && status.tierKey in PLAN_TIER_PRESETS ? PLAN_TIER_PRESETS[status.tierKey as PlanTierKey].labelTh : status.tierKey ? 'ต้องตรวจสอบข้อมูล' : 'ยังไม่มีข้อมูลแพ็กเกจ'}</dd></div>
          <div><dt className="text-sm text-gray-500">{status.pendingPlanChange?.action === 'PREPAID_PLAN_CHANGE' ? 'แพ็กเกจปัจจุบันใช้ถึง' : 'ใช้งานได้ถึง'}</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.pendingPlanChange?.action === 'PREPAID_PLAN_CHANGE' ? date(status.pendingPlanChange.effectiveAt) : status.termEndsAt ? date(status.termEndsAt) : 'ยังไม่ระบุ'}</dd></div>
          <div><dt className="text-sm text-gray-500">ใบเสร็จคงเหลือ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{status.purchaseSource === 'NO_TERM' && status.usage.remaining === null ? 'ยังไม่ได้กำหนดโควตาแพ็กเกจ' : status.usage.remaining ?? 'ไม่จำกัด'} {status.usage.remaining !== null && 'ใบ'}</dd>{(quotaReset || (quotaExpiry && date(quotaExpiry) !== date(status.termEndsAt))) && <p className="mt-1 text-sm text-gray-500">{quotaReset ? `เริ่มรอบใหม่ ${date(quotaReset)}` : `ใบที่หมดอายุก่อนใช้ได้ถึง ${date(quotaExpiry)}`}</p>}</div>
        </dl>}
        {returning && returnAttempt?.eventDiscount && <p role="status" className="rounded-xl bg-brand-50 p-3">{returnAttempt.eventDiscount.state === 'USED' ? 'ใช้ส่วนลดจากงานแล้ว' : 'ส่วนลดจะถูกใช้เมื่อยืนยันการชำระ'} · −{money(returnAttempt.eventDiscount.shownDiscountSatang)}</p>}
        {/* R-A8/F04: who gets the documents is said from PAID; changing it opens once the payment applied.
            The recipient is written at apply, so until then Checkout's own address stands in. */}
        {returning && returnAttempt?.paymentState === 'PAID' && <div className="space-y-2 rounded-xl bg-gray-50 p-4" aria-label="อีเมลรับเอกสาร">
          <p className="break-all">ส่งเอกสารไปที่ <strong>{status.recipient?.email || 'อีเมลที่กรอกไว้ที่หน้าชำระเงิน'}</strong></p>
          <button className={button} disabled={recipientLocked} onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>
          {recipientLocked && <p className="text-sm text-gray-600">{BILLING_RECIPIENT_WAIT_TEXT}</p>}
        </div>}
        {status.effectiveCapacity?.temporary&&<section className="space-y-2 rounded-xl border border-emerald-300 p-3" aria-label="สิทธิ์แพ็กเกจชั่วคราว"><p>ผู้ดูแลให้สิทธิ์ {PLAN_TIER_PRESETS[status.effectiveCapacity.tierKey].labelTh} ชั่วคราว</p><p>{status.effectiveCapacity.branchLimit} สาขา · {status.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {date(status.effectiveCapacity.temporary.expiresAt)}</p><p>เมื่อครบกำหนดจะใช้แพ็กเกจที่ซื้ออยู่ล่าสุด การซื้อเพิ่มด้านล่างคิดจากแพ็กเกจที่ชำระเงิน</p></section>}

        {status.usage.monthlyAllowance&&<p>{billingMonthlyAllowanceText(status.usage)}</p>}
        {!status.pendingDeal && (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && status.paidThrough && <p className="text-sm text-gray-600">จ่ายครั้งเดียว ใช้ได้ถึง {date(status.paidThrough)} · ไม่มีการตัดเงินงวดถัดไป ซื้อใหม่เมื่ออยากใช้ต่อ</p>}
        {promotionBlock && <section role="status" aria-label="สถานะโปรโมชั่น" className="space-y-1 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">{promotionBlock.title}</p>
          {promotionBlock.lines.map(line => <p key={line} className="break-words text-sm leading-7">{line}</p>)}
        </section>}
        {status.pendingDeal && <section role="status" aria-label="สถานะดีลล่วงหน้า" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">{status.pendingDeal.state === 'HELD' ? 'ชำระแล้ว รายการนี้ต้องให้ทีมงานตรวจสอบก่อนเริ่มดีล' : status.pendingDeal.state === 'PAID' ? 'ชำระดีลแล้ว รอเริ่มสิทธิ์' : 'ชำระดีลแล้ว กำลังยืนยันการต่ออายุ'}</p>
          <p>สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง {date(status.pendingDeal.startsAt)} แล้วจึงเริ่มสิทธิ์ดีล</p>
          <p>งวดแรกสิ้นสุด {date(status.pendingDeal.firstCycleEndsAt)} · {status.pendingDeal.purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'ตัดบัตรรอบถัดไป'} วันที่ {date(status.pendingDeal.nextChargeAt)}</p>
        </section>}
        {status.renewalMode === 'PROMPTPAY_RENEW' && status.attemptId && status.applyState === 'APPLIED' && <p role="status" className="rounded-xl bg-amber-50 p-3">ชำระงวดแรกสำเร็จแล้ว กำลังยืนยันการตั้งบิล QR รอบถัดไป กรุณาตรวจสถานะอีกครั้ง</p>}
        {status.cancelAtPeriodEnd ? <p className="text-sm text-gray-600">หยุดต่ออายุแล้ว ใช้งานได้ถึงวันที่ระบุข้างต้น</p> : status.nextChargeAt && !status.collectionPause && <p className="text-sm text-gray-600">{status.renewalMode === 'PROMPTPAY_RENEW' ? 'ระบบจะออกบิล QR วันที่ ' : 'ต่ออายุอัตโนมัติวันที่ '}{date(status.nextChargeAt)}</p>}
        {status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <div className="space-y-2 rounded-xl border border-brand-200 p-4"><p>บิลต่ออายุรอชำระ{status.renewalInvoiceDueAt ? ` · ครบกำหนด ${date(status.renewalInvoiceDueAt)}` : ''}</p><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate(status.renewalInvoiceUrl!, 'document'))}>เปิดบิลและสแกน QR</button></div>}
        {status.graceEndsAt && <p>ระยะผ่อนผันถึง {date(status.graceEndsAt)} · ใช้ยอดใบเสร็จเดิมที่เหลือได้ ไม่มีการเติมโควตาจนกว่าจะชำระสำเร็จ</p>}
        {status.purchaseEligibility === 'COMPANY_SALES_CLOSED' && <p role="status" className="text-sm leading-7 text-gray-600">ร้านนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ กรุณาติดต่อทีมงาน</p>}
        {status.purchaseEligibility === 'SOURCE_REVIEW_REQUIRED' && <p role="status" className="text-sm leading-7 text-gray-600">ข้อมูลการชำระเงินเดิมของร้านนี้ยังไม่ตรงกัน กรุณาติดต่อทีมงานก่อนเริ่มรายการใหม่</p>}
        {status.purchaseEligibility === 'ENTITLEMENT_REVIEW_REQUIRED' && <p role="status" className="text-sm leading-7 text-gray-600">ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมงานก่อนชำระเงิน</p>}
        {status.refundReviewPending && <p role="status" className="rounded-xl bg-amber-50 p-3">กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ คำขอนี้ไม่เปลี่ยนสิทธิ์แพ็กเกจเดิม คุณตรวจรายการเดิมด้านล่าง หรือ <a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมมั่งมี</a> ได้</p>}
        {status.accessState === 'HELD' && <p>ร้านนี้ถูกพักใช้งานโดยผู้ดูแล กรุณาติดต่อทีมงาน ข้อมูลยังอยู่ครบ</p>}
        {/* Paid but held: the team reviews before the rights open, and the reference is in plain sight. */}
        {applyHeld && <p role="status" className="break-all rounded-xl bg-amber-50 p-3">ทีมงานกำลังตรวจสอบก่อนเปิดสิทธิ์{supportReference && ` · เลขอ้างอิง ${supportReference}`}</p>}
        {supportReference && !confirmed && !applyHeld && <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงสำหรับแจ้งทีมงาน</summary><p className="break-all">{supportReference}</p></details>}
        {/* A shop that never had a package has no "เดิม" to keep. */}
        {returnFailed && <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">รายการนี้ไม่ได้ชำระสำเร็จหรือรายการหมดอายุ {noPackage && lockReason === 'no_package' ? 'ไม่มีการเรียกเก็บเงินจากรายการนี้' : 'สิทธิ์แพ็กเกจเดิมยังคงเดิม'}</p>}
        {/* A paid advance deal applies on its start date: it is never told to contact the team. */}
        {returning && !confirmed && timedOut && !status.pendingDeal && <p role="status">ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง</p>}
        {oneTapCancel && <button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => action(async () => {
          const result = await api.cancelCheckout(status.attemptId!);
          if (result.state === 'EXPIRED') { reopenChooser.current = true; setCheckoutCancelNotice({ text: 'ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย', checking: false }); }
          else if (result.state === 'COMPLETED') setCheckoutCancelNotice({ text: 'รายการเดิมชำระสำเร็จแล้ว ระบบกำลังเปิดสิทธิ์ให้ ไม่ต้องซื้อใหม่', checking: true });
          else setCheckoutCancelNotice({ text: 'กำลังตรวจผลรายการเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดอัปเดตข้อมูล', checking: true });
          setReload(value => value + 1);
        })}>เลือกแพ็กเกจใหม่</button>}
        {canResumePayment && <button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => {
          const result = await api.resume(status.attemptId!);
          if (result.checkoutUrl) { navigate(result.checkoutUrl, 'checkout'); return; }
          // An expired or closed Checkout has no page to return to: say so instead of a silent reload.
          setCheckoutCancelNotice({ text: 'หน้าชำระเงินเดิมเปิดต่อไม่ได้แล้ว ระบบกำลังตรวจผลรายการเดิม กรุณารอสักครู่แล้วกดอัปเดตข้อมูล', checking: true });
          setReload(value => value + 1);
        })}>กลับไปยังรายการเดิม</button>}
        {canEndCheckout && !oneTapCancel && (confirmCheckoutCancel ? <div className="space-y-2 rounded-xl border border-amber-300 p-3">
          <p>ยุติหน้าชำระเงินรายการนี้ใช่ไหม? ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงิน ก่อนให้เริ่มรายการใหม่</p>
          <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async () => {
            const result = await api.cancelCheckout(status.attemptId!);
            setConfirmCheckoutCancel(false);
            setCheckoutCancelNotice(result.state === 'EXPIRED' ? { text: 'ยุติหน้าชำระเงินแล้ว เลือกแพ็กเกจใหม่ได้', checking: false }
              : { text: 'กำลังตรวจผลรายการเดิม กรุณากดอัปเดตข้อมูลก่อนเริ่มรายการใหม่', checking: true });
            setReload(value => value + 1);
          })}>ยืนยันยุติหน้าชำระเงิน</button><button className={button} disabled={busy} onClick={() => setConfirmCheckoutCancel(false)}>ยังไม่ยุติ</button></div>
        </div> : <button className={button} disabled={busy} onClick={() => setConfirmCheckoutCancel(true)}>ยุติรายการที่ยังไม่ชำระ</button>)}
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
      {status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <section className="mangmee-card space-y-3 p-5" aria-label="บิล QR รอบปัจจุบัน"><h2 className="text-lg font-bold">บิล พร้อมเพย์ รอบปัจจุบัน</h2><p>สแกน QR เพื่อชำระบิลเดิม ระบบไม่หักเงินอัตโนมัติ</p><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate(status.renewalInvoiceUrl!, 'document'))}>เปิดบิลและสแกน QR</button></section>}
      {status.subscriptionState === 'NONE' && !status.collection && !status.pendingPlanChange && <p className="mangmee-card p-5 text-gray-500">ยังไม่มีการต่ออายุอัตโนมัติ</p>}
      <BillingCollectionPanel key={activeCollectionId ?? 'renewal'} companyId={companyId} status={status} operationId={activeCollectionId} onChange={collectionChanged} apiOverride={preview?.api}
        onEdit={activeCollectionId && capacityDraft.current?.collectionId === activeCollectionId ? () => { if (preview) setPreviewCollectionId(undefined); else router.push(`/companies/${encodeURIComponent(companyId)}/billing`); setCapacity(capacityDraft.current); setChoosing(true); setSection('package'); } : undefined}
        onBack={() => { if (preview) setPreviewCollectionId(undefined); else router.push(`/companies/${encodeURIComponent(companyId)}/billing`); setChoosing(false); setSection('package'); }} />
      {!activeCollectionId && <>
      {status.allowedActions.includes('portal_payment_method') && <section className="mangmee-card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" aria-label="วิธีชำระเงิน"><div><h2 className="text-lg font-bold">บัตรชำระเงิน</h2><p className="mt-1 text-sm text-gray-500">เปลี่ยนบัตรสำหรับการต่ออายุผ่านผู้ให้บริการรับชำระเงิน</p></div><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate((await api.portal()).url, 'portal'))}>จัดการบัตรชำระเงิน</button></section>}
      <div ref={emailSettings} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-4">
        {bounceBanner}
        <BillingEmailRecipientPanel companyId={companyId} status={status} latestInvoice={latestInvoice} openRequest={recipientOpen}
          onChanged={collectionChanged} apiOverride={preview?.api} />
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
        <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { const repair = status.capacityRepair!; setCapacity({ options: await api.capacity(repair.offerKey, repair.interval), billingEmail: recipientEmail, repair, key: crypto.randomUUID() }); })}>เลือกสิทธิ์สำหรับรายการที่จ่ายแล้ว</button></section>}
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
          <p>{deal.creditScope === 'CHAT' ? `เครดิต AI ${dealAiCreditText(deal.aiMonthlyBudgetSatang, 'CHAT')}` : `เพดาน AI รวม: ${dealAiCreditText(deal.aiMonthlyBudgetSatang)}`}</p>
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
            <button className="mangmee-btn mangmee-btn-primary w-full" disabled={busy} aria-busy={Boolean(busy)}
              onClick={() => action(async () => { await requestQuote(deal.base, deal.autoRenew && deal.cadence === 'year' ? 'year' : 'month', recipientEmail, undefined, chosenDealMode, deal.dealId); })}>เลือกข้อเสนอนี้</button>
          </>}
        </section>}
        {deal && <h3 className="text-lg font-bold">หรือเลือกแพ็กเกจปกติ</h3>}
        <fieldset className="space-y-2"><legend className="font-semibold">วิธีชำระและต่ออายุ</legend>
          {displayedModes.includes('CARD_AUTO') && modeRadio('CARD_AUTO')}
          {otherModes.length > 0 && <>
            <button type="button" className={billingBackControl} aria-expanded={otherModesExpanded} aria-controls={otherModesId} onClick={() => setOtherModesOpen(value => !value)}>วิธีชำระอื่น<span aria-hidden="true">{otherModesExpanded ? '▴' : '▾'}</span></button>
            <div id={otherModesId} hidden={!otherModesExpanded} className="space-y-2">{otherModes.map(modeRadio)}</div>
          </>}
        </fieldset>
        {status.renewalMode === 'CARD_AUTO' && status.subscriptionState === 'active' && status.paidThrough && Date.parse(status.paidThrough) > Date.now() && !availableModes.includes('CARD_ONCE') &&
          <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm leading-7">{modeUnavailable ? 'เลือกวิธีจ่ายใหม่นี้ได้ แต่ยังชำระซ้อนกับสมาชิกเดิมไม่ได้' : 'ร้านนี้มีสมาชิกบัตรที่ต่ออายุอัตโนมัติอยู่'} หากต้องการเปลี่ยน ให้<button className="mx-1 font-semibold text-brand-700 underline" onClick={() => { setChoosing(false); setSection('payment'); }}>หยุดต่ออายุอัตโนมัติ</button>ก่อน สิทธิ์ที่จ่ายไว้ใช้ได้ถึง {date(status.paidThrough)} แล้วจึงซื้อด้วยวิธีใหม่</p>}
        {(status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && modeUnavailable &&
          <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm leading-7">แพ็กเกจปัจจุบันเป็นแบบจ่ายครั้งเดียว ระหว่างที่ยังไม่หมดอายุ ซื้อแพ็กเกจอื่นได้ด้วยบัตรจ่ายครั้งเดียวหรือพร้อมเพย์จ่ายครั้งเดียว หากต้องการต่ออายุอัตโนมัติให้เริ่มหลังแพ็กเกจนี้หมดอายุ</p>}
        <div className="flex gap-2">{(['month', 'year'] as const).map(value => <button key={value} className={interval === value ? billingPrimaryControl : button} aria-pressed={interval === value} onClick={() => { setInterval(value); setQuote(null); setCapacity(null); setCadenceNotice(false); }}>{value === 'month' ? 'รายเดือน' : 'รายปี'}</button>)}</div>
        {cadenceNotice && <div ref={cadenceNoticeRef} tabIndex={-1} role="status" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-3 rounded-xl bg-amber-50 p-4">
          <p>{cadenceNotice === 'pending' ? 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป กรุณาตรวจสอบและยกเลิกรายการนั้นก่อนซื้อรายปี' : 'หากต้องการเพิ่มระดับและเปลี่ยนรอบชำระ ให้เพิ่มระดับในรอบเดิมก่อน แล้วจึงเลือกรอบชำระใหม่ ระบบจะแสดงยอดให้ตรวจสอบแยกแต่ละรายการ'}</p>
          <button className={button} onClick={() => { if (cadenceNotice === 'pending') setSection('payment'); else setInterval(status.interval!); setCadenceNotice(false); }}>{cadenceNotice === 'pending' ? 'ดูรายการเปลี่ยนแพ็กเกจ' : `เลือกแพ็กเกจ${status.interval === 'year' ? 'รายปี' : 'รายเดือน'}`}</button>
        </div>}        {/* Sales-event spec §8 / SD-O12 / SD-O13: the holder's discounts sit above the list, the best one chosen; one per payment. */}
        {/* Promotion spec Q4: the ONE benefit of this purchase — the promotion, a held discount, or neither. The notes about a discount this shop cannot use stay separate from the choice. */}
        {eventDiscountBlockedText(status.eventDiscount).length > 0 && <p role="note" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7">
          {eventDiscountBlockedText(status.eventDiscount).map(line => <span key={line} className="block break-words">{line}</span>)}</p>}
        {eventDiscountUsable(status.eventDiscount) && !ticketView && <div role="note" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm leading-7"><p className="break-words">{eventDiscountOneTimeOnlyText(status.eventDiscount)}</p>
          {availableModes.some(mode => eventDiscountMode(mode)) && <button type="button" className={button} onClick={() => { setPurchaseMode(availableModes.find(mode => eventDiscountMode(mode))!); setQuote(null); setCapacity(null); }}>เลือกจ่ายครั้งเดียว</button>}</div>}
        {(promotionChoice || ticketView) && <section aria-label={choiceCopy.section} className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <fieldset className="space-y-2"><legend className="font-semibold">{choiceCopy.legend}</legend>
            {promotionChoice && <label className="flex min-h-11 items-center gap-3"><input type="radio" name="benefitChoice" className="shrink-0" checked={pageBenefit === 'PROMOTION'}
              onChange={() => { setBenefitPick('PROMOTION'); setQuote(null); }} /><span className="min-w-0 break-words"><span className="block font-semibold">{promotionChoice.title}</span>
              {promotionChoice.lines.map(line => <span key={line} className="block text-sm text-gray-600">{line}</span>)}</span></label>}
            {/* Owner 2026-09-29: one row per held discount, the best first and chosen; the first row is the default pick. */}
            {ticketView && eventDiscountChoices(ticketView).map((ticket, index, all) => <label key={ticket.ticketSerial} className="flex min-h-11 items-center gap-3">
              <input type="radio" name="benefitChoice" className="shrink-0" checked={pageBenefit === 'EVENT_DISCOUNT' && (chosenEventSerial ?? all[0]!.ticketSerial) === ticket.ticketSerial}
                onChange={() => { setBenefitPick('EVENT_DISCOUNT'); setEventSerial(index ? ticket.ticketSerial : null); setQuote(null); }} /><span className="min-w-0 break-words">{eventDiscountChoiceLabel(ticket)}</span></label>)}
            <label className="flex min-h-11 items-center gap-3"><input type="radio" name="benefitChoice" className="shrink-0" checked={pageBenefit === 'NORMAL'}
              onChange={() => { setBenefitPick('NORMAL'); setQuote(null); }} />{choiceCopy.normal}</label>
            {choiceCopy.notes.map(note => <p key={note} className="text-sm leading-6 text-gray-600">{note}</p>)}
          </fieldset></section>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.catalog.offers.filter(offer => offer.interval === interval).map(offer => {
          const monthly = data.catalog.offers.find(item => item.offerKey === offer.offerKey && item.interval === 'month');
          const saving = interval === 'year' && monthly ? monthly.priceSatang * 12 - offer.priceSatang : 0;
          const current = status.accessState === 'ACTIVE' && status.tierKey === offer.offerKey && status.interval === offer.interval;
          const currentRank = BILLING_PAID_TIERS.indexOf(status.tierKey as typeof BILLING_PAID_TIERS[number]);
          const fullPackageUpgrade = status.accessState === 'ACTIVE' && currentRank >= 0 && status.paidThrough && Date.parse(status.paidThrough) > Date.now() &&
            (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') &&
            (chosenMode === 'CARD_ONCE' || chosenMode === 'PROMPTPAY_ONCE') && status.interval === offer.interval &&
            BILLING_PAID_TIERS.indexOf(offer.offerKey as typeof BILLING_PAID_TIERS[number]) > currentRank;
          const packageChangeUnavailable = status.packageChangesEnabled === false && status.paidThrough && Date.parse(status.paidThrough) > Date.now() &&
            (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && (status.tierKey !== offer.offerKey || status.interval !== offer.interval);
          // Read the offer's actual snapshot so the card matches what checkout grants.
          const menus = dealMenuLabels(offer.featureKeys);
          // Promotion spec Q4: a card takes the benefit the buyer picked where it fits, else a normal purchase (never another benefit);
          // with no pick, the promotion it has, else the held discount that lowers it.
          const promo = offer.availability === 'AVAILABLE' ? promotionRow(status.promotions, offer) : undefined, promoCard = promo?.available ? promotionCard(promo, offer) : null;
          const ticketLine = eventDiscountMode(chosenMode, status.purchaseSource) ? eventDiscountCard(status.eventDiscount, offer, chosenEventSerial) : null;
          const cardBenefit = promotionCardBenefit(benefitPick, offered, { PROMOTION: !!promoCard, EVENT_DISCOUNT: !!ticketLine });
          const eventCard = cardBenefit === 'EVENT_DISCOUNT' ? ticketLine : null;
          // A card that takes the promotion says its months and receipts once, in the promotion block; the plain lines (12 months, 360 receipts, the average on the paid price) are for a normal purchase.
          const plain = promotionCardShowsPlainFacts(cardBenefit);
          // Promotion spec Q5: an immediate upgrade is held back until `upgradeDeferredUntil`; the card says when instead of offering it.
          const upgradeNote = promotionUpgradeNote(status, offer);
          return <article key={offer.offerKey} className={`mangmee-card relative flex flex-col gap-4 p-5${current ? ' !border-brand-500' : ''}`}>
          {current && <MangmeeBadge className="absolute -top-3 right-4 border">แพ็กเกจปัจจุบัน</MangmeeBadge>}
          <h3 className="font-bold">{offer.label}</h3><p className="text-xl font-bold">{money(offer.priceSatang)} / {interval === 'month' ? 'เดือน' : 'ปี'}</p>
          {promoCard && <section aria-label={`โปรโมชั่น ${offer.label}`} className={`space-y-1 rounded-xl border p-3 ${cardBenefit === 'PROMOTION' ? 'border-brand-300 bg-brand-50' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            <p className="break-words text-sm font-semibold">{promoCard.name}</p><p className="text-lg font-bold">{promoCard.headline}</p>
            {promoCard.lines.map(line => <p key={line} className="break-words text-sm">{line}</p>)}
            {cardBenefit !== 'PROMOTION' && <p className="text-sm font-semibold">{PROMOTION_NOT_PICKED}</p>}</section>}
          {/* A promotion that cannot be used says why, and never closes the normal purchase below. */}
          {promo && !promo.available && <p role="note" className="break-words text-sm text-gray-600">{promotionReasonText(promo.reason)}</p>}
          {eventCard && <p className="break-words text-sm font-semibold text-brand-700">{eventDiscountCardText(eventCard.eventName, eventCard.shownDiscountSatang)}</p>}
          {interval === 'year' && plain && <p className="text-sm text-gray-600">เฉลี่ยเดือนละ {money(Math.round(offer.priceSatang / 12))}</p>}
          {data.catalog.taxTreatment === 'EXCLUSIVE_VAT_7' && <p className="text-sm text-gray-600">ราคายังไม่รวม VAT 7%</p>}
          {(plain || interval === 'month') && <p className="text-sm text-brand-700">{interval === 'year' ? `ใช้งาน 12 เดือน${saving > 0 ? ` · ประหยัด ${money(saving)}` : ''}` : 'ชำระรายเดือน'}</p>}<p>{offer.branchLimit} สาขา · {offer.employeeLimit} ผู้ใช้</p>
          {plain && <p>{offer.receiptAllowance.toLocaleString('th-TH')} ใบ ได้ทันทีเมื่อชำระสำเร็จ</p>}
          <p>เครดิต AI {dealAiCreditText(DEFAULT_CHAT_CREDIT_SATANG, 'CHAT')} · ใบเสร็จคิดตามจำนวนที่อ่านสำเร็จ</p>
          {offer.offerKey === 'ENTERPRISE_1999' && <p className="text-sm text-gray-600">{enterpriseMenuSummary}</p>}
          {menus.length > 0 && <details className="text-sm text-gray-600"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand-700">ดูรายละเอียดทั้งหมด · {menus.length} เมนู</summary>
            <ul className="space-y-1 break-words">{menus.map(label => <li key={label}><span aria-hidden="true">✓ </span>{label}</li>)}</ul></details>}
          {offer.availability === 'COMING_SOON' && <p className="text-sm text-gray-600">แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน</p>}
          <button className="mangmee-btn mangmee-btn-primary mt-auto w-full" disabled={!!packageChangeUnavailable || !!upgradeNote || modeUnavailable || busy || catalogUnavailable || Date.parse(data.catalog.validUntil) <= Date.now() || offer.availability !== 'AVAILABLE'} aria-busy={Boolean(busy)} onClick={() => action(async () => {
            await requestQuote(offer.offerKey, interval, recipientEmail);
          })}>{offer.availability === 'COMING_SOON' ? 'เร็ว ๆ นี้' : offer.availability === 'AVAILABLE' ? current ? 'ซื้อแพ็กเกจเดิมเพิ่ม' : fullPackageUpgrade ? 'อัปเกรดจ่ายส่วนต่าง' : status.paidThrough && Date.parse(status.paidThrough) > Date.now() && status.tierKey === offer.offerKey && status.interval === 'month' && interval === 'year' ? 'เปลี่ยนเป็นรายปี' : status.paidThrough && Date.parse(status.paidThrough) > Date.now() && status.tierKey === offer.offerKey && status.interval === 'year' && interval === 'month' ? 'เปลี่ยนเป็นรายเดือนรอบถัดไป' : 'เลือกแพ็กเกจนี้' : 'ยังไม่เปิดขาย'}</button>
          {packageChangeUnavailable && <p className="text-sm text-gray-500">{errorText({ code: 'BILLING_REPEAT_NOT_READY' })}</p>}
          {upgradeNote && <p role="note" className="break-words text-sm text-gray-600">{upgradeNote}</p>}
          {fullPackageUpgrade && !upgradeNote && <button className={button} disabled={!!packageChangeUnavailable || modeUnavailable || busy || catalogUnavailable || Date.parse(data.catalog.validUntil) <= Date.now() || offer.availability !== 'AVAILABLE'} aria-busy={Boolean(busy)} onClick={() => action(async () => {
            await requestQuote(offer.offerKey, interval, recipientEmail, undefined, chosenMode, undefined, 'FULL_PACKAGE');
          })}>ซื้อ {offer.label} เต็มแพ็ก {money(offer.priceSatang)}</button>}
        </article>; })}</div>
      </section>}
      {quote && <section aria-label="ยืนยันซื้อแพ็กเกจ" className="mangmee-card space-y-5 p-5 sm:p-6">
        {dealQuote && <p className="rounded-xl bg-brand-50 p-4 text-brand-800">ข้อเสนอพิเศษ · {autoDeal ? dealConfirmText(autoDeal) : `จ่ายครั้งเดียว ไม่มีหักอัตโนมัติ · ใช้ได้ ${dealQuote.months} เดือน`}{dealQuote.description ? ` · ${dealQuote.description}` : ''}</p>}
        <p>{quote.advanceDeal ? `สิทธิ์ดีลตั้งแต่ ${date(quote.advanceDeal.startsAt)}:` : quote.purchase?.kind === 'REPEAT' ? 'สิทธิ์คงเดิม:' : quote.purchase?.kind === 'SCHEDULED_CHANGE' ? `สิทธิ์ตั้งแต่ ${date(quote.purchase.previousPaidThrough)}:` : 'สิทธิ์หลังชำระสำเร็จ:'} สูงสุด {quote.offer.branchLimit} สาขา · {quote.offer.employeeLimit} ผู้ใช้ รวม{THAI_SYSTEM_ROLE_NAMES.OWNER}</p>
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
          <dl className="mt-2 space-y-1 text-sm sm:text-base">
            <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ชื่อบนเอกสาร</dt><dd className="min-w-0 break-words">{quote.billingProfile?.name || quote.companyName}</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ที่อยู่</dt><dd className="min-w-0 break-words">{quote.billingProfile && quote.billingProfile.missingFields.every(field => field === 'name')
              ? Object.values(quote.billingProfile.address).filter(Boolean).join(' ') : 'จะกรอกที่หน้าชำระเงิน'}</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">อีเมลรับเอกสาร</dt><dd className="min-w-0 break-all">{quote.billingEmail || 'จะกรอกที่หน้าชำระเงิน'}
              {quote.billingEmail && status.recipient?.bouncedAt && status.recipient.email === quote.billingEmail && <MangmeeBadge tone="amber" className="ml-2">ส่งไม่ถึง</MangmeeBadge>}</dd></div>
          </dl>
          <div className="mt-2 flex flex-wrap gap-x-4">
            {canOpenProfile && <Link className="inline-flex min-h-11 items-center text-brand-700 underline" href={billingProfileHref(companyId, {
              offer: quote.offer.offerKey, interval: quote.offer.interval, channel: pendingPurchase.current?.channel ?? 'web', purchaseMode: quote.purchaseMode,
              ...(dealQuote ? { dealId: dealQuote.dealId } : {}),
              ...(quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? { purchaseIntent: 'FULL_PACKAGE' as const } : {}),
            })}>แก้ไขข้อมูลร้าน</Link>}
            {status.recipient?.email && <button type="button" className="inline-flex min-h-11 items-center text-brand-700 underline" onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>}
          </div>
        </div>
        {quote.eventDiscount && <section aria-label="ส่วนลดจากงาน" className="space-y-2 rounded-xl border border-brand-200 p-4">
          {quote.eventDiscount.applied ? <><dl className="space-y-1">
            {/* The price the discount came off: an upgrade's difference, otherwise the package price. */}
            <div className="flex justify-between gap-3"><dt>{quote.purchase?.kind === 'UPGRADE' ? 'ส่วนต่างแพ็กเกจ' : 'ราคาแพ็กเกจ'}</dt><dd className="shrink-0">{money(quote.eventDiscount.applied.unitAmountSatang + quote.eventDiscount.shownDiscountSatang)}</dd></div>
            <div className="flex justify-between gap-3 font-semibold text-brand-800"><dt className="min-w-0 break-words">ส่วนลดจากงาน {quote.eventDiscount.eventName}</dt><dd className="shrink-0">−{money(quote.eventDiscount.shownDiscountSatang)}</dd></div>
          </dl>{/* SD-O13: a renewing mode discounts its first bill only; the next round is the full price, on the day this period ends. */}
          {eventDiscountFirstBillOnly(quote.purchaseMode) && quote.purchase?.projectedPaidThrough &&
            <p className="font-semibold">{eventDiscountNextRoundText(quote.purchaseMode, money(quote.totalSatang), quote.purchase.projectedPaidThrough)}</p>}
          <p className="text-sm text-gray-600">{eventDiscountFirstBillOnly(quote.purchaseMode) ? 'ส่วนลดใช้กับบิลแรกเท่านั้น' : 'ส่วนลดใช้กับการจ่ายครั้งนี้เท่านั้น'} งานเดียวกันใช้ได้ร้านละครั้ง</p></>
          : <p>ไม่ใช้ส่วนลดจากงานครั้งนี้ · ส่วนลดยังเป็นของคุณถึง {date(quote.eventDiscount.expiresAt)}</p>}
          <button type="button" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" disabled={busy} aria-busy={busy} onClick={() => {
            const next: BillingBenefitChoice = quote.eventDiscount?.applied ? 'NORMAL' : 'EVENT_DISCOUNT';
            setBenefitPick(next);
            void action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, recipientEmail, capacityDraft.current?.initialSelection, quote.purchaseMode, undefined,
              quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? 'FULL_PACKAGE' : undefined, { choice: next }); });
          }}>{promotionSwitchLabel(quote)}</button>
        </section>}
        <p>ราคาก่อนภาษี {money((quote.eventDiscount?.applied ?? quote).subtotalSatang)} · ภาษี {money((quote.eventDiscount?.applied ?? quote).taxSatang)}</p>
        {quote.purchase && ['REPEAT', 'FULL_PACKAGE_UPGRADE'].includes(quote.purchase.kind) ? <dl className={`grid gap-5 rounded-xl bg-brand-50 p-5 ${annualConversion ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div><dt className="text-sm text-brand-800">ชำระวันนี้</dt><dd className="mt-1 text-2xl font-bold text-brand-800">{money((quote.eventDiscount?.applied ?? quote).totalSatang)}</dd></div>
          <div><dt className="text-sm text-gray-600">โควตาที่เพิ่ม</dt><dd className="mt-1 text-xl font-bold">{(promoReview?.totalReceiptUnits ?? quote.purchase.receiptUnitsAdded).toLocaleString('th-TH')} ใบ<span className="mt-1 block text-sm font-normal text-gray-600">ใช้ได้ทันทีเมื่อชำระสำเร็จ</span></dd></div>
          <div><dt className="text-sm text-gray-600">วันหมดอายุใหม่</dt><dd className="mt-1 text-xl font-bold">{date(promoReview?.benefitEnd ?? quote.purchase.projectedPaidThrough)}<span className="mt-1 block text-sm font-normal text-gray-600">{annualConversion ? 'เพิ่ม 12 เดือนจาก' : 'ต่อจากเดิม'} {date(quote.purchase.previousPaidThrough)}</span></dd></div>
          {annualConversion && <div><dt className="text-sm text-gray-600">ต่ออายุรายปีครั้งถัดไป</dt><dd className="mt-1 text-xl font-bold">{money(quote.totalSatang)}<span className="mt-1 block text-sm font-normal text-gray-600">วันที่ {date(quote.purchase.projectedPaidThrough)}</span></dd></div>}
        </dl> : <p className="rounded-xl bg-brand-50 p-5 text-2xl font-bold text-brand-800">ชำระวันนี้ {money((quote.eventDiscount?.applied ?? quote).totalSatang)}</p>}
        <p>{quote.taxTreatment === 'NOT_VAT_REGISTERED' ? 'บริษัทผู้ให้บริการยังไม่ได้จด VAT จึงไม่มีการเรียกเก็บ VAT' : quote.taxTreatment === 'INCLUSIVE_VAT_7' ? 'ราคารวม VAT 7% แล้ว' : 'ราคาเพิ่ม VAT 7%'}</p>
        {/* Promotion spec §3: the paid period, the free time, the receipts and the next round — all from the quote, all estimates until payment is confirmed. */}
        {promoReview && <section aria-label="โปรโมชั่นที่ใช้ในรายการนี้" className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="break-words font-semibold text-brand-800">{promoReview.title}</p>
          <dl className="grid gap-3 sm:grid-cols-2">{promoReview.rows.map(row => <div key={row.label}><dt className="text-sm text-gray-600">{row.label}</dt><dd className="break-words font-semibold">{row.value}</dd></div>)}</dl>
          {promoReview.next && <p className="break-words font-semibold">{promoReview.next}</p>}
          <p className="text-sm text-gray-600">{promoReview.estimate}</p>
        </section>}
        {quote.purchase?.kind === 'UPGRADE' ? <div className="space-y-2"><p>ชำระส่วนต่างและเริ่ม {quote.offer.label} เมื่อยืนยันการชำระสำเร็จ วันหมดอายุคงเดิม {date(quote.purchase.projectedPaidThrough)} เพิ่ม {quote.purchase.receiptUnitsAdded} ใบ รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts} ใบ</p><p>{quote.purchaseMode === 'CARD_AUTO' ? 'ยอดต่ออายุรอบถัดไป' : 'ราคาเต็มเมื่อซื้อรอบใหม่'} {money(quote.upgrade!.nextRenewalTotalSatang)}</p>{(quote.purchaseMode === 'CARD_ONCE' || quote.purchaseMode === 'PROMPTPAY_ONCE') && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, recipientEmail, undefined, quote.purchaseMode, undefined, 'FULL_PACKAGE'); })}>ดูทางเลือกซื้อ {quote.offer.label} เต็มแพ็ก {money(quote.upgrade!.nextRenewalTotalSatang)}</button>}<details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">รายละเอียดส่วนต่าง</summary><p>คำนวณส่วนต่าง ณ {date(quote.upgrade!.prorationAt)} · จำนวนคงเหลือเปลี่ยนตามการใช้งานระหว่างชำระ</p><ul className="space-y-1">{quote.upgrade!.segments.map((segment,index)=><li key={index}>{date(segment.start)} ถึง {date(segment.end)}: {money(segment.amountSatang)} · เพิ่ม {segment.receiptUnitsAdded} ใบ</li>)}</ul></details></div> : quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? <div className="space-y-2"><p>ซื้อ {quote.offer.label} เต็มแพ็กเพิ่มจากแพ็กเดิม จ่ายราคาเต็ม {money(quote.totalSatang)} ไม่หักค่าแพ็กเดิม เริ่มสิทธิ์แพ็กใหม่และเพิ่มโควตาเต็ม {quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบทันทีหลังชำระสำเร็จ</p><p>รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ (รวมยอดเดิมที่ยังใช้ได้) · วันหมดอายุใหม่ {date(quote.purchase.projectedPaidThrough)} · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</p><button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, recipientEmail, undefined, quote.purchaseMode); })}>กลับไปดูราคาอัปเกรดจ่ายส่วนต่าง</button></div> : quote.purchase?.kind === 'SCHEDULED_CHANGE' ? <div className="space-y-2"><p>ชำระแพ็กเกจเต็มล่วงหน้า สิทธิ์เดิมยังใช้ได้ถึง {date(quote.purchase.previousPaidThrough)} จากนั้นเริ่ม {quote.offer.label} และรับโควตา {quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบ</p><p>แพ็กเกจรอบใหม่ใช้ได้ถึง {date(quote.purchase.projectedPaidThrough)} ไม่มีการตัดเงินงวดถัดไป</p></div> : quote.purchase?.kind === 'REPEAT' ? <p className="text-sm text-gray-600">หลังซื้อคงเหลือประมาณ {promotionReceipts(quote).projected.toLocaleString('th-TH')} ใบ รวมโควตาเดิมที่ยังไม่หมดอายุ · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</p> : quote.purchase?.kind === 'RESTART' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ รับ {promoReview?.totalReceiptUnits ?? quote.offer.receiptAllowance} ใบ วันและโควตาที่หมดอายุไปแล้วไม่ทบ ประวัติชำระเงินเดิมยังดูได้</p> : <div className="space-y-2">
          {quote.purchase?.trialCarryover && <dl className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
            <div className="flex justify-between gap-3"><dt>โควตาแพ็กเกจ{promoReview && ` (รวมแถม ${promotionReceipts(quote).bonus.toLocaleString('th-TH')} ใบ)`}</dt><dd>{promotionReceipts(quote).packageUnits.toLocaleString('th-TH')} ใบ</dd></div>
            <div className="flex justify-between gap-3"><dt>ยกยอดจากทดลองใช้</dt><dd>{quote.purchase.trialCarryover.receiptUnits.toLocaleString('th-TH')} ใบ</dd></div>
            {quote.purchase.projectedRemainingReceipts > quote.offer.receiptAllowance + quote.purchase.trialCarryover.receiptUnits && <div className="flex justify-between gap-3"><dt>โควตาเพิ่มเติมเดิมที่ยังใช้ได้</dt><dd>{(quote.purchase.projectedRemainingReceipts - quote.offer.receiptAllowance - quote.purchase.trialCarryover.receiptUnits).toLocaleString('th-TH')} ใบ</dd></div>}
            <div className="flex justify-between gap-3 font-semibold"><dt>รวมหลังชำระสำเร็จโดยประมาณ</dt><dd>{promotionReceipts(quote).projected.toLocaleString('th-TH')} ใบ</dd></div>
            <div className="text-gray-600">ยอดจากทดลองใช้หมดอายุวันที่ {date(quote.purchase.trialCarryover.expiresAt)} · ยอดจริงขึ้นกับการใช้งานระหว่างชำระ</div>
          </dl>}
          {quote.previousSource === 'ADMIN_MANUAL' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ แพ็กเกจเดิมที่ผู้ดูแลให้ไว้ถึง {date(quote.previousTermEndsAt)} จะถูกแทนที่ วันคงเหลือ (ถ้ามี) ไม่ทบและไม่ลดราคา รับโควตาใหม่ {(promoReview?.totalReceiptUnits ?? quote.offer.receiptAllowance).toLocaleString('th-TH')} ใบ</p>
            : quote.previousSource === 'NO_TERM' ? <p>เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ รับโควตา {(promoReview?.totalReceiptUnits ?? quote.offer.receiptAllowance).toLocaleString('th-TH')} ใบ ไม่มีวันแพ็กเกจเดิมให้ทบ</p>
            /* An auto-renewing deal opens ONE cycle per payment, so its snapshot `months` — which
               the deal itself ignores — must not be read as the term: the offer's interval is. */
            : quote.advanceDeal ? <p>ชำระงวดแรกวันนี้ ใช้แพ็กเกจปัจจุบันต่อถึง {date(quote.advanceDeal.startsAt)} แล้วจึงเริ่มดีลและรับโควตา {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</p>
              : promoReview ? <p>{promoReview.summary}</p>
              : <p>ชำระสำเร็จแล้ว ใช้งานได้ {dealQuote && !autoDeal ? `${dealQuote.months} เดือน` : quote.offer.interval === 'year' ? '12 เดือน' : '1 เดือน'} {!quote.purchase?.trialCarryover && <>พร้อมโควตา {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</>}</p>}
          {quote.purchase?.kind === 'INITIAL' && quote.trialEndsAt && <p className="text-sm text-gray-600">การทดลองใช้จะสิ้นสุดเมื่อชำระสำเร็จ วันทดลองที่เหลือจะไม่บวกเพิ่มในแพ็กเกจนี้</p>}
        </div>}
        {/* Per-tier menu sets make this list long in both directions, so what is gained is read the
            same way as what is lost, and only a package that really takes a menu away warns. */}
        {quote.featureImpact && (quote.featureImpact.removed.length > 0 || quote.featureImpact.added.length > 0 || quote.featureImpact.preservedAdmin > 0) && <section className={`space-y-2 rounded-xl border p-4 ${quote.featureImpact.removed.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`} aria-label={menusMoveLater ? 'การเปลี่ยนสิทธิ์เมนูเมื่อเริ่มแพ็กเกจรอบถัดไป' : 'การเปลี่ยนสิทธิ์เมนูหลังชำระ'}>
          <p className="font-semibold">{menusMoveLater ? `สิทธิ์เมนูตั้งแต่ ${menusMoveLater}` : 'สิทธิ์เมนูเมื่อชำระสำเร็จ'}</p>
          {quote.featureImpact.removed.length > 0 && <><p>{menusMoveLater ? `เมนูต่อไปนี้จะหยุดใช้ตั้งแต่ ${menusMoveLater} โดยข้อมูลเดิมยังเก็บไว้:` : 'เมนูต่อไปนี้จะหยุดใช้หลังชำระ โดยข้อมูลเดิมยังเก็บไว้:'}</p><ul className="list-disc space-y-1 break-words pl-6">{quote.featureImpact.removed.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
          {quote.featureImpact.added.length > 0 && <><p>{menusMoveLater ? `เมนูที่จะเปิดใช้เพิ่มตั้งแต่ ${menusMoveLater}:` : 'เมนูที่จะเปิดใช้เพิ่มหลังชำระ:'}</p><ul className="list-disc space-y-1 break-words pl-6">{quote.featureImpact.added.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
          {quote.featureImpact.preservedAdmin > 0 && <p>สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะร้านนี้ยังคงอยู่</p>}
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
        {quoteExpired ? <div role="status" className="space-y-3 rounded-xl bg-amber-50 p-4"><p>ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่</p>
          <button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void requoteSame()}>ตรวจสอบราคาใหม่</button></div>
        : <div className="flex flex-wrap gap-3"><button className="mangmee-btn mangmee-btn-primary" disabled={busy || (catalogUnavailable && !dealQuote) || !accepted || (!!status.purchaseBlockCode && !(dealQuote && dealModes.includes(quote.purchaseMode!)))} aria-busy={Boolean(busy)} onClick={() => action(async navigate => {
          const params = new URLSearchParams(window.location.search);
          const result = await api.checkout({ quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: params.get('channel') === 'line' ? 'line' : 'web' }, key.current);
          if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout');
          // The quote was spent on the refused attempt: back to the chooser, which stays open.
          else if (result.state === 'FAILED') { setQuote(null); setAccepted(false); setError('ยังเปิดหน้าชำระเงินไม่ได้ กรุณาตรวจสอบราคาใหม่แล้วลองอีกครั้ง'); }
          // The reservation stands until Stripe answers: never retry, only look again.
          else if (result.state === 'UNKNOWN') { setQuote(null); setChoosing(false); setCheckoutCancelNotice({ text: 'กำลังตรวจกับผู้ให้บริการรับชำระเงินว่าหน้าชำระเงินถูกสร้างหรือไม่ กรุณารอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่', checking: true }); setReload(value => value + 1); }
          else { setQuote(null); setChoosing(false); setReload(value => value + 1); }
        })}>{busy ? 'กำลังตรวจสอบ…' : 'ยืนยันและไปหน้าชำระเงิน'}</button></div>}
      </section>}
      </div>}
      <section hidden={section !== 'history'} id="billing-history" aria-label="ประวัติการชำระเงิน" className="mangmee-card space-y-4 p-5 sm:p-6"><h2 className="text-lg font-bold">ประวัติและเอกสารการชำระเงิน</h2>
        {historyLoading && <p role="status">กำลังโหลดประวัติการชำระเงิน…</p>}
        {historyError && <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-4"><p>โหลดประวัติการชำระเงินไม่สำเร็จ · {historyError}</p>
          <button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async () => { const history = await api.history(); setData(current => current && ({ ...current, history })); setHistoryError(''); })}>ลองโหลดประวัติใหม่</button></div>}
        {!historyLoading && !historyError && data.history.items.length === 0 && <p className="rounded-xl bg-gray-50 p-5 text-gray-500">ยังไม่มีรายการชำระเงิน</p>}
        {data.history.items.map(invoice => <article key={invoice.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4"><p>{invoice.number ?? 'รายการชำระเงิน'} · {money(invoice.amountSatang)} · {date(invoice.createdAt)}</p>
          {invoice.promotion && <p className="break-words text-sm text-gray-600">{promotionInvoiceLine(invoice.promotion)}</p>}
          {(invoice.refundedSatang > 0 || invoice.disputed) && <p className="text-sm text-amber-900">{invoice.refundedSatang > 0 && `ยอดคืนเงินที่ผู้ให้บริการรับชำระเงินบันทึก ${money(invoice.refundedSatang)} · `}{invoice.disputed && 'มีข้อพิพาทการชำระเงิน · '}ทีมงานตรวจสิทธิ์เป็นรายกรณี · ตรวจล่าสุด {date(invoice.financialObservedAt)}</p>}
          {preview ? <button className={button} onClick={preview.openDocumentHistory}>ดูเอกสาร</button> : <Link className={button} href={`/companies/${encodeURIComponent(companyId)}/billing/invoices/${encodeURIComponent(invoice.id)}`}>ดูเอกสาร</Link>}
        </article>)}
        {data.history.nextCursor && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { const page = await api.history(data.history.nextCursor!); setData(current => current && ({ ...current, history: { items: [...current.history.items, ...page.items], nextCursor: page.nextCursor } })); })}>รายการก่อนหน้า</button>}
      </section>
    </>}
    <footer className="space-y-2 border-t border-gray-200 pt-5 text-sm text-gray-500"><p>ต้องการความช่วยเหลือเรื่องแพ็กเกจ</p><div className="flex flex-wrap gap-4"><a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`tel:${PLAN_TERM_RENEW_PHONE.replaceAll('-', '')}`}>{PLAN_TERM_RENEW_PHONE}</a><a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>{PLAN_TERM_CONTACT_EMAIL}</a></div></footer>
  </BillingCustomerFrame>;
}

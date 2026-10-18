'use client';
import Link from 'next/link';
import { dangerButtonClass, quietButtonClass, primaryButtonClass as billingPrimaryControl, secondaryButtonClass as billingControl } from '@/common/components/button';
import { FieldError } from '@/common/components/field';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { billingProfileHref, billingProfileSelection } from './billing-profile-navigation';
import { useRouter } from 'next/navigation';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { MetricGrid } from '@/common/components/mangmee/MetricGrid';
import { Pagination } from '@/common/components/data-table/Pagination';
import { MangmeeBadge } from '@/common/components/mangmee';
import BillingCustomerFrame from './BillingCustomerFrame';
import { BillingEmailRecipientPanel } from './BillingEmailRecipientPanel';
import { errorStatus, errorText as billingErrorText } from './billing-error-text';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { shopPlanTierLabel, THAI_SYSTEM_ROLE_NAMES, BILLING_PAID_TIERS, DEFAULT_CHAT_CREDIT_SATANG, PLAN_TIER_PRESETS, planTermStateLabel, type PlanTierKey, type BillingCatalog, type BillingQuote, type BillingStatus, type BillingAttemptView, type BillingPurchaseMode, type BillingBenefitChoice, type BillingEventDiscountView } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { PLAN_LOCK_COPY, PLAN_TERM_CONTACT_EMAIL, PLAN_TERM_RENEW_PHONE, claimUnlockReload, cardRenewalRunning, planLockReason } from '@/features/plan-term/plan-term.logic';
import { notifyPlanTermChanged, type PlanLockReason } from '@/features/plan-term/plan-term.api';
import { useLockedShell } from '@/features/plan-term/LockedShellScope';
import { billingApi, type BillingHistory } from './billing.api';
import BillingCollectionPanel from './BillingCollectionPanel';
import BillingCapacityPicker from './BillingCapacityPicker';
import {billingLeavesPage, billingHistoryStatus, billingPurchaseChoices, billingOneTimePurchase, billingMonthlyAllowanceText, billingPurchaseModeLabel, billingSupportReference} from './billing-display';
import { billingDeal, billingQuoteDeal, dealAiCreditText, dealConfirmText, dealMenuLabels } from './billing-deal';
import { eventDiscountBlockedText, eventDiscountCard, eventDiscountCardText, eventDiscountChoiceLabel, eventDiscountChoices, eventDiscountFirstBillOnly, eventDiscountHeldNotice,
  eventDiscountMode, eventDiscountNextRoundText, eventDiscountOneTimeOnlyText, eventDiscountSerial, eventDiscountUsable } from './billing-event-discount';
import { PROMOTION_NOT_PICKED, promotionCard, promotionCardBenefit, promotionChoiceCopy, promotionChoiceLabel, promotionInvoiceLine, promotionLostNotice, promotionOffered,
  promotionPageBenefit, promotionQuoteBenefit, promotionQuoteFields, promotionReasonText, promotionReceipts, promotionReservedName, promotionReview, promotionRow, promotionStatus, promotionSwitchLabel,
  promotionUpgradeNote, purchaseBlockQuiet, statusDeadlines, type PromotionLostNotice, type QuoteBenefit, type QuoteFields } from './billing-promotion';
import { PENDING_TEXT, paymentIsOver, pendingPayment, type PendingPayment, type PendingStepKey } from './billing-pending-payment';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

const money = (satang: number) => `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
const date = formatThaiDate;
const errorText = (error: unknown) => billingErrorText(error).replaceAll('แท็บการต่ออายุและจ่ายเงิน', 'การต่ออายุด้านล่าง');
const button = billingControl;
const STEP_CLASS = { primary: billingPrimaryControl, secondary: billingControl, quiet: quietButtonClass } as const;
/** Codes whose fix lives beside the document recipient, in the renewal block (G16: routed by code, not by wording). */
const RECIPIENT_ERROR_CODES = ['BILLING_EMAIL_UPDATE_PENDING', 'BILLING_RECIPIENT_UPDATE_REQUIRED', 'BILLING_EMAIL_CHANGED', 'BILLING_RECIPIENT_BOUNCED'];
const RETURN_NOT_FOUND = 'ไม่พบรายการนี้ในร้านที่เลือก ดูประวัติหรือติดต่อทีมงาน';
function navigateProvider(url: string, kind: 'checkout' | 'portal' | 'document') {
  const parsed = new URL(url);
  const hosts = kind === 'checkout' ? ['checkout.stripe.com'] : kind === 'portal' ? ['billing.stripe.com'] : ['invoice.stripe.com', 'pay.stripe.com', 'payments.stripe.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !hosts.includes(parsed.hostname)) throw new Error('Unexpected provider URL');
  window.location.assign(parsed.href);
}

export default function BillingPage({ companyId, returning = false, returnAttemptId = null, collectionId, previewHref, preview, canOpenProfile = false }: { companyId: string; returning?: boolean; returnAttemptId?: string | null; collectionId?: string; previewHref?: string;
  preview?: { api: ReturnType<typeof billingApi>; navigate: typeof navigateProvider; openDocumentHistory: () => void; startWithPlans?: boolean; initialSection?: 'package' | 'payment' | 'history'; retrySelection?: { offer: string; interval: 'month' | 'year'; purchaseMode: BillingPurchaseMode; dealId?: string; purchaseIntent?: 'FULL_PACKAGE' }; returnHome?: () => void };
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
  const scrolledAnchor = useRef<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    const target = hash === '#billing-recipient' ? 'billing-recipient' : hash === '#billing-history' || section === 'history' ? 'billing-history' : hash === '#billing-payment' || section === 'payment' ? 'billing-payment' : null;
    const element = target && data ? document.getElementById(target) : null;
    if (element && scrolledAnchor.current !== target) { scrolledAnchor.current = target; element.scrollIntoView({ block: 'start' }); }
  }, [data, section]);
  const cadenceNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (cadenceNotice) { cadenceNoticeRef.current?.scrollIntoView({ block: 'start' }); cadenceNoticeRef.current?.focus({ preventScroll: true }); } }, [cadenceNotice]);
  const [choosing, setChoosing] = useState(preview?.startWithPlans ?? false);
  const [buyingStep, setBuyingStep] = useState(0);
  const [recipientOpen, setRecipientOpen] = useState(0);
  useEffect(() => {
    const selectHash = () => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
      if (window.location.hash === '#billing-payment') setSection('payment');
      if (window.location.hash === '#billing-history') setSection('history');
      if (window.location.hash === '#billing-recipient') { setSection('payment'); setRecipientOpen(value => value + 1); }
    };
    // The payment page's back link returns here without a hash; remember the history destination once.
    try {
      const backToHistory = window.sessionStorage.getItem(`billing-history-return:${companyId}`) === 'history';
      window.sessionStorage.removeItem(`billing-history-return:${companyId}`);
      if (backToHistory && !window.location.hash && !returning) setSection('history');
    } catch { /* Storage is optional; explicit anchors still work. */ }
    selectHash(); window.addEventListener('hashchange', selectHash);
    return () => window.removeEventListener('hashchange', selectHash);
  }, []);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState<string | null>(null), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [historyError, setHistoryError] = useState(''), [historyLoading, setHistoryLoading] = useState(false);
  // Item 6: a notice about a Checkout still being checked carries its own "อัปเดตข้อมูล" and goes away once
  // the status has no attempt left to check; a finished outcome ("ยุติ…แล้ว") stays until the next action.
  const [checkoutCancelNotice, setCheckoutCancelNotice] = useState<{ text: string; checking: boolean } | null>(null);
  // UAT 2026-10-10: the status whose open payment the buyer has just ended (the cancel call succeeded). That status is stale from then on — it still names the payment — and a read is on its way, so
  // the page shows its loading line until a status that is not this one arrives: the notice that says the payment is ended and the block of choices for it are never on screen together.
  const [endedStatus, setEndedStatus] = useState<BillingStatus | null>(null);
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
  const [purchaseMode, setPurchaseMode] = useState<BillingPurchaseMode | undefined>(undefined);
  const [selectedOffer, setSelectedOffer] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<'offer' | 'mode' | null>(null);
  const offerChoices = useRef<HTMLDivElement>(null), modeChoices = useRef<HTMLFieldSetElement>(null);
  // The deal card carries its own choice: its modes are the deal's (S39), not the catalog's.
  const [dealMode, setDealMode] = useState<BillingPurchaseMode | null>(null);
  const [quote, setQuote] = useState<BillingQuote | null>(null), [accepted, setAccepted] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const consentInput = useRef<HTMLInputElement>(null), consentGroup = useRef<HTMLDivElement>(null);
  // Promotion spec Q4 / sales-event spec §4.3: the ONE benefit this purchase takes, for this purchase only. null = the default, chosen for the
  // buyer: the promotion on a card that has one, else the held discount ("ใช้", as before), else a normal purchase.
  const [benefitPick, setBenefitPick] = useState<BillingBenefitChoice | null>(null);
  // Promotion spec §3: a promotion that stopped being available at quote or pay time. Shown until the buyer asks again on purpose.
  const [promotionLost, setPromotionLost] = useState<PromotionLostNotice | null>(null);
  // Owner 2026-09-29: which held discount this payment uses; null = the default, the best one for each card.
  const [eventSerial, setEventSerial] = useState<string | null>(null);
  // Spec §8.1: the holder's tickets when this shop is not starting a package (owner-only read; refused = no line). The same answer says how the shop renews and whether that renewal runs, so the line is drawn from it alone.
  const [heldView, setHeldView] = useState<BillingEventDiscountView | null>(null);
  useEffect(() => {
    let live = true;
    api.eventDiscount().then(view => { if (live) setHeldView(view); }, () => { if (live) setHeldView(null); });
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
  useEffect(() => { if (quote || choosing) { if (quote && buyingStep === 1) { consentGroup.current?.scrollIntoView({ block: 'center' }); consentInput.current?.focus({ preventScroll: true }); return; } if (!quote || !quoteHeading.current) window.scrollTo({ top: 0 }); else backNavigation.current?.scrollIntoView({ block: 'start' }); quoteHeading.current?.focus({ preventScroll: true }); } }, [quote, choosing, buyingStep]);
  // Promotion spec §3: the lost-promotion notice sits at the top of the page, but the buyer is wherever the refused button was (a card far below, or the end of the review), and a refused
  // checkout also scrolls to the chooser heading just above. Declared after that effect so this one has the last word: the notice lands under the sticky header and is announced.
  const lostNotice = useRef<HTMLDivElement>(null);
  useEffect(() => { if (promotionLost) { lostNotice.current?.scrollIntoView({ block: 'start' }); lostNotice.current?.focus({ preventScroll: true }); } }, [promotionLost]);
  // The ordinary messages sit at the top too: the red banner after a refused action, the notice after ending or resuming a payment, and the answer of the check. The buyer is at the button that
  // was pressed, so each is brought into view under the sticky header (only if it is not already fully visible: `nearest`) and takes focus. Last in the order: a message always wins over
  // "go to the chooser heading"; the lost-promotion notice and the banner never come together (`action` sets one or the other); a recipient error has its own destination (the email panel),
  // so the banner leaves it alone. The order the scroll/focus effects run in (the later one wins, within one commit): the cadence notice (declared first, inside the chooser, never in the
  // same commit as a chooser change), the chooser heading, the lost-promotion notice, the banner, the cancel notice, the answer of the check, the recipient destinations.
  const errorBanner = useRef<HTMLDivElement>(null), checkoutNotice = useRef<HTMLDivElement>(null), refreshAnswer = useRef<HTMLDivElement>(null);
  // Ending a payment reopens the chooser a read later, in a commit of its own, and the chooser heading scrolls past the notice that says why. That reopening bumps this counter in the SAME
  // batch as `setChoosing(true)`, so the notice effect (declared after the chooser's) runs again in that commit and is the last to scroll. Opening the chooser by hand does not bump it:
  // an old notice never pulls the page back to itself.
  const [noticeAgain, setNoticeAgain] = useState(0);
  useEffect(() => { if (error && !RECIPIENT_ERROR_CODES.includes(errorCode ?? '')) { errorBanner.current?.scrollIntoView({ block: 'nearest' }); errorBanner.current?.focus({ preventScroll: true }); } }, [error, errorCode]);
  useEffect(() => { if (checkoutCancelNotice) { checkoutNotice.current?.scrollIntoView({ block: 'nearest' }); checkoutNotice.current?.focus({ preventScroll: true }); } }, [checkoutCancelNotice, noticeAgain]);
  useEffect(() => { if (refreshNotice) { refreshAnswer.current?.scrollIntoView({ block: 'nearest' }); refreshAnswer.current?.focus({ preventScroll: true }); } }, [refreshNotice]);
  useEffect(() => { if (error && RECIPIENT_ERROR_CODES.includes(errorCode ?? '')) { setSection('payment'); setRecipientOpen(value => value + 1); emailSettings.current?.scrollIntoView({ block: 'start' }); } }, [error, errorCode]);
  // The renewal block renders first; only then is there a recipient panel to scroll to.
  useEffect(() => { if (recipientOpen) emailSettings.current?.scrollIntoView({ block: 'start' }); else if (choosing) backNavigation.current?.scrollIntoView({ block: 'start' }); }, [recipientOpen]);
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
      if (!new URLSearchParams(window.location.search).has('interval') && data.status.interval && data.status.paidThrough && Date.parse(data.status.paidThrough) > Date.now()) setInterval(data.status.interval);
      intervalInitialized.current = true;
    }
  }, [data]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('interval') === 'year') setInterval('year'); }, []);
  useEffect(() => {
    let active = true, historyDenied = false;
    let history: BillingHistory = { items: [], nextCursor: null };
    setError(''); setErrorCode(null);
    setHistoryError(''); setHistoryLoading(true);
    const historyRequest = ++historyRead.current;
    const read = ++statusRead.current;
    // Development replays setup/cleanup before this microtask; obsolete setups must not send reads.
    queueMicrotask(() => {
      if (!active) return;
      // History is independent: an unavailable or slow document service must not delay purchase.
      void api.history(historyPosition.cursor, 10).then(value => {
        if (!active || historyRequest !== historyRead.current) return;
        history = value; setData(current => current && { ...current, history }); setHistoryLoading(false);
      }).catch(e => {
        if (!active || historyRequest !== historyRead.current) return;
        setHistoryLoading(false);
        if (errorStatus(e) === 401 || errorStatus(e) === 403) {
          historyDenied = true; setData(null); setError(errorText(e)); setErrorCode(apiErrorCode(e));
        } else setHistoryError(errorText(e));
      });
      Promise.all([api.status(), api.catalog()]).then(([status, catalog]) => {
        if (!active || historyDenied) return;
        setData(current => {
          const currentHistory = historyRequest === historyRead.current ? history : current?.history ?? history;
          return read === statusRead.current ? { status, catalog, history: currentHistory } : current && { ...current, catalog, history: currentHistory };
        });
        if (read !== statusRead.current) return;
        if (!status.attemptId) setCheckoutCancelNotice(notice => notice?.checking ? null : notice);
        // F09/F10: after a one-tap cancel, the chooser opens only on a status that allows a new sale.
        if (reopenChooser.current && status.allowedActions.includes('new_sales') && !status.attemptId) { reopenChooser.current = false; setChoosing(true); setBuyingStep(0); setSection('package'); setNoticeAgain(value => value + 1); }
      }).catch(e => { if (active) { setData(null); setError(errorText(e)); setErrorCode(apiErrorCode(e)); } });
      if (returning) {
        if (!returnAttemptId) setReturnError('ลิงก์ไม่มีเลขรายการที่ถูกต้อง ดูสถานะและประวัติการจ่ายเงินของร้าน');
        else void api.attempt(returnAttemptId).then(value => { if (active) { setReturnAttempt(value); setReturnError(''); } })
          .catch(e => { if (active) { setReturnAttempt(null); setReturnError(errorStatus(e) === 404 ? RETURN_NOT_FOUND : errorText(e)); } });
      }
    });
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
      setQuote(null); setBuyingStep(0); setAccepted(false); setError('ราคา หรือสถานะขายเปลี่ยนแล้ว ตรวจสอบรายการใหม่'); setErrorCode(null);
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
  /** The status again, in place, as a quote request reads it. A bare `setReload` would also clear the banner the buyer was just given (the reload effect starts by emptying `error`). */
  async function readStatus() {
    const read = ++statusRead.current;
    try { const latest = await api.status(); if (read === statusRead.current) setData(value => value && { ...value, status: latest }); }
    catch { /* the message on screen stays; the next read says more */ }
  }
  async function action(work: (navigate: typeof navigateProvider) => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setErrorCode(null);
    const current = generation.current;
    try { await work((url, kind) => { if (current === generation.current) (preview?.navigate ?? navigateProvider)(url, kind); }); }
    catch (e) { if (current === generation.current) {
      if ([401, 403].includes(errorStatus(e) ?? 0)) setData(null);
      // Promotion spec §3: a promotion that cannot be used any more is never swapped for a normal purchase here — say why, drop the old quote, and let the buyer ask again.
      const lost = promotionLostNotice(e);
      if (lost) { setPromotionLost(lost); setQuote(null); setBuyingStep(0); setAccepted(false); if (!lost.canRecheck) setChoosing(false); setReload(value => value + 1); }
      else {
        setError(errorText(e)); setErrorCode(apiErrorCode(e));
        // A payment that is over (never started and ended, or changed under the buyer): read the status so its block and its buttons go, and the buyer can start again.
        if (paymentIsOver(e)) await readStatus();
      }
    } }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }
  async function requestQuote(offerKey: string, selectedInterval: string, billingEmail: string, selection?: BillingCapacitySelection, requestedMode?: BillingPurchaseMode, dealId?: string, purchaseIntent?: 'FULL_PACKAGE', benefit?: QuoteBenefit) {
    // A deal is paid with one of ITS modes: falling back to the catalog's choice here would send
    // CARD_AUTO on a deal quote, which the API refuses.
    const activeMode = offerKey === data?.status.tierKey && selectedInterval === data?.status.interval && data?.status.paidThrough && Date.parse(data.status.paidThrough) > Date.now()
      && data.status.availablePurchaseModes?.find(mode => mode === data.status.renewalMode);
    const mode = requestedMode ?? (dealId ? chosenDealMode ?? chosenMode : chosenMode ?? (activeMode || undefined));
    if (!mode) { setBuyingStep(1); setChoiceError('mode'); modeChoices.current?.scrollIntoView({ block: 'start' }); return; }
    setSelectedOffer(offerKey); setSelectedDeal(Boolean(dealId));
    if (!dealId) setPurchaseMode(mode);
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
      key.current = crypto.randomUUID(); setAccepted(false); setQuote(result); setConsentError(false);
      setBuyingStep(repeatShortcut.current || billingOneTimePurchase(result.purchaseMode) ? 2 : 1); repeatShortcut.current = false; setCapacity(null); setPromotionLost(null);
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
  const heldDiscount = eventDiscountHeldNotice(heldView);
  // The status on screen when the cancel call answers, not the one the button was drawn from: a read that landed while the call was out replaced it.
  const latestStatus = useRef(status);
  latestStatus.current = status;
  const settling = !!status && status === endedStatus;
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
  const modeAvailabilityKey = availableModes.join('|');
  useEffect(() => {
    setPurchaseMode(current => {
      const modes = modeAvailabilityKey.split('|').filter(Boolean) as BillingPurchaseMode[];
      if (current && modes.includes(current)) return current;
      return status?.renewalMode && modes.includes(status.renewalMode as BillingPurchaseMode) ? status.renewalMode as BillingPurchaseMode : undefined;
    });
  }, [modeAvailabilityKey, status?.paidThrough, status?.renewalMode]);
  const chosenMode = purchaseMode;
  // Promotion spec Q4: what this page offers as the ONE benefit of a purchase, and which radio the buyer's pick (or the default) turns on.
  const ticketView = status && chosenMode && eventDiscountMode(chosenMode, status.purchaseSource) && eventDiscountUsable(status.eventDiscount) ? status.eventDiscount : undefined;
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
  // R-A5: only a saved recipient change invalidates the quote; cancelling the editor keeps it.
  const previousRecipient = useRef(recipientEmail);
  useEffect(() => {
    const changed = previousRecipient.current !== recipientEmail;
    previousRecipient.current = recipientEmail;
    if (changed && quote && recipientEmail && recipientEmail !== quote.billingEmail) void requoteSame();
    // A failed re-quote stays visible until the buyer retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientEmail]);
  const pendingId = useId();
  const [renewalChoice, setRenewalChoice] = useState<'auto' | 'once' | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<'qr' | 'card' | null>(null);
  const [selectedDeal, setSelectedDeal] = useState(false);
  const repeatShortcut = useRef(false);
  const repeatEntryUsed = useRef(false);
  const repeatOffer = data?.catalog.offers.find(offer => offer.offerKey === status?.tierKey && offer.interval === status?.interval && offer.availability === 'AVAILABLE');
  const openRepeat = () => {
    setChoosing(true); setRecipientOpen(0); setSection('package'); setAccepted(false);
    setSelectedOffer(repeatOffer?.offerKey ?? null);
    setInterval(repeatOffer?.interval === 'year' ? 'year' : 'month');
    const mode = billingPurchaseChoices(status!).find(choice => choice.mode === status?.renewalMode && !choice.disabled)?.mode;
    setPurchaseMode(mode); setSelectedDeal(false); repeatShortcut.current = true;
    if (repeatOffer && mode) void action(async () => { await requestQuote(repeatOffer.offerKey, repeatOffer.interval, recipientEmail, undefined, mode); });
    else setBuyingStep(1);
  };
  useEffect(() => {
    if (!status || !data || repeatEntryUsed.current || returning || activeCollectionId || new URLSearchParams(window.location.search).get('purchase') !== 'repeat') return;
    repeatEntryUsed.current = true;
    // An existing invoice or unfinished payment owns the next step, never a second checkout.
    if (status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl) { setSection('payment'); return; }
    if (status.allowedActions.includes('new_sales') && !pending?.inFlight && !status.capacityRepair) openRepeat();
    // One explicit entry, after the authoritative reads arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const firstPurchase = !status?.paidThrough || Date.parse(status.paidThrough) <= Date.now();
  const repeatReview = !dealQuote && quote?.purchase?.kind === 'REPEAT';
  const oneTimeQuote = billingOneTimePurchase(quote?.purchaseMode);
  const initialPurchaseReview = !dealQuote && !!quote && (!quote.purchase || ['INITIAL', 'RESTART'].includes(quote.purchase.kind));
  const quoteLabel = quote && (dealQuote ? quote.offer.label.replace(PLAN_TIER_PRESETS[quote.offer.offerKey].labelTh, shopPlanTierLabel(quote.offer.offerKey)) : shopPlanTierLabel(quote.offer.offerKey));
  const renewalCadence = (quote?.pendingPlanChange?.offer.interval ?? quote?.offer.interval) === 'year' ? 'ปี' : 'เดือน';
  const renewalDate = quote?.promotion?.expectedNextChargeAt ?? quote?.purchase?.projectedPaidThrough;
  const goBack = () => {
    setConsentError(false);
    if (quote && buyingStep === 2 && !capacityDraft.current) { setBuyingStep(1); return; }
    if (quote) { setQuote(null); setCapacity(capacityDraft.current); setAccepted(false); setBuyingStep(buyingStep === 2 ? 1 : 0); }
    else if (buyingStep > 0) { setBuyingStep(buyingStep - 1); setConsentError(false); }
    else { setChoosing(false); setAccepted(false); window.scrollTo({ top: 0 }); }
  };
  const reviewSelection = () => {
    const offer = data?.catalog.offers.find(item => item.offerKey === selectedOffer && item.interval === interval);
    const changeBlocked = status?.packageChangesEnabled === false && !firstPurchase && billingOneTimePurchase(status.renewalMode as BillingPurchaseMode) && (status.tierKey !== selectedOffer || status.interval !== interval);
    if (!selectedDeal && (!offer || offer.availability !== 'AVAILABLE' || changeBlocked || (status && promotionUpgradeNote(status, offer)))) { setBuyingStep(0); setChoiceError('offer'); offerChoices.current?.scrollIntoView({ block: 'start' }); return; }
    if (buyingStep === 0) { setChoiceError(null); setBuyingStep(1); return; }
    if (!chosenMode) { setChoiceError('mode'); modeChoices.current?.scrollIntoView({ block: 'start' }); return; }
    setChoiceError(null);
    if (quote) {
      if (!billingOneTimePurchase(quote.purchaseMode) && !accepted) { setConsentError(true); consentGroup.current?.scrollIntoView({ block: 'center' }); consentInput.current?.focus({ preventScroll: true }); return; }
      setBuyingStep(2); return;
    }
    return action(async () => { await requestQuote(selectedDeal ? deal!.base : offer!.offerKey, interval, recipientEmail, undefined, chosenMode, selectedDeal ? deal?.dealId : undefined); });
  };
  useEffect(() => {
    const group = choiceError === 'offer' ? offerChoices.current : choiceError === 'mode' ? modeChoices.current : null;
    group?.scrollIntoView({ block: 'start' }); group?.focus({ preventScroll: true });
    if (consentError) { consentGroup.current?.scrollIntoView({ block: 'center' }); consentInput.current?.focus({ preventScroll: true }); }
  }, [choiceError, consentError]);
  // Each page is one server batch; keep its cursor so earlier pages remain reachable.
  const [historyNavigation, setHistoryNavigation] = useState<{ company: string; pages: { cursor?: string }[]; page: number }>({ company: companyId, pages: [{}], page: 1 });
  const historyPages = historyNavigation.company === companyId ? historyNavigation.pages : [{}];
  const historyPage = historyNavigation.company === companyId ? historyNavigation.page : 1;
  const historyRead = useRef(0);
  const historyPosition = historyPages[historyPage - 1] ?? {};
  const historyRows = data?.history.items ?? [];
  const historyHasNext = !!data?.history.nextCursor;
  const latestInvoiceSeen = useRef<{ company: string; invoice: BillingHistory['items'][number] } | null>(null);
  if (!historyPosition.cursor && data?.status.companyId === companyId && data.history.items[0]) latestInvoiceSeen.current = { company: companyId, invoice: data.history.items[0] };
  const latestInvoice = latestInvoiceSeen.current?.company === companyId ? latestInvoiceSeen.current.invoice : null;
  const lockReason: PlanLockReason = planLockReason(status);
  const knownTier = status?.tierKey && status.tierKey in PLAN_TIER_PRESETS ? status.tierKey as PlanTierKey : null;
  const noPackageFacts = !!status && !knownTier && !status.termEndsAt && status.usage.remaining === null;
  const noPackage = !!status && (noPackageFacts || status.accessState !== 'ACTIVE' && (status.accessState === 'EXPIRED' || !status.termEndsAt));
  const packageHeading = status?.accessState === 'EXPIRED' ? PLAN_LOCK_COPY[lockReason].title
    : noPackage ? PLAN_LOCK_COPY.no_package.title : 'แพ็กเกจปัจจุบัน';
  const currentReturn = returning && (!status?.attemptId || status.attemptId === returnAttemptId);
  const returnFailed = currentReturn && returnAttempt?.paymentState === 'FAILED';
  // Stripe sent the customer back after paying, and the API keeps the attempt OPEN until the reconciler
  // applies it (the drain runs about every 10 s). While that answer is pending, nothing here may offer to
  // end, resume or redo the payment — only after the 3-minute wait gives up do those come back.
  const awaitingStripe = currentReturn && !checkoutCanceled && !returnError && !timedOut && (!returnAttempt || returnAttempt.paymentState === 'PENDING');
  // Promotion spec §7: the right this shop holds. On the return page the attempt's own right wins; a renewal still being set up
  // brings the same "check again" control as any other unfinished payment (`checking`), and never an invitation to pay again.
  // A right already opened is told only while the package runs (on the return page, once the attempt itself is applied); an ended or lapsed package is not "using" it.
  const promotionUse = (returning ? returnAttempt?.promotion : undefined) ?? status?.promotion;
  const promotionBlock = promotionStatus(promotionUse, status?.accessState === 'ACTIVE' || (returning && returnComplete));
  // Paid, and the package is not applied yet (the card heading says so too).
  const paidNotApplied = !!status && (currentReturn ? returnAttempt?.paymentState === 'PAID' && returnAttempt.applyState !== 'APPLIED' : status.paymentState === 'PAID' && status.applyState !== 'APPLIED');
  const hasPaymentToCheck = status && (!confirmed || (returning && status.attemptId !== returnAttemptId) || ['past_due', 'unpaid'].includes(status.subscriptionState) || promotionBlock?.checking) && (status.paymentState !== 'NONE' || status.attemptId || returnAttemptId || status.subscriptionState !== 'NONE');
  const unresolvedReturn = currentReturn && !checkoutCanceled && !awaitingStripe && !returnFailed && !returnComplete && !paidNotApplied;
  const attemptPaymentState = currentReturn && returnAttempt ? returnAttempt.paymentState === 'PENDING' && status?.paymentState === 'UNKNOWN' ? 'UNKNOWN' : returnAttempt.paymentState : status?.paymentState ?? 'NONE';
  const canEndCheckout = !awaitingStripe && !paidNotApplied && !(currentReturn && returnComplete) && !returnFailed && Boolean(status?.canCancelCheckout && status.attemptId);
  const canResumePayment = canEndCheckout && ['PENDING', 'FAILED', 'UNKNOWN', 'ACTION_REQUIRED'].includes(attemptPaymentState);
  // F09/F10: an unpaid Checkout is ended and replaced in one tap; the two-step confirm stays for
  // attempts whose outcome is unknown or needs action.
  const oneTapCancel = canEndCheckout && attemptPaymentState === 'PENDING' && !unresolvedReturn;
  // Paid, then held for the team (not a capacity choice, not a deal waiting for its start date).
  const applyHeld = !!status && !status.capacityRepair && !status.pendingDeal && (currentReturn ? returnAttempt?.applyState : status.applyState) === 'HELD';
  const applyReview = applyHeld || (paidNotApplied && (currentReturn ? returnAttempt?.applyState : status?.applyState) === 'FAILED');
  const supportReference = billingSupportReference(returning ? returnAttemptId : status?.reference);
  // Item 17: a no-package box saying "เลือกแพ็กเกจ…" with no button under it, and no other line saying
  // why, was a dead end (sales closed, collection paused, policy not ready).
  const canBuy = !!status?.allowedActions.includes('new_sales');
  const purchaseSalesClosed = ['BILLING_SALES_CLOSED', 'BILLING_COMPANY_SALES_CLOSED'].includes(status?.purchaseBlockCode ?? '') || (!status?.purchaseBlockCode && status?.purchaseEligibility === 'COMPANY_SALES_CLOSED');
  const purchaseBlockText = status?.purchaseBlockCode === 'BILLING_CHECKOUT_PENDING' ? PENDING_TEXT.alertCheckoutPending
    : status?.purchaseBlockCode ? errorText({ code: status.purchaseBlockCode })
    : purchaseSalesClosed ? errorText({ code: 'BILLING_COMPANY_SALES_CLOSED' }) : null;
  const contactLinks = <div className="flex flex-wrap gap-4 text-sm">
    <a className="inline-flex min-h-11 items-center underline" href={`tel:${PLAN_TERM_RENEW_PHONE.replaceAll('-', '')}`}>{PLAN_TERM_RENEW_PHONE}</a>
    <a className="inline-flex min-h-11 items-center break-all underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>{PLAN_TERM_CONTACT_EMAIL}</a>
  </div>;
  const saleClosedUnexplained = !!status && !status.purchaseBlockCode && !canBuy && !status.attemptId && !status.refundReviewPending
    && status.purchaseEligibility === 'ELIGIBLE' && status.accessState !== 'HELD';
  // Round 3: while a payment of this shop is unfinished, in flight or being checked, ONE block says what is waiting and what to press (billing-pending-payment.ts); the generic
  // "choose a package" button and the hint that invites a new purchase give way to it. Round 4: for a payment that waits for the buyer or the provider the block LEADS the card and its title
  // is the card's heading; the amber "still checking" alert, a no-package box with nothing but the pointer, and the old "ยังยืนยันผลไม่ได้" paragraph are gone — one message per fact.
  const pendingState = status ? pendingPayment({ paymentState: attemptPaymentState, hasAttempt: !!status.attemptId || !!returnAttemptId, awaiting: awaitingStripe, unconfirmed: unresolvedReturn,
    canEnd: canEndCheckout, canResume: canResumePayment, oneTap: oneTapCancel, canCheck: !!hasPaymentToCheck, moneyReceived: paidNotApplied, held: applyHeld, deferred: !!status.pendingDeal, renewalSetup: !!promotionBlock?.checking,
    canPurchase: canBuy && !status.renewalInvoiceUrl, salesClosed: purchaseSalesClosed,
    failed: returnFailed, hasPackage: !noPackage, reservedPromotion: promotionReservedName(promotionUse) }) : null;
  const failureExit = canBuy ? 'เลือกวิธีจ่ายหรือจ่ายอีกครั้ง' : 'ตรวจผลการจ่ายเงินหรือติดต่อทีมงานมั่งมี';
  const mappedFailure = returnAttempt?.errorCode ? errorText({ code: returnAttempt.errorCode }) : null;
  const failureReason = returnAttempt?.errorCode === 'BILLING_CHECKOUT_NOT_STARTED'
    ? `รายการเดิมยังไม่ได้เริ่มจ่าย ยังไม่มีการตัดเงิน ${failureExit}`
    : returnAttempt?.state === 'EXPIRED' ? `หน้าจ่ายเงินหมดอายุแล้ว ${failureExit}`
    : mappedFailure && !mappedFailure.startsWith('ยังยืนยันผลรายการไม่ได้') ? mappedFailure.replaceAll('กรุณา', '').replaceAll('ลองใหม่', 'ลองอีกครั้ง')
    : `การจ่ายเงินรายการนี้ไม่เสร็จ ${failureExit}`;
  const pending = pendingState?.kind === 'FAILED' ? { ...pendingState, heading: 'ยังไม่ได้รับเงิน', intro: [failureReason, ...pendingState.intro.filter(line => !line.includes('เลือกแพ็กเกจ'))] }
    : pendingState && applyReview ? { ...pendingState, heading: paidNotApplied ? 'ได้รับเงินแล้ว ต้องตรวจสอบแพ็กเกจ' : 'รายการจ่ายเงินต้องตรวจสอบ' } : pendingState;
  const pendingShown = !!pending && !!(pending.heading || pending.title || pending.intro.length > 0 || pending.steps.length > 0);
  const pendingLeads = pendingShown && !!pending?.heading;
  // UAT 2026-10-10: a running, paid shop that cannot buy another package right now (a promotion with time left, a QR bill every period) is told so in one quiet line inside the card, not by the amber alert.
  const quietBlock = status ? purchaseBlockQuiet(status) : null;
  const purchaseHint = pending?.inFlight ? null : canBuy || oneTapCancel ? lockReason === 'no_package' ? 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน' : 'เลือกแพ็กเกจเพื่อใช้งานต่อ'
    : saleClosedUnexplained ? 'ยังเปิดรับเงินไม่ได้ชั่วคราว ลองอีกครั้งภายหลัง' : null;
  const purchasing = (choosing && canBuy) || !!quote || !!capacity;
  const showOverview = !purchasing;
  const annualOffers = data?.catalog.offers.filter(offer => offer.interval === 'year') ?? [];
  const annualSaving = annualOffers.length > 0 && annualOffers.every(annual => data?.catalog.offers.some(monthly => monthly.offerKey === annual.offerKey && monthly.interval === 'month' && annual.priceSatang === monthly.priceSatang * 10));
  const renewalKind = chosenMode ? billingOneTimePurchase(chosenMode) ? 'once' : 'auto' : renewalChoice;
  const paymentKind = chosenMode ? chosenMode.startsWith('CARD') ? 'card' : 'qr' : paymentChoice;
  const selectMethod = (renewal: typeof renewalChoice, payment: typeof paymentChoice) => {
    setRenewalChoice(renewal); setPaymentChoice(payment); setQuote(null); setAccepted(false); setConsentError(false); setCapacity(null); setChoiceError(null);
    const mode = renewal && payment ? renewal === 'auto' ? payment === 'card' ? 'CARD_AUTO' : 'PROMPTPAY_RENEW' : payment === 'card' ? 'CARD_ONCE' : 'PROMPTPAY_ONCE' : undefined;
    setPurchaseMode(mode); if (selectedDeal && mode) setDealMode(mode);
  };
  const modeReason = selectedDeal ? chosenMode && !dealModes.includes(chosenMode) ? 'ข้อเสนอนี้ยังใช้วิธีจ่ายที่เลือกไม่ได้' : null
    : status ? billingPurchaseChoices(status).find(choice => choice.mode === chosenMode)?.reason : null;
  const consent = quote && !billingOneTimePurchase(quote.purchaseMode) && <div ref={consentGroup} className="space-y-2">
    <label className="flex min-h-11 items-start gap-3"><input ref={consentInput} type="checkbox" className="mt-1 size-5 shrink-0" checked={accepted} aria-invalid={consentError} aria-describedby={consentError ? 'billing-renewal-consent-error' : undefined} onChange={event => { setAccepted(event.target.checked); setConsentError(false); }} />{quote.purchaseMode === 'PROMPTPAY_RENEW' ? `ยอมรับการออกบิลพร้อมเพย์ทุก${renewalCadence}` : `ยอมรับการตัดบัตรอัตโนมัติทุก${renewalCadence}`}</label>
    {consentError && <FieldError id="billing-renewal-consent-error">ติ๊กยอมรับการต่ออายุก่อน</FieldError>}
  </div>;
  // R-A7: a document bounced — said on the overview and above the recipient panel.
  const bounceBanner = status?.recipient?.bouncedAt ? <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <p className="font-semibold">อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่</p>
    <p className="break-all text-sm">ระบบส่งเอกสารไปที่ {status.recipient.email} ไม่สำเร็จ แก้อีเมลรับเอกสาร แล้วกดส่งเอกสารอีกครั้ง</p>
    <button className={button} onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>
  </div> : null;
  // The payable total leads every review; promotion terms and the document facts follow it.
  const documentBox = (quote: BillingQuote, status: BillingStatus) => <div className="space-y-2" aria-label="ข้อมูลออกเอกสาร">
      <dl className="mt-2 space-y-1 text-sm sm:text-base">
        <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ออกใบเสร็จในชื่อ</dt><dd className="min-w-0 break-words">{quote.billingProfile?.name || quote.companyName}</dd></div>
        <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ที่อยู่</dt><dd className="min-w-0 break-words">{quote.billingProfile && quote.billingProfile.missingFields.every(field => field === 'name')
          ? Object.values(quote.billingProfile.address).filter(Boolean).join(' ') : 'จะกรอกที่หน้าจ่ายเงิน'}</dd></div>
        <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">อีเมลรับเอกสาร</dt><dd className="min-w-0 break-all">{quote.billingEmail || 'จะกรอกที่หน้าจ่ายเงิน'}
          {quote.billingEmail && status.recipient?.bouncedAt && status.recipient.email === quote.billingEmail && <MangmeeBadge tone="amber" className="ml-2">ส่งไม่ถึง</MangmeeBadge>}</dd></div>
      </dl>
      <ActionGroup align="start" className="mt-2">
        {canOpenProfile && <Link className={quietButtonClass} href={billingProfileHref(companyId, {
          offer: quote.offer.offerKey, interval: quote.offer.interval, channel: pendingPurchase.current?.channel ?? 'web', purchaseMode: quote.purchaseMode,
          ...(dealQuote ? { dealId: dealQuote.dealId } : {}),
          ...(quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? { purchaseIntent: 'FULL_PACKAGE' as const } : {}),
        })}>แก้ไขข้อมูลร้าน</Link>}
        {status.recipient?.email && <button type="button" className={quietButtonClass} onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>}
      </ActionGroup>
    </div>;
  const discountBox = (quote: BillingQuote) => quote.eventDiscount && <section aria-label="ส่วนลดจากงาน" className="space-y-2 rounded-xl border border-brand-200 p-4">
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
    </section>;
  // Round 3: the choices for an unfinished payment, drawn from billing-pending-payment.ts (title, what is waiting, the choices in order, each with what it does). Every choice does exactly
  // what the loose button of the same job did: resume the Checkout, ask the provider for the result, end the Checkout (one tap when it is unpaid, with the confirmation otherwise).
  const choosePackage = () => { setBuyingStep(0); setSelectedDeal(false); setInterval(firstPurchase ? 'month' : status?.interval ?? 'month'); setPurchaseMode(billingPurchaseChoices(status!).find(choice => choice.mode === status?.renewalMode && !choice.disabled)?.mode); setRenewalChoice(null); setPaymentChoice(null); setSelectedOffer(null); setRecipientOpen(0); setChoosing(true); };
  const purchaseActions = status && <>
    {!firstPurchase && <button className="mangmee-btn mangmee-btn-secondary" onClick={choosePackage}>เปลี่ยนแพ็กเกจ</button>}
    {!cardRenewalRunning(status) && <button className="mangmee-btn mangmee-btn-primary" onClick={firstPurchase || !repeatOffer ? choosePackage : openRepeat}>{firstPurchase || !repeatOffer ? 'เลือกแพ็กเกจ' : `ต่ออายุ ${money(repeatOffer.priceSatang)}`}</button>}
  </>;
  const retryPurchase = (step: 1 | 2) => {
    if (!canBuy) return;
    let selection = preview?.retrySelection;
    try { selection ??= JSON.parse(window.sessionStorage.getItem(`billing-selection:${companyId}:${returnAttemptId}`) ?? 'null'); } catch { /* A browser may block storage. The chooser remains available. */ }
    const offer = data?.catalog.offers.find(item => item.offerKey === selection?.offer && item.interval === selection.interval);
    if (!selection || !offer || !['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'].includes(selection.purchaseMode)) {
      choosePackage(); setCheckoutCancelNotice({ text: 'ไม่พบแพ็กเกจในรายการเดิม เลือกแพ็กเกจแล้วลองอีกครั้ง', checking: false }); return;
    }
    setSelectedOffer(offer.offerKey); setInterval(offer.interval); setPurchaseMode(selection.purchaseMode); setSelectedDeal(!!selection.dealId);
    if (selection.dealId) setDealMode(selection.purchaseMode);
    setChoosing(true); setRecipientOpen(0); setSection('package'); setQuote(null); setAccepted(false); setBuyingStep(1);
    if (step === 2) {
      repeatShortcut.current = true;
      void action(async () => {
        try { await requestQuote(offer.offerKey, offer.interval, recipientEmail, undefined, selection!.purchaseMode, selection!.dealId, selection!.purchaseIntent); }
        catch (error) { repeatShortcut.current = false; throw error; }
      });
    }
  };
  const returnedInvoice = useRef<{ company: string; attempt: string | null; invoice: BillingHistory['items'][number] } | null>(null);
  const matchedInvoice = data?.history.items.find(invoice => invoice.id === returnAttempt?.invoiceReference);
  if (matchedInvoice && data?.status.companyId === companyId) returnedInvoice.current = { company: companyId, attempt: returnAttemptId, invoice: matchedInvoice };
  const returnInvoice = returnedInvoice.current?.company === companyId && returnedInvoice.current.attempt === returnAttemptId ? returnedInvoice.current.invoice : null;
  const paidSummary = returning && confirmed && !status?.pendingDeal && status?.accessState !== 'HELD';
  const heldShop = status?.accessState === 'HELD' && !applyReview;
  const returnFocused = !status?.pendingDeal && (paidSummary || (returning && (returnFailed || paidNotApplied)) || applyReview || heldShop);
  const returnHeading = heldShop ? 'ร้านนี้ถูกพักใช้งาน' : paidSummary ? returnInvoice ? <>จ่าย <span className="whitespace-nowrap">{money(returnInvoice.amountSatang)}แล้ว</span></> : 'จ่ายแล้ว' : null;
  const rememberHistory = () => { try { window.sessionStorage.setItem(`billing-history-return:${companyId}`, 'history'); } catch { /* Storage is optional. */ } };
  const openPayment = (invoiceId?: string | null) => {
    if (invoiceId) { if (preview) preview.openDocumentHistory(); else { rememberHistory(); router.push(`/companies/${encodeURIComponent(companyId)}/billing/invoices/${encodeURIComponent(invoiceId)}`); } }
    else { setSection('history'); scrolledAnchor.current = null; document.getElementById('billing-history')?.scrollIntoView({ block: 'start' }); }
  };
  const changeHistoryPage = (page: number) => action(async () => {
    if (!data || data.status.companyId !== companyId || page < 1) return;
    const position = historyPages[page - 1] ?? (data.history.nextCursor ? { cursor: data.history.nextCursor } : null);
    if (!position) return;
    const read = ++historyRead.current;
    if (position.cursor !== historyPosition.cursor) {
      setHistoryLoading(true);
      try {
        const history = await api.history(position.cursor, 10);
        if (read !== historyRead.current) return;
        setData(current => current && ({ ...current, history }));
      } finally { if (read === historyRead.current) setHistoryLoading(false); }
    }
    setHistoryNavigation({ company: companyId, pages: historyPages[page - 1] ? historyPages : [...historyPages, position], page }); setHistoryError(''); setHistoryLoading(false);
    document.getElementById('billing-history')?.scrollIntoView({ block: 'start' });
  });
  const pendingSection = (status: BillingStatus, block: PendingPayment) => {
    const run: Record<PendingStepKey, () => void> = {
      continue: () => action(async navigate => {
        const result = await api.resume(status.attemptId!);
        if (result.checkoutUrl) { navigate(result.checkoutUrl, 'checkout'); return; }
        // An expired or closed Checkout has no page to return to: say so instead of a silent reload.
        setCheckoutCancelNotice({ text: 'หน้าจ่ายเงินเดิมเปิดต่อไม่ได้แล้ว ระบบกำลังตรวจผลรายการเดิม รอสักครู่แล้วกดอัปเดตข้อมูล', checking: true });
        setReload(value => value + 1);
      }),
      check: () => action(async () => {
        const result = await api.refresh();
        setRefreshNotice(result.queued ? 'ส่งคำขอตรวจสอบแล้ว กดอัปเดตข้อมูลเพื่อดูผลล่าสุด' : 'ยังไม่มีรายการที่ต้องตรวจสอบกับผู้ให้บริการ');
        setReload(value => value + 1);
      }),
      // F09/F10: an unpaid Checkout is ended and replaced in one tap; the two-step confirm stays for attempts whose outcome is unknown or needs action.
      cancel: oneTapCancel ? () => action(async () => {
        const result = await api.cancelCheckout(status.attemptId!);
        setEndedStatus(latestStatus.current ?? status);
        if (result.state === 'EXPIRED') { reopenChooser.current = true; setCheckoutCancelNotice({ text: 'ยกเลิกรายการเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย', checking: false }); }
        else if (result.state === 'COMPLETED') setCheckoutCancelNotice({ text: 'รายการเดิมจ่ายสำเร็จแล้ว ระบบกำลังเปิดสิทธิ์ให้ ไม่ต้องซื้อใหม่', checking: true });
        else setCheckoutCancelNotice({ text: 'กำลังตรวจผลรายการเดิมกับผู้ให้บริการรับเงิน รอสักครู่แล้วกดอัปเดตข้อมูล', checking: true });
        setReload(value => value + 1);
      }) : () => setConfirmCheckoutCancel(true),
    };
    return <section aria-label={block.heading ?? block.title ?? PENDING_TEXT.regionName} className="space-y-4">
      {block.title && <h3 className="text-lg font-bold text-gray-900">{block.title}</h3>}
      {block.intro.map(line => <p key={line} className="break-words leading-7 text-gray-800">{line}</p>)}
      {confirmCheckoutCancel && !oneTapCancel && block.steps.some(step => step.key === 'cancel') ? <div className="space-y-3">
              <h3 className="font-semibold">{PENDING_TEXT.confirmEnd}</h3>
              <p>{PENDING_TEXT.confirmDetail}</p>
              <ActionGroup><button className={STEP_CLASS.secondary} disabled={busy} aria-busy={busy} onClick={() => setConfirmCheckoutCancel(false)}>{PENDING_TEXT.confirmNo}</button><button className={dangerButtonClass} disabled={busy} aria-busy={busy} onClick={() => action(async () => {
                const result = await api.cancelCheckout(status.attemptId!);
                setEndedStatus(latestStatus.current ?? status); setConfirmCheckoutCancel(false);
                setCheckoutCancelNotice(result.state === 'EXPIRED' ? { text: 'ยกเลิกรายการแล้ว เลือกแพ็กเกจใหม่ได้', checking: false }
                  : { text: 'กำลังตรวจผลรายการเดิม กดอัปเดตข้อมูลก่อนเริ่มรายการใหม่', checking: true });
                setReload(value => value + 1);
              })}>{PENDING_TEXT.confirmYes}</button></ActionGroup>
      </div> : <>
        <ActionGroup align="start" className={block.kind === 'FAILED' ? undefined : '!flex-col'}>
          {block.kind === 'FAILED' && status.allowedActions.includes('new_sales') && !status.renewalInvoiceUrl && <>
            <button className={button} disabled={busy} aria-busy={busy} onClick={() => retryPurchase(1)}>เปลี่ยนวิธีจ่าย</button>
            <button className={billingPrimaryControl} disabled={busy} aria-busy={busy} onClick={() => retryPurchase(2)}>จ่ายอีกครั้ง</button>
          </>}
          {block.steps.map(step => <button key={step.key} type="button" className={STEP_CLASS[paidSummary && step.key === 'check' ? 'secondary' : step.emphasis]} disabled={busy} aria-busy={busy}
            aria-describedby={step.caption.length ? `${pendingId}-${step.key}` : undefined} onClick={run[step.key]}>{step.label}</button>)}
        </ActionGroup>
        {(block.intro.some(line => line.includes('ติดต่อทีมงาน')) || block.kind === 'FAILED' && purchaseSalesClosed) && contactLinks}
        {block.steps.filter(step => step.caption.length > 0).map(step => <div key={step.key} id={`${pendingId}-${step.key}`} className="space-y-1">
          {step.caption.map(line => <p key={line} className="break-words text-sm leading-6 text-gray-600">{line}</p>)}
        </div>)}
        {refreshNotice && <div ref={refreshAnswer} tabIndex={-1} role="status" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-2">
          <p className="text-sm leading-6 text-gray-700">{refreshNotice}</p>
          <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={() => setReload(value => value + 1)}>อัปเดตข้อมูล</button>
        </div>}
      </>}

    </section>;
  };
  return <div className="mangmee-flat bg-white [&>div]:bg-white"><BillingCustomerFrame title="แพ็กเกจ" eyebrow="" description=""
    actions={previewHref && <Link className="mangmee-btn mangmee-btn-secondary" href={previewHref}>พรีวิวขั้นตอน (local)</Link>}
    backHref={status?.accessState === 'ACTIVE' ? `/companies/${encodeURIComponent(companyId)}/dashboard` : lockedShell ? `/companies/${encodeURIComponent(companyId)}/settings` : '/billing/companies'}
    backLabel={status?.accessState === 'ACTIVE' ? 'กลับไปหน้าแรก' : lockedShell ? 'กลับไปตั้งค่าร้าน' : 'กลับไปเลือกร้าน'}>
    {error && <div ref={errorBanner} tabIndex={-1} role="alert" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="break-words">{error}<button className={`${button} ml-3`} disabled={busy} aria-busy={busy} onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button></p>
      {error.includes('ติดต่อทีมงาน') && contactLinks}
      {error.includes('ติดต่อทีมงาน') && supportReference && !applyReview && !heldShop &&
        <p className="break-all text-sm">เลขอ้างอิงสำหรับแจ้งทีมงาน: {supportReference}</p>}
    </div>}
    {checkoutCancelNotice && <div ref={checkoutNotice} tabIndex={-1} role="status" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-2 rounded-xl bg-gray-50 p-3"><p>{checkoutCancelNotice.text}</p>
      {checkoutCancelNotice.checking && <button className={button} disabled={busy} aria-busy={busy} onClick={() => setReload(value => value + 1)}>อัปเดตข้อมูล</button>}</div>}
    {(!data || settling) && !error && <p role="status">กำลังตรวจสอบสิทธิ์และรายการจ่ายเงิน…</p>}
    {data && status && !settling && <>
      {purchaseBlockText && !quietBlock && !applyReview && !heldShop && !(pending?.kind === 'FAILED' && purchaseSalesClosed) && !(status.purchaseBlockCode === 'BILLING_CHECKOUT_PENDING' && pendingShown && pending?.inFlight) && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p>{purchaseBlockText}</p>
        {purchaseBlockText.includes('ติดต่อทีมงาน') && contactLinks}
        {supportReference && !applyReview && !heldShop && <p className="break-all text-sm">เลขอ้างอิงสำหรับแจ้งทีมงาน: {supportReference}</p>}
        {status.purchaseBlockCode === 'BILLING_EMAIL_UPDATE_PENDING'
          ? <button className={button} onClick={() => { setChoosing(false); openRecipientEditor(); }}>จัดการผู้รับเอกสาร</button>
          : <button className={button} disabled={busy} aria-busy={busy} onClick={() => { setChoosing(false); setSection('payment'); setReload(value => value + 1); }}>ตรวจสถานะล่าสุด</button>}
      </div>}
      {status.mode === 'TEST' && !preview && <div><MangmeeBadge tone="amber">โหมดทดสอบ · ไม่มีการรับเงินจริง</MangmeeBadge></div>}
      {returnError && <div role="alert" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4"><p>{returnError}</p>{returnError.includes('ติดต่อทีมงาน') && contactLinks}</div>}
      {promotionLost && <div ref={lostNotice} tabIndex={-1} role="alert" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-semibold">{promotionLost.title}</p>
        <p className="break-words">{promotionLost.text}</p>
        <p className="text-sm leading-7">{promotionLost.hint}</p>
        <ActionGroup>
          <button className={button} onClick={() => setPromotionLost(null)}>ปิดข้อความนี้</button>
          {promotionLost.canRecheck && <button className={billingPrimaryControl} disabled={busy} aria-busy={busy} onClick={() => recheckPromotion()}>ตรวจสอบรายการใหม่</button>}
        </ActionGroup>
      </div>}
      {showOverview && <>
      {heldDiscount && <p role="note" className="break-words rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm leading-7">{heldDiscount}</p>}
      {!pending?.inFlight && status.allowedActions.includes('new_sales') && !!status.billingProfile?.missingFields.length && <p role="note" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7 text-gray-700">
        เอกสารจะออกในชื่อ <strong className="break-words">{status.billingProfile.name || status.companyName}</strong> · ที่อยู่กรอกได้ที่หน้าจ่ายเงิน{canOpenProfile && <> หรือ <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={`/companies/${encodeURIComponent(companyId)}/settings/profile#shop`}>เติมล่วงหน้าที่ข้อมูลร้าน</Link></>}
      </p>}
      {bounceBanner}
      <section aria-label="สถานะแพ็กเกจ" className="mangmee-card space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{returnHeading ?? pending?.heading ?? (returnFailed ? 'ยังไม่ได้รับเงิน' : status.pendingDeal ? status.pendingDeal.state === 'HELD' ? 'จ่ายแล้ว ต้องตรวจสอบก่อนเริ่มดีล' : status.pendingDeal.state === 'PAID' ? 'จ่ายดีลแล้ว รอเริ่มสิทธิ์' : 'จ่ายแล้ว กำลังยืนยันการต่ออายุ' : confirmed ? 'แพ็กเกจปัจจุบัน' : paidNotApplied ? PENDING_TEXT.titleReceived : status.attemptId ? 'กำลังตรวจสอบรายการจ่ายเงิน' : packageHeading)}</h2>
          {!noPackageFacts && !pendingShown && !returnFocused && <MangmeeBadge tone={status.accessState === 'ACTIVE' ? 'brand' : 'amber'}>{status.accessState === 'HELD' ? 'ถูกพักใช้งานโดยผู้ดูแล' : planTermStateLabel(status.accessState === 'ACTIVE' ? 'ACTIVE' : lockReason === 'no_package' ? 'NO_PACKAGE' : 'EXPIRED')}</MangmeeBadge>}
        </div>
        {pending && pendingLeads && !heldShop && pendingSection(status, pending)}
        {returning && returnAttempt?.eventDiscount && <p role="status" className="rounded-xl bg-brand-50 p-3">{returnAttempt.eventDiscount.state === 'USED' ? 'ใช้ส่วนลดจากงานแล้ว' : 'ส่วนลดจะถูกใช้เมื่อยืนยันการจ่าย'} · −{money(returnAttempt.eventDiscount.shownDiscountSatang)}</p>}
        {paidSummary && <>
          {returnInvoice?.offer && <p>{returnInvoice.offer.label} ใช้ได้ถึง <span className="whitespace-nowrap">{date(returnInvoice.promotion?.benefitEnd ?? returnInvoice.periodEnd)}</span></p>}
          <ActionGroup>
            <Link className={button} href={`/companies/${encodeURIComponent(companyId)}/dashboard`} onClick={preview?.returnHome ? event => { event.preventDefault(); preview.returnHome!(); } : undefined}>กลับหน้าแรก</Link>
            <button className={billingPrimaryControl} onClick={() => openPayment(returnAttempt?.invoiceReference)}>ดูใบเสร็จรับเงิน</button>
          </ActionGroup>
        </>}
        {heldShop && <p><a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมงานมั่งมี</a>เพื่อตรวจสอบการใช้งานร้าน</p>}
        {(!returnFocused || (status.accessState === 'ACTIVE' && !noPackage)) && <>
        {/* The payment block owns its state; package details only add facts such as the old expiry. */}
        {noPackageFacts ? null : noPackage ? (pendingShown && !(lockReason === 'trial_ended' && status.termEndsAt) ? null : <dl className="grid gap-5">
          {/* R2/R10: the same title PLAN_LOCK_COPY gives the heading above, on an expired shop — never
              a second, hardcoded "ยังไม่มีแพ็กเกจ" that would say something else under "แพ็กเกจหมดอายุแล้ว". */}
          <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-2 text-lg font-bold text-gray-900">{PLAN_LOCK_COPY[lockReason].title}</dd>
            {purchaseHint && <p className="mt-1 text-sm text-gray-600">{purchaseHint}</p>}
            {/* Only when a term really ran out: a shop that never had one starts and ends today. */}
            {lockReason === 'trial_ended' && status.termEndsAt && <p className="mt-1 text-sm text-gray-500">หมดอายุเมื่อ {date(status.termEndsAt)}</p>}</div>
        </dl>) : <MetricGrid items={[
          ...(knownTier ? [{ key: 'package', label: 'แพ็กเกจ', value: `${shopPlanTierLabel(knownTier)}${status.interval ? ` · ${status.interval === 'year' ? 'รายปี' : 'รายเดือน'}` : ''}`, dot: 'bg-brand-500' }] : []),
          ...(status.termEndsAt ? [{ key: 'expiry', label: 'ใช้ได้ถึง', value: date(status.pendingPlanChange?.action === 'PREPAID_PLAN_CHANGE' ? status.pendingPlanChange.effectiveAt : status.termEndsAt), note: `เหลือ ${Math.max(0, Math.ceil((Date.parse(status.pendingPlanChange?.action === 'PREPAID_PLAN_CHANGE' ? status.pendingPlanChange.effectiveAt : status.termEndsAt) - Date.now()) / 86_400_000))} วัน`, dot: 'bg-amber-500' }] : []),
          ...(status.usage.remaining !== null ? [{ key: 'receipts', label: 'อ่านใบเสร็จได้อีก', value: status.usage.remaining?.toLocaleString('th-TH') ?? 'ไม่จำกัด', unit: status.usage.remaining === null ? undefined : ' ใบ', note: quotaReset ? `เริ่มรอบใหม่ ${date(quotaReset)}` : quotaExpiry && date(quotaExpiry) !== date(status.termEndsAt) ? `ใบที่หมดอายุก่อนใช้ได้ถึง ${date(quotaExpiry)}` : undefined, dot: 'bg-sky-500' }] : []),
        ]} />}
        </>}
        {!returnFocused && <>
        {status.effectiveCapacity?.temporary&&<section className="space-y-2 rounded-xl border border-emerald-300 p-3" aria-label="สิทธิ์แพ็กเกจชั่วคราว"><p>ผู้ดูแลให้สิทธิ์ {shopPlanTierLabel(status.effectiveCapacity.tierKey)} ชั่วคราว</p><p>{status.effectiveCapacity.branchLimit} สาขา · {status.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {date(status.effectiveCapacity.temporary.expiresAt)}</p><p>เมื่อครบกำหนดจะใช้แพ็กเกจที่ซื้ออยู่ล่าสุด การซื้อเพิ่มด้านล่างคิดจากแพ็กเกจที่จ่ายเงิน</p></section>}

        {status.usage.monthlyAllowance&&<p>{billingMonthlyAllowanceText(status.usage)}</p>}
        {!status.pendingDeal && (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && status.paidThrough && <p className="text-sm text-gray-600">จ่ายครั้งเดียว ใช้ได้ถึง {date(status.paidThrough)} · ไม่มีการตัดเงินงวดถัดไป ซื้อใหม่เมื่ออยากใช้ต่อ</p>}
        {status.pendingDeal && <section role="status" aria-label="สถานะดีลล่วงหน้า" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">{status.pendingDeal.state === 'HELD' ? 'จ่ายแล้ว รายการนี้ต้องให้ทีมงานตรวจสอบก่อนเริ่มดีล' : status.pendingDeal.state === 'PAID' ? 'จ่ายดีลแล้ว รอเริ่มสิทธิ์' : 'จ่ายดีลแล้ว กำลังยืนยันการต่ออายุ'}</p>
          <p>สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง {date(status.pendingDeal.startsAt)} แล้วจึงเริ่มสิทธิ์ดีล</p>
          <p>งวดแรกสิ้นสุด {date(status.pendingDeal.firstCycleEndsAt)} · {status.pendingDeal.purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'ตัดบัตรรอบถัดไป'} วันที่ {date(status.pendingDeal.nextChargeAt)}</p>
        </section>}
        {status.renewalMode === 'PROMPTPAY_RENEW' && status.attemptId && status.applyState === 'APPLIED' && <p role="status" className="rounded-xl bg-amber-50 p-3">จ่ายงวดแรกสำเร็จแล้ว กำลังยืนยันการตั้งบิล QR รอบถัดไป ตรวจสถานะอีกครั้ง</p>}
        {status.cancelAtPeriodEnd ? <p className="text-sm text-gray-600">{status.renewalMode === 'PROMPTPAY_RENEW' ? 'หยุดออกบิลแล้ว' : 'หยุดต่ออายุแล้ว'}</p> : status.nextChargeAt && !status.collectionPause && !cardRenewalRunning(status) && <p className="text-sm text-gray-600">{status.renewalMode === 'PROMPTPAY_RENEW' ? 'ระบบจะออกบิล QR วันที่ ' : 'ต่ออายุอัตโนมัติวันที่ '}{date(status.nextChargeAt)}</p>}
        {status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <p>มีบิลต่ออายุรอจ่าย{status.renewalInvoiceDueAt ? <> · ครบกำหนด <span className="whitespace-nowrap">{date(status.renewalInvoiceDueAt)}</span></> : null}</p>}
        {status.graceEndsAt && <p>ระยะผ่อนผันถึง {date(status.graceEndsAt)} · ใช้ยอดใบเสร็จเดิมที่เหลือได้ ไม่มีการเติมจำนวนใบเสร็จจนกว่าจะจ่ายสำเร็จ</p>}
        {status.purchaseEligibility === 'SOURCE_REVIEW_REQUIRED' && <p role="status" className="text-sm leading-7 text-gray-600">ข้อมูลการจ่ายเงินเดิมของร้านนี้ยังไม่ตรงกัน ติดต่อทีมงานก่อนเริ่มรายการใหม่</p>}
        {status.purchaseEligibility === 'ENTITLEMENT_REVIEW_REQUIRED' && <p role="status" className="text-sm leading-7 text-gray-600">ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม ติดต่อทีมงานก่อนจ่ายเงิน</p>}
        {status.refundReviewPending && <p role="status" className="rounded-xl bg-amber-50 p-3">กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ คำขอนี้ไม่เปลี่ยนสิทธิ์แพ็กเกจเดิม คุณตรวจรายการเดิมด้านล่าง หรือ <a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมมั่งมี</a> ได้</p>}
        </>}
        {promotionBlock && !pending?.showsReservedPromotion && <section role="status" aria-label="สถานะโปรโมชั่น" className="space-y-1 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">{promotionBlock.title}</p>
          {promotionBlock.lines.map(line => <p key={line} className="break-words text-sm leading-7">{line}</p>)}
        </section>}
        {applyReview && <p><a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมงานมั่งมี</a>เพื่อตรวจสอบรายการจ่ายเงิน</p>}
        {/* A paid advance deal applies on its start date: it is never told to contact the team (the contact line is in the block of an unpaid payment only). */}
        {pending && pendingShown && !pendingLeads && !heldShop && pendingSection(status, pending)}
        {/* R10: the offer is the first card behind this button, so the button itself has to say so —
            a locked shop with a three-day deal must not have to guess that "เลือกแพ็กเกจ" holds it. */}
        {!returnFocused && cardRenewalRunning(status) && <p>ตัดบัตรอัตโนมัติ <span className="whitespace-nowrap">{date(status.nextChargeAt)}</span></p>}
        {!returnFocused && status.allowedActions.includes('new_sales') && !pending?.inFlight && !status.renewalInvoiceUrl && pending?.kind !== 'FAILED' && <ActionGroup>
          {purchaseActions}
        </ActionGroup>}
        {!returnFocused && status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <button className={billingPrimaryControl} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate(status.renewalInvoiceUrl!, 'document'))}>จ่ายบิลงวดนี้</button>}
        {!returnFocused && quietBlock && <div><p role="note" className="break-words text-sm leading-7 text-gray-600">{quietBlock}</p>{quietBlock.includes('ติดต่อทีมงาน') && contactLinks}</div>}
        {/* Support information, not a step: the very last thing in the card. */}
        {supportReference && !confirmed && <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">เลขอ้างอิงสำหรับแจ้งทีมงาน</summary><p className="break-all">{supportReference}</p></details>}
      </section>
      </>}
      {(purchasing || status.capacityRepair) && <div ref={backNavigation} hidden={recipientOpen > 0} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-6">
      {!status.capacityRepair && <ThemedSteps aria-label="ขั้นตอนซื้อแพ็กเกจ" steps={['แพ็กเกจ', 'วิธีจ่าย', 'จ่าย'].map((label, index) => ({ key: String(index), label, state: index === (capacity ? 0 : buyingStep) ? 'current' : index < (capacity ? 0 : buyingStep) ? 'done' : 'upcoming' }))} />}
        {status.capacityRepair && !capacity && <h2 className="text-xl font-bold">ตรวจสอบสิทธิ์จากรายการจ่ายเงิน</h2>}
      {capacityNotice && status.attemptId && <p role="status">{capacityNotice}</p>}
      {status.capacityRepair && !capacity && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>จ่ายสำเร็จแล้ว แต่ข้อมูลสาขาหรือผู้ใช้เปลี่ยน เลือกสิทธิ์ล่าสุดเพื่อเปิดใช้งานจากรายการเดิม</p>
        <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { const repair = status.capacityRepair!; setCapacity({ options: await api.capacity(repair.offerKey, repair.interval), billingEmail: recipientEmail, repair, key: crypto.randomUUID() }); })}>เลือกสิทธิ์สำหรับรายการที่จ่ายแล้ว</button></section>}
      {capacity && <BillingCapacityPicker key={capacity.options.sourceHash + capacity.key} options={capacity.options} initialSelection={capacity.initialSelection} repair={!!capacity.repair} scheduledAt={capacity.scheduledAt} currentTierKey={status.tierKey} currentInterval={status.interval} onCancel={selection => { if (!capacity.repair) capacityDraft.current = { ...capacity, initialSelection: selection }; setCapacity(null); setBuyingStep(0); }}        onRefresh={async () => { const latest = await api.status(), options = await api.capacity(capacity.options.offerKey, capacity.options.interval);
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
        {cadenceNotice && <div ref={cadenceNoticeRef} tabIndex={-1} role="status" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-3 rounded-xl bg-amber-50 p-4">
          <p>{cadenceNotice === 'pending' ? 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป ตรวจสอบและยกเลิกรายการนั้นก่อนซื้อรายปี' : 'หากต้องการเพิ่มระดับและเปลี่ยนรอบจ่าย ให้เพิ่มระดับในรอบเดิมก่อน แล้วจึงเลือกรอบจ่ายใหม่ ระบบจะแสดงยอดให้ตรวจสอบแยกแต่ละรายการ'}</p>
          <button className={button} onClick={() => { if (cadenceNotice === 'pending') { setChoosing(false); setSection('payment'); } else { setInterval(status.interval!); setBuyingStep(0); } setCadenceNotice(false); }}>{cadenceNotice === 'pending' ? 'ดูรายการเปลี่ยนแพ็กเกจ' : `เลือกแพ็กเกจ${status.interval === 'year' ? 'รายปี' : 'รายเดือน'}`}</button>
        </div>}        {/* Sales-event spec §8 / SD-O12 / SD-O13: the holder's discounts sit above the list, the best one chosen; one per payment. */}

      {status.allowedActions.includes('new_sales') && buyingStep === 0 && !capacity && <section className="space-y-4 pb-64 sm:pb-32" aria-label="เลือกแพ็กเกจ">
        {catalogUnavailable && <p role="status">ยังตรวจสอบราคาปัจจุบันไม่ได้ ลองอีกครั้ง คุณยังดูประวัติและจัดการรายการเดิมได้</p>}
        {/* R10: the deal is the first card, above the catalog, and the catalog stays selectable. */}
        {deal && <section aria-label="ข้อเสนอพิเศษสำหรับร้านคุณ" className="mangmee-card space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold">ข้อเสนอพิเศษสำหรับร้านคุณ</h3>
            <MangmeeBadge tone="brand">ข้อเสนอพิเศษ</MangmeeBadge>
          </div>
          <p className="font-bold">{deal.baseLabel.replace(PLAN_TIER_PRESETS[deal.base].labelTh, shopPlanTierLabel(deal.base))}</p>
          <p className="text-2xl font-bold text-brand-800">{money(deal.priceSatang)}</p>
          <p>{deal.autoRenew ? `ราคานี้${deal.cadence === 'year' ? 'ทุกปี' : 'ทุกเดือน'}` : `รวม ${deal.months} เดือน`}</p>
          <p>{deal.branchLimit} สาขา · {deal.employeeLimit} ผู้ใช้ · {deal.monthlySlipLimit.toLocaleString('th-TH')} ใบต่อเดือน</p>
          {dealMenuLabels(deal.featureKeys).length > 0 && <p>เมนูที่ได้: {dealMenuLabels(deal.featureKeys).join(' · ')}</p>}
          <p>{deal.creditScope === 'CHAT' ? `เครดิต AI ${dealAiCreditText(deal.aiMonthlyBudgetSatang, 'CHAT')}` : `เพดาน AI รวม: ${dealAiCreditText(deal.aiMonthlyBudgetSatang)}`}</p>
          {deal.creditScope === 'CHAT' && <p className="text-sm text-gray-600">หากร้านมีค่าเครดิตพิเศษที่ผู้ดูแลตั้งไว้ จะคงค่านั้น</p>}
          {deal.description && <p className="text-sm text-gray-600">{deal.description}</p>}
          <p className="text-sm text-gray-600">ใช้ได้ถึง {date(deal.offerExpiresAt)}</p>
          {/* S37: both one-time gates closed means nobody can pay this offer on the web today. */}
          {!chosenDealMode ? <p role="status" className="rounded-xl bg-amber-50 p-4">ติดต่อทีมงานเพื่อจ่ายข้อเสนอนี้ โทร {PLAN_TERM_RENEW_PHONE}</p> : <>
            <p className="text-sm text-gray-600">{deal.autoRenew ? 'ต่ออายุอัตโนมัติ' : 'จ่ายครั้งเดียว'}</p>
            <button className="mangmee-btn mangmee-btn-secondary" onClick={() => { setSelectedDeal(true); setSelectedOffer(deal.base); setInterval(deal.autoRenew && deal.cadence === 'year' ? 'year' : 'month'); setPurchaseMode(chosenDealMode); setBuyingStep(1); }}>เลือกข้อเสนอนี้</button>
          </>}
        </section>}
        {deal && <h3 className="text-lg font-bold">หรือเลือกแพ็กเกจปกติ</h3>}
        <div className="mangmee-segmented" role="group" aria-label="รอบจ่าย">{(['month', 'year'] as const).map(value => <button key={value} className={`mangmee-tab ${interval === value ? 'mangmee-tab-active' : ''}`} disabled={busy} aria-busy={busy} aria-pressed={interval === value} onClick={() => { setInterval(value); setQuote(null); setAccepted(false); setCapacity(null); setCadenceNotice(false); }}>{value === 'month' ? 'รายเดือน' : annualSaving ? 'รายปี · ฟรี 2 เดือน' : 'รายปี'}</button>)}</div>
        {/* Promotion spec Q4: the ONE benefit of this purchase — the promotion, a held discount, or neither. The notes about a discount this shop cannot use stay separate from the choice. */}
        {eventDiscountBlockedText(status.eventDiscount).length > 0 && <p role="note" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7">
          {eventDiscountBlockedText(status.eventDiscount).map(line => <span key={line} className="block break-words">{line}</span>)}</p>}
        {eventDiscountUsable(status.eventDiscount) && !ticketView && <div role="note" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm leading-7"><p className="break-words">{eventDiscountMode('CARD_AUTO', status.purchaseSource) ? `มีส่วนลดจากงาน ${status.eventDiscount.eventName} เลือกวิธีจ่ายแล้วตรวจยอดก่อนจ่าย` : eventDiscountOneTimeOnlyText(status.eventDiscount)}</p>
          {availableModes.some(mode => eventDiscountMode(mode)) && <button type="button" className={button} onClick={() => { setPurchaseMode(availableModes.find(mode => eventDiscountMode(mode))!); setQuote(null); setCapacity(null); }}>เลือกจ่ายครั้งเดียว</button>}</div>}
        {(promotionChoice || ticketView) && <section aria-label={choiceCopy.section} className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <fieldset className="min-w-0 space-y-2"><legend className="font-semibold">{choiceCopy.legend}</legend>
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
        <div ref={offerChoices} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-2"><h3 className="font-semibold">แพ็กเกจ</h3>
          {choiceError === 'offer' && <FieldError>เลือกแพ็กเกจก่อน</FieldError>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="แพ็กเกจ">{data.catalog.offers.filter(offer => offer.interval === interval).map(offer => {
          const current = status.accessState === 'ACTIVE' && status.tierKey === offer.offerKey && status.interval === offer.interval;
          const packageChangeUnavailable = status.packageChangesEnabled === false && status.paidThrough && Date.parse(status.paidThrough) > Date.now() &&
            (status.renewalMode === 'CARD_ONCE' || status.renewalMode === 'PROMPTPAY_ONCE') && (status.tierKey !== offer.offerKey || status.interval !== offer.interval);
          // Read the offer's actual snapshot so the card matches what checkout grants.
          const baseFeatures = data.catalog.offers.find(item => item.offerKey === 'STARTER_249' && item.interval === interval)?.featureKeys ?? [];
          const menus = dealMenuLabels(offer.featureKeys).filter(label => !dealMenuLabels(baseFeatures).includes(label)).map(label => label.includes('ภ.ง.ด.') ? 'ภาษีหัก ณ ที่จ่าย' : label.includes('50 ทวิ') ? '50 ทวิ' : label);
          // Promotion spec Q4: a card takes the benefit the buyer picked where it fits, else a normal purchase (never another benefit);
          // with no pick, the promotion it has, else the held discount that lowers it.
          const promo = offer.availability === 'AVAILABLE' ? promotionRow(status.promotions, offer) : undefined, promoCard = promo?.available ? promotionCard(promo, offer) : null;
          const ticketLine = chosenMode && eventDiscountMode(chosenMode, status.purchaseSource) ? eventDiscountCard(status.eventDiscount, offer, chosenEventSerial) : null;
          const cardBenefit = promotionCardBenefit(benefitPick, offered, { PROMOTION: !!promoCard, EVENT_DISCOUNT: !!ticketLine });
          const eventCard = cardBenefit === 'EVENT_DISCOUNT' ? ticketLine : null;
          // Promotion spec Q5: an immediate upgrade is held back until `upgradeDeferredUntil`; the card says when instead of offering it.
          const upgradeNote = promotionUpgradeNote(status, offer);
          return <label key={offer.offerKey} className={`relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border-2 p-4 ${selectedOffer === offer.offerKey && !selectedDeal ? 'border-brand-700 bg-brand-50' : 'border-gray-200'}`}>
          {current && <MangmeeBadge className="absolute -top-3 right-4 border">แพ็กเกจปัจจุบัน</MangmeeBadge>}
          <h3 className="font-bold">{shopPlanTierLabel(offer.offerKey)}</h3><p className="text-xl font-bold"><span className="whitespace-nowrap">{(offer.priceSatang / 100).toLocaleString('th-TH')} บาท / {interval === 'month' ? 'เดือน' : 'ปี'}</span></p>
          {promoCard && <section aria-label={`โปรโมชั่น ${shopPlanTierLabel(offer.offerKey)}`} className={`space-y-1 rounded-xl border p-3 ${cardBenefit === 'PROMOTION' ? 'border-brand-300 bg-brand-50' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">{promoCard.name}</p><p className="text-lg font-bold">{promoCard.headline}</p>
            {promoCard.lines.map(line => <p key={line} className="text-sm [overflow-wrap:anywhere]">{line}</p>)}
            {cardBenefit !== 'PROMOTION' && <p className="text-sm font-semibold">{PROMOTION_NOT_PICKED}</p>}</section>}
          {/* A promotion that cannot be used says why, and never closes the normal purchase below. */}
          {promo && !promo.available && <p role="note" className="break-words text-sm text-gray-600">{promotionReasonText(promo.reason)}</p>}
          {eventCard && <p className="text-sm font-semibold text-brand-700 [overflow-wrap:anywhere]">{eventDiscountCardText(eventCard.eventName, eventCard.shownDiscountSatang)}</p>}
          {data.catalog.taxTreatment === 'EXCLUSIVE_VAT_7' && <p className="text-sm text-gray-600">ราคายังไม่รวม VAT 7%</p>}
          <p>{offer.branchLimit} สาขา · {offer.employeeLimit} คน · {offer.monthlySlipLimit.toLocaleString('th-TH')} ใบต่อเดือน</p>
          {menus.length > 0 && <p className="text-sm text-gray-600">{menus.join(' / ')}</p>}
          {offer.availability === 'COMING_SOON' && <p className="text-sm text-gray-600">แพ็กเกจนี้ยังไม่เปิดรับเงิน</p>}
          <span className="mt-auto flex min-h-11 items-center gap-3">
            <input type="radio" name="offer" aria-label={`เลือก ${shopPlanTierLabel(offer.offerKey)}`} value={offer.offerKey} checked={selectedOffer === offer.offerKey && !selectedDeal} disabled={!!packageChangeUnavailable || !!upgradeNote || offer.availability !== 'AVAILABLE' || busy} aria-busy={busy}
              onChange={() => { setSelectedDeal(false); setSelectedOffer(offer.offerKey); setQuote(null); setAccepted(false); setChoiceError(null); }} />เลือก {shopPlanTierLabel(offer.offerKey)}
          </span>
          {packageChangeUnavailable && <p className="text-sm text-gray-500">{errorText({ code: 'BILLING_REPEAT_NOT_READY' })}</p>}
          {upgradeNote && <p role="note" className="break-words text-sm text-gray-600">{upgradeNote}</p>}
        </label>; })}</div>
        <p className="text-sm text-gray-600">นับเฉพาะใบเสร็จที่อ่านได้ พร้อม {(DEFAULT_CHAT_CREDIT_SATANG / 100).toLocaleString('th-TH')} เครดิตสำหรับคุยกับผู้ช่วยต่อเดือน</p>
      </section>}
      {buyingStep === 1 && !capacity && <section aria-label="วิธีจ่าย" className="space-y-5 pb-64 sm:pb-32">
        <fieldset ref={modeChoices} disabled={busy} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] min-w-0 space-y-4"><legend className="font-semibold">จ่ายแบบไหน</legend>
          {choiceError === 'mode' && <FieldError>เลือกวิธีจ่ายก่อน</FieldError>}
          <div className="grid gap-3 sm:grid-cols-2">{(['auto', 'once'] as const).map(value => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 p-4 ${renewalKind === value ? 'border-brand-700' : 'border-gray-200'}`}><input type="radio" name="renewalChoice" value={value} checked={renewalKind === value} onChange={() => selectMethod(value, paymentKind)} />{value === 'auto' ? 'ต่ออายุอัตโนมัติ' : 'จ่ายครั้งเดียว'}</label>)}</div>
          <fieldset className="min-w-0 space-y-3"><legend className="font-semibold">จ่ายด้วย</legend><div className="grid gap-3 sm:grid-cols-2">{(['qr', 'card'] as const).map(value => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 p-4 ${paymentKind === value ? 'border-brand-700' : 'border-gray-200'}`}><input type="radio" name="paymentChoice" value={value} checked={paymentKind === value} onChange={() => selectMethod(renewalKind, value)} />{value === 'qr' ? 'QR พร้อมเพย์' : 'บัตร'}</label>)}</div></fieldset>
          {chosenMode === 'PROMPTPAY_RENEW' && <p className="text-sm text-gray-600">ส่งบิล QR ให้สแกนจ่ายทุก{interval === 'year' ? 'ปี' : 'เดือน'}</p>}
          {modeReason && <p role="status">{modeReason} <a className="text-brand-700 underline" href={`tel:${PLAN_TERM_RENEW_PHONE.replaceAll('-', '')}`}>ติดต่อทีมงานมั่งมี</a></p>}
          {consent}
        </fieldset>
      </section>}
      {buyingStep < 2 && !capacity && status.allowedActions.includes('new_sales') && <FormActionBar><ActionGroup>
        <button className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy} onClick={goBack}>กลับ</button>
        <button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => { if (modeReason && buyingStep === 1) { setChoiceError('mode'); return; } return reviewSelection(); }}>ถัดไป</button>
      </ActionGroup></FormActionBar>}
      {quote && buyingStep === 2 && <section aria-label="ตรวจก่อนจ่าย" className="space-y-5 pb-64 sm:pb-32">
        <h2 ref={quoteHeading} tabIndex={-1} className="text-lg font-bold">ตรวจก่อนจ่าย</h2>
        <MetricGrid items={[{ key: 'total', label: 'ยอดที่จ่ายวันนี้', value: money((quote.eventDiscount?.applied ?? quote).totalSatang).replace(' บาท', ''), unit: 'บาท', dot: 'bg-brand-500' }]} />
        {/* Promotion spec §3: the paid period, the free time, the receipts and the next round — all from the quote, all estimates until payment is confirmed. */}
        {promoReview && <section aria-label="โปรโมชั่นที่ใช้ในรายการนี้" className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="break-words font-semibold text-brand-800">{promoReview.title}</p>
          <dl className="grid gap-3 sm:grid-cols-2">{promoReview.rows.map(row => <div key={row.label}><dt className="text-sm text-gray-600">{row.label}</dt><dd className="break-words font-semibold">{row.value}</dd></div>)}</dl>
          {promoReview.next && <p className="break-words font-semibold">{promoReview.next}</p>}
          <p className="text-sm text-gray-600">{promoReview.estimate}</p>
        </section>}
        <dl className="grid gap-4 sm:grid-cols-2" aria-label="รายละเอียดแพ็กเกจที่จ่าย">
          <div><dt>แพ็กเกจ</dt><dd className="font-semibold">{shopPlanTierLabel(quote.offer.offerKey)} · {quote.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}</dd></div>
          <div><dt>{repeatReview || quote.purchase?.kind === 'UPGRADE' ? 'อ่านใบเสร็จได้เพิ่ม' : 'อ่านใบเสร็จได้'}</dt><dd>{(promoReview?.totalReceiptUnits ?? quote.purchase?.receiptUnitsAdded ?? quote.offer.receiptAllowance).toLocaleString('th-TH')} ใบ{repeatReview || quote.purchase?.kind === 'UPGRADE' ? '' : promoReview || dealQuote ? 'ในแพ็กเกจนี้' : quote.offer.interval === 'year' ? 'ต่อปี' : 'ต่อเดือน'}</dd></div>
          <div><dt>จ่ายด้วย</dt><dd>{billingPurchaseModeLabel(quote.purchaseMode!)}</dd></div>
          <div><dt>ใช้ได้ถึง</dt><dd>{repeatReview && <><span className="whitespace-nowrap">{date(quote.purchase?.previousPaidThrough)}</span> → </>}<span className="whitespace-nowrap">{date(promoReview?.benefitEnd ?? quote.advanceDeal?.firstCycleEndsAt ?? quote.purchase?.projectedPaidThrough)}</span></dd></div>
        </dl>
        {!repeatReview && <p className="text-sm text-gray-600">{quote.offer.branchLimit} สาขา · {quote.offer.employeeLimit} คน รวม{THAI_SYSTEM_ROLE_NAMES.OWNER}</p>}
        {repeatReview && <p className="text-sm text-gray-600">สิทธิ์คงเดิม: สูงสุด {quote.offer.branchLimit} สาขา · {quote.offer.employeeLimit} ผู้ใช้ รวม{THAI_SYSTEM_ROLE_NAMES.OWNER}</p>}
        {repeatReview && !oneTimeQuote && renewalDate && <p>{quote.purchaseMode === 'CARD_AUTO' ? 'ตัดบัตรครั้งถัดไป' : 'ออกบิลครั้งถัดไป'} <span className="whitespace-nowrap">{date(renewalDate)}</span></p>}
        {dealQuote && <p className="rounded-xl bg-brand-50 p-4 text-brand-800">ข้อเสนอพิเศษ · {autoDeal ? dealConfirmText(autoDeal) : `จ่ายครั้งเดียว ไม่มีหักอัตโนมัติ · ใช้ได้ ${dealQuote.months} เดือน`}{dealQuote.description ? ` · ${dealQuote.description}` : ''}</p>}
        {quote.advanceDeal && <section aria-label="กำหนดการเริ่มดีลล่วงหน้า" className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="font-semibold">จ่ายดีลงวดแรกวันนี้ · สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง {date(quote.advanceDeal.startsAt)}</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-sm text-gray-600">วันเริ่มสิทธิ์ดีล</dt><dd className="font-semibold">{date(quote.advanceDeal.startsAt)}</dd></div>
            <div><dt className="text-sm text-gray-600">งวดแรกสิ้นสุด</dt><dd className="font-semibold">{date(quote.advanceDeal.firstCycleEndsAt)}</dd></div>
            <div><dt className="text-sm text-gray-600">{quote.purchaseMode === 'PROMPTPAY_RENEW' ? 'ออกบิล QR รอบถัดไป' : 'เก็บเงินรอบถัดไป'}</dt><dd className="font-semibold">{date(quote.advanceDeal.nextChargeAt)}</dd></div>
          </dl>
          <p>สิทธิ์และจำนวนใบเสร็จของดีลจะเริ่มในวันเริ่มสิทธิ์ดีล</p>
        </section>}
        {!promoReview && <>{documentBox(quote, status)}{discountBox(quote)}</>}
        {(quote.eventDiscount?.applied ?? quote).taxSatang > 0 && <p>ราคาก่อนภาษี <span className="whitespace-nowrap">{money((quote.eventDiscount?.applied ?? quote).subtotalSatang)}</span> · ภาษี <span className="whitespace-nowrap">{money((quote.eventDiscount?.applied ?? quote).taxSatang)}</span></p>}
        {quote.taxTreatment !== 'NOT_VAT_REGISTERED' && <p>{quote.taxTreatment === 'INCLUSIVE_VAT_7' ? 'ราคารวม VAT 7% แล้ว' : 'ราคาเพิ่ม VAT 7%'}</p>}
        {promoReview && <>{discountBox(quote)}{documentBox(quote, status)}</>}
        {quote.purchase?.kind === 'UPGRADE' ? <div className="space-y-2"><p>จ่ายส่วนต่างและเริ่ม {quoteLabel} เมื่อยืนยันการจ่ายสำเร็จ วันหมดอายุคงเดิม {date(quote.purchase.projectedPaidThrough)} เพิ่ม {quote.purchase.receiptUnitsAdded} ใบ รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts} ใบ</p><p>{quote.purchaseMode === 'CARD_AUTO' ? 'ยอดต่ออายุรอบถัดไป' : 'ราคาเต็มเมื่อซื้อรอบใหม่'} {money(quote.upgrade!.nextRenewalTotalSatang)}</p>{(quote.purchaseMode === 'CARD_ONCE' || quote.purchaseMode === 'PROMPTPAY_ONCE') && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, recipientEmail, undefined, quote.purchaseMode, undefined, 'FULL_PACKAGE'); })}>ดูทางเลือกซื้อ {quoteLabel} เต็มแพ็ก {money(quote.upgrade!.nextRenewalTotalSatang)}</button>}<details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">รายละเอียดส่วนต่าง</summary><p>คำนวณส่วนต่าง ณ {date(quote.upgrade!.prorationAt)} · จำนวนคงเหลือเปลี่ยนตามการใช้งานระหว่างจ่าย</p><ul className="space-y-1">{quote.upgrade!.segments.map((segment,index)=><li key={index}>{date(segment.start)} ถึง {date(segment.end)}: {money(segment.amountSatang)} · เพิ่ม {segment.receiptUnitsAdded} ใบ</li>)}</ul></details></div> : quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? <div className="space-y-2"><p>ซื้อ {quoteLabel} เต็มแพ็กเพิ่มจากแพ็กเดิม จ่ายราคาเต็ม {money(quote.totalSatang)} ไม่หักค่าแพ็กเดิม เริ่มสิทธิ์แพ็กใหม่และเพิ่มจำนวนใบเสร็จเต็ม {quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบทันทีหลังจ่ายสำเร็จ</p><p>รวมคงเหลือประมาณ {quote.purchase.projectedRemainingReceipts.toLocaleString('th-TH')} ใบ (รวมยอดเดิมที่ยังใช้ได้) · วันหมดอายุใหม่ {date(quote.purchase.projectedPaidThrough)} · ยอดจริงขึ้นกับการใช้งานระหว่างจ่าย</p><button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => action(async () => { await requestQuote(quote.offer.offerKey, quote.offer.interval, recipientEmail, undefined, quote.purchaseMode); })}>กลับไปดูราคาอัปเกรดจ่ายส่วนต่าง</button></div> : quote.purchase?.kind === 'SCHEDULED_CHANGE' ? <div className="space-y-2"><p>จ่ายแพ็กเกจเต็มล่วงหน้า สิทธิ์เดิมยังใช้ได้ถึง {date(quote.purchase.previousPaidThrough)} จากนั้นเริ่ม {quoteLabel} และรับใบเสร็จ {quote.purchase.receiptUnitsAdded.toLocaleString('th-TH')} ใบ</p><p>แพ็กเกจรอบใหม่ใช้ได้ถึง {date(quote.purchase.projectedPaidThrough)} ไม่มีการตัดเงินงวดถัดไป</p></div> : quote.purchase?.kind === 'REPEAT' ? <p className="text-sm text-gray-600">หลังซื้อคงเหลือประมาณ {promotionReceipts(quote).projected.toLocaleString('th-TH')} ใบ รวมจำนวนใบเสร็จเดิมที่ยังไม่หมดอายุ · ยอดจริงขึ้นกับการใช้งานระหว่างจ่าย</p> : quote.purchase?.kind === 'RESTART' ? <p>เริ่มแพ็กเกจใหม่เมื่อจ่ายสำเร็จ รับ {promoReview?.totalReceiptUnits ?? quote.offer.receiptAllowance} ใบ วันและจำนวนใบเสร็จที่หมดอายุไปแล้วไม่ทบ ประวัติจ่ายเงินเดิมยังดูได้</p> : <div className="space-y-2">
          {quote.purchase?.trialCarryover && <div aria-label="จำนวนใบเสร็จที่อ่านได้หลังจ่าย" className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
            <p>อ่านใบเสร็จได้ประมาณ {promotionReceipts(quote).projected.toLocaleString('th-TH')} ใบ ({promotionReceipts(quote).packageUnits.toLocaleString('th-TH')} ใบของแพ็กเกจ{promoReview && ` รวมแถม ${promotionReceipts(quote).bonus.toLocaleString('th-TH')} ใบ`} + {quote.purchase.trialCarryover.receiptUnits.toLocaleString('th-TH')} ใบที่เหลือจากช่วงทดลอง{quote.purchase.projectedRemainingReceipts > quote.offer.receiptAllowance + quote.purchase.trialCarryover.receiptUnits && ` + ${(quote.purchase.projectedRemainingReceipts - quote.offer.receiptAllowance - quote.purchase.trialCarryover.receiptUnits).toLocaleString('th-TH')} ใบที่เพิ่มไว้และยังใช้ได้`})</p>
            <p className="text-gray-600">จำนวนที่เหลือจากช่วงทดลองใช้ได้ถึง {date(quote.purchase.trialCarryover.expiresAt)} · จำนวนจริงขึ้นกับการใช้งานระหว่างจ่าย</p>
          </div>}
          {quote.previousSource === 'ADMIN_MANUAL' ? <p>เริ่มแพ็กเกจใหม่เมื่อจ่ายสำเร็จ แพ็กเกจเดิมที่ผู้ดูแลให้ไว้ถึง {date(quote.previousTermEndsAt)} จะถูกแทนที่ วันคงเหลือ (ถ้ามี) ไม่ทบและไม่ลดราคา รับใบเสร็จใหม่ {(promoReview?.totalReceiptUnits ?? quote.offer.receiptAllowance).toLocaleString('th-TH')} ใบ</p>
            : quote.previousSource === 'NO_TERM' ? null
            /* An auto-renewing deal opens ONE cycle per payment, so its snapshot `months` — which
               the deal itself ignores — must not be read as the term: the offer's interval is. */
            : quote.advanceDeal ? <p>จ่ายงวดแรกวันนี้ ใช้แพ็กเกจปัจจุบันต่อถึง {date(quote.advanceDeal.startsAt)} แล้วจึงเริ่มดีลและรับใบเสร็จ {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</p>
              : promoReview ? null
              : !quote.purchase?.projectedPaidThrough ? <p>เมื่อจ่ายแล้ว รับใบเสร็จ {quote.offer.receiptAllowance.toLocaleString('th-TH')} ใบ</p> : null}
          {quote.purchase?.kind === 'INITIAL' && quote.trialEndsAt && <p className="text-sm text-gray-600">การทดลองใช้จะสิ้นสุดเมื่อจ่ายสำเร็จ วันทดลองที่เหลือจะไม่บวกเพิ่มในแพ็กเกจนี้</p>}
        </div>}
        {/* Per-tier menu sets make this list long in both directions, so what is gained is read the
            same way as what is lost, and only a package that really takes a menu away warns. */}
        {quote.featureImpact && (quote.featureImpact.removed.length > 0 || quote.featureImpact.added.length > 0 || quote.featureImpact.preservedAdmin > 0) && <section className={`space-y-2 rounded-xl border p-4 ${quote.featureImpact.removed.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`} aria-label={menusMoveLater ? 'การเปลี่ยนสิทธิ์เมนูเมื่อเริ่มแพ็กเกจรอบถัดไป' : 'การเปลี่ยนสิทธิ์เมนูหลังจ่าย'}>
          <p className="font-semibold">{menusMoveLater ? `สิทธิ์เมนูตั้งแต่ ${menusMoveLater}` : 'สิทธิ์เมนูเมื่อจ่ายสำเร็จ'}</p>
          {quote.featureImpact.removed.length > 0 && <><p>{menusMoveLater ? `เมนูต่อไปนี้จะหยุดใช้ตั้งแต่ ${menusMoveLater} โดยข้อมูลเดิมยังเก็บไว้:` : 'เมนูต่อไปนี้จะหยุดใช้หลังจ่าย โดยข้อมูลเดิมยังเก็บไว้:'}</p><ul className="list-disc space-y-1 break-words pl-6">{quote.featureImpact.removed.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
          {quote.featureImpact.added.length > 0 && <><p>{menusMoveLater ? `เมนูที่จะเปิดใช้เพิ่มตั้งแต่ ${menusMoveLater}:` : 'เมนูที่จะเปิดใช้เพิ่มหลังจ่าย:'}</p><ul className="list-disc space-y-1 break-words pl-6">{quote.featureImpact.added.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
          {quote.featureImpact.preservedAdmin > 0 && <p>สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะร้านนี้ยังคงอยู่</p>}
        </section>}
        {quote.pendingPlanChange && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>รายการเปลี่ยนเป็น {shopPlanTierLabel(quote.pendingPlanChange.offer.offerKey)} ({quote.pendingPlanChange.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}) จะมีผลจาก {date(quote.pendingPlanChange.oldEffectiveAt)} เป็น {date(quote.pendingPlanChange.newEffectiveAt)}</p><p>ยอดต่ออายุหลังวันนั้น {money(quote.pendingPlanChange.totalSatang)} · คงสาขา {quote.pendingPlanChange.capacity.retainedBranches.join(', ')} · คงผู้ใช้ {quote.pendingPlanChange.capacity.retainedMembers.join(', ')}</p><p>ซื้อสำเร็จจึงยืนยันวันเปลี่ยนใหม่ หากจ่ายไม่สำเร็จคำสั่งเดิมคงอยู่</p></div>}
        {initialPurchaseReview && !oneTimeQuote && !promoReview && renewalDate && <p>{quote.purchaseMode === 'CARD_AUTO' ? 'ตัดบัตรครั้งถัดไปโดยประมาณ' : 'ออกบิลครั้งถัดไปโดยประมาณ'} <span className="whitespace-nowrap">{date(renewalDate)}</span></p>}
        {quote.purchaseMode === 'PROMPTPAY_RENEW' ? <p>ระบบออกบิลทุก{renewalCadence} ต้องสแกนจ่ายเอง ไม่มีการหักเงินอัตโนมัติ</p>
          : quote.purchaseMode === 'CARD_ONCE' || quote.purchaseMode === 'PROMPTPAY_ONCE' ? <p>จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป</p>
          : initialPurchaseReview ? <p>เลือกบัตรที่หน้าจ่ายเงิน บัตรใบนั้นจะใช้ต่ออายุอัตโนมัติทุก{renewalCadence}</p>
          : annualConversion ? <p className="text-sm text-gray-600">จ่ายค่ารายปีเต็มจำนวนครั้งนี้ แล้วหยุดตัดเงินรายเดือน ไม่มีการตัดเงินต่ออายุก่อนวันหมดอายุใหม่ ปิดการต่ออายุอัตโนมัติได้โดยยังใช้เวลาที่จ่ายไว้ได้ครบ</p>
          : <p>ต่ออายุอัตโนมัติทุก{(quote.pendingPlanChange?.offer.interval ?? quote.offer.interval) === 'year' ? 'ปี' : 'เดือน'}ตามแพ็กเกจ ยกเลิกมีผลสิ้นรอบ</p>}        {quote.capacity && <div className="space-y-1 rounded-xl bg-amber-50 p-3"><p>เมื่อเริ่มแพ็กเกจใหม่ คงสาขา: {quote.capacity.retainedBranches.join(', ')} · พักสาขา: {quote.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p>
          <p>คงผู้ใช้: {quote.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {quote.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p>
          {quote.capacity.defaults.map((item,index) => <p key={index}>สาขาเริ่มต้นของ {item.member}: {item.branch ?? 'เลือกเมื่อเข้าใช้งาน'}</p>)}<p>ข้อมูลและประวัติยังอยู่ครบ ระบบตรวจสิทธิ์อีกครั้งก่อนเปิดใช้งาน</p></div>}
        {quote.purchaseMode === 'CARD_AUTO' && status.allowedActions.includes('portal_payment_method') && <button className={`${button} w-full sm:w-56`} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate((await api.portal()).url, 'portal'))}>จัดการบัตรที่ใช้ต่ออายุ</button>}
        {!accepted && consent}
        {/* A stale catalog does not stop a deal: its price is the approved snapshot's, not a row's. */}
        {quoteExpired ? <div role="status" className="space-y-3 rounded-xl bg-amber-50 p-4"><p>ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่</p>
          </div> : null}
      </section>}
      {quote && buyingStep === 2 && <FormActionBar summary={<>
        <p className="text-sm leading-6">กดจ่ายเพื่อเปิดหน้า{quote.purchaseMode?.startsWith('CARD') ? 'จ่ายด้วยบัตร' : 'จ่ายด้วย QR พร้อมเพย์'}</p>
        <p className="text-sm leading-6">กดจ่าย คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง <Link className="whitespace-nowrap text-brand-700 underline" href="/terms" target="_blank" rel="noopener noreferrer">ข้อกำหนดการใช้งาน</Link></p>
      </>}><ActionGroup>
        <button className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy} onClick={goBack}>กลับ</button>
        {quoteExpired ? <button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => void requoteSame()}>ตรวจสอบราคาใหม่</button>
        : <button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={Boolean(busy)} onClick={() => {
          if (!oneTimeQuote && !accepted) { setConsentError(true); consentGroup.current?.scrollIntoView({ block: 'center' }); consentInput.current?.focus({ preventScroll: true }); return; }
          return action(async navigate => {
            const params = new URLSearchParams(window.location.search);
            if (quoteExpired || Date.parse(quote.expiresAt) <= Date.now()) return;
            const result = await api.checkout({ quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: params.get('channel') === 'line' ? 'line' : 'web' }, key.current);
            // Navigation breadcrumb only: the next quote still validates price, mode and consent.
            try { window.sessionStorage.setItem(`billing-selection:${companyId}:${result.attemptId}`, JSON.stringify({ offer: quote.offer.offerKey, interval: quote.offer.interval, purchaseMode: quote.purchaseMode, ...(dealQuote ? { dealId: dealQuote.dealId } : {}), ...(quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? { purchaseIntent: 'FULL_PACKAGE' } : {}) })); } catch { /* Storage is optional. */ }
            if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout');
            // The quote was spent on the refused attempt: back to the chooser, which stays open.
            else if (result.state === 'FAILED') { setQuote(null); setBuyingStep(0); setAccepted(false); setError('ยังเปิดหน้าจ่ายเงินไม่ได้ ตรวจสอบราคาใหม่แล้วลองอีกครั้ง'); }
            // The reservation stands until Stripe answers: never retry, only look again.
            else if (result.state === 'UNKNOWN') { setQuote(null); setChoosing(false); setCheckoutCancelNotice({ text: 'กำลังตรวจกับผู้ให้บริการรับเงินว่าหน้าจ่ายเงินถูกสร้างหรือไม่ รอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่', checking: true }); setReload(value => value + 1); }
            else { setQuote(null); setChoosing(false); setReload(value => value + 1); }
          });
        }}>{busy ? 'กำลังตรวจสอบ…' : `จ่าย ${money((quote.eventDiscount?.applied ?? quote).totalSatang)}`}</button>}
      </ActionGroup></FormActionBar>}
      </div>}
      {!purchasing && <section id="billing-history" aria-label="ประวัติการจ่ายเงิน" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] mangmee-card space-y-4 p-5 sm:p-6"><h2 className="text-lg font-bold">ประวัติและเอกสารการจ่ายเงิน</h2>
        {historyLoading && <p role="status">กำลังโหลดประวัติการจ่ายเงิน…</p>}
        {historyError && <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-4"><p>โหลดประวัติการจ่ายเงินไม่สำเร็จ · {historyError}</p>
          <button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async () => { const history = await api.history(historyPosition.cursor, 10); setData(current => current && ({ ...current, history })); setHistoryError(''); })}>ลองโหลดประวัติใหม่</button></div>}
        {!historyLoading && !historyError && data.history.items.length === 0 && <p className="rounded-xl bg-gray-50 p-5 text-gray-500">ยังไม่มีรายการจ่ายเงิน</p>}
        {!historyLoading && !historyError && historyRows.length > 0 && <>
          <table className="hidden w-full text-sm sm:table">
            <thead><tr className="border-b border-gray-100 text-left text-sm text-gray-500"><th className="px-2 py-3">วันที่</th><th className="px-2 py-3">แพ็กเกจ</th><th className="px-2 py-3 text-right">ยอด (บาท)</th><th className="px-2 py-3 text-right">สถานะ</th></tr></thead>
            <tbody>{historyRows.map(invoice => <tr key={invoice.id} role="link" tabIndex={0} aria-label={`เปิดรายการจ่ายเงิน ${invoice.number ?? date(invoice.createdAt)}`}
              className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-700"
              onClick={() => openPayment(invoice.id)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); openPayment(invoice.id); } }}>
              <td className="px-2 py-4"><span className="whitespace-nowrap">{date(invoice.paidAt ?? invoice.createdAt)}</span></td>
              <td className="px-2 py-4"><p className="font-semibold">{invoice.offer ? `${invoice.offer.label} · ${invoice.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}` : 'ยังไม่มีข้อมูลแพ็กเกจ'}</p>
                {invoice.promotion && <p className="mt-1 text-sm text-gray-600">{promotionInvoiceLine(invoice.promotion)}</p>}</td>
              <td className="whitespace-nowrap px-2 py-4 text-right font-semibold tabular-nums">{money(invoice.amountSatang).replace(' บาท', '')}</td>
              <td className="px-2 py-4 text-right"><MangmeeBadge tone={invoice.disputed || invoice.refundedSatang > 0 || invoice.paymentState.toLowerCase() !== 'paid' ? 'amber' : 'brand'}>{billingHistoryStatus(invoice)}</MangmeeBadge>
                {invoice.paymentState.toLowerCase() === 'paid' && invoice.applyState !== 'APPLIED' && <p className="mt-1 text-sm text-gray-500">{invoice.applyState === 'HELD' ? 'ทีมงานกำลังตรวจสอบแพ็กเกจ' : 'กำลังเปิดแพ็กเกจ'}</p>}</td>
            </tr>)}</tbody>
          </table>
          <div className="space-y-3 sm:hidden">{historyRows.map(invoice => <Link key={invoice.id} href={`/companies/${encodeURIComponent(companyId)}/billing/invoices/${encodeURIComponent(invoice.id)}`}
            className="block min-h-11 space-y-2 rounded-xl border border-gray-200 p-4 focus-visible:outline-2 focus-visible:outline-brand-700"
            onClick={event => { if (preview) { event.preventDefault(); openPayment(invoice.id); } else if (billingLeavesPage(event)) rememberHistory(); }}>
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="font-semibold">{invoice.offer ? `${invoice.offer.label} · ${invoice.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}` : 'ยังไม่มีข้อมูลแพ็กเกจ'}</span><span className="whitespace-nowrap font-semibold tabular-nums">{money(invoice.amountSatang)}</span></div>
            <p><span className="whitespace-nowrap">{date(invoice.paidAt ?? invoice.createdAt)}</span></p>
            {invoice.promotion && <p className="text-sm text-gray-600">{promotionInvoiceLine(invoice.promotion)}</p>}
            <MangmeeBadge tone={invoice.disputed || invoice.refundedSatang > 0 || invoice.paymentState.toLowerCase() !== 'paid' ? 'amber' : 'brand'}>{billingHistoryStatus(invoice)}</MangmeeBadge>
            {invoice.paymentState.toLowerCase() === 'paid' && invoice.applyState !== 'APPLIED' && <p className="text-sm text-gray-500">{invoice.applyState === 'HELD' ? 'ทีมงานกำลังตรวจสอบแพ็กเกจ' : 'กำลังเปิดแพ็กเกจ'}</p>}
          </Link>)}</div>
        </>}
        {!historyError && (historyPage > 1 || historyHasNext) && <div aria-busy={historyLoading} className="relative [&>div>span]:invisible">
          <Pagination prominent page={historyPage} totalPages={Math.max(historyPages.length, historyPage + (historyHasNext ? 1 : 0))} onPageChange={changeHistoryPage} />
          {/* Cursor reads do not know the total number of pages. */}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-base font-semibold tabular-nums text-gray-900">หน้า {historyPage}</span>
        </div>}

      </section>}
      <section hidden={purchasing && recipientOpen === 0} id="billing-payment" aria-label="การต่ออายุ" className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-6">
      {purchasing && recipientOpen > 0 && <button className={button} onClick={() => { setRecipientOpen(0); setSection('package'); }}>กลับไปจ่าย</button>}
      <h2 className="text-lg font-bold">การต่ออายุ</h2>
      {status.renewalMode === 'PROMPTPAY_RENEW' && status.renewalInvoiceUrl && <section className="mangmee-card space-y-3 p-5" aria-label="บิล QR รอบปัจจุบัน"><h3 className="text-lg font-bold">บิลพร้อมเพย์รอบปัจจุบัน</h3><p>สแกน QR เพื่อจ่ายบิลเดิม ระบบไม่หักเงินอัตโนมัติ</p><button className={button} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate(status.renewalInvoiceUrl!, 'document'))}>เปิดบิลพร้อมเพย์</button></section>}
      {status.subscriptionState === 'NONE' && !status.collection && !status.pendingPlanChange && <div className="mangmee-card space-y-1 p-5 sm:p-6"><h2 className="text-base font-semibold">ต่ออายุอัตโนมัติ</h2><p className="text-sm text-gray-500">ยังไม่ได้เปิด</p></div>}
      <BillingCollectionPanel key={activeCollectionId ?? 'renewal'} companyId={companyId} status={status} operationId={activeCollectionId} onChange={collectionChanged} apiOverride={preview?.api}
        onEdit={activeCollectionId && capacityDraft.current?.collectionId === activeCollectionId ? () => { if (preview) setPreviewCollectionId(undefined); else router.push(`/companies/${encodeURIComponent(companyId)}/billing`); setCapacity(capacityDraft.current); setChoosing(true); setSection('package'); } : undefined}
        onBack={() => { if (preview) setPreviewCollectionId(undefined); else router.push(`/companies/${encodeURIComponent(companyId)}/billing`); setChoosing(false); setSection('package'); }} />
      {!activeCollectionId && <>
      {status.allowedActions.includes('portal_payment_method') && <section className="mangmee-card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" aria-label="วิธีจ่ายเงิน"><div><h2 className="text-base font-semibold">บัตร</h2></div><button className={`${button} w-full sm:w-56`} disabled={busy} aria-busy={busy} onClick={() => action(async navigate => navigate((await api.portal()).url, 'portal'))}>จัดการบัตร</button></section>}
      <div id="billing-recipient" ref={emailSettings} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-4">
        {bounceBanner}
        <BillingEmailRecipientPanel companyId={companyId} status={status} latestInvoice={latestInvoice} openRequest={recipientOpen} hideEdit={Boolean(paidNotApplied)}
          onChanged={collectionChanged} apiOverride={preview?.api} />
      </div>
      </>}
      </section>
    </>}
    <footer className="space-y-2 border-t border-gray-200 pt-5 text-sm text-gray-500"><p>ต้องการความช่วยเหลือเรื่องแพ็กเกจ</p><div className="flex flex-wrap gap-4"><a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`tel:${PLAN_TERM_RENEW_PHONE.replaceAll('-', '')}`}>{PLAN_TERM_RENEW_PHONE}</a><a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>{PLAN_TERM_CONTACT_EMAIL}</a></div></footer>
  </BillingCustomerFrame></div>;
}

'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BillingConfigurationOperation, BillingPromotionCampaignDetail, BillingPromotionPreviewRow } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingApprovalLabel, billingControl, billingField, billingLink, billingPrimaryControl } from '../billing/billing-display';
import { BillingCampaignForm } from './BillingCampaignFormPage';
import BillingCampaignReportSection from './BillingCampaignReportSection';
import { closeCampaign, confirmPassword, discardCampaignDraft, getCampaign, previewCampaign, stepOperation } from './billing-campaigns.api';
import {
  CAMPAIGN_CLOSE_COPY, CAMPAIGN_MANAGE_PERMISSION, CAMPAIGN_OPERATION_STEP_TEXT, CAMPAIGN_SAVED_NOTICE, CAMPAIGN_TEXT_LIMITS, CAMPAIGN_TONE_CLASS, DETAIL_NEEDS, DRAFT_STALE_TEXT,
  blockerText, campaignButtons, campaignError, campaignLoadFailure, campaignModeMarker, campaignRequest, campaignStatusMeta, campaignTerms, campaignTitle, draftErrorText, draftLockedText,
  isRequestOpen, operationStateText, operationSteps, pendingCheckoutsText, permissionNote, previewBlockedText, previewRowView, publishedTermsCopy, requestKey, resumeBlockedText, reuseIntent,
  termsFacts, type CampaignIntent, type CampaignLoadFailure, type CampaignOperationStep,
} from './billing-campaigns.logic';

const badge = 'inline-flex rounded-lg border px-2 py-1 text-sm';
const card = 'min-w-0 space-y-3 rounded-xl border border-gray-200 bg-white p-5 sm:p-6';

/** Password confirmation, same rule and wording as the settings page: submit, approve, pause and end all need it. */
function ReauthPanel({ until, onConfirmed }: { until: string | null; onConfirmed: (until: string) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (until && Date.parse(until) > Date.now()) return <p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">ยืนยันตัวตนแล้ว ดำเนินการได้ถึง {formatThaiDateTime(until)}</p>;
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true); setError('');
    try {
      const proof = await confirmPassword(password);
      setPassword('');
      onConfirmed(proof.reauthenticatedUntil);
    } catch (cause) { setError(campaignError(cause).text); } finally { setBusy(false); }
  }
  return <section aria-label="ยืนยันรหัสผ่าน" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
    <h3 className="font-bold">ยืนยันรหัสผ่าน</h3>
    <p>การส่งคำขอ อนุมัติ พัก และจบแคมเปญต้องยืนยันรหัสผ่านปัจจุบัน ใช้ได้ 5 นาทีในอุปกรณ์นี้</p>
    <form className="space-y-3" onSubmit={event => void confirm(event)}>
      <label className="block">รหัสผ่านปัจจุบัน<input className={billingField} type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button type="submit" className={billingPrimaryControl} disabled={busy || !password} aria-busy={busy}>ยืนยันรหัสผ่าน</button>
    </form>
  </section>;
}

function TermsCard({ title, note, terms, endedAt, children }: { title: string; note?: string; terms?: ReturnType<typeof campaignTerms>; endedAt?: string | null; children?: ReactNode }) {
  return <section aria-label={title} className={card}>
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {note && <p className="text-sm text-gray-600">{note}</p>}
    {terms && <dl className="space-y-2">
      {termsFacts(terms).map(fact => <div key={fact.label}><dt className="text-sm text-gray-500">{fact.label}</dt><dd className="text-gray-900 [overflow-wrap:anywhere]">{fact.value}</dd></div>)}
    </dl>}
    {endedAt && <p className="text-sm text-gray-600">จบเมื่อ {formatThaiDateTime(endedAt)}</p>}
    {children}
  </section>;
}

function PreviewSection({ rows, caption }: { rows: readonly BillingPromotionPreviewRow[]; caption: string }) {
  if (rows.length === 0) return null;
  return <section aria-label="ตัวอย่างเมื่อเปิดแคมเปญ" className={card}>
    <h2 className="text-lg font-semibold text-gray-900">ตัวอย่างเมื่อเปิดแคมเปญ</h2>
    <p className="text-sm text-gray-600">{caption}</p>
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map(row => {
        const view = previewRowView(row);
        return <article key={`${row.offerKey}:${row.interval}`} aria-label={view.title} className="min-w-0 space-y-3 rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">{view.title}</h3>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">ราคาวันนี้</dt><dd className="text-base text-gray-900">{view.price}{view.priceNote && <span className="ml-2 text-sm text-gray-600">({view.priceNote})</span>}</dd></div>
            <div><dt className="text-gray-500">เวลาที่ได้</dt><dd className="text-base text-gray-900">{view.time}</dd></div>
            <div><dt className="text-gray-500">ใบเสร็จที่ได้</dt><dd className="text-base text-gray-900">{view.receipts}</dd></div>
            <div><dt className="text-gray-500">ตัวอย่างวันที่</dt><dd className="text-gray-900">{view.dates}</dd></div>
            <div><dt className="text-gray-500">รอบถัดไป</dt><dd className="text-gray-900">{view.next}</dd></div>
          </dl>
          {view.blockers.length > 0 && <ul role="alert" className="list-inside list-disc rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            {view.blockers.map((text, index) => <li key={index}>{text}</li>)}
          </ul>}
        </article>;
      })}
    </div>
  </section>;
}

/** `/system/billing/campaigns/[campaignId]`: terms, draft, preview, the publish workflow, pause/end and the usage report. */
export default function BillingCampaignDetailPage({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [detail, setDetail] = useState<BillingPromotionCampaignDetail | null>(null);
  const [failure, setFailure] = useState<CampaignLoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const [operation, setOperation] = useState<BillingConfigurationOperation | null>(null);
  // The version of the open request that already answered "stale" to a step: the server leaves it as it was, so it must not be offered again as it is.
  const [refusedRequest, setRefusedRequest] = useState<string | null>(null);
  const [rows, setRows] = useState<BillingPromotionPreviewRow[]>([]);
  const [reauthUntil, setReauthUntil] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<'pause' | 'end' | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [publishReason, setPublishReason] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(search?.get('saved') === '1' ? CAMPAIGN_SAVED_NOTICE : '');
  const generation = useRef(0);
  const closeIntent = useRef<CampaignIntent | null>(null);
  const alertRef = useRef<HTMLParagraphElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);

  const apply = (value: BillingPromotionCampaignDetail) => {
    setDetail(value); setOperation(value.operation); setRows(value.previewRows); setReauthUntil(value.reauthenticatedUntil); setDiscarding(false);
  };
  useEffect(() => {
    if (search?.get('saved')) window.history.replaceState(null, '', window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const token = ++generation.current;
    setLoading(true); setFailure(null); setBusy(false);
    getCampaign(campaignId)
      .then(value => { if (token === generation.current) { apply(value); setFormKey(key => key + 1); } })
      .catch(cause => { if (token === generation.current) setFailure(campaignLoadFailure(cause)); })
      .finally(() => { if (token === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [campaignId, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!error) return;
    alertRef.current?.scrollIntoView({ block: 'center' });
    alertRef.current?.focus({ preventScroll: true });
  }, [error]);
  useEffect(() => { if (closing) confirmRef.current?.focus(); }, [closing]);
  useEffect(() => { if (editing) editRef.current?.scrollIntoView({ block: 'start' }); }, [editing]);
  useEffect(() => { if (notice) noticeRef.current?.scrollIntoView({ block: 'nearest' }); }, [notice]);

  function fail(cause: unknown) {
    const problem = campaignError(cause);
    if (problem.kind !== 'unconfirmed') closeIntent.current = null;
    if (problem.kind === 'reauth') setReauthUntil(null);
    if (problem.kind === 'stale') {
      if (isRequestOpen(operation)) setRefusedRequest(requestKey(operation!));
      setReload(value => value + 1);
    }
    // The permission is gone: stop offering the buttons even though this page was loaded with them.
    if (problem.kind === 'forbidden') {
      setDetail(current => current && { ...current, capabilities: [], campaign: { ...current.campaign, allowedActions: [] } });
      setOperation(current => current && { ...current, allowedActions: [] });
    }
    setError(problem.text);
  }
  async function run<T>(task: () => Promise<T>, done: (value: T) => void) {
    if (busy) return;
    const token = generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await task();
      if (token === generation.current) done(value);
    } catch (cause) {
      if (token === generation.current) fail(cause);
    } finally { if (token === generation.current) setBusy(false); }
  }

  const shell = (children: ReactNode) => <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8" aria-busy={loading}>
    <Link className={billingLink} href="/system/billing/campaigns">กลับรายการแคมเปญ</Link>
    {children}
  </main>;
  if (!detail) {
    return shell(<>
      {loading && <p role="status" className="text-gray-600">กำลังโหลดแคมเปญ…</p>}
      {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
        <p>{failure.text}</p>
        {failure.kind === 'failed' && <button type="button" className={`${billingControl} mt-3`} onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button>}
      </div>}
    </>);
  }

  const campaign = detail.campaign, draft = campaign.draft, published = campaign.published;
  const buttons = campaignButtons(campaign.allowedActions);
  const status = campaignStatusMeta(campaign.status), marker = campaignModeMarker(detail.mode), terms = campaignTerms(campaign);
  // Spec §4: while a request is open the draft is frozen (an edit would make the later approval stale), and a request that can no longer go on offers only "ยกเลิกคำขอ".
  const request = campaignRequest(operation, { settingsVersion: detail.settingsVersion, refused: refusedRequest });
  const steps = operationSteps(operation, request.usable);
  const reauthenticated = Boolean(reauthUntil && Date.parse(reauthUntil) > Date.now());
  const previewBlocked = previewBlockedText(draft?.validationErrors, rows), resumeBlocked = resumeBlockedText(Boolean(draft), rows);
  const blocked = buttons.preview ? previewBlocked : resumeBlocked;
  const canManage = detail.capabilities.includes(CAMPAIGN_MANAGE_PERMISSION);
  const termsCopy = publishedTermsCopy(campaign.status);
  const permission = permissionNote({ canManage, canApprove: steps.includes('approve'), needs: DETAIL_NEEDS });

  const preview = (action: 'PUBLISH' | 'RESUME') => run(
    () => previewCampaign(campaignId, { expectedVersion: detail.settingsVersion, ...(action === 'PUBLISH' && draft ? { draftVersion: draft.version } : {}), action, reason: publishReason.trim() }),
    result => { setOperation(result.operation); setRows(result.previewRows); });
  const step = (kind: CampaignOperationStep) => operation && run(() => stepOperation(operation, kind), result => {
    setOperation(result);
    if (!isRequestOpen(result)) { setNotice(operationStateText(result.state)); setPublishReason(''); setReload(value => value + 1); }
  });
  const close = (action: 'pause' | 'end') => {
    const body = { expectedVersion: detail.settingsVersion, reason: closeReason.trim() };
    // A retry after a lost response reuses the key, so the server answers with the first result instead of acting twice.
    closeIntent.current = reuseIntent(closeIntent.current, `${action}:${JSON.stringify(body)}`, () => `billing-campaign-${action}-${crypto.randomUUID()}`);
    return run(() => closeCampaign(campaignId, action, body, closeIntent.current!.key), next => {
      closeIntent.current = null;
      apply(next); setClosing(null); setCloseReason(''); setNotice(CAMPAIGN_CLOSE_COPY[action].done);
    });
  };
  const discard = () => draft && run(() => discardCampaignDraft(campaignId, draft.version), () => {
    setDiscarding(false);
    if (published) { setNotice('ยกเลิกร่างแล้ว เงื่อนไขที่ใช้อยู่ไม่เปลี่ยน'); setReload(value => value + 1); } else router.push('/system/billing/campaigns');
  });

  const showDraftCard = Boolean(draft) || buttons.edit;
  const previewCaption = operation ? 'ตัวอย่างของคำขอนี้ ตรวจให้ตรงกับที่ต้องการก่อนส่งคำขอ'
    : draft ? 'ตัวอย่างจากร่างที่บันทึกไว้ คำนวณจากราคาและโควตาแพ็กเกจปัจจุบัน ยังไม่เปลี่ยนอะไรกับลูกค้า'
      : 'ตัวอย่างจากเงื่อนไขที่ใช้อยู่ คำนวณจากราคาและโควตาแพ็กเกจปัจจุบัน';
  return shell(<>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-gray-900 [overflow-wrap:anywhere]">{campaignTitle(campaign)}</h1>
        <p className="mt-1 text-gray-600 [overflow-wrap:anywhere]">ชื่อที่ลูกค้าเห็น: {terms?.displayName || 'ยังไม่ได้กรอก'}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className={`${badge} ${CAMPAIGN_TONE_CLASS[status.tone]}`}>{status.label}</span>
        <span className={`${badge} ${CAMPAIGN_TONE_CLASS[marker.tone]}`}>{marker.label}{marker.hint && ` · ${marker.hint}`}</span>
      </div>
    </header>
    <div>
      <button type="button" className={billingControl} disabled={loading || busy || editing} aria-busy={loading} onClick={() => setReload(value => value + 1)}>โหลดข้อมูลล่าสุด</button>
    </div>
    {status.help && <p className="rounded-lg bg-gray-50 p-3 text-gray-700">{status.help}</p>}
    {error && <p ref={alertRef} role="alert" tabIndex={-1} className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p ref={noticeRef} role="status" className="rounded-lg bg-green-50 p-4 text-green-800">{notice}</p>}
    {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
      <p>{failure.text}</p>
      {failure.kind === 'failed' && <button type="button" className={`${billingControl} mt-3`} onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button>}
    </div>}
    {detail.mode === 'DISABLED' && <p className="rounded-lg border border-gray-200 bg-white p-4 text-gray-700">ยังไม่เปิดใช้การชำระเงินในระบบนี้ จึงยังเปิดหรือแก้แคมเปญไม่ได้</p>}
    {permission && <p className="text-sm text-gray-600">{permission}</p>}

    {editing ? <section ref={editRef} aria-label="แก้ร่างแคมเปญ" className="scroll-mt-4 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{draft ? 'แก้ร่างแคมเปญ' : 'แก้เงื่อนไขเป็นร่างใหม่'}</h2>
      <BillingCampaignForm key={formKey} campaign={campaign}
        onSaved={saved => { apply(saved); setEditing(false); setError(''); setNotice(CAMPAIGN_SAVED_NOTICE); }}
        onStale={() => { setError(DRAFT_STALE_TEXT); setReload(value => value + 1); }}
        onCancel={() => setEditing(false)} />
    </section> : <>
      <div className={`grid gap-4 ${published && showDraftCard ? 'lg:grid-cols-2' : ''}`}>
        {published && <TermsCard title={termsCopy.title} terms={published} endedAt={published.endedAt} note={termsCopy.note} />}
        {showDraftCard && <TermsCard title="ร่างที่กำลังแก้" terms={draft?.values}
          note={draft ? 'ยังไม่มีผลกับลูกค้า จนกว่าจะตรวจสอบก่อนเปิดและยืนยัน' : 'ยังไม่มีร่าง กด “แก้เงื่อนไข” เพื่อสร้างร่างใหม่จากเงื่อนไขที่ใช้อยู่'}>
          {draft && draft.validationErrors.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <p className="font-semibold">ร่างยังไม่ครบ</p>
            <ul className="list-inside list-disc">{draft.validationErrors.map(item => <li key={`${item.field}:${item.code}`}>{draftErrorText(item)}</li>)}</ul>
          </div>}
          {request.open && (buttons.edit || buttons.discard) && <p role="note" className="rounded-lg bg-amber-50 p-3 text-amber-900">{draftLockedText(operation!.allowedActions.includes('cancel'))}</p>}
          <div className="flex flex-wrap gap-3">
            {buttons.edit && <button type="button" className={draft ? billingPrimaryControl : billingControl} disabled={busy || request.open} onClick={() => setEditing(true)}>{draft ? 'แก้ร่าง' : 'แก้เงื่อนไข'}</button>}
            {buttons.discard && draft && (discarding && !request.open ? <>
              <button type="button" className={billingControl} disabled={busy} aria-busy={busy} onClick={() => void discard()}>ยืนยันยกเลิกร่างนี้</button>
              <button type="button" className={billingControl} disabled={busy} onClick={() => setDiscarding(false)}>ไม่ยกเลิก</button>
            </> : <button type="button" className={billingControl} disabled={busy || request.open} onClick={() => setDiscarding(true)}>ยกเลิกร่าง</button>)}
          </div>
        </TermsCard>}
      </div>

      <PreviewSection rows={rows} caption={previewCaption} />

      {(buttons.preview || buttons.resume || operation) && <section aria-label="เปิดใช้แคมเปญ" className={card}>
        <h2 className="text-lg font-semibold text-gray-900">{!draft && buttons.resume ? 'กลับมาเปิดแคมเปญ' : 'เปิดใช้แคมเปญ'}</h2>
        {!operation && <>
          <p className="text-gray-700">ขั้นตอน: ตรวจสอบก่อนเปิด ส่งคำขอ แล้วอนุมัติและเปิดใช้ (ต้องยืนยันรหัสผ่าน) แคมเปญเริ่มรับสิทธิ์ตามเวลาเริ่มที่ตั้งไว้โดยไม่ต้องทำอะไรเพิ่ม
            การเปิดแคมเปญไม่ได้เปิดการขาย ถ้าปิดรับรายการซื้อไว้ในตั้งค่าการชำระเงิน ลูกค้ายังซื้อไม่ได้</p>
          <div>
            <label htmlFor="campaign-publish-reason" className="block font-medium text-gray-900">เหตุผล</label>
            <textarea id="campaign-publish-reason" className={billingField} rows={2} maxLength={CAMPAIGN_TEXT_LIMITS.reason} value={publishReason} disabled={busy} onChange={event => setPublishReason(event.target.value)} />
            <p className="mt-1 text-sm text-gray-600">ระบบเก็บไว้ในประวัติการเปลี่ยนแปลงของแคมเปญ</p>
          </div>
          {blocked && <p className="text-amber-800">{blocked}</p>}
          <div className="flex flex-wrap gap-3">
            {buttons.preview && <button type="button" className={billingPrimaryControl} disabled={busy || !publishReason.trim() || Boolean(previewBlocked)} aria-busy={busy} onClick={() => void preview('PUBLISH')}>ตรวจสอบก่อนเปิด</button>}
            {buttons.resume && <button type="button" className={buttons.preview ? billingControl : billingPrimaryControl} disabled={busy || !publishReason.trim() || Boolean(resumeBlocked)} aria-busy={busy} onClick={() => void preview('RESUME')}>กลับมาเปิด</button>}
          </div>
        </>}
        {operation && <div className="space-y-3">
          {request.open && !request.usable ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{request.note}</p>
            : <p className="font-semibold text-gray-900">{operationStateText(operation.state)}</p>}
          {operation.reason && <p className="text-gray-700 [overflow-wrap:anywhere]">เหตุผลที่ระบุ: {operation.reason}</p>}
          {['BLOCKED', 'FAILED', 'UNKNOWN'].includes(operation.state) && operation.errorCode && <p role="alert" className="text-red-800">{blockerText(operation.errorCode)}</p>}
          {request.usable && <p className="text-gray-700">ใช้คำขอได้ถึง {formatThaiDateTime(operation.expiresAt)}</p>}
          {operation.approvalMode && <p className="text-gray-700">{billingApprovalLabel(operation.approvalMode)}</p>}
          {steps.some(item => item !== 'cancel') && <ReauthPanel until={reauthUntil} onConfirmed={setReauthUntil} />}
          <div className="flex flex-wrap gap-3">
            {steps.map(item => <button key={item} type="button" className={item === 'cancel' ? billingControl : billingPrimaryControl} aria-busy={busy}
              disabled={busy || (item !== 'cancel' && !reauthenticated)} onClick={() => void step(item)}>{CAMPAIGN_OPERATION_STEP_TEXT[item]}</button>)}
          </div>
        </div>}
      </section>}

      {(buttons.pause || buttons.end) && <section aria-label="พักหรือจบแคมเปญ" className={card}>
        <h2 className="text-lg font-semibold text-gray-900">พักหรือจบแคมเปญ</h2>
        <p className="text-gray-700">มีผลทันทีหลังยืนยัน ร้านที่จองสิทธิ์ไว้แล้วยังได้รับสิทธิ์ตามเดิม</p>
        {!closing && <div className="flex flex-wrap gap-3">
          {buttons.pause && <button type="button" className={billingControl} disabled={busy} onClick={() => setClosing('pause')}>{CAMPAIGN_CLOSE_COPY.pause.open}</button>}
          {buttons.end && <button type="button" className={billingControl} disabled={busy} onClick={() => setClosing('end')}>{CAMPAIGN_CLOSE_COPY.end.open}</button>}
        </div>}
        {closing && <div ref={confirmRef} tabIndex={-1} role="group" aria-label={CAMPAIGN_CLOSE_COPY[closing].title} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold text-gray-900">{CAMPAIGN_CLOSE_COPY[closing].title}</h3>
          <p className="font-medium text-gray-900">{pendingCheckoutsText(campaign.pendingCheckouts)}</p>
          <p className="text-gray-700">{CAMPAIGN_CLOSE_COPY[closing].effect}</p>
          {CAMPAIGN_CLOSE_COPY[closing].final && <p className="font-semibold text-red-800">{CAMPAIGN_CLOSE_COPY[closing].final}</p>}
          <div>
            <label htmlFor="campaign-close-reason" className="block font-medium text-gray-900">เหตุผล</label>
            <textarea id="campaign-close-reason" className={billingField} rows={2} maxLength={CAMPAIGN_TEXT_LIMITS.reason} value={closeReason} disabled={busy} onChange={event => setCloseReason(event.target.value)} />
          </div>
          <ReauthPanel until={reauthUntil} onConfirmed={setReauthUntil} />
          <div className="flex flex-wrap gap-3">
            <button type="button" className={billingPrimaryControl} aria-busy={busy} disabled={busy || !closeReason.trim() || !reauthenticated} onClick={() => void close(closing)}>{CAMPAIGN_CLOSE_COPY[closing].confirm}</button>
            <button type="button" className={billingControl} disabled={busy} onClick={() => setClosing(null)}>ไม่ดำเนินการ</button>
          </div>
        </div>}
      </section>}
    </>}

    {published && <BillingCampaignReportSection campaignId={campaignId} />}
  </>);
}

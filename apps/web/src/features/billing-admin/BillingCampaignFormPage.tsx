'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BILLING_PROMOTION_STARTER_TEMPLATE, type BillingPromotionCampaignDetail, type BillingPromotionCampaignList, type BillingPromotionCampaignView,
  type BillingPromotionDraftError, type BillingPromotionDraftField, type BillingPromotionTemplate,
} from '@watchdog-bms/contracts';
import { billingControl, billingField, billingLink, billingPermissionLabel, billingPrimaryControl } from '../billing/billing-display';
import BillingDateTimeField from './BillingDateTimeField';
import { listCampaigns, saveCampaignDraft } from './billing-campaigns.api';
import {
  CAMPAIGN_MANAGE_PERMISSION, CAMPAIGN_TEXT_LIMITS, CAMPAIGN_TONE_CLASS, bahtText, campaignDraftInput, campaignError, campaignFormFromTerms, campaignFormProblems,
  campaignLoadFailure, campaignModeMarker, countText, draftErrorsByField, draftErrorText, emptyCampaignForm, reuseIntent, templateRuleSummary,
  type CampaignFormProblems, type CampaignFormValues, type CampaignIntent, type CampaignLoadFailure,
} from './billing-campaigns.logic';

function Notes({ id, hint, problem, missing }: { id: string; hint?: ReactNode; problem?: string; missing?: string }) {
  return <div id={id}>
    {hint && <p className="mt-1 text-sm text-gray-600">{hint}</p>}
    {problem && <p role="alert" className="mt-1 text-sm text-red-700">{problem}</p>}
    {!problem && missing && <p className="mt-1 text-sm text-amber-800">{missing}</p>}
  </div>;
}

/**
 * The draft form. Without `campaign` it creates one; with it, it edits the saved draft, or starts a new revision from the
 * published terms. Saving a draft never opens the promotion to customers (spec §4), and a failed save keeps what was typed.
 */
export function BillingCampaignForm({ campaign, template = BILLING_PROMOTION_STARTER_TEMPLATE, onSaved, onStale, onCancel }: {
  campaign?: BillingPromotionCampaignView; template?: BillingPromotionTemplate;
  onSaved: (detail: BillingPromotionCampaignDetail) => void;
  /** The draft was changed elsewhere: the parent reloads the latest and asks for a new review. */
  onStale?: () => void; onCancel?: () => void;
}) {
  const [form, setForm] = useState<CampaignFormValues>(() => (campaign ? campaignFormFromTerms(campaign.draft?.values ?? campaign.published, template) : emptyCampaignForm(template)));
  const [problems, setProblems] = useState<CampaignFormProblems>({});
  const [missing, setMissing] = useState<BillingPromotionDraftError[]>(campaign?.draft?.validationErrors ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<CampaignIntent | null>(null);
  const root = useRef<HTMLFormElement | null>(null);
  const alertRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (!error) return;
    alertRef.current?.scrollIntoView({ block: 'center' });
    alertRef.current?.focus({ preventScroll: true });
  }, [error]);
  const missingBy = draftErrorsByField(missing);
  const edit = (patch: Partial<CampaignFormValues>, ...fields: (BillingPromotionDraftField | 'reason')[]) => {
    setForm(current => ({ ...current, ...patch }));
    setProblems(current => Object.fromEntries(Object.entries(current).filter(([key]) => !(fields as string[]).includes(key))));
    setMissing(current => current.filter(item => !(fields as string[]).includes(item.field)));
  };
  const focusField = (field: string) => root.current?.querySelector<HTMLElement>(field === 'cap' ? '[data-field="cap"] input[inputmode]' : `[data-field="${field}"] :is(input, textarea, button)`)?.focus();
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = campaignFormProblems(form);
    setProblems(found); setError('');
    const first = (['startsAt', 'endsAt', 'cap', 'reason'] as const).find(field => found[field]);
    if (first) { focusField(first); return; }
    const input = campaignDraftInput(form, { campaignId: campaign?.campaignId, draftVersion: campaign?.draft?.version }, template);
    intent.current = reuseIntent(intent.current, JSON.stringify(input), () => `billing-campaign-draft-${crypto.randomUUID()}`);
    setBusy(true);
    try {
      const detail = await saveCampaignDraft(input, intent.current.key);
      intent.current = null;
      // The parent leaves this form (navigates, or closes it). Staying busy until then means a second click cannot save a second draft.
      onSaved(detail);
    } catch (cause) {
      const failure = campaignError(cause);
      // A definite answer ends this command; a lost response keeps its key so pressing save again cannot create a second draft.
      if (failure.kind !== 'unconfirmed') intent.current = null;
      setBusy(false);
      if (failure.kind === 'stale' && onStale) { onStale(); return; }
      setError(failure.text);
    }
  }
  const taken = campaign?.published ? campaign.usage.taken : 0;
  return <form ref={root} noValidate onSubmit={event => void save(event)} className="space-y-5" aria-label={campaign ? 'แก้ร่างแคมเปญ' : 'สร้างแคมเปญใหม่'} aria-busy={busy}>
    <p className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-brand-800">
      การบันทึกร่างยังไม่เปิดแคมเปญให้ลูกค้า กรอกไม่ครบก็บันทึกไว้ก่อนได้ เมื่อพร้อมให้ตรวจตัวอย่างและยืนยันเปิดในหน้ารายละเอียดของแคมเปญ
      {campaign?.published && !campaign.draft ? ' การแก้ไขจะสร้างเป็นร่างใหม่ เงื่อนไขที่ใช้อยู่ตอนนี้ยังไม่เปลี่ยน' : ''}
    </p>
    {error && <p ref={alertRef} role="alert" tabIndex={-1} className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {missing.length > 0 && <section aria-label="สิ่งที่ร่างยังขาด" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <h2 className="font-semibold">ร่างที่บันทึกไว้ล่าสุดยังไม่ครบ</h2>
      <ul className="list-inside list-disc">{missing.map(item => <li key={`${item.field}:${item.code}`}>{draftErrorText(item)}</li>)}</ul>
    </section>}

    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="ข้อมูลแคมเปญ">
      <h2 className="text-lg font-semibold text-gray-900">ข้อมูลแคมเปญ</h2>
      <dl className="grid gap-3 rounded-lg bg-gray-50 p-4 sm:grid-cols-2">
        <div><dt className="text-sm text-gray-500">ประเภทแคมเปญ</dt><dd className="mt-1 text-gray-900">ซื้อแพ็กเกจแถมเดือน</dd></div>
        <div><dt className="text-sm text-gray-500">ผู้มีสิทธิ์</dt><dd className="mt-1 text-gray-900">ร้านใหม่และร้านเดิม หนึ่งครั้งต่อร้านต่อแคมเปญ</dd></div>
      </dl>
      <div data-field="internalName">
        <label htmlFor="campaign-internal-name" className="block font-medium text-gray-900">ชื่อภายใน</label>
        <input id="campaign-internal-name" className={billingField} maxLength={CAMPAIGN_TEXT_LIMITS.internalName} disabled={busy} value={form.internalName}
          aria-describedby="campaign-internal-name-note" aria-invalid={Boolean(missingBy.internalName)} onChange={event => edit({ internalName: event.target.value }, 'internalName')} />
        <Notes id="campaign-internal-name-note" hint="เห็นเฉพาะผู้ดูแล ใช้ค้นหาและจัดการแคมเปญ" missing={missingBy.internalName} />
      </div>
      <div data-field="description">
        <label htmlFor="campaign-description" className="block font-medium text-gray-900">คำอธิบาย (ไม่บังคับ)</label>
        <textarea id="campaign-description" className={billingField} rows={3} maxLength={CAMPAIGN_TEXT_LIMITS.description} disabled={busy} value={form.description}
          aria-describedby="campaign-description-note" aria-invalid={Boolean(missingBy.description)} onChange={event => edit({ description: event.target.value }, 'description')} />
        <Notes id="campaign-description-note" hint="บันทึกไว้ให้ทีมเข้าใจว่าแคมเปญนี้จัดทำไว้เพื่ออะไร ลูกค้าไม่เห็น" missing={missingBy.description} />
      </div>
      <div data-field="displayName">
        <label htmlFor="campaign-display-name" className="block font-medium text-gray-900">ชื่อที่ลูกค้าเห็น</label>
        <input id="campaign-display-name" className={billingField} maxLength={CAMPAIGN_TEXT_LIMITS.displayName} disabled={busy} value={form.displayName}
          aria-describedby="campaign-display-name-note" aria-invalid={Boolean(missingBy.displayName)} onChange={event => edit({ displayName: event.target.value }, 'displayName')} />
        <Notes id="campaign-display-name-note" hint="ข้อความธรรมดา ไม่รับเครื่องหมาย < > ราคาและจำนวนเดือนที่ลูกค้าเห็นระบบคำนวณจากเงื่อนไขด้านล่างให้เอง" missing={missingBy.displayName} />
      </div>
    </section>

    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="แพ็กเกจและสิ่งที่ได้">
      <fieldset data-field="rules" disabled={busy} className="min-w-0 space-y-2">
        <legend className="font-semibold text-gray-900">แพ็กเกจและรอบที่ร่วมแคมเปญ</legend>
        {template.rules.map(rule => {
          const summary = templateRuleSummary(rule);
          return <label key={rule.interval} className="flex min-h-11 items-start gap-3 rounded-lg border border-gray-200 p-3">
            <input type="checkbox" className="mt-1" checked={form.intervals.includes(rule.interval)} aria-describedby="campaign-rules-note"
              onChange={event => edit({ intervals: event.target.checked ? [...form.intervals, rule.interval] : form.intervals.filter(item => item !== rule.interval) }, 'rules')} />
            <span className="min-w-0"><span className="block font-medium text-gray-900">{summary.label}</span><span className="block text-sm text-gray-600">{summary.months} · {summary.receipts}</span></span>
          </label>;
        })}
        <Notes id="campaign-rules-note" missing={missingBy.rules}
          hint={`ผลประโยชน์กำหนดตายตัวตามแบบตั้งต้น แก้สูตรเองไม่ได้ ใช้ได้เมื่อแพ็กเกจเริ่มต้นราคาเดือนละ ${bahtText(template.monthlyPriceSatang)} ตามการตั้งค่าการชำระเงิน ถ้าราคาหรือโควตาเปลี่ยน ระบบจะไม่ให้เปิดแคมเปญจนกว่าจะตรวจตัวอย่างใหม่`} />
      </fieldset>
      <p className="rounded-lg bg-gray-50 p-3 text-gray-700">การซ้อนสิทธิ์: ใช้ร่วมกับส่วนลดกิจกรรมหรือดีลไม่ได้ ร้านเลือกได้อย่างเดียวต่อหนึ่งรายการซื้อ</p>
    </section>

    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="เวลาและจำนวนสิทธิ์">
      <h2 className="text-lg font-semibold text-gray-900">เวลาและจำนวนสิทธิ์</h2>
      <div data-field="startsAt">
        <BillingDateTimeField label="เริ่มรับสิทธิ์" value={form.startsAt} disabled={busy} onChange={value => edit({ startsAt: value }, 'startsAt', 'endsAt')} />
        <Notes id="campaign-starts-at-note" problem={problems.startsAt} missing={missingBy.startsAt} />
      </div>
      <div data-field="endsAt">
        <BillingDateTimeField label="สิ้นสุดรับสิทธิ์" value={form.endsAt} disabled={busy} onChange={value => edit({ endsAt: value }, 'endsAt')} />
        <Notes id="campaign-ends-at-note" problem={problems.endsAt} missing={missingBy.endsAt} />
      </div>
      <fieldset data-field="cap" disabled={busy} className="min-w-0 space-y-2">
        <legend className="font-semibold text-gray-900">จำนวนสิทธิ์สูงสุด</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="campaign-cap" checked={form.capChoice === 'UNLIMITED'} aria-describedby="campaign-cap-note" onChange={() => edit({ capChoice: 'UNLIMITED' }, 'cap')} />ไม่จำกัด
        </label>
        <div className="flex min-h-11 flex-wrap items-center gap-3">
          <label className="flex items-center gap-3">
            <input type="radio" name="campaign-cap" checked={form.capChoice === 'LIMITED'} aria-describedby="campaign-cap-note" onChange={() => edit({ capChoice: 'LIMITED' }, 'cap')} />จำกัดไม่เกิน
          </label>
          <input aria-label="จำนวนสิทธิ์สูงสุด" className={`${billingField} !mt-0 !w-32`} inputMode="numeric" maxLength={13} value={form.cap}
            aria-invalid={Boolean(problems.cap)} aria-describedby="campaign-cap-note" onChange={event => edit({ capChoice: 'LIMITED', cap: event.target.value }, 'cap')} />
          <span>สิทธิ์</span>
        </div>
        <Notes id="campaign-cap-note" problem={problems.cap} missing={missingBy.cap}
          hint={`หนึ่งร้านใช้สิทธิ์ได้ครั้งเดียวต่อแคมเปญ ตัวเลขนี้นับทั้งร้านที่กำลังชำระและร้านที่ใช้สิทธิ์แล้ว${taken > 0 ? ` ตอนนี้นับไปแล้ว ${countText(taken)} สิทธิ์ ตั้งให้ไม่น้อยกว่านี้` : ''}`} />
      </fieldset>
    </section>

    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="เหตุผลที่บันทึก">
      <div data-field="reason">
        <label htmlFor="campaign-reason" className="block font-medium text-gray-900">เหตุผลที่บันทึกครั้งนี้</label>
        <textarea id="campaign-reason" className={billingField} rows={2} maxLength={CAMPAIGN_TEXT_LIMITS.reason} disabled={busy} value={form.reason}
          aria-describedby="campaign-reason-note" aria-invalid={Boolean(problems.reason)} onChange={event => edit({ reason: event.target.value }, 'reason')} />
        <Notes id="campaign-reason-note" problem={problems.reason} hint="ระบบเก็บไว้ในประวัติการเปลี่ยนแปลงของแคมเปญ" />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={billingPrimaryControl} disabled={busy} aria-busy={busy}>บันทึกร่าง</button>
        {onCancel && <button type="button" className={billingControl} disabled={busy} onClick={onCancel}>ยกเลิกการแก้ไข</button>}
      </div>
    </section>
  </form>;
}

/** `/system/billing/campaigns/new`: create a campaign from the template, then continue on its detail page. */
export default function BillingCampaignFormPage() {
  const router = useRouter();
  const [list, setList] = useState<BillingPromotionCampaignList | null>(null);
  const [failure, setFailure] = useState<CampaignLoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailure(null);
    listCampaigns()
      .then(value => { if (active) setList(value); })
      .catch(cause => { if (active) { setList(null); setFailure(campaignLoadFailure(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const marker = list ? campaignModeMarker(list.mode) : null;
  const disabled = list?.mode === 'DISABLED';
  const canCreate = Boolean(list && !disabled && list.capabilities.includes(CAMPAIGN_MANAGE_PERMISSION));
  return <main className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-8">
    <Link className={billingLink} href="/system/billing/campaigns">กลับรายการแคมเปญ</Link>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-gray-900">สร้างแคมเปญโปรโมชั่น</h1>
        <p className="mt-2 text-gray-600">แบบตั้งต้น “ซื้อแพ็กเกจแถมเดือน” สำหรับแพ็กเกจเริ่มต้น: ซื้อรายเดือนได้ 2 เดือน ซื้อรายปีได้ 13 เดือน พร้อมใบเสร็จแถม</p>
      </div>
      {marker && <p className={`inline-flex rounded-lg border px-2 py-1 text-sm ${CAMPAIGN_TONE_CLASS[marker.tone]}`}>{marker.label}{marker.hint && ` · ${marker.hint}`}</p>}
    </header>
    {loading && <p role="status" className="text-sm text-gray-600">กำลังโหลด…</p>}
    {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
      <p>{failure.text}</p>
      {failure.kind === 'failed' && <button type="button" className={`${billingControl} mt-3`} onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button>}
    </div>}
    {disabled && <p className="rounded-lg border border-gray-200 bg-white p-4 text-gray-700">ยังไม่เปิดใช้การชำระเงินในระบบนี้ จึงยังสร้างแคมเปญไม่ได้</p>}
    {list && !disabled && !canCreate && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      บัญชีนี้ไม่มีสิทธิ์สร้างแคมเปญ ต้องมีสิทธิ์ “{billingPermissionLabel(CAMPAIGN_MANAGE_PERMISSION)}” ในส่วนการชำระเงิน
    </p>}
    {canCreate && list && <BillingCampaignForm template={list.template} onSaved={detail => router.replace(`/system/billing/campaigns/${encodeURIComponent(detail.campaign.campaignId)}?saved=1`)} />}
  </main>;
}

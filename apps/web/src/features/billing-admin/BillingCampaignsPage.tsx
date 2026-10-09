'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { BillingPromotionCampaignList } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { billingControl, billingField, billingLink, billingPrimaryControl } from '../billing/billing-display';
import { listCampaigns } from './billing-campaigns.api';
import {
  CAMPAIGN_MANAGE_PERMISSION, CAMPAIGN_STATUS_META, CAMPAIGN_STATUSES, CAMPAIGN_TONE_CLASS, LIST_NEEDS, NO_CAMPAIGN_FILTERS, campaignLoadFailure, campaignModeMarker,
  campaignOfferOptions, campaignStatusMeta, campaignTerms, campaignTitle, campaignUsageText, campaignWindowText, filterCampaigns, permissionNote, rulesText,
  type CampaignFilters, type CampaignLoadFailure,
} from './billing-campaigns.logic';

const badge = 'inline-flex rounded-lg border px-2 py-1 text-sm';
/** The TEST / LIVE chip beside a status chip: neutral, so it is never mistaken for the status (a paused or stale campaign is amber too). */
const modeBadge = `${badge} border-gray-300 bg-white text-gray-700`;

export default function BillingCampaignsPage() {
  const [list, setList] = useState<BillingPromotionCampaignList | null>(null);
  const [failure, setFailure] = useState<CampaignLoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [filters, setFilters] = useState<CampaignFilters>(NO_CAMPAIGN_FILTERS);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailure(null);
    listCampaigns()
      .then(value => { if (active) setList(value); })
      .catch(cause => { if (active) { setList(null); setFailure(campaignLoadFailure(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const shown = useMemo(() => (list ? filterCampaigns(list.campaigns, filters) : []), [list, filters]);
  const offers = useMemo(() => (list ? campaignOfferOptions(list.campaigns) : []), [list]);
  const disabled = list?.mode === 'DISABLED';
  const canCreate = Boolean(list && !disabled && list.capabilities.includes(CAMPAIGN_MANAGE_PERMISSION));
  const marker = list ? campaignModeMarker(list.mode) : null;
  const filtered = filters.search.trim() !== '' || filters.status !== '' || filters.offer !== '';
  const create = <Link className={billingPrimaryControl} href="/system/billing/campaigns/new">สร้างแคมเปญ</Link>;
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <Link className={billingLink} href="/system/billing">กลับหน้าการชำระเงิน</Link>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-gray-900">แคมเปญโปรโมชั่น</h1>
        <p className="mt-2 text-gray-600">สร้างและดูแลโปรโมชั่นซื้อแพ็กเกจแถมเดือน ตั้งเวลาและจำนวนสิทธิ์ และดูการใช้สิทธิ์ของแต่ละแคมเปญ</p>
      </div>
      {marker && <p className={`${badge} ${CAMPAIGN_TONE_CLASS[marker.tone]}`}>{marker.label}{marker.hint && ` · ${marker.hint}`}</p>}
    </header>
    <p role="status" className="text-sm text-gray-600">{loading ? 'กำลังโหลดแคมเปญ…' : list && !disabled ? `แสดง ${shown.length} จาก ${list.campaigns.length} แคมเปญ` : ''}</p>
    {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
      <p>{failure.text}</p>
      {failure.kind === 'failed' && <button type="button" className={`${billingControl} mt-3`} onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button>}
    </div>}
    {disabled && <p className="rounded-lg border border-gray-200 bg-white p-4 text-gray-700">ยังไม่เปิดใช้การชำระเงินในระบบนี้ จึงยังสร้างหรือใช้แคมเปญไม่ได้</p>}
    {list && !disabled && <>
      <div className="flex flex-wrap items-center gap-3">
        {canCreate ? create : <p className="text-sm text-gray-600">{permissionNote({ canManage: false, canApprove: list.campaigns.some(item => item.allowedActions.includes('APPROVE')), needs: LIST_NEEDS })}</p>}
        <button type="button" className={billingControl} disabled={loading} aria-busy={loading} onClick={() => setReload(value => value + 1)}>โหลดรายการใหม่</button>
      </div>
      {list.campaigns.length > 0 && <form role="search" aria-label="ค้นหาและกรองแคมเปญ" onSubmit={event => event.preventDefault()}
        className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(14rem,2fr)_minmax(14rem,1fr)_minmax(18rem,1.2fr)_auto]">
        <div className="min-w-0 sm:col-span-2 xl:col-span-1">
          <label htmlFor="campaign-search" className="block text-sm font-medium text-gray-700">ค้นหาชื่อแคมเปญ</label>
          <input id="campaign-search" type="search" className={billingField} maxLength={120} value={filters.search} placeholder="ชื่อภายในหรือชื่อที่ลูกค้าเห็น" onChange={event => setFilters({ ...filters, search: event.target.value })} />
        </div>
        <div className="min-w-0">
          <label htmlFor="campaign-status" className="block text-sm font-medium text-gray-700">สถานะ</label>
          <ThemedSelect id="campaign-status" aria-label="สถานะ" wrapLabel className={billingField} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value as CampaignFilters['status'] })}>
            <option value="">ทุกสถานะ</option>
            {CAMPAIGN_STATUSES.map(status => <option key={status} value={status}>{CAMPAIGN_STATUS_META[status].label}</option>)}
          </ThemedSelect>
        </div>
        <div className="min-w-0">
          <label htmlFor="campaign-offer" className="block text-sm font-medium text-gray-700">แพ็กเกจและรอบ</label>
          <ThemedSelect id="campaign-offer" aria-label="แพ็กเกจและรอบ" wrapLabel className={billingField} value={filters.offer} onChange={event => setFilters({ ...filters, offer: event.target.value })}>
            <option value="">ทุกแพ็กเกจ</option>
            {offers.map(offer => <option key={offer.value} value={offer.value}>{offer.label}</option>)}
          </ThemedSelect>
        </div>
        <button type="button" className={`${billingControl} sm:justify-self-start`} disabled={!filtered} onClick={() => setFilters(NO_CAMPAIGN_FILTERS)}>ล้างตัวกรอง</button>
      </form>}
      {list.campaigns.length === 0 && <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-gray-900">ยังไม่มีแคมเปญโปรโมชั่น</p>
        <p className="mx-auto mt-2 max-w-lg text-gray-600">เริ่มจากแบบตั้งต้น “ซื้อแพ็กเกจแถมเดือน” กรอกไม่ครบก็บันทึกร่างไว้ก่อนได้ ลูกค้าจะยังไม่เห็นแคมเปญจนกว่าจะตรวจตัวอย่างและยืนยันเปิด</p>
        {canCreate && <div className="mt-4">{create}</div>}
      </div>}
      {list.campaigns.length > 0 && shown.length === 0 && <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-gray-900">ไม่พบแคมเปญตามตัวกรองนี้</p>
        <button type="button" className={`${billingControl} mt-4`} onClick={() => setFilters(NO_CAMPAIGN_FILTERS)}>ล้างตัวกรอง</button>
      </div>}
      <div className="space-y-3">
        {shown.map(item => {
          const status = campaignStatusMeta(item.status), terms = campaignTerms(item), packages = rulesText(terms?.rules ?? []);
          return <article key={item.campaignId} aria-label={campaignTitle(item)} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">
                  <Link className="inline-flex min-h-11 max-w-full items-center text-brand-800 underline underline-offset-4 [overflow-wrap:anywhere]" href={`/system/billing/campaigns/${encodeURIComponent(item.campaignId)}`}>{campaignTitle(item)}</Link>
                </h2>
                <p className="mt-1 text-gray-600 [overflow-wrap:anywhere]">ชื่อที่ลูกค้าเห็น: {terms?.displayName || 'ยังไม่ได้กรอก'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`${badge} ${CAMPAIGN_TONE_CLASS[status.tone]}`}>{status.label}</span>
                {marker && <span className={modeBadge}>{marker.label}</span>}
              </div>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-gray-500">ช่วงเวลา (เวลาประเทศไทย)</dt><dd className="mt-1 text-base text-gray-900">{campaignWindowText(terms?.startsAt, terms?.endsAt)}</dd></div>
              <div><dt className="text-gray-500">แพ็กเกจและรอบ</dt><dd className="mt-1 text-base text-gray-900">{packages || 'ยังไม่ได้เลือก'}</dd></div>
              <div><dt className="text-gray-500">ใช้สิทธิ์แล้ว (รวมที่จองไว้) / สูงสุด</dt><dd className="mt-1 text-base text-gray-900">{campaignUsageText(item)}</dd></div>
            </dl>
            {(item.published && item.draft) || item.pendingOperationId ? <p className="text-sm text-amber-800">
              {item.published && item.draft ? 'มีร่างที่แก้ไว้ ยังไม่ได้เปิดใช้' : ''}{item.published && item.draft && item.pendingOperationId ? ' · ' : ''}{item.pendingOperationId ? 'มีคำขอเปิดใช้ที่ยังไม่เสร็จ' : ''}
            </p> : null}
          </article>;
        })}
      </div>
    </>}
  </main>;
}

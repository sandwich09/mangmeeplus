'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FEATURE_PACKAGE_PRESETS,
  SALES_DEAL_ALLOWED_FEATURE_KEYS,
  SALES_COMPANY_SEARCH_MIN_CHARS, SALES_DEAL_CYCLES_MAX, SALES_DEAL_DESCRIPTION_MAX, SALES_DEAL_MONTHS_MAX, SALES_DEAL_REASON_MAX,
  type SalesCompanySearchItem, type SalesDealBaseTier, type SalesDealView,
} from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { SelectField, SwitchField, TextField, TextareaField } from '@/common/components/field';
import { LoadingState } from '@/common/components/state';
import { Modal } from '@/common/components/modal';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { actSalesDeal, createSalesDeal, getSalesDeal, saveSalesDeal, searchSalesCompanies, type SalesDealAction } from './sales.api';
import {
  baseTierDefaults, baseTierFeatureKeys, baseTierLabel, dealAutoRenew, dealFormFromView, dealInputFromForm, dealPaymentNote, dealPriceState,
  dealWarnings, dealCatalogPriceSatang, emptyDealForm, firstDealErrorField, isDealCancellable, isDealEditable, isMenuSelected, parseBahtInput,
  SALES_DEAL_BASE_TIERS, SALES_DEAL_MENU_BINDINGS, SALES_DEAL_MENU_GROUPS, toggleMenuSelection, validateDealForm,
  type SalesDealFormErrors, type SalesDealFormValues,
} from './sales-console.logic';
import { SalesCompanyLine, SalesDealBadges, SalesDealStatusBadge, SalesDealSummary, SalesNotice } from './SalesConsoleParts';

const STATE_CONFLICT_MESSAGE = 'ดีลนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง';

/** Search-as-you-type over `/v1/sales/companies` (min 2 chars, ≤20 rows — R11/S33). */
function CompanyPicker({
  selected, onSelect, disabled, error,
}: { selected: SalesCompanySearchItem | null; onSelect: (company: SalesCompanySearchItem) => void; disabled: boolean; error?: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SalesCompanySearchItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < SALES_COMPANY_SEARCH_MIN_CHARS) { setItems(null); setSearchError(null); return; }
    const controller = new AbortController();
    // Typing is faster than the round trip and every call is audited (S33), so the keystrokes are
    // debounced rather than each one becoming an audit row.
    const timer = setTimeout(() => {
      setSearchError(null);
      searchSalesCompanies(term, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setItems(result.items); })
        .catch((cause) => { if (!controller.signal.aborted) { setItems([]); setSearchError(apiErrorMessage(cause)); } });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  if (selected && disabled) {
    return (
      <MangmeeCard className="p-3.5">
        <SalesCompanyLine company={selected} />
      </MangmeeCard>
    );
  }

  return (
    <div className="grid gap-2">
      <TextField
        label="ร้านค้า"
        name="dealCompanyQuery"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        hint={`พิมพ์ชื่อร้านอย่างน้อย ${SALES_COMPANY_SEARCH_MIN_CHARS} ตัวอักษร`}
        error={error}
        autoComplete="off"
      />
      {selected && (
        <MangmeeCard className="border-brand-200 bg-brand-25 p-3.5">
          <p className="text-xs font-semibold text-brand-800">ร้านที่เลือกไว้</p>
          <div className="mt-1"><SalesCompanyLine company={selected} /></div>
        </MangmeeCard>
      )}
      {searchError && <SalesNotice tone="error">{searchError}</SalesNotice>}
      {items && items.length === 0 && !searchError && <p className="text-sm text-gray-500">ไม่พบร้านที่ตรงกับคำค้นนี้</p>}
      {items && items.length > 0 && (
        <MangmeeCard>
          {items.map((company) => (
            <button
              key={company.companyId}
              type="button"
              disabled={Boolean(company.openDealId)}
              onClick={() => { onSelect(company); setQuery(''); setItems(null); }}
              className="flex w-full min-h-12 items-center justify-between gap-3 border-t border-gray-100 px-3.5 py-3 text-left first:border-t-0 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SalesCompanyLine company={company} />
              {company.openDealId && <span className="mangmee-badge mangmee-badge-amber shrink-0">มีดีลค้างอยู่</span>}
            </button>
          ))}
        </MangmeeCard>
      )}
    </div>
  );
}

/** preset + switches (spec §12): the preset fills the list, the per-menu toggles tune it. */
function MenuPicker({ featureKeys, onChange, disabled }: { featureKeys: string[]; onChange: (keys: string[]) => void; disabled: boolean }) {
  const selectedCount = useMemo(
    () => SALES_DEAL_MENU_BINDINGS.filter((binding) => isMenuSelected(featureKeys, binding)
      && binding.entitlementKeys.every((key) => SALES_DEAL_ALLOWED_FEATURE_KEYS.includes(key))).length
      + Number(featureKeys.includes('wht_50bis')),
    [featureKeys],
  );
  const legacyKeys = featureKeys.filter((key) => !SALES_DEAL_ALLOWED_FEATURE_KEYS.includes(key));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {(['starter', 'standard', 'full'] as const).map((presetKey) => (
          <button key={presetKey} type="button" disabled={disabled || presetKey !== 'starter'}
            onClick={() => onChange([...FEATURE_PACKAGE_PRESETS[presetKey].featureKeys])}
            className="mangmee-btn mangmee-btn-secondary">
            ชุด{FEATURE_PACKAGE_PRESETS[presetKey].labelTh}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange([])} className="mangmee-btn mangmee-btn-secondary">ล้างทั้งหมด</button>
      </div>
      <div className="grid gap-3">
        {SALES_DEAL_MENU_GROUPS.map((group) => {
          const bindings = SALES_DEAL_MENU_BINDINGS.filter((binding) => binding.group === group.key);
          if (bindings.length === 0) return null;
          return (
            <div key={group.key}>
              <p className="text-xs font-semibold text-gray-500">{group.label}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {bindings.map((binding) => {
                  const on = isMenuSelected(featureKeys, binding);
                  const available = binding.entitlementKeys.every((key) => SALES_DEAL_ALLOWED_FEATURE_KEYS.includes(key))
                    && binding.parentFeatureKey !== null && SALES_DEAL_ALLOWED_FEATURE_KEYS.includes(binding.parentFeatureKey);
                  return (
                    <button key={binding.navKey} type="button" disabled={disabled || !available}
                      onClick={() => onChange(toggleMenuSelection(featureKeys, binding, !on))}
                      aria-pressed={on}
                      className={`mangmee-btn ${on ? 'mangmee-btn-primary' : 'mangmee-btn-secondary'}`}>
                      {binding.labelTh}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" disabled={disabled} aria-pressed={featureKeys.includes('wht_50bis')}
        onClick={() => onChange(featureKeys.includes('wht_50bis')
          ? featureKeys.filter((key) => key !== 'wht_50bis')
          : [...featureKeys, 'wht_50bis'])}
        className={`mangmee-btn ${featureKeys.includes('wht_50bis') ? 'mangmee-btn-primary' : 'mangmee-btn-secondary'}`}>
        ออกหนังสือรับรอง 50 ทวิในระบบ
      </button>
      {legacyKeys.length > 0 && <p role="alert" className="text-sm text-amber-700">ดีลฉบับเดิมมีฟีเจอร์ที่ยังไม่เปิดขาย เลือกชุดเริ่มต้นก่อนบันทึกใหม่</p>}
      <p className="text-xs text-gray-400">เลือกไว้ {selectedCount} เมนู</p>
    </div>
  );
}

type DecisionKind = Exclude<SalesDealAction, 'submit'>;

const DECISION_COPY: Record<DecisionKind, { title: string; confirm: string; hint: string; required: boolean }> = {
  approve: { title: 'อนุมัติดีลนี้', confirm: 'อนุมัติ', hint: 'เมื่ออนุมัติแล้ว ระบบจะแจ้งเจ้าของร้านทาง LINE และข้อเสนอจะใช้ได้ 3 วัน', required: false },
  reject: { title: 'ปฏิเสธดีลนี้', confirm: 'ปฏิเสธ', hint: 'เซลล์จะเห็นเหตุผลนี้และแก้ไขดีลเดิมส่งใหม่ได้', required: true },
  cancel: { title: 'ยกเลิกดีลนี้', confirm: 'ยกเลิกดีล', hint: 'ยกเลิกแล้วแก้ไม่ได้ ต้องสร้างดีลใหม่หากลูกค้ายังสนใจ', required: true },
  // D-P5-6/7: ending never takes the shop's paid cycle away — it stops the next one at the deal
  // price. On บัตร the next cycle is the catalog price; on QR the next bill is simply not issued.
  end: { title: 'จบดีลนี้', confirm: 'จบดีล', hint: 'รอบที่ลูกค้าจ่ายแล้วยังใช้ได้ครบ รอบถัดไปกลับไปราคาปกติและเมนู/เครดิต AI ค่าเริ่มต้นของแพ็กเกจ', required: true },
};

const CADENCE_CHOICES = [['month', 'รายเดือน'], ['year', 'รายปี']] as const;

const AUTO_RENEW_HINT = 'ดีลอัตโนมัติจำกัดรอบเดือน/ปี · ลูกค้าเลือกจ่ายด้วยบัตร (ตัดอัตโนมัติ) หรือ QR (สแกนทุกงวด) · จบดีลแล้วกลับราคาปกติและเมนู/เครดิต AI ค่าเริ่มต้นของแพ็กเกจ';

export default function SalesDealFormPage({ dealId, companyId, canApprove }: { dealId?: string; companyId?: string; canApprove: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<SalesDealFormValues>(emptyDealForm);
  const [company, setCompany] = useState<SalesCompanySearchItem | null>(null);
  const [deal, setDeal] = useState<SalesDealView | null>(null);
  const [errors, setErrors] = useState<SalesDealFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(dealId || companyId));
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<DecisionKind | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setFormError(null);
    try {
      const view = await getSalesDeal(id);
      if (!mounted.current) return;
      setDeal(view);
      setValues(dealFormFromView(view));
      setCompany(view.company);
    } catch (cause) {
      if (mounted.current) setFormError(apiErrorMessage(cause));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { if (dealId) void load(dealId); }, [dealId, load]);

  useEffect(() => {
    if (dealId || !companyId) return;
    const preselectedCompanyId = companyId.trim();
    if (!preselectedCompanyId || preselectedCompanyId.length > 120) { setLoading(false); return; }
    let cancelled = false;
    searchSalesCompanies(preselectedCompanyId)
      .then(({ items }) => {
        const picked = items.find((item) => item.companyId === preselectedCompanyId);
        if (cancelled) return;
        if (!picked || picked.openDealId) { setFormError('ร้านนี้ไม่มีให้สร้างดีลใหม่ กรุณาตรวจรายการที่ค้างอยู่'); return; }
        setCompany(picked);
        setValues((previous) => ({ ...previous, companyId: picked.companyId }));
      })
      .catch((cause) => { if (!cancelled) setFormError(apiErrorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, dealId]);

  const editable = !deal || isDealEditable(deal.status);
  // D-P5-6: set by the return op, either automatically after cycle N or by a lead's "จบดีล".
  const endsAt = deal?.returnAt ?? null;
  const set = <K extends keyof SalesDealFormValues>(key: K, value: SalesDealFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const price = parseBahtInput(values.priceBaht);
  const months = /^\d+$/.test(values.months.trim()) ? Number(values.months.trim()) : null;
  // Compare the current form's base and term with the catalog; auto deals sell one cycle at a time.
  const catalogMonths = values.autoRenew ? values.cadence === 'year' ? 12 : 1 : months;
  const warnings = dealWarnings({
    priceSatang: price.ok ? price.satang : null,
    catalogPriceSatang: company && catalogMonths !== null ? dealCatalogPriceSatang(values.base, catalogMonths) : null,
    accessState: company?.accessState ?? null,
    // S31 likewise: the deal view's own copy of the counts once it exists, the picked search row
    // before that, so a limit below what the shop runs is called out on a brand-new form too.
    usage: deal
      ? { branchCount: deal.company.branchCount, employeeCount: deal.company.employeeCount }
      : company
        ? { branchCount: company.branchCount, employeeCount: company.employeeCount }
        : null,
    branchLimit: /^\d+$/.test(values.branchLimit.trim()) ? Number(values.branchLimit.trim()) : null,
    employeeLimit: /^\d+$/.test(values.employeeLimit.trim()) ? Number(values.employeeLimit.trim()) : null,
  });

  const focusField = (field: keyof SalesDealFormValues) => {
    const input = document.getElementById(field === 'companyId' ? 'dealCompanyQuery' : field);
    input?.scrollIntoView({ block: 'center' });
    if (input instanceof HTMLElement) input.focus();
  };

  const handleApiFailure = (cause: unknown) => {
    setFormError(apiErrorCode(cause) === 'SALES_DEAL_STATE_CONFLICT' ? STATE_CONFLICT_MESSAGE : apiErrorMessage(cause));
  };

  const persist = async (forSubmit: boolean) => {
    const found = validateDealForm(values, { forSubmit });
    setErrors(found);
    const first = firstDealErrorField(found);
    if (first) { setFormError(null); focusField(first); return; }

    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const body = { ...dealInputFromForm(values), ...(deal ? { version: deal.version } : {}) };
      const saved = deal ? await saveSalesDeal(deal.id, body) : await createSalesDeal(body);
      // Submit takes no reason (SalesDealSubmitDto is version-only) — the deal's own
      // internalReason was already saved above; a decision reason is only for approve/reject/cancel.
      const next = forSubmit
        ? await actSalesDeal(saved.id, 'submit', { version: saved.version })
        : saved;
      if (!mounted.current) return;
      setDeal(next);
      setValues(dealFormFromView(next));
      setCompany(next.company);
      setNotice(forSubmit ? 'ส่งให้หัวหน้าอนุมัติแล้ว' : 'บันทึกฉบับร่างแล้ว');
      if (!deal) router.replace(`/sales/deals/${encodeURIComponent(next.id)}`);
    } catch (cause) {
      if (mounted.current) handleApiFailure(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const runDecision = async () => {
    if (!deal || !decision) return;
    const reason = decisionReason.trim();
    if (DECISION_COPY[decision].required && !reason) return;
    setBusy(true);
    setFormError(null);
    try {
      const next = await actSalesDeal(deal.id, decision, { version: deal.version, reason });
      if (!mounted.current) return;
      setDeal(next);
      setValues(dealFormFromView(next));
      setDecision(null);
      setDecisionReason('');
      setNotice(decision === 'approve' ? 'อนุมัติแล้ว ระบบแจ้งเจ้าของร้านทาง LINE ให้เปิดหน้าแพ็กเกจ'
        : decision === 'reject' ? 'ปฏิเสธดีลแล้ว'
          : decision === 'end' ? 'ตั้งวันจบดีลแล้ว ระบบแจ้งเจ้าของร้านล่วงหน้า 14 วัน' : 'ยกเลิกดีลแล้ว');
    } catch (cause) {
      if (mounted.current) { setDecision(null); handleApiFailure(cause); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (loading) {
    return <MangmeePage eyebrow="ทีมขายมั่งมี" title="ดีล"><LoadingState label="กำลังโหลดดีล…" /></MangmeePage>;
  }

  return (
    <MangmeePage
      eyebrow={<Link href="/sales/deals" className="underline underline-offset-2">ดีล</Link>}
      title={deal ? deal.company.name : 'สร้างดีลใหม่'}
      description={deal ? `เซลล์ผู้ดูแล ${deal.salesDisplayName}` : 'ข้อเสนอพิเศษสำหรับร้านเดียว ราคาและสิทธิ์กำหนดเองได้'}
      meta={deal ? <><SalesDealStatusBadge status={deal.status} /><SalesDealBadges deal={deal} /></> : undefined}
    >
      {formError && <SalesNotice tone="error">{formError}</SalesNotice>}
      {formError === STATE_CONFLICT_MESSAGE && dealId && (
        <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" onClick={() => void load(dealId)}>โหลดข้อมูลล่าสุด</button>
      )}
      {notice && <SalesNotice tone="info">{notice}</SalesNotice>}
      {deal?.status === 'REJECTED' && deal.rejectedReason && (
        <SalesNotice tone="warning">เหตุผลที่หัวหน้าปฏิเสธ: {deal.rejectedReason}</SalesNotice>
      )}
      {deal && dealPaymentNote(deal) && <SalesNotice tone="info">{dealPaymentNote(deal)}</SalesNotice>}
      {/* D-P5-3: the shop cannot see an offer whose per-shop price is not ready. Saying so here is
          the difference between "ทำไมลูกค้าไม่เห็นข้อเสนอ" and a call to the team. */}
      {deal && dealPriceState(deal) && (
        <SalesNotice tone={dealPriceState(deal)!.tone === 'danger' ? 'error' : 'warning'}>{dealPriceState(deal)!.note}</SalesNotice>
      )}
      {deal?.status === 'APPROVED' && deal.offerExpiresAt && (
        <SalesNotice tone="info">
          อนุมัติโดย {deal.approvedByDisplayName ?? '—'} · ข้อเสนอใช้ได้ถึง {formatThaiDateTime(deal.offerExpiresAt)}
          {deal.selfApproved ? ' · อนุมัติโดยผู้สร้างเอง' : ''}
        </SalesNotice>
      )}
      {warnings.map((warning) => <SalesNotice key={warning} tone="warning">{warning}</SalesNotice>)}

      {!editable && deal && (
        <MangmeeCard className="p-4">
          <p className="mb-3 text-xs font-semibold text-gray-500">รายละเอียดข้อเสนอ (แก้ไขไม่ได้แล้ว)</p>
          <SalesDealSummary deal={deal} />
          {deal.internalReason && (
            <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600">
              <span className="font-semibold text-gray-500">เหตุผลภายใน: </span>{deal.internalReason}
            </p>
          )}
        </MangmeeCard>
      )}

      {editable && (
        <form className="grid gap-4" noValidate onSubmit={(event) => { event.preventDefault(); void persist(true); }}>
          <MangmeeCard className="grid gap-4 p-4">
            <CompanyPicker
              selected={company}
              disabled={Boolean(deal)}
              error={errors.companyId}
              onSelect={(picked) => { setCompany(picked); set('companyId', picked.companyId); }}
            />
            {company && (
              <p className="text-xs text-gray-400">
                ตอนนี้ร้านใช้อยู่ {deal?.company.branchCount ?? company.branchCount} สาขา · {deal?.company.employeeCount ?? company.employeeCount} ผู้ใช้
              </p>
            )}
          </MangmeeCard>

          <MangmeeCard className="grid gap-4 p-4">
            <SelectField
              label="แพ็กเกจฐาน"
              name="base"
              value={values.base}
              onChange={(event) => {
                // Phase 6: the picked package hands over its menus as well as its limits, so a deal
                // starts from what the customer's card promises instead of an empty picker.
                const base = event.target.value as SalesDealBaseTier;
                setValues((previous) => ({ ...previous, base, ...baseTierDefaults(base), featureKeys: baseTierFeatureKeys(base) }));
              }}
            >
              {SALES_DEAL_BASE_TIERS.map((tier) => <option key={tier} value={tier}>{baseTierLabel(tier)}</option>)}
            </SelectField>
            <SwitchField label="ต่ออายุอัตโนมัติ (ตัดบัตร/ออกบิล QR ทุกรอบ)" name="autoRenew" hint={AUTO_RENEW_HINT}
              checked={values.autoRenew} onChange={(event) => set('autoRenew', event.target.checked)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={values.autoRenew ? 'ราคาต่อรอบ (บาท)' : 'ราคาที่ลูกค้าจ่าย (บาท)'}
                name="priceBaht" inputMode="decimal"
                hint={values.autoRenew ? 'รวม VAT ถ้ามี · ราคาต่อ 1 รอบ ตัดทุกรอบที่ราคานี้' : 'รวม VAT ถ้ามี · ราคาทั้งดีล ไม่ใช่ต่อเดือน'}
                value={values.priceBaht} onChange={(event) => set('priceBaht', event.target.value)} error={errors.priceBaht} />
              {/* An auto-renewing deal has no month count to type: the cycle IS the term (D-P5-2). */}
              {!values.autoRenew && (
                <TextField label="จำนวนเดือน" name="months" inputMode="numeric" hint={`1–${SALES_DEAL_MONTHS_MAX} เดือน`}
                  value={values.months} onChange={(event) => set('months', event.target.value)} error={errors.months} />
              )}
            </div>
            {values.autoRenew && (
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="grid gap-1">
                  <legend className="text-sm font-medium text-gray-700">รอบการเก็บเงิน</legend>
                  {CADENCE_CHOICES.map(([value, label]) => (
                    <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-gray-700">
                      <input type="radio" name="cadence" className="size-5" checked={values.cadence === value}
                        onChange={() => set('cadence', value)} />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="grid gap-1">
                  <legend className="text-sm font-medium text-gray-700">ราคานี้ใช้ถึงเมื่อไร</legend>
                  <label className="flex min-h-11 items-center gap-3 text-sm text-gray-700">
                    <input type="radio" name="dealDuration" className="size-5" checked={!values.cycles}
                      onChange={() => set('cycles', '')} />
                    จนกว่าจะเพิกถอน
                  </label>
                  <label className="flex min-h-11 items-center gap-3 text-sm text-gray-700">
                    <input type="radio" name="dealDuration" className="size-5" checked={Boolean(values.cycles)}
                      onChange={() => set('cycles', '12')} />
                    ครบจำนวนรอบแล้วกลับราคาปกติ
                  </label>
                  {Boolean(values.cycles) && (
                    <TextField label="จำนวนรอบ" name="cycles" inputMode="numeric"
                      hint={`1–${SALES_DEAL_CYCLES_MAX} รอบ · ครบแล้วร้านกลับไปราคาปกติของแพ็กเกจฐาน`}
                      value={values.cycles} onChange={(event) => set('cycles', event.target.value)} error={errors.cycles} />
                  )}
                </fieldset>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="สาขา" name="branchLimit" inputMode="numeric" value={values.branchLimit}
                onChange={(event) => set('branchLimit', event.target.value)} error={errors.branchLimit} />
              <TextField label="ผู้ใช้" name="employeeLimit" inputMode="numeric" value={values.employeeLimit}
                onChange={(event) => set('employeeLimit', event.target.value)} error={errors.employeeLimit} />
              <TextField label="ใบเสร็จต่อเดือน" name="monthlySlipLimit" inputMode="numeric" value={values.monthlySlipLimit}
                onChange={(event) => set('monthlySlipLimit', event.target.value)} error={errors.monthlySlipLimit} />
            </div>
            <TextField label="เครดิตแชตต่อเดือน (credit)" name="aiBudgetBaht" inputMode="decimal"
              hint="เว้นว่าง = 50 credit · ค่า AI พิเศษที่ผู้ดูแลตั้งไว้ยังมีผล · ใบเสร็จคิดตามจำนวนที่อ่านสำเร็จ · ปิด AI = เอาเมนู AI ออกด้านล่าง"
              value={values.aiBudgetBaht} onChange={(event) => set('aiBudgetBaht', event.target.value)} error={errors.aiBudgetBaht} />
          </MangmeeCard>

          <MangmeeCard className="grid gap-3 p-4">
            <p className="text-sm font-semibold text-gray-700">เมนูที่ร้านได้ใช้</p>
            <MenuPicker featureKeys={values.featureKeys} disabled={busy} onChange={(keys) => set('featureKeys', keys)} />
            {errors.featureKeys && <p role="alert" className="text-sm text-red-700">{errors.featureKeys}</p>}
          </MangmeeCard>

          <MangmeeCard className="grid gap-4 p-4">
            <TextareaField label="โน้ตถึงลูกค้า" name="description" maxLength={SALES_DEAL_DESCRIPTION_MAX}
              hint={`ลูกค้าเห็นข้อความนี้ในหน้าแพ็กเกจ · ไม่เกิน ${SALES_DEAL_DESCRIPTION_MAX} ตัวอักษร · ห้ามใส่เครื่องหมาย +`}
              value={values.description} onChange={(event) => set('description', event.target.value)} error={errors.description} />
            <TextareaField label="เหตุผลภายใน" name="internalReason" maxLength={SALES_DEAL_REASON_MAX}
              hint="ทีมขายเห็นเท่านั้น ลูกค้าไม่เห็น · ห้ามใส่ข้อมูลส่วนบุคคลของลูกค้า"
              value={values.internalReason} onChange={(event) => set('internalReason', event.target.value)} error={errors.internalReason} />
          </MangmeeCard>

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy} onClick={() => void persist(false)}>บันทึกฉบับร่าง</button>
            <button type="submit" className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy}>ส่งอนุมัติ</button>
          </div>
        </form>
      )}

      {deal && (
        <div className="grid gap-2 sm:grid-cols-2">
          {canApprove && deal.status === 'PENDING_APPROVAL' && (
            <>
              <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy} onClick={() => { setDecisionReason(''); setDecision('approve'); }}>อนุมัติ</button>
              <button type="button" className="mangmee-btn mangmee-btn-danger" disabled={busy} onClick={() => { setDecisionReason(''); setDecision('reject'); }}>ปฏิเสธ</button>
            </>
          )}
          {isDealCancellable(deal.status) && (
            <button type="button" className="mangmee-btn mangmee-btn-secondary sm:col-span-2" disabled={busy} onClick={() => { setDecisionReason(''); setDecision('cancel'); }}>ยกเลิกดีล</button>
          )}
          {/* D-P5-6: only a running auto-renewing deal can be ended, and only once — a deal whose
              return date is already set has nothing left to decide. */}
          {canApprove && deal.status === 'APPLIED' && dealAutoRenew(deal.snapshot) && !endsAt && (
            <button type="button" className="mangmee-btn mangmee-btn-secondary sm:col-span-2" disabled={busy} onClick={() => { setDecisionReason(''); setDecision('end'); }}>จบดีล</button>
          )}
        </div>
      )}

      <Modal open={decision !== null} onClose={() => setDecision(null)} title={decision ? DECISION_COPY[decision].title : ''}>
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-gray-600">{decision ? DECISION_COPY[decision].hint : ''}</p>
          <TextareaField
            label={decision && DECISION_COPY[decision].required ? 'เหตุผล (จำเป็น)' : 'เหตุผล (ไม่บังคับ)'}
            name="decisionReason"
            maxLength={SALES_DEAL_REASON_MAX}
            value={decisionReason}
            onChange={(event) => setDecisionReason(event.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setDecision(null)}>ปิด</button>
            <button type="button" className="mangmee-btn mangmee-btn-primary" aria-busy={busy}
              disabled={busy || (decision !== null && DECISION_COPY[decision].required && !decisionReason.trim())}
              onClick={() => void runDecision()}>
              {decision ? DECISION_COPY[decision].confirm : ''}
            </button>
          </div>
        </div>
      </Modal>
    </MangmeePage>
  );
}

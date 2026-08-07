'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ChartOfAccountsReadiness,
  ChartTemplateApplyMode,
  TaxCodeDefinitionDto,
  TaxCodeProfileDto,
  TaxProfileSetupBlocker,
  TaxProfileSetupReadiness,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import {
  applyChartTemplate,
  getChartReadiness,
  listChartTemplates,
  listLedgerAccounts,
  previewChartTemplate,
  type ChartTemplateMetadata,
  type ChartTemplatePreviewResult,
  type LedgerAccount,
} from '@/features/ledger/ledger.api';
import {
  activateTaxCodeProfile,
  createTaxCodeProfileFromTemplate,
  getTaxCodeProfileReadiness,
  listTaxCodeDefinitions,
  listTaxCodeProfileTemplates,
  listTaxCodeProfiles,
  upsertTaxAccountRule,
  upsertTaxReportMapping,
  type TaxCodeProfileTemplate,
} from '@/features/tax/transaction-tax.api';
import { transactionTaxErrorMessage } from '@/features/tax/transaction-tax.model';
import { useNotVatRegistered } from './vat-registration-notice';
import {
  ACCOUNTING_TAX_SETUP_STEPS,
  accountingTaxSetupHref,
  earliestAccountingTaxSetupStep,
  guidedAccountRuleInput,
  guidedReportRuleInput,
  safeAccountingReturnTo,
  type AccountingTaxSetupStep,
} from './accounting-tax-setup.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

type Props = {
  companyId: string;
  permissions: string[];
  step: AccountingTaxSetupStep;
  initialMode?: string;
  initialProfileId?: string;
  returnTo?: string;
};

const primary = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';
const cardRow = 'rounded-xl border border-gray-200 bg-white p-4';

const has = (permissions: string[], permission: string) => permissions.includes(permission);

function blockerLabel(blocker: TaxProfileSetupBlocker): string {
  if (blocker.code === 'missing_account_rule') return `ยังไม่ผูกบัญชี ${blocker.accountRole} / ${blocker.postingSide}`;
  if (blocker.code === 'missing_report_rule') return `ยังไม่ผูกรายงาน ${blocker.formType} / ${blocker.boxKey} / ${blocker.amountSource}`;
  if (blocker.code === 'profile_has_no_definitions') return 'Profile ยังไม่มี Tax Code';
  if (blocker.kind === 'PROFILE_OVERLAP') return 'ช่วงวันที่ Profile ซ้อนกับ Profile ที่เปิดใช้งานอยู่';
  if (blocker.kind === 'EFFECTIVE_WINDOW') return 'ช่วงวันที่ของกฎยังครอบคลุม Tax Code ไม่ครบ';
  if (blocker.kind === 'DEFINITION') return 'ความหมายของ Tax Code ยังไม่ผ่านการตรวจสอบ';
  return `การตั้งค่า ${blocker.externalTaxCode ?? ''} ยังไม่สมบูรณ์`;
}

function readinessWarningLabel(code: string): string {
  if (code === 'profile_already_active') return 'ชุดรหัสภาษี (Tax Profile) นี้เปิดใช้งานแล้ว';
  if (code === 'profile_readiness_blockers_truncated') return 'มีรายการที่ต้องแก้จำนวนมาก หน้านี้แสดงเฉพาะ 500 รายการแรก';
  return 'มีคำเตือนจากการตรวจความพร้อม กรุณาตรวจการตั้งค่าขั้นสูง';
}

function Stepper({
  companyId,
  current,
  profileId,
  returnTo,
}: {
  companyId: string;
  current: AccountingTaxSetupStep;
  profileId?: string;
  returnTo?: string;
}) {
  const active = current === 'chart-review' ? 'chart' : current;
  return (
    <nav aria-label="ขั้นตอนตั้งค่าบัญชีและภาษี" className="mb-6 overflow-x-auto">
      <ol className="flex w-max min-w-full items-center gap-2">
        {ACCOUNTING_TAX_SETUP_STEPS.map((item, index) => {
          const selected = item.key === active;
          return (
            <li key={item.key} className="flex items-center gap-2">
              <Link
                href={accountingTaxSetupHref(companyId, item.key, { profileId, returnTo })}
                aria-current={selected ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold ${
                  selected ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  selected ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>{index + 1}</span>
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
              {index < ACCOUNTING_TAX_SETUP_STEPS.length - 1 && <span aria-hidden="true" className="text-gray-300">→</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AccountingTaxSetupPage({
  companyId,
  permissions,
  step,
  initialMode,
  initialProfileId,
  returnTo,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const canChartRead = has(permissions, 'ledger.account.read');
  const canChartManage = has(permissions, 'ledger.account.manage');
  const canProfileRead = has(permissions, 'tax.profile.read');
  const canProfileManage = has(permissions, 'tax.profile.manage') && has(permissions, 'tax.config.manage');
  const canConfigRead = has(permissions, 'tax.config.read');
  const canMapAccounts = has(permissions, 'ledger.posting-rule.manage') && has(permissions, 'tax.config.manage');
  const canMapReports = has(permissions, 'tax.config.manage');
  const prerequisitesReady = canChartRead && canProfileRead && canConfigRead;
  const notVatRegistered = useNotVatRegistered(companyId);

  const [profiles, setProfiles] = useState<TaxCodeProfileDto[]>([]);
  const [taxTemplates, setTaxTemplates] = useState<TaxCodeProfileTemplate[]>([]);
  const [chartTemplates, setChartTemplates] = useState<ChartTemplateMetadata[]>([]);
  const [chartReadiness, setChartReadiness] = useState<ChartOfAccountsReadiness | null>(null);
  const [profileId, setProfileId] = useState(initialProfileId ?? '');
  const [profileReadiness, setProfileReadiness] = useState<TaxProfileSetupReadiness | null>(null);
  const [definitions, setDefinitions] = useState<TaxCodeDefinitionDto[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [preview, setPreview] = useState<ChartTemplatePreviewResult | null>(null);
  const [applyMode, setApplyMode] = useState<ChartTemplateApplyMode>('MISSING_ONLY');
  const [acknowledgeConflicts, setAcknowledgeConflicts] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayCivilDate());
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activated, setActivated] = useState(false);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextReadiness, nextChartTemplates, nextProfiles, nextTaxTemplates] = await Promise.all([
        canChartRead ? getChartReadiness(companyId) : Promise.resolve(null),
        canChartRead ? listChartTemplates(companyId) : Promise.resolve([]),
        canProfileRead ? listTaxCodeProfiles(companyId) : Promise.resolve([]),
        canProfileRead ? listTaxCodeProfileTemplates(companyId) : Promise.resolve([]),
      ]);
      setChartReadiness(nextReadiness);
      setChartTemplates(nextChartTemplates);
      setProfiles(nextProfiles);
      setTaxTemplates(nextTaxTemplates);
      setProfileId((current) => {
        if (initialProfileId && nextProfiles.some((item) => item.id === initialProfileId)) return initialProfileId;
        if (current && nextProfiles.some((item) => item.id === current)) return current;
        const eligible = nextProfiles.filter((item) => item.status !== 'RETIRED');
        return eligible.length === 1 ? eligible[0]!.id : '';
      });
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [canChartRead, canProfileRead, companyId, initialProfileId]);

  const loadProfile = useCallback(async (id: string) => {
    if (!id || !canConfigRead || !canProfileRead) {
      setProfileReadiness(null);
      setDefinitions([]);
      return null;
    }
    try {
      const [readiness, nextDefinitions] = await Promise.all([
        getTaxCodeProfileReadiness(companyId, id),
        listTaxCodeDefinitions(companyId, { profileId: id }),
      ]);
      setProfileReadiness(readiness);
      setDefinitions(nextDefinitions);
      return readiness;
    } catch (cause) {
      setError(transactionTaxErrorMessage(cause));
      return null;
    }
  }, [canConfigRead, canProfileRead, companyId]);

  useEffect(() => { void loadBase(); }, [loadBase]);
  useEffect(() => { void loadProfile(profileId); }, [loadProfile, profileId]);

  useEffect(() => {
    if (step !== 'chart-review' || !canChartRead) return;
    setLoading(true);
    previewChartTemplate(companyId, 'TH_SME_COA_V1')
      .then(setPreview)
      .catch((cause) => setError(apiErrorMessage(cause)))
      .finally(() => setLoading(false));
  }, [canChartRead, companyId, step]);

  useEffect(() => {
    if (step !== 'mappings' || !canChartRead) return;
    listLedgerAccounts(companyId).then(setAccounts).catch((cause) => setError(apiErrorMessage(cause)));
  }, [canChartRead, companyId, step]);

  const selectedProfile = profiles.find((item) => item.id === profileId) ?? null;
  // The guided wizard installs the standard Thai set and nothing else. It used to offer a
  // "บัญชีไทยมาตรฐาน / SAP ERP" choice on a screen where every prerequisite still read
  // "ยังเปิดให้ใช้ไม่ได้" — a live control over a decision the shop owner it is written for cannot
  // evaluate. The SAP path keeps all three of its homes on the Tax Code settings page: the
  // built-in template list, the canonical CSV/JSON import, and manual profile creation.
  const availableTemplates = useMemo(
    () => taxTemplates.filter((item) => item.sourceSystem === 'WATCHDOG'),
    [taxTemplates],
  );
  useEffect(() => {
    if (!availableTemplates.some((item) => item.key === selectedTemplateKey)) {
      setSelectedTemplateKey(availableTemplates[0]?.key ?? '');
    }
  }, [availableTemplates, selectedTemplateKey]);

  const chartReady = Boolean(chartReadiness?.chartTemplateApplied && chartReadiness.chartConflicts === 0);
  const safeReturnTo = safeAccountingReturnTo(companyId, returnTo);
  const workflowParams = { profileId: profileId || undefined, returnTo: safeReturnTo ?? undefined };
  const currentStep = earliestAccountingTaxSetupStep({
    prerequisitesReady,
    chartReady,
    profileId: profileId || undefined,
    profileReady: Boolean(profileReadiness?.canActivate || selectedProfile?.status === 'ACTIVE'),
  });

  const missingAccountBlockers = useMemo(
    () => profileReadiness?.blockers.filter((item) => item.code === 'missing_account_rule') ?? [],
    [profileReadiness],
  );
  const missingReportBlockers = useMemo(
    () => profileReadiness?.blockers.filter((item) => item.code === 'missing_report_rule') ?? [],
    [profileReadiness],
  );
  const otherBlockers = useMemo(
    () => profileReadiness?.blockers.filter((item) => !['missing_account_rule', 'missing_report_rule'].includes(item.code)) ?? [],
    [profileReadiness],
  );
  const mappingManifest = useMemo(
    () => chartTemplates.find((item) => item.templateKey === chartReadiness?.chartTemplateKey)
      ?? chartTemplates.find((item) => item.templateKey === 'TH_SME_COA_V1'),
    [chartReadiness?.chartTemplateKey, chartTemplates],
  );
  const requiresAdvancedMapping = Boolean(
    selectedProfile && selectedProfile.sourceSystem !== 'WATCHDOG' && !profileReadiness?.canActivate,
  );

  useEffect(() => {
    if (!missingAccountBlockers.length || !accounts.length || !mappingManifest) return;
    setAccountSelections((current) => {
      const next = { ...current };
      for (const blocker of missingAccountBlockers) {
        const key = `${blocker.taxCodeDefinitionId}:${blocker.accountRole}:${blocker.postingSide}`;
        if (next[key]) continue;
        const suggestion = mappingManifest.mappingSuggestions.find((item) => item.kind === 'TAX' && item.key === blocker.accountRole);
        const account = accounts.find((item) => item.code === suggestion?.accountCode && item.status === 'ACTIVE' && item.isPosting);
        if (account) next[key] = account.id;
      }
      return next;
    });
  }, [accounts, mappingManifest, missingAccountBlockers]);

  async function applyChart() {
    if (!preview) return;
    const conflicts = preview.unusedConflicts + preview.inUseConflicts;
    if (conflicts > 0 && !acknowledgeConflicts) {
      setError('กรุณายืนยันว่าตรวจรายการขัดแย้งแล้ว');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await applyChartTemplate(companyId, preview.templateKey, {
        expectedTemplateChecksum: preview.templateChecksum,
        expectedPreviewChecksum: preview.previewChecksum,
        mode: applyMode,
        acknowledgeConflicts: conflicts > 0,
      });
      router.push(accountingTaxSetupHref(companyId, 'profile', workflowParams));
    } catch (cause) {
      setError(apiErrorMessage(cause));
      try { setPreview(await previewChartTemplate(companyId, 'TH_SME_COA_V1')); } catch { setPreview(null); }
    } finally {
      setBusy(false);
    }
  }

  async function createProfile() {
    if (!selectedTemplateKey || !effectiveFrom) return;
    setBusy(true);
    setError('');
    try {
      const result = await createTaxCodeProfileFromTemplate(companyId, selectedTemplateKey as TaxCodeProfileTemplate['key'], effectiveFrom);
      setProfileId(result.profile.id);
      router.push(accountingTaxSetupHref(companyId, 'mappings', { ...workflowParams, profileId: result.profile.id }));
    } catch (cause) {
      setError(transactionTaxErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveMappings() {
    if (!selectedProfile) return;
    setBusy(true);
    setError('');
    try {
      for (const blocker of missingAccountBlockers) {
        const definition = definitions.find((item) => item.id === blocker.taxCodeDefinitionId);
        const selectionKey = `${blocker.taxCodeDefinitionId}:${blocker.accountRole}:${blocker.postingSide}`;
        const accountId = accountSelections[selectionKey];
        if (!definition || !accountId || !blocker.accountRole || !blocker.postingSide) throw new Error(`กรุณาเลือกบัญชีสำหรับ ${blocker.externalTaxCode ?? ''}`);
        await upsertTaxAccountRule(companyId, guidedAccountRuleInput(definition, blocker, accountId));
      }
      for (const blocker of missingReportBlockers) {
        const definition = definitions.find((item) => item.id === blocker.taxCodeDefinitionId);
        if (!definition || !blocker.formType || !blocker.boxKey || !blocker.amountSource) throw new Error('ข้อมูลกฎรายงานไม่ครบ');
        await upsertTaxReportMapping(companyId, guidedReportRuleInput(definition, blocker));
      }
      const readiness = await loadProfile(selectedProfile.id);
      if (readiness?.canActivate) router.push(accountingTaxSetupHref(companyId, 'review', workflowParams));
      else toast.success('บันทึกการตั้งค่าเรียบร้อยแล้ว');
    } catch (cause) {
      setError(transactionTaxErrorMessage(cause));
      await loadProfile(selectedProfile.id);
    } finally {
      setBusy(false);
    }
  }

  async function activateProfile() {
    if (!selectedProfile) return;
    setBusy(true);
    setError('');
    try {
      await activateTaxCodeProfile(companyId, selectedProfile.id);
      setActivated(true);
      await loadBase();
      await loadProfile(selectedProfile.id);
      toast.success('เปิดใช้งานชุดรหัสภาษีเรียบร้อยแล้ว');
    } catch (cause) {
      setError(transactionTaxErrorMessage(cause));
      await loadProfile(selectedProfile.id);
    } finally {
      setBusy(false);
    }
  }

  const back = (target: AccountingTaxSetupStep) => (
    <Link className={secondary} href={accountingTaxSetupHref(companyId, target, workflowParams)}>ย้อนกลับ</Link>
  );

  // A <Link> cannot be disabled. The old `aria-disabled + pointer-events-none` pair stopped the
  // mouse and nothing else: a keyboard user still tabbed onto the blocked step and Enter still
  // navigated past the gate it was drawn to enforce. A span is genuinely inert — not focusable,
  // not activatable — and keeps the button's look.
  const next = (target: AccountingTaxSetupStep, label: string, enabled: boolean) => (
    enabled
      ? <Link className={primary} href={accountingTaxSetupHref(companyId, target, workflowParams)}>{label}</Link>
      : <span className={`${primary} cursor-not-allowed opacity-50`} aria-disabled="true">{label}</span>
  );

  let content;
  if (step === 'overview') {
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">สถานะการตั้งค่า</h2>
        {/* Context, never a gate. The steps all stay reachable: a company that registers for VAT
            later must not have to hunt for a screen that quietly removed itself. */}
        {notVatRegistered && (
          <p className="mt-3 rounded-lg border border-blue-200 bg-blue-light-50 px-4 py-3 text-sm text-blue-700">
            บริษัทนี้ตอบว่า<strong>ยังไม่ได้จดทะเบียน VAT</strong> — ขั้นผังบัญชียังจำเป็นสำหรับการลงบัญชี
            ส่วนขั้นชุดรหัสภาษีและการผูกรายงานยังไม่จำเป็น ทำได้เมื่อจดทะเบียน VAT แล้ว
          </p>
        )}
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className={cardRow}><dt className="text-xs text-gray-500">สิทธิ์ที่จำเป็น</dt><dd className="mt-1 font-bold">{prerequisitesReady ? 'พร้อม' : 'ต้องตรวจสอบ'}</dd></div>
          <div className={cardRow}><dt className="text-xs text-gray-500">ผังบัญชี</dt><dd className="mt-1 font-bold">{chartReady ? 'พร้อม' : 'ยังไม่พร้อม'}</dd></div>
          <div className={cardRow}><dt className="text-xs text-gray-500">ชุดรหัสภาษี (Tax Profile)</dt><dd className="mt-1 font-bold">{selectedProfile?.status ?? 'ยังไม่มี'}</dd></div>
        </dl>
        {!loading && (
          <div className="mt-6 flex justify-end">
            <Link className={primary} href={accountingTaxSetupHref(companyId, currentStep, workflowParams)}>
              {currentStep === 'review' ? 'ตรวจการตั้งค่าที่ใช้งานอยู่' : 'เริ่มตั้งค่าหรือทำต่อ'}
            </Link>
          </div>
        )}
      </MangmeeCard>
    );
  } else if (step === 'prerequisites') {
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">ก่อนเริ่ม ต้องมี 3 อย่างนี้</h2>
        <p className="mt-1 text-sm text-gray-600">ทั้งสามอย่างตั้งค่าครั้งเดียว หลังจากนั้นระบบลงบัญชีและออกรายงานภาษีให้เอง</p>
        <div className="mt-4 space-y-3">
          {[
            {
              label: 'ผังบัญชี',
              what: 'รายชื่อบัญชีทั้งหมดของบริษัท เช่น เงินสด ลูกหนี้ รายได้ ค่าใช้จ่าย เปรียบเหมือนช่องเก็บเงินแต่ละประเภท ถ้ายังไม่มี ระบบจะไม่รู้ว่าเงินแต่ละก้อนต้องลงช่องไหน',
              readable: canChartRead,
              manageable: canChartManage,
              need: 'ให้ผู้ดูแลระบบเปิดใช้งานระบบบัญชีคู่ แล้วให้เจ้าของบริษัทเปิดสิทธิ์ดูและแก้ไขผังบัญชีให้บัญชีของคุณ',
            },
            {
              label: 'ชุดรหัสภาษี (Tax Profile)',
              what: 'ชุดภาษีที่บริษัทใช้จริง เช่น VAT 7% ยกเว้น VAT หรือหัก ณ ที่จ่าย 3% บอกระบบว่าเวลาออกบิลหรือบันทึกค่าใช้จ่ายต้องคิดภาษีแบบไหน กี่เปอร์เซ็นต์',
              readable: canProfileRead,
              manageable: canProfileManage,
              need: 'ให้ผู้ดูแลระบบเปิดใช้งานระบบภาษีไทย แล้วให้เจ้าของบริษัทเปิดสิทธิ์ดูและแก้ไขชุดรหัสภาษีให้บัญชีของคุณ',
            },
            {
              label: 'การผูกบัญชีและรายงาน',
              what: 'การจับคู่ว่ารหัสภาษีแต่ละตัวจะลงบัญชีไหนในผังบัญชี และไปโผล่ช่องไหนในรายงานภาษีซื้อ-ขายและแบบ ภ.พ.30 ทำครั้งเดียวจบ ไม่ต้องมานั่งกรอกเองทุกเดือน',
              readable: canConfigRead,
              manageable: canMapAccounts && canMapReports,
              need: 'ให้ผู้ดูแลระบบเปิดใช้งานระบบภาษีไทย แล้วให้เจ้าของบริษัทเปิดสิทธิ์ผูกบัญชีและตั้งค่ารายงานภาษีให้บัญชีของคุณ',
            },
          ].map(({ label, what, readable, manageable, need }) => (
            <div key={label} className={cardRow}>
              <div className="flex items-center justify-between gap-3">
                <strong>{label}</strong>
                <span className={readable && manageable ? 'text-green-700' : 'text-amber-700'}>
                  {!readable ? 'ยังเปิดให้ใช้ไม่ได้' : manageable ? 'พร้อมตั้งค่า' : 'ดูได้ แต่ยังแก้ไม่ได้'}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{what}</p>
              {(!readable || !manageable) && <p className="mt-2 text-sm text-amber-700">{need}</p>}
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          {next('chart', 'ถัดไป: ตรวจผังบัญชี', prerequisitesReady)}
        </div>
      </MangmeeCard>
    );
  } else if (step === 'chart') {
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">ตรวจสถานะผังบัญชี</h2>
        {!canChartRead ? <p role="alert" className="mt-4 text-sm text-red-700">ไม่มีสิทธิ์ ledger.account.read</p> : (
          <>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt>จำนวนบัญชี</dt><dd className="font-bold">{chartReadiness?.chartAccountCount ?? '-'}</dd></div>
              <div className="flex justify-between gap-3"><dt>Template</dt><dd className="font-bold">{chartReadiness?.chartTemplateKey ?? 'ยังไม่มีที่มา'}</dd></div>
              <div className="flex justify-between gap-3"><dt>รายการขัดแย้ง</dt><dd className="font-bold">{chartReadiness?.chartConflicts ?? '-'}</dd></div>
            </dl>
            <p className="mt-4 text-sm text-gray-600">ขั้นถัดไปเป็น Preview เท่านั้น ระบบยังไม่เปลี่ยนบัญชีจนกว่าจะยืนยันในหน้าแยก</p>
          </>
        )}
        <div className="mt-6 flex justify-between gap-3">
          {back('prerequisites')}
          {next(
            chartReady ? 'profile' : 'chart-review',
            chartReady ? 'ถัดไป: ตั้งค่าชุดรหัสภาษี (Tax Profile)' : 'ถัดไป: ตรวจผลกระทบ',
            canChartRead,
          )}
        </div>
      </MangmeeCard>
    );
  } else if (step === 'chart-review') {
    const conflictCount = (preview?.unusedConflicts ?? 0) + (preview?.inUseConflicts ?? 0);
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">ตรวจผลกระทบก่อนใช้ผังบัญชี</h2>
        {preview && (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className={cardRow}><dt className="text-xs text-gray-500">ตรงกัน</dt><dd className="text-xl font-bold">{preview.exact}</dd></div>
              <div className={cardRow}><dt className="text-xs text-gray-500">จะสร้าง</dt><dd className="text-xl font-bold">{preview.missing}</dd></div>
              <div className={cardRow}><dt className="text-xs text-gray-500">แก้ได้</dt><dd className="text-xl font-bold">{preview.unusedConflicts}</dd></div>
              <div className={cardRow}><dt className="text-xs text-gray-500">กำลังใช้งาน</dt><dd className="text-xl font-bold">{preview.inUseConflicts}</dd></div>
            </dl>
            {conflictCount > 0 && (
              <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-600"><tr><th className="p-3">รหัส</th><th className="p-3">ผลกระทบ</th><th className="p-3">ถูกใช้อ้างอิง</th><th className="p-3">ข้อมูลที่ต่าง</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.rows.filter((row) => row.classification.endsWith('CONFLICT')).map((row) => (
                      <tr key={row.code}>
                        <td className="p-3 font-bold">{row.code}</td>
                        <td className="p-3">{row.classification === 'IN_USE_CONFLICT' ? 'กำลังใช้งาน — ไม่แทนที่' : 'ยังไม่ใช้งาน'}</td>
                        <td className="p-3">{row.dependencyCount}</td>
                        <td className="p-3">{row.differingFields.join(', ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="mt-4 block text-sm font-bold">วิธีใช้ Template
              <ThemedSelect className="mt-2" value={applyMode} onChange={(event) => setApplyMode(event.target.value as ChartTemplateApplyMode)}>
                <option value="MISSING_ONLY">เพิ่มเฉพาะบัญชีที่ขาด</option>
                <option value="REPLACE_UNUSED">เพิ่มและแทนที่เฉพาะบัญชีที่ยังไม่ถูกใช้</option>
              </ThemedSelect>
            </label>
            {conflictCount > 0 && (
              <label className="mt-4 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-700" checked={acknowledgeConflicts} onChange={(event) => setAcknowledgeConflicts(event.target.checked)} />
                ตรวจรายการขัดแย้งแล้ว และยอมรับว่ารายการที่กำลังใช้งานจะไม่ถูกแทนที่
              </label>
            )}
          </>
        )}
        <div className="mt-6 flex justify-between gap-3">
          {back('chart')}
          <button type="button" className={primary} disabled={!preview || !canChartManage || busy || (conflictCount > 0 && !acknowledgeConflicts)} onClick={() => void applyChart()}>
            {busy ? 'กำลังบันทึก...' : 'ยืนยันใช้ผังบัญชีและไปต่อ'}
          </button>
        </div>
        {!canChartManage && <p className="mt-2 text-right text-xs text-amber-700">ต้องมีสิทธิ์ ledger.account.manage</p>}
      </MangmeeCard>
    );
  } else if (step === 'profile') {
    const existingTarget = selectedProfile && selectedProfile.status !== 'RETIRED';
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">เลือกหรือสร้างชุดรหัสภาษี (Tax Profile)</h2>
        {profiles.filter((item) => item.status !== 'RETIRED').length > 0 && (
          <label className="mt-4 block text-sm font-bold">ทำต่อจาก Profile เดิม
            <ThemedSelect className="mt-2" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              <option value="">เลือก Profile</option>
              {profiles.filter((item) => item.status !== 'RETIRED').map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.status}</option>
              ))}
            </ThemedSelect>
          </label>
        )}
        {!existingTarget && (
          <>
            <div className="mt-4 space-y-2">
              {availableTemplates.map((item) => (
                <label key={item.key} className={`${cardRow} flex cursor-pointer items-start gap-3`}>
                  <input type="radio" className="mt-1 h-4 w-4 shrink-0 accent-brand-700" name="template" value={item.key} checked={selectedTemplateKey === item.key} onChange={() => setSelectedTemplateKey(item.key)} />
                  <span><strong>{item.name}</strong><span className="mt-1 block text-xs text-gray-500">{item.definitionCount} Tax Codes · {item.warning}</span></span>
                </label>
              ))}
            </div>
            <label className="mt-4 block text-sm font-bold">เริ่มมีผลวันที่
              <input className="mangmee-input mt-2 w-full" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </label>
          </>
        )}
        <div className="mt-6 flex justify-between gap-3">
          {back('chart')}
          {existingTarget ? (
            <Link className={primary} href={accountingTaxSetupHref(companyId, selectedProfile.status === 'ACTIVE' ? 'review' : 'mappings', workflowParams)}>
              {selectedProfile.status === 'ACTIVE' ? 'ตรวจการตั้งค่าที่ใช้งานอยู่' : 'ถัดไป: ตรวจการผูกบัญชีและรายงาน'}
            </Link>
          ) : (
            <button type="button" className={primary} disabled={!canProfileManage || !selectedTemplateKey || !effectiveFrom || busy} onClick={() => void createProfile()}>
              {busy ? 'กำลังสร้าง...' : 'สร้าง Draft และไปต่อ'}
            </button>
          )}
        </div>
        {!canProfileManage && <p className="mt-2 text-right text-xs text-amber-700">ต้องมีสิทธิ์ tax.profile.manage และ tax.config.manage</p>}
      </MangmeeCard>
    );
  } else if (step === 'mappings') {
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">ตรวจการผูกบัญชีและรายงาน</h2>
        {!selectedProfile ? (
          <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">กรุณาเลือกชุดรหัสภาษี (Tax Profile) ก่อน</div>
        ) : (
          <div className="mt-4 space-y-4">
            {missingAccountBlockers.map((blocker) => {
              const key = `${blocker.taxCodeDefinitionId}:${blocker.accountRole}:${blocker.postingSide}`;
              const suggestedCode = mappingManifest?.mappingSuggestions.find((item) => item.kind === 'TAX' && item.key === blocker.accountRole)?.accountCode;
              return (
                <div key={key} className={cardRow}>
                  <strong>{blocker.externalTaxCode} · {blocker.accountRole}</strong>
                  <p className="mt-1 text-xs text-gray-500">ด้าน {blocker.postingSide} · ข้อเสนอจาก {mappingManifest?.templateKey ?? 'ไม่มี Template'} {suggestedCode ? `→ ${suggestedCode}` : ''}</p>
                  {mappingManifest && (
                    <p className="mt-1 text-xs text-gray-400">
                      Template v{mappingManifest.templateVersion} · mapping v{mappingManifest.mappingManifestVersion} · checksum {mappingManifest.mappingManifestChecksum.slice(0, 8)}…
                    </p>
                  )}
                  <ThemedSelect className="mt-3" value={accountSelections[key] ?? ''} onChange={(event) => setAccountSelections((current) => ({ ...current, [key]: event.target.value }))}>
                    <option value="">เลือกบัญชี</option>
                    {accounts.filter((item) => item.status === 'ACTIVE' && item.isPosting).map((item) => (
                      <option key={item.id} value={item.id}>{item.code} · {item.nameTh}</option>
                    ))}
                  </ThemedSelect>
                </div>
              );
            })}
            {missingReportBlockers.map((blocker) => (
              <div key={`${blocker.taxCodeDefinitionId}:${blocker.formType}:${blocker.boxKey}:${blocker.amountSource}`} className={cardRow}>
                <strong>{blocker.externalTaxCode} · {blocker.formType}</strong>
                <p className="mt-1 text-sm text-gray-600">{blocker.boxKey} · ใช้ยอด {blocker.amountSource} · Normal</p>
              </div>
            ))}
            {otherBlockers.map((blocker, index) => <div key={`${blocker.code}:${index}`} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{blockerLabel(blocker)}</div>)}
            {(profileReadiness?.warnings ?? []).map((warning) => (
              <div key={warning.code} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{readinessWarningLabel(warning.code)}</div>
            ))}
            {requiresAdvancedMapping && (
              <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                SAP/ERP Profile มีหลายบริบทและกฎเฉพาะบริษัท กรุณาตรวจและบันทึกใน Tax Account Determination ขั้นสูงก่อนกลับมาหน้านี้
              </div>
            )}
            {(profileReadiness?.canActivate || selectedProfile.status === 'ACTIVE') && <div className="rounded-lg bg-green-50 p-4 text-sm font-bold text-green-800">การผูกบัญชีและรายงานครบแล้ว</div>}
          </div>
        )}
        <div className="mt-6 flex justify-between gap-3">
          {back('profile')}
          {profileReadiness?.canActivate || selectedProfile?.status === 'ACTIVE' ? (
            <Link className={primary} href={accountingTaxSetupHref(companyId, 'review', workflowParams)}>ถัดไป: ตรวจและเปิดใช้งาน</Link>
          ) : (
            <button type="button" className={primary} disabled={!selectedProfile || busy || requiresAdvancedMapping || otherBlockers.length > 0 || (missingAccountBlockers.length > 0 && !canMapAccounts) || (missingReportBlockers.length > 0 && !canMapReports)} onClick={() => void saveMappings()}>
              {busy ? 'กำลังบันทึก...' : 'บันทึกที่ตรวจแล้วและไปต่อ'}
            </button>
          )}
        </div>
        {(otherBlockers.length > 0 || requiresAdvancedMapping) && <p className="mt-3 text-right text-xs text-amber-700">รายการนี้ต้องแก้ใน <Link className="underline" href={`/companies/${companyId}/settings/tax-accounts`}>Tax Account Determination ขั้นสูง</Link></p>}
      </MangmeeCard>
    );
  } else {
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">ตรวจครั้งสุดท้ายและเปิดใช้งาน</h2>
        {selectedProfile ? (
          <>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt>Profile</dt><dd className="font-bold">{selectedProfile.name}</dd></div>
              <div className="flex justify-between gap-3"><dt>ช่วงวันที่</dt><dd className="font-bold">{selectedProfile.effectiveFrom.slice(0, 10)} – {selectedProfile.effectiveTo?.slice(0, 10) ?? 'ไม่สิ้นสุด'}</dd></div>
              <div className="flex justify-between gap-3"><dt>Tax Code</dt><dd className="font-bold">{profileReadiness?.definitionCount ?? '-'}</dd></div>
              <div className="flex justify-between gap-3"><dt>Blocker</dt><dd className="font-bold">{profileReadiness?.blockers.length ?? '-'}</dd></div>
            </dl>
            {(profileReadiness?.blockers ?? []).map((blocker, index) => <div key={`${blocker.code}:${index}`} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{blocker.externalTaxCode ? `${blocker.externalTaxCode}: ` : ''}{blockerLabel(blocker)}</div>)}
            {(profileReadiness?.warnings ?? []).map((warning) => (
              <div key={warning.code} className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{readinessWarningLabel(warning.code)}</div>
            ))}
            <p className="mt-4 text-xs text-gray-500">การเปิดใช้งานจะถูกบันทึก Audit และไม่แก้ snapshot ของเอกสารที่ออกแล้ว</p>
          </>
        ) : <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">กรุณาเลือกชุดรหัสภาษี (Tax Profile) ก่อน</div>}
        <div className="mt-6 flex justify-between gap-3">
          {back('mappings')}
          {activated || selectedProfile?.status === 'ACTIVE' ? (
            <Link className={primary} href={safeReturnTo ?? `/companies/${companyId}/settings`}>
              {safeReturnTo ? 'กลับไปรายการค่าใช้จ่าย' : 'กลับภาพรวมการตั้งค่า'}
            </Link>
          ) : (
            <button type="button" className={primary} disabled={!selectedProfile || !profileReadiness?.canActivate || !canProfileManage || busy} onClick={() => void activateProfile()}>
              {busy ? 'กำลังเปิดใช้งาน...' : 'ยืนยันและเปิดใช้งานชุดรหัสภาษี (Tax Profile)'}
            </button>
          )}
        </div>
      </MangmeeCard>
    );
  }

  const stepRank: Record<AccountingTaxSetupStep, number> = {
    overview: -1,
    prerequisites: 0,
    chart: 1,
    'chart-review': 1,
    profile: 2,
    mappings: 3,
    review: 4,
  };
  const readinessLoaded = !profileId || profileReadiness !== null;
  if (!loading && readinessLoaded && step !== 'overview' && stepRank[step] > stepRank[currentStep]) {
    content = (
      <MangmeeCard className="p-6">
        <h2 className="text-lg font-extrabold text-gray-900">ต้องทำขั้นก่อนหน้าให้เสร็จก่อน</h2>
        <p className="mt-2 text-sm text-gray-600">ระบบตรวจสถานะจริงของบริษัทแล้ว พบว่ายังข้ามมาขั้นตอนนี้ไม่ได้</p>
        <div className="mt-6 flex justify-end">
          <Link className={primary} href={accountingTaxSetupHref(companyId, currentStep, workflowParams)}>ไปขั้นตอนที่ต้องทำต่อ</Link>
        </div>
      </MangmeeCard>
    );
  }

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title="ตั้งค่าบัญชีและภาษี"
      description="ทำทีละขั้น กดถัดไปเมื่อพร้อม ระบบจะยังไม่เริ่มใช้ชุดรหัสภาษี (Tax Profile) จนกว่าคุณจะกดยืนยันในขั้นสุดท้าย"
      actions={<Link className="text-sm font-bold text-gray-600 hover:text-brand-700" href={`/companies/${companyId}/settings`}>ออกจากการตั้งค่า</Link>}
    >
      {step !== 'overview' && <Stepper companyId={companyId} current={step} profileId={profileId || undefined} returnTo={safeReturnTo ?? undefined} />}
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && <div role="status" className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">กำลังโหลดสถานะล่าสุด...</div>}
      {content}
    </MangmeePage>
  );
}

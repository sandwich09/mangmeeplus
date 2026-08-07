'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChartTemplateApplyMode, LedgerAccountClass } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  applyChartTemplate,
  getChartReadiness,
  listChartTemplates,
  listLedgerAccounts,
  previewChartTemplate,
  type ApplyChartTemplateResult,
  type ChartOfAccountsReadiness,
  type ChartTemplateMetadata,
  type ChartTemplatePreviewResult,
  type LedgerAccount,
} from './ledger.api';
import {
  chartApplyBlocker,
  filterChartAccounts,
  requestIdFromError,
} from './chart-master.logic';

const ACCOUNT_CLASS_LABELS: Record<LedgerAccountClass, string> = {
  ASSET: 'สินทรัพย์',
  LIABILITY: 'หนี้สิน',
  EQUITY: 'ส่วนของเจ้าของ',
  REVENUE: 'รายได้',
  COST: 'ต้นทุน',
  EXPENSE: 'ค่าใช้จ่าย',
  TAX_EXPENSE: 'ภาษีเงินได้',
  SUSPENSE: 'บัญชีพัก',
};

const FIELD_LABELS: Record<string, string> = {
  nameTh: 'ชื่อบัญชี',
  accountClass: 'หมวดบัญชี',
  normalBalance: 'ด้านยอดคงเหลือ',
  reportGroup: 'กลุ่มรายงาน',
  isPosting: 'สถานะลงรายการ',
  isControlled: 'การควบคุม',
  globalAccount: 'บัญชีกลางของระบบ',
};

const DEPENDENCY_LABELS: Record<string, string> = {
  JournalLine: 'รายการสมุดรายวัน',
  PostingRuleAccount: 'กฎลงบัญชี (บัญชี)',
  PostingRuleCode: 'กฎลงบัญชี (รหัส)',
  TaxAccountRule: 'กฎบัญชีภาษี',
  TaxReconciliationLine: 'กระทบยอดภาษี',
  BankAccount: 'บัญชีธนาคาร',
  BankAdjustment: 'รายการปรับปรุงธนาคาร',
  AccountHierarchy: 'ผังบัญชีแม่/ลูก',
  AccountingDocumentLineAssignment: 'เอกสารบัญชีที่ยังไม่ลงบัญชี',
  ExpenseLineAssignment: 'ค่าใช้จ่ายที่ยังไม่ลงบัญชี',
  PurchaseRequestLineAssignment: 'ใบขอซื้อที่ยังใช้งาน',
  PurchaseOrderLineAssignment: 'ใบสั่งซื้อที่ยังไม่ลงบัญชี',
  VendorBillLineAssignment: 'ใบแจ้งหนี้ผู้ขายที่ยังไม่ลงบัญชี',
  TaxEventAssignment: 'เหตุการณ์ภาษี',
  GLOBAL_ACCOUNT: 'บัญชีกลางของระบบ',
};

const inputClass = 'mangmee-input';
const primaryButton = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';

function ReadinessBadge({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
      ready ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'
    }`}>
      {label}: {ready ? 'พร้อม' : 'ยังไม่พร้อม'}
    </span>
  );
}

function GapRow({ label, value }: { label: string; value: string | number }) {
  const clear = value === 0 || value === '0' || value === '-';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0">
      <dt className="text-gray-600">{label}</dt>
      <dd className={`text-right font-semibold ${clear ? 'text-green-700' : 'text-amber-800'}`}>{value}</dd>
    </div>
  );
}

function formatAppliedAt(value: string | null): string {
  return value ? new Date(value).toLocaleString('th-TH') : '-';
}

export function ChartOfAccountsSettingsPage({
  companyId,
  permissions,
}: {
  companyId: string;
  permissions: string[];
}) {
  const canRead = permissions.includes('ledger.account.read');
  const canManage = permissions.includes('ledger.account.manage');
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [templates, setTemplates] = useState<ChartTemplateMetadata[]>([]);
  const [readiness, setReadiness] = useState<ChartOfAccountsReadiness | null>(null);
  const [templateKey, setTemplateKey] = useState('');
  const [preview, setPreview] = useState<ChartTemplatePreviewResult | null>(null);
  const [mode, setMode] = useState<ChartTemplateApplyMode>('MISSING_ONLY');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ApplyChartTemplateResult | null>(null);
  const [search, setSearch] = useState('');
  const [accountClass, setAccountClass] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(canRead);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | null>(null);

  const showError = useCallback((cause: unknown) => {
    setError(apiErrorMessage(cause));
    setErrorRef(requestIdFromError(cause));
  }, []);

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setErrorRef(null);
    try {
      const [nextAccounts, nextTemplates, nextReadiness] = await Promise.all([
        listLedgerAccounts(companyId),
        listChartTemplates(companyId),
        getChartReadiness(companyId),
      ]);
      setAccounts(nextAccounts);
      setTemplates(nextTemplates);
      setReadiness(nextReadiness);
      setTemplateKey((current) => nextTemplates.some((item) => item.templateKey === current)
        ? current
        : (nextTemplates[0]?.templateKey ?? ''));
    } catch (cause) {
      showError(cause);
    } finally {
      setLoading(false);
    }
  }, [canRead, companyId, showError]);

  useEffect(() => { void load(); }, [load]);

  const filteredAccounts = useMemo(
    () => filterChartAccounts(accounts, { search, accountClass, status }),
    [accountClass, accounts, search, status],
  );
  const selectedTemplate = templates.find((item) => item.templateKey === templateKey) ?? null;
  const conflicts = preview?.rows.filter((row) =>
    row.classification === 'UNUSED_CONFLICT' || row.classification === 'IN_USE_CONFLICT') ?? [];
  const applyBlocker = chartApplyBlocker({ canManage, preview, mode, confirmed });

  async function runPreview() {
    if (!templateKey) return;
    setPreviewing(true);
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setError(null);
    setErrorRef(null);
    try {
      setPreview(await previewChartTemplate(companyId, templateKey));
    } catch (cause) {
      showError(cause);
    } finally {
      setPreviewing(false);
    }
  }

  async function applyTemplate() {
    if (!preview) return;
    const blocker = chartApplyBlocker({ canManage, preview, mode, confirmed });
    if (blocker) {
      setError(blocker);
      setErrorRef(null);
      return;
    }
    setApplying(true);
    setResult(null);
    setError(null);
    setErrorRef(null);
    try {
      const nextResult = await applyChartTemplate(companyId, preview.templateKey, {
        expectedTemplateChecksum: preview.templateChecksum,
        expectedPreviewChecksum: preview.previewChecksum,
        mode,
        acknowledgeConflicts: conflicts.length > 0,
      });
      setResult(nextResult);
      setPreview(null);
      setConfirmed(false);
      await load();
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      if (code === 'coa_preview_changed' || code === 'coa_template_checksum_mismatch') {
        setPreview(null);
        setConfirmed(false);
      }
      showError(cause);
    } finally {
      setApplying(false);
    }
  }

  if (!canRead) {
    return (
      <MangmeePage title="ผังบัญชี Master Data">
        <div role="alert">
          <MangmeeCard className="p-6 text-sm text-red-700">
            คุณไม่มีสิทธิ์ดูผังบัญชีของบริษัทนี้
          </MangmeeCard>
        </div>
      </MangmeePage>
    );
  }

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title="ผังบัญชี Master Data"
      description="ตรวจผังบัญชีของบริษัท เทียบกับ Template มาตรฐาน และแก้เฉพาะรายการที่ตรวจสอบผลกระทบแล้ว"
      actions={(
        <button type="button" className={secondaryButton} onClick={() => void load()} disabled={loading || applying}>
          {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
        </button>
      )}
    >
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div>{error}</div>
          {errorRef && <div className="mt-1 font-mono text-xs">รหัสอ้างอิง: {errorRef}</div>}
        </div>
      )}
      {result && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          ใช้ Template สำเร็จ: สร้าง {result.created} · อัปเดต {result.updated} · ข้าม {result.skipped}
          {result.acknowledgedConflicts > 0 && ` · คงรายการขัดแย้งไว้ ${result.acknowledgedConflicts}`}
        </div>
      )}
      {loading && (
        <div role="status">
          <MangmeeCard className="p-5 text-sm text-gray-500">
            กำลังโหลดผังบัญชี Template และสถานะความพร้อม...
          </MangmeeCard>
        </div>
      )}

      {!loading && readiness && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <MangmeeCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900">ที่มาและสถานะ Master Data</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {readiness.chartTemplateApplied
                    ? 'บริษัทนี้บันทึกที่มาของ Template แล้ว'
                    : 'ผังบัญชีเดิมยังไม่มีที่มาของ Template ที่ยืนยันแล้ว'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ReadinessBadge ready={readiness.readyForManualLedger} label="ลงบัญชีเอง" />
                <ReadinessBadge ready={readiness.readyForAutomaticPosting} label="ลงบัญชีอัตโนมัติ" />
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-gray-500">Template</dt><dd className="font-semibold text-gray-900">{readiness.chartTemplateKey ?? '-'}</dd></div>
              <div><dt className="text-gray-500">Version</dt><dd className="font-semibold text-gray-900">{readiness.chartTemplateVersion ?? '-'}</dd></div>
              <div><dt className="text-gray-500">จำนวนบัญชี</dt><dd className="font-semibold text-gray-900">{readiness.chartAccountCount}</dd></div>
              <div><dt className="text-gray-500">นำมาใช้เมื่อ</dt><dd className="font-semibold text-gray-900">{formatAppliedAt(readiness.chartTemplateAppliedAt)}</dd></div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Checksum</dt>
                <dd className="break-all font-mono text-xs text-gray-700">{readiness.chartTemplateChecksum ?? '-'}</dd>
              </div>
            </dl>
          </MangmeeCard>

          <MangmeeCard className="p-5">
            <h2 className="font-bold text-gray-900">ช่องว่างที่ต้องปิดก่อนลงบัญชีอัตโนมัติ</h2>
            <dl className="mt-2 text-sm">
              <GapRow label="บัญชีขัดแย้งกับ Template" value={readiness.chartConflicts} />
              <GapRow label="บทบาทกฎลงบัญชีที่ขาด" value={readiness.requiredPostingRolesMissing.join(', ') || '-'} />
              <GapRow label="บทบาทบัญชีภาษีที่ขาด" value={readiness.requiredTaxAccountRolesMissing.join(', ') || '-'} />
              <GapRow label="Tax Profile รอตรวจ" value={readiness.taxProfilesNeedingReview} />
              <GapRow label="บัญชีธนาคารเชื่อมไม่ถูกต้อง" value={readiness.bankLedgerLinksInvalid} />
              <GapRow label="หัวเอกสาร/Tax Code รายการไม่ตรงกัน" value={readiness.legacyTaxHeaderMismatches} />
              <GapRow label="เอกสารต้นทางลงบัญชีไม่สำเร็จ" value={readiness.sourcePostingErrors} />
            </dl>
            <Link
              href={`/companies/${companyId}/settings/tax-accounts`}
              className="mt-3 inline-flex text-sm font-semibold text-brand-700 hover:underline"
            >
              ไปที่ Tax Account Determination →
            </Link>
          </MangmeeCard>
        </section>
      )}

      {!loading && (
        <MangmeeCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-gray-900">ตรวจผลกระทบก่อนใช้ Template</h2>
              <p className="mt-1 text-sm text-gray-500">
                ระบบจะไม่เขียนข้อมูลจนกว่าจะ preview และยืนยันรายการขัดแย้งอย่างชัดเจน
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ThemedSelect
                aria-label="Template ผังบัญชี"
                className={inputClass}
                value={templateKey}
                onChange={(event) => {
                  setTemplateKey(event.target.value);
                  setPreview(null);
                  setConfirmed(false);
                  setResult(null);
                }}
              >
                {templates.map((template) => (
                  <option key={template.templateKey} value={template.templateKey}>
                    {template.templateKey} · v{template.templateVersion}
                  </option>
                ))}
              </ThemedSelect>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => void runPreview()}
                disabled={!templateKey || previewing || applying}
              >
                {previewing ? 'กำลังตรวจ...' : 'Preview ผลกระทบ'}
              </button>
            </div>
          </div>
          {templates.length === 0 && (
            <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ไม่พบ Template ผังบัญชีที่พร้อมใช้งาน
            </div>
          )}
          {selectedTemplate && (
            <div className="mt-4 text-xs text-gray-500">
              {selectedTemplate.accountCount} บัญชี · checksum {selectedTemplate.accountsChecksum}
            </div>
          )}
          {previewing && <p role="status" className="mt-4 text-sm text-gray-500">กำลังสแกนบัญชีและข้อมูลที่อ้างอิง...</p>}
          {preview && (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['ตรงกัน', preview.exact, 'text-green-700'],
                  ['ขาด', preview.missing, 'text-blue-700'],
                  ['ขัดแย้งแต่ยังไม่ถูกใช้', preview.unusedConflicts, 'text-amber-700'],
                  ['ขัดแย้งและถูกใช้แล้ว', preview.inUseConflicts, 'text-red-700'],
                ].map(([label, value, tone]) => (
                  <div key={String(label)} className="rounded-lg border border-gray-200 px-4 py-3">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
                  </div>
                ))}
              </div>

              {conflicts.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-amber-200">
                  <div className="bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                    รายการขัดแย้งทั้งหมด ({conflicts.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="mangmee-table">
                      <thead><tr><th>รหัส</th><th>ระดับผลกระทบ</th><th>ข้อมูลที่ต่าง</th><th>ข้อมูลที่อ้างอิง</th></tr></thead>
                      <tbody>
                        {conflicts.map((row) => (
                          <tr key={row.code}>
                            <td className="whitespace-nowrap font-semibold">{row.code}</td>
                            <td className={row.classification === 'IN_USE_CONFLICT' ? 'text-red-700' : 'text-amber-700'}>
                              {row.classification === 'IN_USE_CONFLICT' ? 'ถูกใช้งานแล้ว' : 'ยังไม่ถูกใช้งาน'}
                            </td>
                            <td>{row.differingFields.map((field) => FIELD_LABELS[field] ?? field).join(', ') || '-'}</td>
                            <td>
                              <div className="font-semibold">{row.dependencyCount} รายการ</div>
                              {Object.entries(row.dependencies).map(([source, count]) => (
                                <div key={source} className="text-xs text-gray-500">
                                  {DEPENDENCY_LABELS[source] ?? source}: {count}
                                </div>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-gray-200 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
                  <div className="text-sm font-medium text-gray-700">
                    วิธีนำ Template มาใช้
                    <ThemedSelect
                      aria-label="วิธีนำ Template มาใช้"
                      className={`${inputClass} mt-1 w-full`}
                      value={mode}
                      onChange={(event) => {
                        setMode(event.target.value as ChartTemplateApplyMode);
                        setConfirmed(false);
                      }}
                    >
                      <option value="MISSING_ONLY">เพิ่มเฉพาะบัญชีที่ขาด</option>
                      <option value="REPLACE_UNUSED" disabled={preview.inUseConflicts > 0}>
                        แทนที่บัญชีขัดแย้งที่ยังไม่ถูกใช้
                      </option>
                    </ThemedSelect>
                  </div>
                  <div className="text-sm text-gray-600">
                    {mode === 'MISSING_ONLY'
                      ? 'บัญชีเดิมที่มีความหมายต่างกันจะไม่ถูกแก้ไข'
                      : 'ระบบตรวจ dependency ซ้ำใน transaction และแก้เฉพาะบัญชีที่ไม่มีการอ้างอิง'}
                  </div>
                </div>
                {conflicts.length > 0 && (
                  <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      ฉันตรวจรายการขัดแย้งและยืนยัน
                      {mode === 'MISSING_ONLY' ? 'ให้คงบัญชีเดิมไว้' : 'ให้แทนที่เฉพาะรายการที่ยังไม่ถูกใช้งาน'}
                    </span>
                  </label>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={primaryButton}
                    onClick={() => void applyTemplate()}
                    disabled={Boolean(applyBlocker) || previewing || applying || loading}
                  >
                    {applying ? 'กำลังนำ Template มาใช้...' : 'ยืนยันนำ Template มาใช้'}
                  </button>
                  {applyBlocker && <span className="text-xs text-amber-800">{applyBlocker}</span>}
                </div>
              </div>
            </div>
          )}
        </MangmeeCard>
      )}

      {!loading && (
        <MangmeeCard className="overflow-hidden">
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900">ผังบัญชีของบริษัท</h2>
                <p className="mt-1 text-sm text-gray-500">แสดง {filteredAccounts.length} จาก {accounts.length} บัญชี</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  aria-label="ค้นหาผังบัญชี"
                  className={inputClass}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ค้นหารหัส ชื่อ หรือกลุ่ม"
                />
                <ThemedSelect
                  aria-label="กรองหมวดบัญชี"
                  className={inputClass}
                  value={accountClass}
                  onChange={(event) => setAccountClass(event.target.value)}
                >
                  <option value="">ทุกหมวด</option>
                  {Object.entries(ACCOUNT_CLASS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </ThemedSelect>
                <ThemedSelect
                  aria-label="กรองสถานะบัญชี"
                  className={inputClass}
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="">ทุกสถานะ</option>
                  <option value="ACTIVE">ใช้งาน</option>
                  <option value="INACTIVE">ปิดใช้งาน</option>
                </ThemedSelect>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="mangmee-table">
              <thead>
                <tr><th>รหัส / ชื่อบัญชี</th><th>หมวด / ยอดคงเหลือ</th><th>กลุ่มรายงาน</th><th>การลงรายการ</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="font-semibold text-gray-900">{account.code} · {account.nameTh}</div>
                      {account.nameEn && <div className="text-xs text-gray-500">{account.nameEn}</div>}
                    </td>
                    <td>
                      <div>{ACCOUNT_CLASS_LABELS[account.accountClass]}</div>
                      <div className="text-xs text-gray-500">{account.normalBalance}</div>
                    </td>
                    <td>
                      <div>{account.reportGroup ?? '-'}</div>
                      {(account.sourceGroup1 || account.sourceGroup2) && (
                        <div className="text-xs text-gray-500">
                          {[account.sourceGroup1, account.sourceGroup2].filter(Boolean).join(' / ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{account.isPosting ? 'ลงรายการได้' : 'หัวกลุ่ม'}</div>
                      {account.isControlled && <div className="text-xs font-semibold text-amber-700">ควบคุมพิเศษ</div>}
                    </td>
                    <td>
                      <div>{account.status === 'ACTIVE' ? 'ใช้งาน' : account.status}</div>
                      {!account.companyId && <div className="text-xs text-red-700">บัญชีกลางของระบบ</div>}
                    </td>
                  </tr>
                ))}
                {filteredAccounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                      {accounts.length === 0 ? 'ยังไม่มีบัญชีในบริษัทนี้' : 'ไม่พบบัญชีตามตัวกรอง'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </MangmeeCard>
      )}
    </MangmeePage>
  );
}

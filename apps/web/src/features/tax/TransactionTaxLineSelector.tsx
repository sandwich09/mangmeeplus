'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  ResolveTransactionTaxPreviewDto,
  TaxCodeDefinitionDto,
  TransactionTaxContext,
  TransactionTaxDirection,
} from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { listTaxCodeDefinitions, resolveTransactionTaxPreview } from './transaction-tax.api';
import { availableTaxDefinitions, suggestedLineTaxCode, transactionTaxDiagnosticMessage, transactionTaxErrorMessage } from './transaction-tax.model';

type Props = {
  companyId: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string;
  transactionContext: TransactionTaxContext;
  direction: TransactionTaxDirection;
  documentDate: string;
  currency?: string;
  netAmount: string;
  grossAmount: string;
  branchId?: string;
  value?: string;
  onChange: (definitionId: string, definition?: TaxCodeDefinitionDto) => void;
  disabled?: boolean;
  allowNoTax?: boolean;
  labelAddon?: ReactNode;
  /**
   * Whether the caller may run the tax setup wizard. The empty-state CTA sent every user to a
   * wizard most of them cannot complete — and must not, when the company is not VAT-registered.
   */
  canConfigureTax?: boolean;
  /**
   * External code suggested by the expense's category. Used ONLY as the default when `value` is
   * empty — it is never written on mount, so an untouched expense never persists a code nobody
   * chose (spec AC5).
   */
  suggestedTaxCode?: string | null;
};

// Most display names already carry the rate ("ภาษีซื้อขอคืนได้ 7%"), so appending
// it again read as "7% · 7%". Append only when the name doesn't say the rate.
function taxChoiceLabel(item: TaxCodeDefinitionDto) {
  const rate = Number(item.rate);
  if (!Number.isFinite(rate) || item.displayName.includes(`${rate}%`)) return item.displayName;
  return `${item.displayName} ${rate}%`;
}

export function TransactionTaxLineSelector({
  companyId, sourceType, sourceId, sourceLineId, transactionContext, direction,
  documentDate, currency = 'THB', netAmount, grossAmount, branchId, value = '',
  onChange, disabled = false, allowNoTax = true,
  labelAddon, canConfigureTax = false, suggestedTaxCode = null,
}: Props) {
  const [definitions, setDefinitions] = useState<TaxCodeDefinitionDto[]>([]);
  const [preview, setPreview] = useState<ResolveTransactionTaxPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listTaxCodeDefinitions(companyId, { transactionContext, sourceType })
      .then((items) => { if (!cancelled) setDefinitions(items); })
      .catch((cause) => { if (!cancelled) setError(transactionTaxErrorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, sourceType, transactionContext]);

  const choices = useMemo(() => availableTaxDefinitions(definitions, {
    context: transactionContext,
    direction,
    documentDate,
  }), [definitions, direction, documentDate, transactionContext]);
  const suggestedCode = suggestedLineTaxCode({
    categoryDefaultInputTaxCode: suggestedTaxCode,
    lineHasTaxCode: Boolean(value),
    available: choices,
  });
  const suggested = suggestedCode ? choices.find((item) => item.externalCode === suggestedCode) ?? null : null;
  const effectiveValue = value || suggested?.id || '';
  const setupHref = canConfigureTax && sourceType === 'expense.record'
    ? `/companies/${companyId}/settings/accounting-tax-setup?returnTo=${encodeURIComponent(
      sourceId.startsWith('new-')
        ? `/companies/${companyId}/expenses/manual`
        : `/companies/${companyId}/expenses?expenseId=${encodeURIComponent(sourceId)}`,
    )}`
    : null;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    if (!effectiveValue || disabled || !documentDate || (!netAmount && !grossAmount)) return;
    const selected = choices.find((item) => item.id === effectiveValue);
    if (!selected) return;
    resolveTransactionTaxPreview(companyId, {
      branchId: branchId || undefined,
      sourceType,
      sourceId,
      sourceLineId,
      transactionContext,
      documentDate,
      currency,
      taxCodeDefinitionId: selected.id,
      externalTaxCode: selected.externalCode,
      netAmount: netAmount || '0',
      grossAmount: grossAmount || netAmount || '0',
    }, { profileId: selected.profileId, direction, sourceModule: sourceType.split('.')[0] })
      .then((result) => { if (!cancelled) { setPreview(result); setError(''); } })
      .catch((cause) => { if (!cancelled) setError(transactionTaxErrorMessage(cause)); });
    return () => { cancelled = true; };
  }, [branchId, choices, companyId, currency, direction, disabled, documentDate, grossAmount, netAmount, sourceId, sourceLineId, sourceType, transactionContext, effectiveValue]);

  return (
    <div className="space-y-2" data-testid="transaction-tax-selector">
      <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600">ประเภทภาษีของรายการ {labelAddon}</div>
      <ThemedSelect
        value={effectiveValue}
        disabled={disabled || loading}
        aria-label="เลือกประเภทภาษีของรายการ"
        onChange={(event) => {
          const definition = choices.find((item) => item.id === event.target.value);
          setPreview(null);
          onChange(event.target.value, definition);
        }}
      >
        {allowNoTax && <option value="">รายการนี้ไม่มี VAT</option>}
        {!allowNoTax && <option value="">เลือกประเภทภาษี</option>}
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {taxChoiceLabel(item)} ({item.externalCode})
          </option>
        ))}
      </ThemedSelect>
      {suggested && <p className="text-xs text-brand-700">ค่าตั้งต้นจากหมวดหมู่ค่าใช้จ่าย · เปลี่ยนได้ และจะบันทึกเมื่อคุณกดบันทึกรายการ</p>}
      <p className="text-xs leading-relaxed text-gray-500">
        {direction === 'INPUT'
          ? 'ภาษีซื้อ “ขอคืนได้” คือการนำ VAT ไปหักตอนยื่นภาษี · “ขอคืนไม่ได้” คือ VAT ที่รวมเป็นค่าใช้จ่าย'
          : 'เลือกรหัสภาษีให้ตรงกับเอกสารภาษีของรายการนี้'}
      </p>
      {loading && <p className="text-xs text-gray-500">กำลังโหลดประเภทภาษีที่ใช้ได้...</p>}
      {!loading && choices.length === 0 && !error && (
        <p className="text-xs text-amber-700">
          ยังไม่มีประเภทภาษีที่ใช้ได้กับรายการและวันที่นี้
          {setupHref
            ? <> · <Link className="font-bold underline" href={setupHref}>ตั้งค่าภาษี</Link></>
            : ' กรุณาติดต่อผู้ดูแลการตั้งค่าภาษีของบริษัท'}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {preview && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${preview.errors.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
          {preview.components.map((component) => (
            <div key={component.componentKey} className="flex flex-wrap gap-x-3 gap-y-1">
              <strong>{component.componentKey}</strong>
              <span>ฐาน {component.snapshot.taxBaseAmount}</span>
              <span>ภาษี {component.snapshot.taxAmount}</span>
              <span>{component.accountAssignments.length ? `${component.accountAssignments.length} บัญชี` : 'ยังไม่ผูกบัญชี'}</span>
              <span>{component.reportContributions.length ? `${component.reportContributions.length} ช่องรายงาน` : 'ยังไม่ผูกรายงาน'}</span>
            </div>
          ))}
          {preview.warnings.map((warning) => <p key={warning} className="mt-1 text-amber-700">{transactionTaxDiagnosticMessage(warning)}</p>)}
          {preview.errors.map((message) => <p key={message} className="mt-1 text-red-700">{transactionTaxDiagnosticMessage(message)}</p>)}
        </div>
      )}
    </div>
  );
}

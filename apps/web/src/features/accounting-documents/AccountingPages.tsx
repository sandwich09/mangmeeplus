'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '@/features/web-core-workspace/branch-scope-label.logic';
import { TransactionTaxLineSelector } from '@/features/tax/TransactionTaxLineSelector';
import { isReceiptTaxCodeAllowed } from '@/features/tax/transaction-tax.model';
import type { TaxCodeDefinitionDto, TransactionTaxContext } from '@watchdog-bms/contracts';
import {
  approveQuotation,
  convertDocument,
  createDocument,
  createPayment,
  getDocument,
  issueDocument,
  listCounterparties,
  listDocuments,
  listPayments,
  prepareAccountingDocumentPaymentAttempt,
  rejectQuotation,
  submitQuotationApproval,
  updateDocument,
  uploadAccountingDocumentSupporting,
  voidDocument,
  type AccountingDocumentPaymentAttempt,
} from './accounting-documents.api';
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  OUTPUT_TAX_CODE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from './accounting-documents.model';
import type {
  AccountingDocumentType,
  AccountingOutputTaxCode,
  AccountingPaymentMethod,
  AccountingVatMode,
  CounterpartySummary,
  DocumentDetail,
  DocumentSummary,
  PaymentSummary,
} from './accounting-documents.model';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state/LoadingState';
import { CorrectionNoteSection } from './CorrectionNoteSection';
import { canCreateIncomeInvoice, canRecordReceivedIncome } from './income-record.logic';
import { useSalesRootAvailability } from './sales-root-availability';

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const ghostClass = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';
const dangerClass = 'mangmee-btn mangmee-btn-danger disabled:cursor-not-allowed disabled:opacity-50';
const DOCUMENT_TYPES: AccountingDocumentType[] = ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const POSTING_STATUS_LABELS: Record<string, string> = {
  not_required: 'ไม่ต้องลงบัญชี', pending: 'รอลงบัญชี', posted: 'ลงบัญชีแล้ว',
  posting_error: 'ลงบัญชีไม่สำเร็จ', reversed: 'กลับรายการแล้ว',
};

function documentPermission(documentType: AccountingDocumentType, action: 'read' | 'create' | 'update' | 'issue' | 'void') {
  return `accounting.${documentType.toLowerCase()}.${action}`;
}

function canDocumentAction(permissions: string[], documentType: AccountingDocumentType, action: 'read' | 'create' | 'update' | 'issue' | 'void') {
  return permissions.includes(`accounting.document.${action}`) || permissions.includes(documentPermission(documentType, action));
}

type DraftEditLine = {
  lineNumber: number;
  productId?: string;
  skuSnapshot?: string;
  description: string;
  unitName?: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string;
  whtRate?: string;
  taxCategory?: string;
  revenueCategory?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  transactionContext?: TransactionTaxContext;
};

function err(e: unknown) {
  return apiErrorMessage(e);
}

function money(value?: string) {
  return Number(value ?? '0').toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-gray-400">-</span>;
  const tone: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-brand-100 text-brand-800',
    ISSUED: 'bg-emerald-100 text-emerald-800',
    PAID: 'bg-emerald-100 text-emerald-800',
    PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
    VOIDED: 'bg-red-100 text-red-700',
    REJECTED: 'bg-red-100 text-red-700',
  };
  const label = (DOCUMENT_STATUS_LABELS as Record<string, string>)[status] ?? (PAYMENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone[status] ?? 'bg-gray-100 text-gray-700'}`}>{label}</span>;
}

function MobileDocumentStatusBadge({ status }: { status: DocumentSummary['status'] }) {
  const tone = status === 'REJECTED' || status === 'VOIDED'
    ? 'danger'
    : status === 'PENDING_APPROVAL'
      ? 'amber'
      : status === 'APPROVED' || status === 'ISSUED' || status === 'CREDITED' || status === 'DEBITED' || status === 'CLOSED'
        ? 'brand'
        : 'slate';
  return <MangmeeBadge tone={tone}>{DOCUMENT_STATUS_LABELS[status]}</MangmeeBadge>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

type LinkedTaxSelection = Pick<TaxCodeDefinitionDto, 'id' | 'externalCode' | 'rate' | 'calculationMethod' | 'treatment'>;

function linkedTaxInvoiceVatMode(selections: LinkedTaxSelection[]): AccountingVatMode | null {
  const positive = selections.filter((item) => Number(item.rate) > 0);
  const methods = new Set(positive.map((item) => item.calculationMethod));
  if (methods.size > 1) return null;
  if (methods.has('INCLUSIVE')) return 'VAT_INCLUDED';
  if (methods.has('EXCLUSIVE')) return 'VAT_EXCLUDED';
  return selections.some((item) => item.treatment === 'EXEMPT') ? 'EXEMPT' : 'NO_VAT';
}

function DocumentList({
  companyId,
  selectedId,
  onSelect,
  reloadKey,
  filterType,
  onFilterTypeChange,
}: {
  companyId: string;
  selectedId?: string;
  onSelect: (documentId: string) => void;
  reloadKey: number;
  filterType: AccountingDocumentType | '';
  onFilterTypeChange: (type: AccountingDocumentType | '') => void;
}) {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadAbort = useRef(0);
  const branch = useBranchFilter();
  const branchId = branch?.branchId || undefined;

  const load = useCallback(async () => {
    const token = ++loadAbort.current;
    setLoading(true);
    setError(null);
    try {
      const res = await listDocuments(companyId, { documentType: filterType || undefined, branchId });
      if (token !== loadAbort.current) return;
      setDocs(res.data);
      if (!selectedId && res.data[0]) onSelect(res.data[0].id);
    } catch (e) {
      if (token !== loadAbort.current) return;
      if (isBranchScope403(e, branchId)) { branch?.reportBranchForbidden(); return; }
      setError(err(e));
    } finally {
      if (token === loadAbort.current) setLoading(false);
    }
    // `branch` is deliberately absent: reportBranchForbidden is stable per companyId, which is here.
  }, [companyId, filterType, branchId, onSelect, selectedId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">เอกสารบัญชี</h1>
        <ThemedSelect className={`${inputClass} max-w-xs`} value={filterType} onChange={(e) => onFilterTypeChange(e.target.value as AccountingDocumentType | '')}>
          <option value="">เอกสารทุกประเภท</option>
          {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>)}
        </ThemedSelect>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="mangmee-card overflow-hidden">
        {loading ? <LoadingState label="กำลังโหลด..." />
          : docs.length === 0 ? <p className="px-4 py-8 text-center text-sm text-gray-500">ยังไม่มีเอกสาร</p>
            : <>
        <div className="hidden md:block" data-testid="accounting-documents-table">
        <div className="mangmee-table-scroll">
          <table className="mangmee-table min-w-full">
          <thead>
            <tr>
              {['ประเภท', 'เลขที่', 'สถานะ', 'วันที่', 'ยอดรวม', 'การชำระ', 'การลงบัญชี'].map((header) => <th key={header}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">กำลังโหลด...</td></tr>}
            {!loading && docs.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">ยังไม่มีเอกสาร</td></tr>}
            {!loading && docs.map((doc) => (
              <tr key={doc.id} className={`cursor-pointer ${selectedId === doc.id ? 'bg-brand-25' : ''}`} onClick={() => onSelect(doc.id)}>
                <td className="px-4 py-3 text-sm text-gray-900">{DOCUMENT_TYPE_LABELS[doc.documentType]}</td>
                <td className="px-4 py-3 font-mono text-sm text-gray-700">{doc.documentNumber ?? doc.id.slice(0, 8)}</td>
                <td className="px-4 py-3"><StatusBadge status={doc.status} /></td>
                <td className="px-4 py-3 text-sm text-gray-600">{formatThaiDate(doc.documentDate)}</td>
                <td className="px-4 py-3 text-right text-sm text-gray-900">{money(doc.grandTotalAmount)}</td>
                <td className="px-4 py-3"><StatusBadge status={doc.paymentStatus} /></td>
                <td className="px-4 py-3 text-xs text-gray-500">{doc.postingStatus}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        </div>
        <div className="space-y-3 p-3 md:hidden" data-testid="accounting-documents-card-list">
          {docs.map((doc) => (
            <MangmeeCard key={doc.id} className={selectedId === doc.id ? 'overflow-hidden bg-brand-25' : 'overflow-hidden'}>
              <a
                href={`?documentId=${encodeURIComponent(doc.id)}`}
                className="block min-h-11 w-full p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500"
                data-testid="accounting-document-card"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{DOCUMENT_TYPE_LABELS[doc.documentType]}</span>
                  <span className="max-w-[55%] truncate font-mono text-xs text-gray-600">{doc.documentNumber ?? doc.id.slice(0, 8)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <MobileDocumentStatusBadge status={doc.status} />
                  <span className="shrink-0 text-xs text-gray-500">{formatThaiDate(doc.documentDate)}</span>
                </div>
                <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{money(doc.grandTotalAmount)}</div>
              </a>
            </MangmeeCard>
          ))}
        </div>
        </>}
      </div>
    </section>
  );
}

function CreateDocumentForm({ companyId, onCreated, allowedDocumentTypes }: { companyId: string; onCreated: (documentId?: string) => void; allowedDocumentTypes: AccountingDocumentType[] }) {
  const toast = useToast();
  const branch = useBranchFilter();
  const docTypes = (['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE'] as AccountingDocumentType[])
    .filter((documentType) => allowedDocumentTypes.includes(documentType));
  const [docType, setDocType] = useState<AccountingDocumentType>(docTypes[0] ?? 'QUOTATION');
  const [vatMode, setVatMode] = useState<AccountingVatMode>('NO_VAT');
  const [outputTaxCode, setOutputTaxCode] = useState<AccountingOutputTaxCode | undefined>();
  const [taxCodeDefinitionId, setTaxCodeDefinitionId] = useState('');
  const [externalTaxCode, setExternalTaxCode] = useState<string>();
  const [vatRate, setVatRate] = useState('7');
  // Withholding the CUSTOMER will take from us. Blank on most documents; only a juristic buyer
  // withholds, and the operator knows at issue time.
  const [whtRate, setWhtRate] = useState('');
  const [transactionContext, setTransactionContext] = useState<TransactionTaxContext>('DOMESTIC_SALE');
  const [documentDate, setDocumentDate] = useState(todayCivilDate());
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!docTypes.includes(docType) && docTypes[0]) setDocType(docTypes[0]);
  }, [docType, docTypes]);
  // Preview only — the server recomputes every total. VAT_INCLUDED already carries its VAT.
  const lineGross = (Number(quantity) || 0) * (Number(unitPrice) || 0);
  const expectedGross = vatMode === 'VAT_EXCLUDED' ? lineGross * (1 + (Number(vatRate) || 0) / 100) : lineGross;

  function changeDocumentType(type: AccountingDocumentType) {
    setDocType(type);
    setTaxCodeDefinitionId('');
    setExternalTaxCode(undefined);
    setOutputTaxCode(undefined);
    setVatMode('NO_VAT');
    setTransactionContext('DOMESTIC_SALE');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const created = await createDocument(companyId, {
        documentType: docType,
        documentDate,
        vatMode,
        outputTaxCode,
        branchId: branch?.branchId || undefined,
        lines: [{ lineNumber: 1, description, quantity, unitPrice, vatRate, ...(whtRate ? { whtRate } : {}), taxCodeDefinitionId: taxCodeDefinitionId || undefined, externalTaxCode, transactionContext }],
      });
      setDescription('');
      setUnitPrice('');
      setWhtRate('');
      onCreated(created.id);
      toast.success('บันทึกร่างเอกสารเรียบร้อยแล้ว');
    } catch (ex) {
      setError(err(ex));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mangmee-card space-y-3 p-4">
      <h2 className="text-base font-bold text-gray-900">สร้างเอกสารใหม่</h2>
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ThemedSelect aria-label="ประเภทเอกสาร" className={inputClass} value={docType} onChange={(e) => changeDocumentType(e.target.value as AccountingDocumentType)}>
          {docTypes.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>)}
        </ThemedSelect>
        <ThemedDate className={inputClass} value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs text-gray-600">Tax Code: {externalTaxCode ?? 'รายบรรทัด / ไม่มี'}</div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ThemedSelect className={inputClass} value={vatMode} onChange={(e) => setVatMode(e.target.value as AccountingVatMode)}>
          {(!outputTaxCode || outputTaxCode === 'O0') && <option value="NO_VAT">ไม่มี VAT</option>}
          {(!outputTaxCode || outputTaxCode === 'O7') && <option value="VAT_EXCLUDED">ราคายังไม่รวม VAT</option>}
          {(!outputTaxCode || outputTaxCode === 'O7') && <option value="VAT_INCLUDED">ราคารวม VAT แล้ว</option>}
          {(!outputTaxCode || outputTaxCode === 'OX') && <option value="EXEMPT">ยกเว้น VAT</option>}
        </ThemedSelect>
        <input className={inputClass} type="number" min="0.0001" step="0.0001" value={vatRate} onChange={(e) => setVatRate(e.target.value)} disabled={outputTaxCode !== 'O7'} required={outputTaxCode === 'O7'} aria-label="อัตรา VAT" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold text-gray-600">
          หัก ณ ที่จ่ายที่ลูกค้าจะหัก (%)
          <input className={inputClass} type="number" min="0" max="100" step="0.0001" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} placeholder="เว้นว่างถ้าลูกค้าไม่หัก" aria-label="อัตราถูกหัก ณ ที่จ่าย" />
        </label>
        {Number(whtRate) > 0 && <p className="self-end text-xs text-gray-600">
          {/* The document total is unchanged — withholding only changes what arrives in the bank. */}
          คาดว่าจะได้รับสุทธิ {(expectedGross * (1 - Number(whtRate) / 100)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} จากยอดรวม {expectedGross.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>}
      </div>
      {!isReceiptTaxCodeAllowed(docType) && <p className="text-xs text-gray-500">{docType === 'RECEIPT' ? 'ใบเสร็จรับเงินเป็นหลักฐานรับชำระ ไม่มี Tax Code และไม่สร้าง VAT ซ้ำ' : `${DOCUMENT_TYPE_LABELS[docType]} ไม่ใช่เอกสารภาษี จึงไม่กำหนด Tax Code`}</p>}
      {isReceiptTaxCodeAllowed(docType) && <label className="block text-xs font-bold text-gray-600">
        บริบทธุรกรรม
        <ThemedSelect
          className={inputClass}
          value={transactionContext}
          onChange={(event) => {
            setTransactionContext(event.target.value as TransactionTaxContext);
            setTaxCodeDefinitionId('');
            setExternalTaxCode(undefined);
            setOutputTaxCode(undefined);
            setVatMode('NO_VAT');
          }}
        >
          <option value="DOMESTIC_SALE">ขายในประเทศ</option>
          <option value="EXPORT_GOODS">ส่งออกสินค้า</option>
          <option value="EXPORT_SERVICE">ส่งออกบริการ</option>
        </ThemedSelect>
      </label>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_160px]">
        <input className={inputClass} aria-label="รายละเอียดรายการ" placeholder="รายละเอียดรายการ" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <input className={inputClass} aria-label="จำนวน" type="number" min="0" step="0.0001" placeholder="จำนวน" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        <input className={inputClass} aria-label="ราคาต่อหน่วย" type="number" min="0" step="0.01" placeholder="ราคาต่อหน่วย" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
      </div>
      {isReceiptTaxCodeAllowed(docType) && <TransactionTaxLineSelector
        companyId={companyId}
        branchId={branch?.branchId || undefined}
        sourceType="accounting.document"
        sourceId="new-document"
        sourceLineId="line-1"
        transactionContext={transactionContext}
        direction="OUTPUT"
        documentDate={documentDate}
        netAmount={String(Number(quantity || '0') * Number(unitPrice || '0'))}
        grossAmount={String(Number(quantity || '0') * Number(unitPrice || '0'))}
        value={taxCodeDefinitionId}
        allowNoTax={docType !== 'TAX_INVOICE'}
        onChange={(id, definition) => {
          setTaxCodeDefinitionId(id);
          setExternalTaxCode(definition?.externalCode);
          setOutputTaxCode(['O7', 'OX', 'O0'].includes(definition?.externalCode ?? '') ? definition?.externalCode as AccountingOutputTaxCode : undefined);
          setVatRate(definition?.rate ?? '0');
          if (!definition || definition.calculationMethod === 'NONE' || ['NON_TAXABLE', 'OUTSIDE_SCOPE'].includes(definition.treatment)) setVatMode('NO_VAT');
          else if (definition.treatment === 'EXEMPT') setVatMode('EXEMPT');
          else setVatMode(definition.calculationMethod === 'INCLUSIVE' ? 'VAT_INCLUDED' : 'VAT_EXCLUDED');
        }}
      />}
      <button className={btnClass} disabled={loading || (docType === 'TAX_INVOICE' && !taxCodeDefinitionId)}>{loading ? 'กำลังบันทึก...' : 'บันทึกร่าง'}</button>
    </form>
  );
}

function DocumentDetailPanel({ companyId, documentId, permissions, canCreateSalesRoot, onChanged }: { companyId: string; documentId?: string; permissions: string[]; canCreateSalesRoot: boolean; onChanged: (documentId?: string) => void }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  // Tax the customer withheld. Prefilled from the document only before anything has been received,
  // because after a partial receipt there is no telling how much of the withholding is left.
  const [paymentWht, setPaymentWht] = useState('');
  // The 50 ทวิ the customer issues to US. We never issue it, so there is no certificate record to
  // create — but the number is what proves the tax credit, so it is captured on the payment's
  // existing reference field rather than left on paper.
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<AccountingPaymentMethod>('BANK_TRANSFER');
  const paymentAttempt = useRef<AccountingDocumentPaymentAttempt | null>(null);
  const [linkedTaxInvoiceOpen, setLinkedTaxInvoiceOpen] = useState(false);
  const [linkedTaxInvoiceDate, setLinkedTaxInvoiceDate] = useState(todayCivilDate());
  const [linkedTaxContext, setLinkedTaxContext] = useState<TransactionTaxContext>('DOMESTIC_SALE');
  const [linkedTaxSelections, setLinkedTaxSelections] = useState<Record<number, LinkedTaxSelection | undefined>>({});
  const [editingDraft, setEditingDraft] = useState(false);
  const [editDocumentDate, setEditDocumentDate] = useState(todayCivilDate());
  const [editVatMode, setEditVatMode] = useState<AccountingVatMode>('NO_VAT');
  const [editNote, setEditNote] = useState('');
  const [editLines, setEditLines] = useState<DraftEditLine[]>([]);

  const load = useCallback(async () => {
    if (!documentId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDetail(await getDocument(companyId, documentId));
      setLinkedTaxInvoiceOpen(false);
      setLinkedTaxSelections({});
      setEditingDraft(false);
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  }, [companyId, documentId]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<DocumentDetail | PaymentSummary>, successMessage?: string, selectResult = true): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const result = await action();
      const nextId = 'documentType' in result ? result.id : detail?.id;
      onChanged(selectResult ? nextId : detail?.id);
      if (nextId) setDetail(await getDocument(companyId, nextId));
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (e) {
      setError(err(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createCorrection(body: Parameters<typeof createDocument>[1], successMessage: string, attachment?: File) {
    setError(null);
    setBusy(true);
    let created: DocumentDetail | null = null;
    try {
      created = await createDocument(companyId, body);
      if (attachment) {
        await uploadAccountingDocumentSupporting(companyId, created.id, created.branchId, attachment);
      }
      onChanged(created.id);
      setDetail(await getDocument(companyId, created.id));
      toast.success(successMessage);
    } catch (e) {
      if (created) {
        onChanged(created.id);
        setDetail(await getDocument(companyId, created.id));
        setError(`สร้างร่างเอกสารแล้ว แต่แนบไฟล์ไม่สำเร็จ: ${err(e)} คุณเปิดร่างนี้เพื่อลองแนบใหม่ได้`);
      } else {
        setError(err(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function rejectDocument() {
    if (!detail) return;
    const reason = await promptInput({ title: 'ปฏิเสธใบเสนอราคา', label: 'เหตุผลปฏิเสธ' });
    if (!reason) return;
    await run(() => rejectQuotation(companyId, detail.id, reason), 'ปฏิเสธใบเสนอราคาเรียบร้อยแล้ว');
  }

  async function voidAccountingDocument() {
    if (!detail) return;
    const reason = await promptInput({ title: 'ยกเลิกเอกสาร', label: 'เหตุผลยกเลิกเอกสาร' });
    if (!reason) return;
    await run(() => voidDocument(companyId, detail.id, reason), 'ยกเลิกเอกสารเรียบร้อยแล้ว');
  }

  function beginDraftEdit() {
    if (!detail) return;
    setEditDocumentDate(detail.documentDate.slice(0, 10));
    setEditVatMode(detail.vatMode);
    setEditNote(detail.note ?? '');
    setEditLines(detail.lines.map((line) => ({
      lineNumber: line.lineNumber,
      productId: line.productId,
      skuSnapshot: line.skuSnapshot,
      description: line.description,
      unitName: line.unitName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      vatRate: line.vatRate,
      whtRate: line.whtRate,
      taxCategory: line.taxCategory,
      revenueCategory: line.revenueCategory,
      taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? undefined,
      externalTaxCode: line.taxSnapshot?.externalTaxCode ?? undefined,
      transactionContext: line.taxSnapshot?.taxContext ?? undefined,
    })));
    setEditingDraft(true);
    setError(null);
  }

  async function saveDraftEdit() {
    if (!detail) return;
    const externalCodes = editLines.map((line) => line.externalTaxCode).filter(Boolean) as string[];
    const uniqueCodes = new Set(externalCodes);
    const compatibleOutputTaxCode = externalCodes.length === editLines.length && uniqueCodes.size === 1
      && ['O7', 'OX', 'O0'].includes(externalCodes[0]!)
      ? externalCodes[0] as AccountingOutputTaxCode
      : null;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateDocument(companyId, detail.id, {
        expectedUpdatedAt: detail.updatedAt,
        documentDate: editDocumentDate,
        vatMode: editVatMode,
        outputTaxCode: ['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(detail.documentType)
          ? compatibleOutputTaxCode
          : null,
        note: editNote.trim() || null,
        lines: editLines,
      });
      setDetail(updated);
      setEditingDraft(false);
      onChanged(updated.id);
      toast.success('แก้ไขร่างเอกสารเรียบร้อยแล้ว');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function createLinkedTaxInvoice() {
    if (!detail) return;
    const selections = detail.lines.map((line) => linkedTaxSelections[line.lineNumber]).filter(Boolean) as LinkedTaxSelection[];
    if (selections.length !== detail.lines.length) {
      setError('กรุณาเลือก Tax Code ให้ครบทุกบรรทัดก่อนสร้างใบกำกับภาษี');
      return;
    }
    const vatMode = linkedTaxInvoiceVatMode(selections);
    if (!vatMode) {
      setError('Tax Code แบบ VAT included และ excluded ไม่สามารถใช้ร่วมกันในเอกสารฉบับเดียวได้');
      return;
    }
    const legacyCodes = new Set(selections.map((item) => item.externalCode).filter((code) => ['O7', 'OX', 'O0'].includes(code)));
    const outputTaxCode = legacyCodes.size === 1 && selections.every((item) => legacyCodes.has(item.externalCode))
      ? [...legacyCodes][0] as AccountingOutputTaxCode
      : undefined;
    await run(() => createDocument(companyId, {
      documentType: 'TAX_INVOICE',
      documentDate: linkedTaxInvoiceDate,
      counterpartyId: detail.counterpartyId,
      sourceDocumentId: detail.id,
      sourceDocumentType: detail.documentType,
      currency: detail.currency,
      vatMode,
      outputTaxCode,
      note: `${DOCUMENT_TYPE_LABELS.TAX_INVOICE} for ${detail.documentNumber ?? detail.id}`,
      lines: detail.lines.map((line) => {
        const selection = linkedTaxSelections[line.lineNumber]!;
        return {
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          vatRate: selection.rate,
          taxCodeDefinitionId: selection.id,
          externalTaxCode: selection.externalCode,
          transactionContext: linkedTaxContext,
        };
      }),
    }), 'สร้างร่างใบกำกับภาษีเรียบร้อยแล้ว');
  }

  const canEdit = detail?.status === 'DRAFT' && canDocumentAction(permissions, detail.documentType, 'update');
  const canIssue = detail && ['DRAFT', 'APPROVED'].includes(detail.status) && canDocumentAction(permissions, detail.documentType, 'issue');
  const canSubmit = detail?.documentType === 'QUOTATION' && detail.status === 'DRAFT'
    && permissions.includes('accounting.quotation.submit_approval');
  const canApprove = detail?.documentType === 'QUOTATION' && detail.status === 'PENDING_APPROVAL' && permissions.includes('accounting.quotation.approve');
  const canConvertToInvoice = detail?.documentType === 'QUOTATION' && detail.status === 'ISSUED'
    && canDocumentAction(permissions, 'INVOICE', 'create');
  const canConvertToBillingNote = detail?.documentType === 'QUOTATION' && detail.status === 'ISSUED'
    && canDocumentAction(permissions, 'BILLING_NOTE', 'create');
  const canRecordPayment = detail && ['INVOICE', 'BILLING_NOTE', 'DEBIT_NOTE'].includes(detail.documentType) && detail.status === 'ISSUED' && detail.paymentStatus !== 'PAID' && permissions.includes('accounting.payment.create');
  const paymentSettles = (Number(paymentAmount) || 0) + (Number(paymentWht) || 0);
  // Seed the withheld field from the document, but only while nothing has been received: after a
  // partial receipt the remaining share of the withholding is a judgement call, not arithmetic.
  // Seeded once per document so the operator can clear or correct it without it snapping back.
  const seededWhtFor = useRef<string>('');
  useEffect(() => {
    if (!detail || seededWhtFor.current === detail.id) return;
    seededWhtFor.current = detail.id;
    setPaymentWht(Number(detail.whtAmount) > 0 && Number(detail.paidAmount) === 0 ? String(detail.whtAmount) : '');
  }, [detail]);
  const canTaxInvoice = detail && ['INVOICE', 'RECEIPT'].includes(detail.documentType) && detail.status === 'ISSUED' && permissions.includes('accounting.document.create');
  const canVoid = detail && detail.status !== 'VOIDED' && canDocumentAction(permissions, detail.documentType, 'void');

  if (!documentId) return <section className="mangmee-card p-4 text-base text-gray-500">เลือกเอกสารเพื่อดูรายละเอียดและดำเนินการ</section>;
  if (loading) return <section className="mangmee-card p-4"><LoadingState label="กำลังโหลด..." /></section>;
  if (!detail) return <section className="mangmee-card p-4">{error && <ErrorBanner message={error} />}</section>;

  return (
    <section className="mangmee-card space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-gray-500">{DOCUMENT_TYPE_LABELS[detail.documentType]}</div>
          <h2 className="text-lg font-semibold text-gray-900">{detail.documentNumber ?? detail.id}</h2>
        </div>
        <div className="flex gap-2"><StatusBadge status={detail.status} /><StatusBadge status={detail.paymentStatus} /></div>
      </div>
      {error && <ErrorBanner message={error} />}
      {editingDraft && (
        <section className="space-y-3 rounded-lg border border-brand-200 bg-brand-25 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-gray-600">วันที่เอกสาร<ThemedDate className={inputClass} value={editDocumentDate} onChange={(event) => setEditDocumentDate(event.target.value)} /></label>
            <label className="text-xs font-bold text-gray-600">รูปแบบ VAT<ThemedSelect className={inputClass} value={editVatMode} onChange={(event) => setEditVatMode(event.target.value as AccountingVatMode)}>
              <option value="NO_VAT">ไม่มี VAT</option><option value="VAT_EXCLUDED">ราคายังไม่รวม VAT</option><option value="VAT_INCLUDED">ราคารวม VAT แล้ว</option><option value="EXEMPT">ยกเว้น VAT</option>
            </ThemedSelect></label>
            <label className="text-xs font-bold text-gray-600">หมายเหตุ<input className={inputClass} value={editNote} maxLength={1000} onChange={(event) => setEditNote(event.target.value)} /></label>
          </div>
          <div className="space-y-3">
            {editLines.map((line, index) => (
              <div key={`${line.lineNumber}:${index}`} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_140px_120px]">
                  <input aria-label={`รายละเอียดบรรทัด ${index + 1}`} className={inputClass} value={line.description} maxLength={500} onChange={(event) => setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
                  <input aria-label={`จำนวนบรรทัด ${index + 1}`} className={inputClass} type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                  <input aria-label={`ราคาบรรทัด ${index + 1}`} className={inputClass} type="number" min="0.01" step="0.01" value={line.unitPrice} onChange={(event) => setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item))} />
                  <button type="button" className={ghostClass} disabled={editLines.length === 1} onClick={() => setEditLines((current) => current.filter((_item, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, lineNumber: itemIndex + 1 })))}>ลบบรรทัด</button>
                </div>
                {detail.documentType === 'TAX_INVOICE' && <TransactionTaxLineSelector
                  companyId={companyId}
                  sourceType="accounting.document"
                  sourceId={detail.id}
                  sourceLineId={detail.lines[index]?.id ?? `draft-line-${index + 1}`}
                  transactionContext={line.transactionContext ?? 'DOMESTIC_SALE'}
                  direction="OUTPUT"
                  documentDate={editDocumentDate}
                  netAmount={String((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}
                  grossAmount={String((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}
                  value={line.taxCodeDefinitionId ?? ''}
                  allowNoTax={false}
                  onChange={(_id, definition) => {
                    setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
                      ...item,
                      taxCodeDefinitionId: definition?.id,
                      externalTaxCode: definition?.externalCode,
                      vatRate: definition?.rate ?? '0',
                    } : item));
                    if (!definition || definition.calculationMethod === 'NONE' || ['NON_TAXABLE', 'OUTSIDE_SCOPE'].includes(definition.treatment)) setEditVatMode('NO_VAT');
                    else if (definition.treatment === 'EXEMPT') setEditVatMode('EXEMPT');
                    else setEditVatMode(definition.calculationMethod === 'INCLUSIVE' ? 'VAT_INCLUDED' : 'VAT_EXCLUDED');
                  }}
                />}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghostClass} onClick={() => setEditLines((current) => [...current, { lineNumber: current.length + 1, description: '', quantity: '1', unitPrice: '' }])}>เพิ่มบรรทัด</button>
            <button type="button" className={btnClass} disabled={busy || !editLines.length} onClick={() => void saveDraftEdit()}>{busy ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}</button>
            <button type="button" className={ghostClass} disabled={busy} onClick={() => setEditingDraft(false)}>ยกเลิก</button>
          </div>
        </section>
      )}
      <dl className="grid grid-cols-2 gap-3 text-base sm:grid-cols-4">
        <div><dt className="text-gray-500">วันที่เอกสาร</dt><dd className="font-medium text-gray-900">{formatThaiDate(detail.documentDate)}</dd></div>
        <div><dt className="text-gray-500">ยอดรวม</dt><dd className="font-medium text-gray-900">{money(detail.grandTotalAmount)} {detail.currency}</dd></div>
        <div><dt className="text-gray-500">รับชำระแล้ว</dt><dd className="font-medium text-gray-900">{money(detail.paidAmount)}</dd></div>
        <div><dt className="text-gray-500">ยอดค้างรับ</dt><dd className="font-medium text-gray-900">{money(detail.outstandingAmount)}</dd></div>
        <div><dt className="text-gray-500">VAT</dt><dd className="font-medium text-gray-900">{money(detail.vatAmount)}</dd></div>
        <div><dt className="text-gray-500">รหัสภาษี</dt><dd className="font-mono font-medium text-gray-900">{detail.documentType === 'RECEIPT' ? 'ไม่มี — รับชำระเท่านั้น' : `${!detail.taxCodeSummary || detail.taxCodeSummary === 'NONE' ? 'ไม่มี' : detail.taxCodeSummary === 'SINGLE' ? 'รหัสเดียว' : 'หลายรหัส'}${detail.outputTaxCode ? ` · ${detail.outputTaxCode}` : ''}`}</dd></div>
        <div><dt className="text-gray-500">หัก ณ ที่จ่าย</dt><dd className="font-medium text-gray-900">{money(detail.whtAmount)}</dd></div>
        <div><dt className="text-gray-500">สถานะลงบัญชี</dt><dd className="font-medium text-gray-900">{POSTING_STATUS_LABELS[detail.postingStatus] ?? detail.postingStatus}</dd></div>
        <div><dt className="text-gray-500">เอกสารต้นทาง</dt><dd className="font-medium text-gray-900">{detail.sourceDocumentId ? detail.sourceDocumentId.slice(0, 8) : 'ไม่มี'}</dd></div>
      </dl>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="mangmee-table-scroll">
          <table className="mangmee-table min-w-full">
          <thead><tr><th>ลำดับ</th><th>รายการ</th><th>รหัสภาษี</th><th className="text-right">จำนวน</th><th className="text-right">ราคาต่อหน่วย</th><th className="text-right">ยอดรวม</th></tr></thead>
          <tbody className="divide-y divide-gray-200">
            {detail.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2">{line.lineNumber}</td>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 font-mono">{line.taxSnapshot?.externalTaxCode ?? '—'}{line.taxComponents?.length ? <span className="ml-1 text-xs text-gray-500">({line.taxComponents.length})</span> : null}</td>
                <td className="px-3 py-2 text-right">{line.quantity}</td>
                <td className="px-3 py-2 text-right">{money(line.unitPrice)}</td>
                <td className="px-3 py-2 text-right">{money(line.lineTotalAmount)}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {canEdit && !editingDraft && <button className={ghostClass} disabled={busy} onClick={beginDraftEdit}>แก้ไขร่าง</button>}
        {canCreateSalesRoot && canSubmit && <button className={ghostClass} disabled={busy} onClick={() => run(() => submitQuotationApproval(companyId, detail.id), 'ส่งขออนุมัติเรียบร้อยแล้ว')}>ส่งขออนุมัติ</button>}
        {canApprove && <button className={btnClass} disabled={busy} onClick={() => run(() => approveQuotation(companyId, detail.id, 'อนุมัติในหน้าบัญชี'), 'อนุมัติใบเสนอราคาเรียบร้อยแล้ว')}>อนุมัติ</button>}
        {canApprove && <button className={dangerClass} disabled={busy} onClick={() => void rejectDocument()}>ปฏิเสธ</button>}
        {canIssue && <button className={btnClass} disabled={busy} onClick={() => run(() => issueDocument(companyId, detail.id), 'ออกเอกสารเรียบร้อยแล้ว')}>ออกเอกสาร</button>}
        {canCreateSalesRoot && canConvertToInvoice && <button className={ghostClass} disabled={busy} onClick={() => run(() => convertDocument(companyId, detail.id, 'INVOICE'), 'แปลงเป็นใบแจ้งหนี้เรียบร้อยแล้ว')}>แปลงเป็นใบแจ้งหนี้</button>}
        {canCreateSalesRoot && canConvertToBillingNote && <button className={ghostClass} disabled={busy} onClick={() => run(() => convertDocument(companyId, detail.id, 'BILLING_NOTE'), 'แปลงเป็นใบวางบิลเรียบร้อยแล้ว')}>แปลงเป็นใบวางบิล</button>}
        {canTaxInvoice && <button className={ghostClass} onClick={() => { setLinkedTaxInvoiceOpen(true); setLinkedTaxSelections({}); setError(null); }}>สร้างใบกำกับภาษี</button>}
        {canVoid && <button className={dangerClass + ' col-span-2 order-last sm:order-none'} disabled={busy} onClick={() => void voidAccountingDocument()}>ยกเลิกเอกสาร</button>}
      </div>
      <CorrectionNoteSection
        detail={detail}
        permissions={permissions}
        busy={busy}
        onCreate={createCorrection}
      />
      {canTaxInvoice && linkedTaxInvoiceOpen && (
        <section className="space-y-3 rounded-lg border border-brand-200 bg-brand-25 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold text-gray-900">สร้างใบกำกับภาษีจากเอกสารนี้</h3><p className="text-xs text-gray-600">เลือก Tax Code ตาม profile และบริบทให้ครบทุกบรรทัดก่อนสร้าง Draft</p></div>
            <button type="button" className={ghostClass} onClick={() => setLinkedTaxInvoiceOpen(false)}>ยกเลิก</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ThemedDate className={inputClass} value={linkedTaxInvoiceDate} onChange={(event) => setLinkedTaxInvoiceDate(event.target.value)} />
            <ThemedSelect className={inputClass} value={linkedTaxContext} onChange={(event) => { setLinkedTaxContext(event.target.value as TransactionTaxContext); setLinkedTaxSelections({}); }}>
              <option value="DOMESTIC_SALE">ขายในประเทศ</option>
              <option value="EXPORT_GOODS">ส่งออกสินค้า</option>
              <option value="EXPORT_SERVICE">ส่งออกบริการ</option>
            </ThemedSelect>
          </div>
          <div className="space-y-3">
            {detail.lines.map((line) => (
              <div key={line.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-sm font-medium text-gray-800">บรรทัด {line.lineNumber}: {line.description}</div>
                <TransactionTaxLineSelector
                  companyId={companyId}
                  sourceType="accounting.document"
                  sourceId={`new-linked-tax-invoice:${detail.id}`}
                  sourceLineId={`line:${line.lineNumber}`}
                  transactionContext={linkedTaxContext}
                  direction="OUTPUT"
                  documentDate={linkedTaxInvoiceDate}
                  netAmount={line.lineSubtotalAmount ?? line.lineTotalAmount}
                  grossAmount={line.lineTotalAmount}
                  value={linkedTaxSelections[line.lineNumber]?.id ?? ''}
                  allowNoTax={false}
                  onChange={(_id, definition) => setLinkedTaxSelections((current) => ({
                    ...current,
                    [line.lineNumber]: definition ? {
                      id: definition.id,
                      externalCode: definition.externalCode,
                      rate: definition.rate,
                      calculationMethod: definition.calculationMethod,
                      treatment: definition.treatment,
                    } : undefined,
                  }))}
                />
              </div>
            ))}
          </div>
          <button type="button" className={btnClass} disabled={busy || detail.lines.some((line) => !linkedTaxSelections[line.lineNumber])} onClick={() => void createLinkedTaxInvoice()}>{busy ? 'กำลังสร้าง...' : 'สร้าง Draft ใบกำกับภาษี'}</button>
        </section>
      )}
      {canRecordPayment && (
        <form
          className="grid grid-cols-1 gap-3 border-t border-gray-200 pt-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const attempt = prepareAccountingDocumentPaymentAttempt(paymentAttempt.current, companyId, {
              direction: 'RECEIVED',
              method: paymentMethod,
              amount: paymentAmount,
              ...(Number(paymentWht) > 0 ? { whtAmount: paymentWht } : {}),
              ...(paymentReference.trim() ? { externalReference: paymentReference.trim() } : {}),
              branchId: detail.branchId,
              counterpartyId: detail.counterpartyId,
              allocateToDocumentId: detail.id,
            });
            paymentAttempt.current = attempt;
            const succeeded = await run(() => createPayment(companyId, attempt.body), 'บันทึกรับชำระเรียบร้อยแล้ว', false);
            if (succeeded && paymentAttempt.current === attempt) paymentAttempt.current = null;
          }}
        >
          <input className={inputClass} type="number" min="0.01" step="0.01" placeholder="เงินสดที่ได้รับ" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} required aria-label="เงินสดที่ได้รับ" />
          <input className={inputClass} type="number" min="0" step="0.01" placeholder="ถูกหัก ณ ที่จ่าย" value={paymentWht} onChange={(e) => setPaymentWht(e.target.value)} aria-label="ยอดถูกหัก ณ ที่จ่าย" />
          {Number(paymentWht) > 0 && <input className={`${inputClass} sm:col-span-2`} value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="เลขที่หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ที่ลูกค้าออกให้" aria-label="เลขที่หนังสือรับรองหัก ณ ที่จ่าย" />}
          <ThemedSelect className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as AccountingPaymentMethod)}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ThemedSelect>
          <button className={btnClass} disabled={busy || paymentSettles > Number(detail.outstandingAmount) + 1e-9 && Number(paymentWht) > 0}>{busy ? 'กำลังบันทึก...' : 'บันทึกรับชำระ'}</button>
          <p className="sm:col-span-2 text-xs text-gray-600">
            ตัดยอดค้าง {paymentSettles.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} จาก {Number(detail.outstandingAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {/* Cash alone may become unapplied credit; withheld tax cannot because no cash moved. */}
            {Number(paymentWht) > 0 && paymentSettles > Number(detail.outstandingAmount) + 1e-9 && <strong className="ml-2 text-error-600">เงินสดรวมยอดถูกหักเกินยอดค้าง</strong>}
          </p>
        </form>
      )}
      {inputPromptDialog}
    </section>
  );
}

function CounterpartyListPage({ companyId, canCreateSalesRoot }: { companyId: string; canCreateSalesRoot: boolean }) {
  const toast = useToast();
  const [counterparties, setCounterparties] = useState<CounterpartySummary[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCounterparties(companyId);
      setCounterparties(res.data);
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mangmee-card space-y-3 p-4">
      <h2 className="text-base font-bold text-gray-900">ลูกค้าและคู่ค้า</h2>
      {error && <ErrorBanner message={error} />}
      {canCreateSalesRoot && <form className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { createCounterparty } = await import('./accounting-documents.api');
          await createCounterparty(companyId, { type: 'CUSTOMER', displayName, taxId });
          setDisplayName('');
          setTaxId('');
          await load();
          toast.success('เพิ่มคู่ค้าเรียบร้อยแล้ว');
        } catch (ex) {
          setError(err(ex));
        } finally {
          setBusy(false);
        }
      }}>
        <input className={inputClass} aria-label="ชื่อลูกค้าหรือคู่ค้า" placeholder="ชื่อลูกค้าหรือคู่ค้า" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <input className={inputClass} aria-label="เลขประจำตัวผู้เสียภาษี" placeholder="เลขประจำตัวผู้เสียภาษี" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        <button className={btnClass} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'เพิ่มคู่ค้า'}</button>
      </form>}
      <div className="max-h-64 overflow-auto rounded border border-gray-200">
        {loading ? <LoadingState label="กำลังโหลด..." /> : counterparties.length === 0 ? <p className="p-4 text-sm text-gray-500">ยังไม่มีลูกค้าหรือคู่ค้า</p> : counterparties.map((counterparty) => (
          <div key={counterparty.id} className="flex flex-wrap items-center justify-between border-b border-gray-100 px-3 py-2 text-sm last:border-b-0">
            <span className="font-medium text-gray-900">{counterparty.displayName}</span>
            <span className="text-gray-500">{counterparty.taxId ?? '-'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PaymentListPage({ companyId, reloadKey }: { companyId: string; reloadKey: number }) {
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await listPayments(companyId, { direction: 'RECEIVED' });
        setPayments(res.data);
      } catch (e) {
        setError(err(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [companyId, reloadKey]);

  return (
    <section className="mangmee-card space-y-3 p-4">
      <h2 className="text-base font-bold text-gray-900">รายการรับชำระ</h2>
      {error && <ErrorBanner message={error} />}
      <div className="max-h-64 overflow-auto rounded border border-gray-200">
        {loading ? <LoadingState label="กำลังโหลด..." /> : payments.length === 0 ? <p className="p-4 text-sm text-gray-500">ยังไม่มีรายการรับชำระ</p> : payments.map((payment) => (
          <div key={payment.id} className="grid grid-cols-2 gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 sm:grid-cols-4">
            <span>{formatThaiDate(payment.paidAt)}</span>
            <span>{PAYMENT_METHOD_LABELS[payment.method]}</span>
            <span className="text-right">{money(payment.amount)}</span>
            <span className="text-right text-gray-500">{POSTING_STATUS_LABELS[payment.postingStatus] ?? payment.postingStatus}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AccountingHubPage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [filterType, setFilterType] = useState<AccountingDocumentType | ''>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requested = new URLSearchParams(window.location.search).get('documentType');
    if (DOCUMENT_TYPES.includes(requested as AccountingDocumentType)) setFilterType(requested as AccountingDocumentType);
    const documentId = new URLSearchParams(window.location.search).get('documentId');
    if (documentId) setSelectedId(documentId);
  }, []);
  const refresh = useCallback((documentId?: string) => {
    if (documentId) setSelectedId(documentId);
    setReloadKey((value) => value + 1);
  }, []);
  const contentKey = useMemo(() => `${companyId}:${reloadKey}`, [companyId, reloadKey]);
  const readableDocumentTypes = DOCUMENT_TYPES.filter((documentType) => canDocumentAction(permissions, documentType, 'read'));
  const creatableDocumentTypes = DOCUMENT_TYPES.filter((documentType) => canDocumentAction(permissions, documentType, 'create'));
  const canReadDocuments = readableDocumentTypes.length > 0 || permissions.includes('accounting.document.read_related');
  const canReadCounterparties = permissions.includes('accounting.counterparty.read');
  const canManageCounterparties = permissions.includes('accounting.counterparty.manage');
  const canSubmitQuotation = permissions.includes('accounting.quotation.submit_approval');
  const canReadPayments = permissions.includes('accounting.payment.read');

  const canRecordIncome = permissions.includes('company.vat_registration.read')
    && (canRecordReceivedIncome(permissions) || canCreateIncomeInvoice(permissions));
  const canCreateRootDocument = creatableDocumentTypes.some((type) =>
    ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE'].includes(type));
  const needsSalesAvailability = canCreateRootDocument || canRecordIncome || canManageCounterparties || canSubmitQuotation;
  const salesAvailability = useSalesRootAvailability(companyId, needsSalesAvailability);
  const canCreateSalesRoot = salesAvailability.state === 'OPEN';

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title="บัญชี"
      description="จัดการเอกสารบัญชี การออกเอกสาร การรับชำระ และคู่ค้าโดยอ้างอิง backend จริง"
      actions={canRecordIncome && canCreateSalesRoot
        ? <a href={`/companies/${companyId}/sales-documents/record-income`} className="mangmee-btn mangmee-btn-primary flex h-11 items-center">+ บันทึกรายรับ</a>
        : undefined}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="min-w-0 space-y-4">
          {permissions.includes('accounting.revenue_category.manage') && (
            <div className="flex justify-end">
              <a href={`/companies/${companyId}/sales-documents/revenue-categories`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">จัดการหมวดรายรับ →</a>
            </div>
          )}
          {needsSalesAvailability && salesAvailability.state !== 'OPEN' && (
            <MangmeeCard className="border-amber-200 bg-amber-50 p-5">
              <p className="text-base font-bold text-amber-950">
                {salesAvailability.state === 'LOADING' ? 'กำลังตรวจสอบความพร้อมของระบบ...'
                  : salesAvailability.state === 'CLOSED' ? 'ยังสร้างรายการขายใหม่ไม่ได้ชั่วคราว'
                    : 'ยังตรวจสอบความพร้อมของระบบไม่ได้'}
              </p>
              <p className="mt-2 text-base text-amber-900">รายการเดิมยังเปิดดู รับชำระ ออกใบเสร็จ และแก้ไขได้ตามปกติ</p>
              {salesAvailability.state === 'ERROR' && <button type="button" className={`${ghostClass} mt-3 min-h-11`} onClick={salesAvailability.retry}>ลองตรวจสอบอีกครั้ง</button>}
            </MangmeeCard>
          )}
          {canCreateRootDocument && canCreateSalesRoot && <CreateDocumentForm companyId={companyId} onCreated={refresh} allowedDocumentTypes={creatableDocumentTypes} />}
          {canReadDocuments && <DocumentList
            key={contentKey}
            companyId={companyId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            reloadKey={reloadKey}
            filterType={filterType}
            onFilterTypeChange={setFilterType}
          />}
        </div>
        <div className="min-w-0 space-y-4">
          {canReadDocuments && <DocumentDetailPanel companyId={companyId} documentId={selectedId} permissions={permissions} canCreateSalesRoot={canCreateSalesRoot} onChanged={refresh} />}
          {canReadCounterparties && <CounterpartyListPage companyId={companyId} canCreateSalesRoot={canManageCounterparties && canCreateSalesRoot} />}
          {canReadPayments && <PaymentListPage companyId={companyId} reloadKey={reloadKey} />}
        </div>
      </div>
    </MangmeePage>
  );
}

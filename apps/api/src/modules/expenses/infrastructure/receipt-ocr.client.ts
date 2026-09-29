import { isLineAiRolloutAllowed } from '@watchdog-bms/config';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { AppConfigService } from '../../../common/config/app-config.service';
import { extractValueCandidates, mapThaiDigits, receiptPayeeEntityKind, todayCivilDate, type AiModelPolicy, type ReceiptOcrEvidenceRole, type ReceiptOcrFieldEvidenceV2, type ReceiptOcrRequest, type ReceiptOcrResponse } from '@watchdog-bms/contracts';
import { AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { safeLineErrorDetails } from '../../line-ai/infrastructure/line-reply.adapter';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { classifyAiUsageRequest, companyAiBudgetRefusal, recordCompanyAiUsage, runWithCompanyAiBudgetAdmission, type AiRequestContent } from '../../line-ai/application/company-ai-usage-meter';
import { cancelAiBudgetStep, cancelAiBudgetStepIfGatewayUnspent, type AiBudgetCancelProof, type ReservedAiBudgetStep } from '../../line-ai/application/company-ai-budget-reservation';
import {
  type CompanyOcrAdmissionIdentity,
  admitCompanyOcr,
  companyOcrErrorCode,
  isOcrPreProviderRefusal,
  isOcrRetryableProviderFailure,
  isSinglePageReceiptImage,
  releaseCompanyOcrAdmission,
} from '../../line-ai/application/company-ocr-governance';

// 4 x 45s of gateway provider chain + 15s margin. MUST outlast the gateway: aborting first returns
// AI_GATEWAY_UNREACHABLE, which releases the OCR admission as a retryable failure AND loses the
// response body that carries the usage the meter bills from — so the provider spend would land on
// neither meter, and the trial AI budget is calibrated from both.
const EXTRACT_TIMEOUT_MS = AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS;

/**
 * A receipt read is OCR either way; the KIND still reports a PDF honestly as OTHER.
 *
 * Optional chaining is load-bearing, not defensive noise: this is evaluated while ASSEMBLING the
 * budget step, before admission has decided anything, and a request that would be refused by the
 * rate limit, the missing secret, the model policy or the money gate may legitimately never carry
 * an attachment. Reading it eagerly turned seven of those refusals into a `TypeError`.
 */
const receiptOcrContent = (request: ReceiptOcrRequest): AiRequestContent =>
  request.attachment?.mimeType === 'application/pdf' ? 'document' : 'image';

function receiptEvidencePaths(fields: NonNullable<ReceiptOcrResponse['fields']>): Map<string, string> {
  const paths = new Map<string, string>();
  const add = (path: string, value: unknown) => { if (typeof value === 'string' && value) paths.set(path, value); };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'buyerAsPrinted' && value && typeof value === 'object') for (const [name, part] of Object.entries(value)) add(`buyerAsPrinted.${name}`, part);
    else if (key === 'lines' && Array.isArray(value)) value.forEach((line, index) => Object.entries(line).forEach(([name, part]) => { if (!['evidenceSignal', 'confidence'].includes(name)) add(`lines.${index}.${name}`, part); }));
    else if (key === 'additionalCharges' && Array.isArray(value)) value.forEach((charge, index) => Object.entries(charge).forEach(([name, part]) => { if (!['kind', 'evidenceSignal', 'confidence'].includes(name)) add(`additionalCharges.${index}.${name}`, part); }));
    else if (!['confidence', 'missingFields', 'expenseDateAssumptions', 'vendorEntityKind', 'categorySuggestion'].includes(key)) add(key, value);
  }
  return paths;
}

function receiptRole(path: string): ReceiptOcrEvidenceRole | undefined {
  if (path === 'vendorName' || path === 'vendorIdentityEvidence') return 'seller_name';
  if (path === 'vendorTaxId') return 'seller_tax_id';
  if (path === 'vendorBranchCode') return 'seller_branch';
  if (path === 'vendorAddress') return 'seller_address';
  if (path === 'buyerAsPrinted.name') return 'buyer_name';
  if (path === 'buyerAsPrinted.taxId') return 'buyer_tax_id';
  if (path === 'buyerAsPrinted.branchCode') return 'buyer_branch';
  if (path === 'buyerAsPrinted.addressText') return 'buyer_address';
  if (path === 'documentNumber') return 'document_number';
  if (path === 'expenseDate') return 'transaction_date';
  if (path === 'description') return 'description';
  if (path === 'quantity') return 'quantity';
  if (path === 'unitPrice') return 'unit_price';
  if (path === 'vatRate') return 'vat_rate';
  if (path === 'whtRate') return 'wht_rate';
  if (path === 'subtotalAmount') return 'subtotal';
  if (path === 'discountAmount') return 'discount';
  if (path === 'taxableAmount') return 'taxable_base';
  if (path === 'vatAmount') return 'vat_amount';
  if (path === 'whtAmount') return 'wht_amount';
  if (path === 'whtBaseAmount') return 'wht_base';
  if (path === 'grandTotalAmount') return 'grand_total';
  if (path === 'currency') return 'currency';
  if (path === 'vatMode') return 'vat_mode';
  if (/^lines\.\d+\.description$/u.test(path)) return 'line_description';
  if (/^lines\.\d+\.amount$/u.test(path)) return 'line_amount';
  if (/^lines\.\d+\.quantity$/u.test(path)) return 'line_quantity';
  if (/^lines\.\d+\.unitPrice$/u.test(path)) return 'line_unit_price';
  if (/^lines\.\d+\.(?:vatRate|vatTreatment)$/u.test(path)) return 'line_vat';
  if (/^additionalCharges\.\d+\.description$/u.test(path)) return 'charge_description';
  if (/^additionalCharges\.\d+\.amount$/u.test(path)) return 'charge_amount';
  if (/^additionalCharges\.\d+\.vatRate$/u.test(path)) return 'charge_vat';
  return undefined;
}

function strictReceiptDecimal(value: string): Decimal | undefined {
  const text = mapThaiDigits(value).normalize('NFKC').replace(/[−－]/gu, '-').trim();
  const accountingNegative = /^\(\s*((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)\s*\)$/u.exec(text);
  const trailingNegative = /^((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)-$/u.exec(text);
  const body = accountingNegative?.[1] ?? trailingNegative?.[1] ?? text;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/u.test(body)) return undefined;
  try {
    const number = new Decimal(body.replace(/,/gu, ''));
    return accountingNegative || trailingNegative ? number.negated() : number;
  } catch { return undefined; }
}

function receiptNumberSign(value: string): 'negative' | 'positive' | 'none' {
  const text = mapThaiDigits(value).normalize('NFKC').replace(/[−－]/gu, '-').trim();
  if (/^\(/u.test(text) || /-$/u.test(text) || /^-/u.test(text)) return 'negative';
  return /^\+/u.test(text) ? 'positive' : 'none';
}

function apiReceiptIssuerText(page: string): string {
  const marked = [...page.matchAll(/\[SELLER\]([\s\S]*?)\[\/SELLER\]/giu)].map((match) => match[1]!);
  return (marked.length ? marked : [page]).map((block) => {
    let otherParty = false;
    return block.split('\n').filter((row) => {
      if (/^\s*(?:[#*|]+\s*)?(?:\[BUYER\]|buyer\b|customer\b|patient\b|bill\s+to\b|ship\s+to\b|cashier\b|(?:ชื่อลูกค้า|ลูกค้า|ผู้ซื้อ|ผู้ป่วย|ผู้รับสินค้า)(?:\s|[:：])|ชื่อ\s*\/\s*Patient)/iu.test(row)) otherParty = true;
      if (/^\s*(?:[#*|]+\s*)?(?:seller\b|issuer\b|(?:ผู้ขาย|ผู้ออกเอกสาร)(?:\s|[:：]))/iu.test(row)) otherParty = false;
      return !otherParty;
    }).join('\n');
  }).join('\n');
}

function roleLine(text: string, locator: ReceiptOcrFieldEvidenceV2): { line: string; before: string } {
  const start = text.lastIndexOf('\n', locator.localSpan.start - 1) + 1;
  const endAt = text.indexOf('\n', locator.localSpan.end);
  const end = endAt < 0 ? text.length : endAt;
  return { line: mapThaiDigits(text.slice(start, end)), before: mapThaiDigits(text.slice(start, locator.localSpan.start)) };
}

function apiReceiptRoleMatches(page: string, locator: ReceiptOcrFieldEvidenceV2, path: string, value: string): boolean {
  const { line, before } = roleLine(page, locator);
  const checks: Partial<Record<ReceiptOcrEvidenceRole, RegExp>> = {
    document_number: /(?:เลขที่(?:ใบเสร็จ|เอกสาร|ใบกำกับภาษี)?|RECEIPT\s*(?:NO|NUMBER)|INVOICE\s*(?:NO|NUMBER)|BILL\s*(?:NO|NUMBER)|DOCUMENT\s*(?:NO|NUMBER)|\bNO\.?\s*)/iu,
    transaction_date: /(?:TRANSACTION\s+DATE|TRANS\s+DATE|TXN\s+DATE|SALE\s+DATE|RECEIPT\s+DATE|ISSUE\s+DATE|DOCUMENT\s+DATE|วันที่ขาย|วันที่|DATE)/iu,
    grand_total: /(?:GRAND\s+TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE|NET\s+TOTAL|รวมทั้งสิ้น|ยอดสุทธิ|ยอดชำระ|TOTAL)/iu,
    subtotal: /(?:SUB\s*TOTAL|SUBTOTAL|ยอดรวม|รวมเงิน)/iu,
    discount: /(?:DISCOUNT|COUPON|VOUCHER|ส่วนลด|คูปอง|โปรโมชั่น)/iu,
    taxable_base: /(?:TAXABLE\s+(?:BASE|AMOUNT)|VAT\s+EXCL|มูลค่าก่อนภาษี|ฐานภาษี)/iu,
    vat_amount: /(?:VAT\s*(?:AMT|AMOUNT|TTL|TOTAL)|TOTAL\s+VAT|ยอดภาษี|ภาษีมูลค่าเพิ่ม)/iu,
    wht_amount: /(?:WHT\s*(?:AMT|AMOUNT|TTL|TOTAL)|WITHHOLDING\s+TAX|หักภาษี\s*ณ\s*ที่จ่าย)/iu,
    wht_base: /(?:WHT\s+BASE|WITHHOLDING\s+(?:TAX\s+)?BASE|ฐาน.{0,15}(?:หัก|ณ\s*ที่จ่าย))/iu,
    vat_rate: /(?:VAT|TAX|ภาษีมูลค่าเพิ่ม)/iu,
    wht_rate: /(?:WHT|WITHHOLD|หักภาษี\s*ณ\s*ที่จ่าย)/iu,
    seller_tax_id: /(?:TAX\s*(?:ID|NO|NUMBER)|\bTIN\b|เลข(?:ประจำตัว)?ผู้เสียภาษี|เลขทะเบียนนิติบุคคล|ทะเบียนเลขที่)/iu,
    seller_branch: /(?:สำนักงานใหญ่|สนญ|HEAD\s+OFFICE|\bHQ\b|\bHO\b|สาขา|BRANCH)/iu,
    seller_address: /(?:ที่อยู่|ที่ตั้ง|สำนักงาน|\bADDRESS\b)/iu,
  };
  const expectedRole = locator.role;
  const required = checks[expectedRole];
  if (required && !required.test(before)) return false;
  if (expectedRole === 'grand_total' && /(?:CASH|CHANGE|TENDERED|PAYMENT|เงินสด|เงินทอน|รับชำระ)/iu.test(before.slice(before.search(required!) + 1))) return false;
  if (expectedRole === 'document_number' && extractValueCandidates(value).dates.some((date) => date.span.trim() === value)) return false;
  if (expectedRole === 'transaction_date' && !extractValueCandidates(locator.rawValue, todayCivilDate(), { documentContext: 'receipt' }).dates.some((date) => date.isoDate === value)) return false;
  if (expectedRole === 'seller_name' || expectedRole === 'seller_tax_id' || expectedRole === 'seller_branch' || expectedRole === 'seller_address') {
    const issuer = apiReceiptIssuerText(page);
    if (!issuer.includes(locator.rawValue)) return false;
  }
  if (['buyer_name', 'buyer_tax_id', 'buyer_branch', 'buyer_address'].includes(expectedRole)
    && !/(?:ผู้ซื้อ|ชื่อลูกค้า|ลูกค้า|BUYER|CUSTOMER|BILL\s+TO|ที่อยู่ผู้ซื้อ)/iu.test(page.slice(Math.max(0, locator.localSpan.start - 180), locator.localSpan.start))) return false;
  if (expectedRole === 'buyer_branch' && value === '00000'
    && !/(?:สำนักงานใหญ่|สนญ|HEAD\s+OFFICE|\bHQ\b|\bHO\b)/iu.test(page.slice(Math.max(0, locator.localSpan.start - 60), locator.localSpan.end))) return false;
  if (expectedRole.startsWith('line_')) {
    const rowDescription = /^lines\.(\d+)\./u.exec(path)?.[1];
    const description = rowDescription ? undefined : value;
    if (description && !line.includes(description)) return false;
    if (rowDescription && !line.trim()) return false;
  }
  return true;
}

/** API trust boundary: match the signed attachment digest and recheck every Gateway locator locally. */
export function verifyReceiptOcrEvidenceV2(response: ReceiptOcrResponse, request: ReceiptOcrRequest): boolean {
  try {
  const evidence = response.receiptEvidence;
  if (!evidence || evidence.version !== 2 || !request.attachment?.contentBase64
    || evidence.attachmentId !== request.attachment.id || !/^[0-9a-f]{64}$/u.test(evidence.attachmentSha256)) return false;
  const expectedDigest = createHash('sha256').update(Buffer.from(request.attachment.contentBase64, 'base64')).digest('hex');
  if (expectedDigest !== evidence.attachmentSha256 || !Array.isArray(evidence.pages) || evidence.pages.length < 1 || evidence.pages.length > 20) return false;
  const pages = new Map<number, string>();
  let pageTextLength = 0;
  for (const page of evidence.pages) {
    if (!page || typeof page !== 'object' || !Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0
      || typeof page.text !== 'string' || !page.text.trim() || page.text.length > 12_000 || pages.has(page.pageIndex)) return false;
    pageTextLength += page.text.length;
    if (pageTextLength > 12_000) return false;
    pages.set(page.pageIndex, page.text);
  }
  if (evidence.pages.some((page, index) => page.pageIndex !== index)) return false;
  if (new Set([...pages.values()].map((value) => mapThaiDigits(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toUpperCase())).size !== pages.size) return false;
  if (response.fields) {
    const fields = response.fields as Record<string, any>;
    if (typeof fields !== 'object' || Array.isArray(fields)
      || (fields.lines !== undefined && (!Array.isArray(fields.lines) || fields.lines.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))))
      || (fields.additionalCharges !== undefined && (!Array.isArray(fields.additionalCharges) || fields.additionalCharges.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))))
      || (fields.buyerAsPrinted !== undefined && (!fields.buyerAsPrinted || typeof fields.buyerAsPrinted !== 'object' || Array.isArray(fields.buyerAsPrinted)))) return false;
  }
  const expected = response.fields ? receiptEvidencePaths(response.fields) : new Map<string, string>();
  if (response.fields?.vendorEntityKind !== undefined
    && (typeof response.fields.vendorName !== 'string' || typeof response.fields.vendorIdentityEvidence !== 'string'
      || receiptPayeeEntityKind(response.fields.vendorName, response.fields.vendorIdentityEvidence) !== response.fields.vendorEntityKind)) return false;
  if (!evidence.fields || typeof evidence.fields !== 'object' || Array.isArray(evidence.fields)
    || Object.keys(evidence.fields).length !== expected.size) return false;
  let sellerPage: number | undefined;
  for (const [path, value] of expected) {
    const locator = evidence.fields[path];
    const role = receiptRole(path);
    if (!locator || !role || locator.role !== role || !pages.has(locator.pageIndex)
      || !Number.isSafeInteger(locator.localSpan?.start) || !Number.isSafeInteger(locator.localSpan?.end)
      || locator.localSpan.start < 0 || locator.localSpan.end <= locator.localSpan.start
      || typeof locator.rawValue !== 'string') return false;
    const page = pages.get(locator.pageIndex)!;
    if (page.slice(locator.localSpan.start, locator.localSpan.end) !== locator.rawValue) return false;
    if (!apiReceiptRoleMatches(page, locator, path, value)) return false;
    if (role.startsWith('seller_')) {
      if (sellerPage !== undefined && sellerPage !== locator.pageIndex) return false;
      sellerPage = locator.pageIndex;
    }
    if (['amount', 'quantity', 'unitPrice', 'vatRate', 'whtRate'].some((suffix) => path === suffix || path.endsWith(`.${suffix}`))
      || ['subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'whtBaseAmount', 'grandTotalAmount'].includes(path)) {
      const printed = strictReceiptDecimal(locator.rawValue);
      const parsed = strictReceiptDecimal(value);
      if (!printed || !parsed || receiptNumberSign(locator.rawValue) !== receiptNumberSign(value)) return false;
      const percentRole = role === 'vat_rate' || role === 'wht_rate' || role === 'line_vat' || role === 'charge_vat';
      if (percentRole && /%/u.test(page.slice(locator.localSpan.end, locator.localSpan.end + 3))) {
        if (!parsed.mul(100).eq(printed)) return false;
      } else if (!parsed.eq(printed)) return false;
    } else if (role === 'seller_tax_id' || role === 'buyer_tax_id') {
      if (locator.rawValue.replace(/\D/gu, '') !== value.replace(/\D/gu, '')) return false;
    } else if (role === 'seller_branch' || role === 'buyer_branch') {
      const raw = locator.rawValue;
      const digits = raw.replace(/\D/gu, '');
      if (value === '00000' ? !/(?:สำนักงานใหญ่|สนญ|HEAD\s+OFFICE|\bHQ\b|\bHO\b|00000)/iu.test(raw)
        : digits !== String(Number(value))) return false;
    } else if (role === 'currency') {
      const currency = value.toUpperCase();
      const valid = currency === 'THB' ? /(?:\bTHB\b|฿|บาท)/iu.test(locator.rawValue)
        : currency === 'USD' ? /(?:\bUSD\b|US\$|\$)/iu.test(locator.rawValue)
          : currency === 'EUR' ? /(?:\bEUR\b|€)/iu.test(locator.rawValue) : currency === 'GBP' ? /(?:\bGBP\b|£)/iu.test(locator.rawValue)
            : currency === 'JPY' ? /(?:\bJPY\b|¥|円)/iu.test(locator.rawValue) : /(?:\bCNY\b|\bRMB\b|人民币)/iu.test(locator.rawValue);
      if (!valid) return false;
    } else if (role === 'vat_mode' || role === 'line_vat') {
      if (!locator.rawValue.trim()) return false;
    } else if (role !== 'transaction_date') {
      if (mapThaiDigits(locator.rawValue).normalize('NFKC').replace(/\s+/gu, ' ').trim().toUpperCase()
        !== mapThaiDigits(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toUpperCase()) return false;
    }
    const linePath = /^lines\.(\d+)\.(?:amount|quantity|unitPrice)$/u.exec(path);
    if (linePath) {
      const description = expected.get(`lines.${linePath[1]}.description`);
      if (!description || !roleLine(page, locator).line.includes(description)) return false;
    }
  }
  const sellerAnchorPath = ['vendorName', 'vendorIdentityEvidence', 'vendorTaxId'].find((path) => evidence.fields[path]);
  if (sellerAnchorPath) {
    const sellerAnchorPage = evidence.fields[sellerAnchorPath]!.pageIndex;
    const vendorName = expected.get('vendorName') ?? expected.get('vendorIdentityEvidence');
    const vendorTaxId = expected.get('vendorTaxId')?.replace(/\D/gu, '');
    for (const locator of Object.values(evidence.fields)) {
      if (locator.pageIndex === sellerAnchorPage) continue;
      const issuer = apiReceiptIssuerText(pages.get(locator.pageIndex)!);
      const sameVendorName = vendorName && issuer.normalize('NFKC').replace(/\s+/gu, ' ').toUpperCase()
        .includes(vendorName.normalize('NFKC').replace(/\s+/gu, ' ').toUpperCase());
      const sameVendorTaxId = vendorTaxId && issuer.replace(/\D/gu, '').includes(vendorTaxId);
      if (!sameVendorName && !sameVendorTaxId) return false;
    }
  }
  return Object.keys(evidence.fields).every((path) => expected.has(path));
  } catch {
    return false;
  }
}

@Injectable()
export class ReceiptOcrClient {
  private readonly logger = new Logger(ReceiptOcrClient.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(RedisRateLimitService) private readonly rateLimits: RedisRateLimitService | undefined,
    private readonly prisma: PrismaService,
  ) {}

  async extract(request: ReceiptOcrRequest, options: { onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void } = {}): Promise<ReceiptOcrResponse> {
    if (this.rateLimits) {
      const companyId = (request as any).companyId ?? (request as any).userContext?.companyId;
      if (!companyId) return { status: 'failed', errorCode: 'AI_RATE_LIMIT_COMPANY_REQUIRED' };
      const decision = await this.rateLimits.consume('ai-ocr-company', companyId, this.config.aiOcrMaxPerCompany, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) return { status: 'failed', errorCode: 'AI_OCR_RATE_LIMITED' };
    }
    if (!this.config.aiGatewayInternalSecret) {
      return { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' };
    }
    // Policy is local readiness. Resolve it before reserving quota so a stale/unapproved tenant
    // model can never consume an OCR read without a provider call.
    const modelPolicy = await resolveCompanyAiModelPolicy(
      this.prisma,
      request.companyId,
      this.config.approvedAiModelIds,
    );
    const admission = await runWithCompanyAiBudgetAdmission(
      this.prisma,
      this.config,
      this.rateLimits,
      request.companyId,
      (monthKey, hold) => this.extractOcrAdmitted(request, modelPolicy, monthKey, options.onAdmitted, hold),
      undefined,
      {
        // ADR 0013 §4: the client's own extraction request id IS the logical attempt — the upload
        // screen reuses it for a lost response and rotates it for an explicit re-read, which is
        // exactly the attempt boundary money must follow. No LINE id, no prompt text.
        stepKind: 'receipt-ocr', attemptKey: `receipt-web:${request.requestId}`,
        sourceRoute: 'receipt-ocr', modelId: modelPolicy?.modelId ?? '', requestId: request.requestId,
        ...classifyAiUsageRequest('receipt-ocr', receiptOcrContent(request)),
      },
    );
    if (admission.allowed) return admission.value;
    // Refused BEFORE `admitCompanyOcr`, so no OCR read was counted and there is nothing to release.
    // The scope rides along so the web notice can say which ceiling closed (spec §9.1).
    const refusal = companyAiBudgetRefusal(admission);
    return { status: 'failed', errorCode: refusal.code, budgetScope: refusal.budgetScope };
  }

  private async extractOcrAdmitted(
    request: ReceiptOcrRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
    onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void,
    hold?: ReservedAiBudgetStep,
  ): Promise<ReceiptOcrResponse> {
    const admission = await admitCompanyOcr(this.prisma, {
      companyId: request.companyId,
      sourceRoute: 'receipt-ocr-web',
      // One explicit web extraction attempt, including a lost-response retry, uses one request id.
      // A deliberate re-read or a failed provider retry gets a fresh id; fencing on the attachment
      // would prevent the customer from ever retrying an unreadable source.
      requestId: request.requestId,
      monthKey: budgetMonthKey,
      // P10-L §15.1: the plan slip ceiling is always measured here; this flag decides whether it refuses.
      enforceReceiptQuota: this.config.receiptQuotaEnforced,
      // The stored attachment's own type; only a one-page image may draw an add-on lot (D4).
      singlePageImage: isSinglePageReceiptImage(request.attachment?.mimeType),
    });
    if (!admission.allowed) {
      // The money hold was taken BEFORE this count/switch/plan gate (ADR 0013 §5). The gate refusing
      // here is proof that no provider call started, so this exact hold is released — and only it.
      await this.releaseHold(hold, 'ocr_admission_refused');
      return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
    }
    onAdmitted?.(admission);
    let result: ReceiptOcrResponse;
    try {
      result = await this.extractAdmitted(request, modelPolicy, budgetMonthKey, hold);
    } catch (error) {
      this.logger.warn({ msg: 'receipt OCR response invalid', requestId: request.requestId, ...safeLineErrorDetails(error) });
      result = { status: 'failed', errorCode: 'OCR_JSON_PARSE_FAILED' };
    }
    const requireEvidenceV2 = request.requireEvidenceV2 === true || (this.config.lineAiReliabilityV2Mode === 'on'
      && isLineAiRolloutAllowed(this.config.lineAiReliabilityV2CompanyIds, request.companyId));
    if (requireEvidenceV2 && result.status === 'ok' && !verifyReceiptOcrEvidenceV2(result, request)) {
      result = { status: 'failed', errorCode: 'OCR_EVIDENCE_INVALID', ...(result.usage ? { usage: result.usage } : {}) };
    }
    // E1c: a refusal by the gateway's own money guard (model/bound/envelope outside what was
    // reserved) carries our code and no usage row, so this hold provably paid for nothing. The
    // OCR read COUNT is a separate decision and stays with `isOcrPreProviderRefusal` below (R-05).
    await cancelAiBudgetStepIfGatewayUnspent(this.prisma, hold, {
      budgetCode: result.errorCode, usage: result.usage,
    });
    // Two reasons to hand the read back. `isOcrPreProviderRefusal` proves no provider ran.
    // `isOcrRetryableProviderFailure` does not — but the upload screen retries it under a fresh
    // request id, which buys a second admission, so keeping this one charges a 15-read trial twice
    // for one flaky upload (P10-L §15.1 residual-1).
    if (isOcrPreProviderRefusal(result) || isOcrRetryableProviderFailure(result)) {
      // R-05: ONLY the pre-provider proof releases money. `isOcrRetryableProviderFailure` says the
      // provider may well have run and cost real money, so it refunds the customer's READ COUNT
      // below and never touches the hold — `releaseCompanyOcrAdmission` cannot reach a reservation.
      if (isOcrPreProviderRefusal(result)) await this.releaseHold(hold, 'gateway_pre_provider_refusal');
      const released = await releaseCompanyOcrAdmission(this.prisma, {
        companyId: request.companyId,
        sourceRoute: 'receipt-ocr-web',
        requestId: request.requestId,
        eventId: admission.eventId,
        ...(isOcrPreProviderRefusal(result) ? {} : { reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' as const }),
      });
      // A pre-provider refusal that cannot be compensated must not look like a free read. A
      // retryable failure keeps its own error: the retry will admit afresh either way, and
      // replacing a truthful "the gateway is down" with a quota word would misdirect the shop.
      if (!released && isOcrPreProviderRefusal(result)) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
    }
    return result;
  }

  /** The one place this seam may release money, and only with a proof that no provider ran. */
  private async releaseHold(hold: ReservedAiBudgetStep | undefined, proof: AiBudgetCancelProof): Promise<void> {
    if (hold) await cancelAiBudgetStep(this.prisma, { reservationId: hold.id, ownerToken: hold.ownerToken, proof });
  }

  private async extractAdmitted(
    request: ReceiptOcrRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
    hold?: ReservedAiBudgetStep,
  ): Promise<ReceiptOcrResponse> {
    const secret = this.config.aiGatewayInternalSecret!;
    const governedRequest = {
      ...request,
      requireEvidenceV2: request.requireEvidenceV2 === true || (this.config.lineAiReliabilityV2Mode === 'on'
        && isLineAiRolloutAllowed(this.config.lineAiReliabilityV2CompanyIds, request.companyId)),
      ...(modelPolicy && { modelPolicy }), ...(hold && { budgetEnvelope: hold.envelope }),
    };
    let response: Response;
    try {
      response = await fetch(`${this.config.aiGatewayInternalUrl}/internal/ai/receipt-ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify(governedRequest),
        signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error({ msg: 'receipt OCR gateway unreachable', ...safeLineErrorDetails(err), requestId: request.requestId });
      return { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' };
    }

    if (!response.ok) {
      this.logger.error({ msg: 'receipt OCR gateway error', status: response.status, requestId: request.requestId });
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }

    const result = (await response.json()) as ReceiptOcrResponse;
    // Same route name as the LINE lane's OCR seam, different flow — both record.
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        {
          companyId: request.companyId, sourceRoute: 'receipt-ocr', requestId: request.requestId, monthKey: budgetMonthKey,
          ...(hold && { invocationKey: hold.invocationKey }),
          ...classifyAiUsageRequest('receipt-ocr', receiptOcrContent(request)),
        },
        result.usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, ...safeLineErrorDetails(err) });
    }
    return result;
  }
}

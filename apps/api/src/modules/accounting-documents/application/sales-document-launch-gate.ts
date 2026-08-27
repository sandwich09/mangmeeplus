import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AccountingDocumentType,
  RequestContext,
  SalesDocumentRootAvailability,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../audit/application/audit.service';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../employee-access/application/entitlement.helper';
import { LaunchGateGuardService } from '../../feature-launch/application/launch-gate.guard';
import { isLaunchRouteOpen } from '../../tax/application/use-cases/wht-certificate-handoff.use-case';
import type { DocumentRecord } from '../domain/models/accounting.model';
import type { CreateDocumentInput } from '../domain/models/accounting.model';
import { validateOutputTaxDocument } from '../domain/logic/accounting-status.logic';

export const SALES_DOCUMENT_LAUNCH_ROUTE_CLOSED_MESSAGE =
  'ระบบสร้างรายการขายใหม่ปิดปรับปรุงชั่วคราว รายการเดิมยังเปิดดู รับชำระ ออกใบเสร็จ และแก้ไขได้ตามปกติ';

/**
 * `sales_documents/DEFAULT` is BLOCK_NEW_ROOT, not a blanket stop. Source-linked receipts and tax
 * invoices plus credit/debit corrections are runoff and must remain available after CLOSE.
 */
export function createsNewSalesRoot(input: {
  documentType: AccountingDocumentType;
  sourceDocumentId?: string;
}, source?: Pick<DocumentRecord, 'documentType' | 'status' | 'paymentStatus' | 'outstandingAmount'>): boolean {
  if (['QUOTATION', 'INVOICE', 'BILLING_NOTE'].includes(input.documentType)) return true;
  if (input.documentType === 'RECEIPT') {
    return !input.sourceDocumentId
      || source?.documentType !== 'INVOICE'
      || source.status !== 'ISSUED'
      || source.paymentStatus !== 'PAID'
      || Number(source.outstandingAmount) !== 0;
  }
  if (input.documentType === 'TAX_INVOICE') {
    return !input.sourceDocumentId
      || !source
      || !['INVOICE', 'RECEIPT'].includes(source.documentType)
      || source.status !== 'ISSUED';
  }
  return false;
}

export function isSalesDocumentLaunchClosedError(error: unknown): boolean {
  const body = (error as { getResponse?: () => unknown })?.getResponse?.() as { code?: string } | undefined;
  return body?.code === FEATURE_TEMPORARILY_UNAVAILABLE;
}

/**
 * Serialize every source-linked sales mutation on the canonical document
 * lifecycle key. Receipt creation also re-checks paid eligibility and active
 * uniqueness while holding that lock, which is the same key payment void uses.
 */
export async function assertSalesDocumentSourceMutationInTransaction(
  db: any,
  companyId: string,
  input: Pick<CreateDocumentInput, 'documentType' | 'sourceDocumentId' | 'sourceDocumentType' | 'vatMode' | 'outputTaxCode' | 'lines'>,
): Promise<any | undefined> {
  if (!input.sourceDocumentId) return undefined;
  const initialSource = await db.accountingDocument.findFirst({
    where: { id: input.sourceDocumentId, companyId },
    select: { documentType: true, sourceDocumentId: true, sourceDocumentType: true },
  });
  if (!initialSource) throw new NotFoundException('Referenced source document was not found');
  // A tax invoice may cite either an invoice or its receipt. Both belong to one sale and must
  // share a lifecycle lock, otherwise each path could issue a separate active tax invoice.
  const upstreamSource = input.documentType === 'TAX_INVOICE'
    && initialSource.documentType === 'RECEIPT'
    && initialSource.sourceDocumentId
    ? await db.accountingDocument.findFirst({
        where: { id: initialSource.sourceDocumentId, companyId },
        select: { id: true, documentType: true },
      })
    : null;
  const lifecycleSourceId = upstreamSource?.documentType === 'INVOICE'
    ? upstreamSource.id
    : input.sourceDocumentId;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${lifecycleSourceId}:accounting-document-lifecycle`}))`;
  if (lifecycleSourceId !== input.sourceDocumentId) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${input.sourceDocumentId}:accounting-document-lifecycle`}))`;
  }
  const currentSource = await db.accountingDocument.findFirst({
    where: { id: input.sourceDocumentId, companyId },
  });
  if (!currentSource) throw new NotFoundException('Referenced source document was not found');
  // Prisma represents nullable columns as null, while the domain facts use
  // absence/undefined. Normalize at this infrastructure boundary so a non-VAT
  // invoice is not mistaken for a VAT source merely because outputTaxCode=null.
  const sourceFacts = {
    ...currentSource,
    outputTaxCode: currentSource.outputTaxCode ?? undefined,
  };
  const currentSourceError = validateOutputTaxDocument(input, sourceFacts);
  if (currentSourceError) throw new UnprocessableEntityException(currentSourceError);
  if (!['RECEIPT', 'TAX_INVOICE'].includes(input.documentType)) return sourceFacts;
  const taxFamilySourceIds = input.documentType === 'TAX_INVOICE'
    ? [
        lifecycleSourceId,
        ...(await db.accountingDocument.findMany({
          where: {
            companyId,
            sourceDocumentId: lifecycleSourceId,
            documentType: 'RECEIPT',
          },
          select: { id: true },
        })).map((row: { id: string }) => row.id),
      ]
    : [input.sourceDocumentId];
  const existingLinkedDocument = await db.accountingDocument.findFirst({
    where: {
      companyId,
      sourceDocumentId: { in: taxFamilySourceIds },
      documentType: input.documentType,
      status: { not: 'VOIDED' },
    },
    select: { id: true },
  });
  if (existingLinkedDocument) {
    const isReceipt = input.documentType === 'RECEIPT';
    throw new ConflictException({
      code: isReceipt ? 'accounting_receipt_already_exists' : 'accounting_tax_invoice_already_exists',
      message: isReceipt
        ? 'Invoice already has an active receipt.'
        : 'Source document already has an active tax invoice.',
    });
  }
  return sourceFacts;
}

async function auditSalesDocumentRootDenial(
  audit: AuditService,
  ctx: RequestContext,
  action: string,
): Promise<void> {
  const targetType = action.startsWith('accounting.counterparty.')
    ? 'accounting_counterparty'
    : action === 'crm.quotation.link'
      ? 'crm_quotation_link'
      : 'accounting_document';
  await audit.log({
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action,
    targetType,
    requestId: ctx.requestId,
    result: 'DENIED',
    riskLevel: 'LOW',
    metadataJson: { reason: 'launch_route_closed' },
  });
}

/** Translate only the expected control-plane refusal; infrastructure failures stay visible. */
export async function rethrowSalesDocumentRootError(
  error: unknown,
  audit: AuditService,
  ctx: RequestContext,
  action: string,
): Promise<never> {
  if (!isSalesDocumentLaunchClosedError(error)) throw error;
  await auditSalesDocumentRootDenial(audit, ctx, action);
  throw new ForbiddenException({
    code: FEATURE_TEMPORARILY_UNAVAILABLE,
    message: SALES_DOCUMENT_LAUNCH_ROUTE_CLOSED_MESSAGE,
  });
}

@Injectable()
export class GetSalesDocumentRootAvailabilityUseCase {
  constructor(private readonly launchGate: LaunchGateGuardService) {}

  async execute(): Promise<SalesDocumentRootAvailability> {
    return {
      canCreateSalesRoot: await isLaunchRouteOpen(this.launchGate, 'sales_documents', 'DEFAULT'),
    };
  }
}

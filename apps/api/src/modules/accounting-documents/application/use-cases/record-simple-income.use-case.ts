import { createHash } from 'node:crypto';
import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { AccountingDocumentType, RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { validateAccountingDocumentMoneyInput } from '../../domain/logic/accounting-money-validation.logic';
import type { RecordSimpleIncomeInput, RecordSimpleIncomeResult } from '../../domain/models/accounting.model';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';

type SimpleIncomeRequest = Omit<RecordSimpleIncomeInput, 'companyId' | 'createdByUserId' | 'payloadFingerprint'>;

function hasDocumentPermission(ctx: RequestContext, type: AccountingDocumentType, action: 'create' | 'issue'): boolean {
  return ctx.permissions.includes(`accounting.document.${action}`)
    || ctx.permissions.includes(`accounting.${type.toLowerCase()}.${action}`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function simpleIncomePayloadFingerprint(input: SimpleIncomeRequest): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

@Injectable()
export class RecordSimpleIncomeUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async execute(ctx: RequestContext, input: SimpleIncomeRequest): Promise<RecordSimpleIncomeResult> {
    const missing = [
      !hasDocumentPermission(ctx, 'INVOICE', 'create') && 'accounting.invoice.create',
      !hasDocumentPermission(ctx, 'INVOICE', 'issue') && 'accounting.invoice.issue',
      !ctx.permissions.includes('accounting.payment.create') && 'accounting.payment.create',
      !hasDocumentPermission(ctx, 'RECEIPT', 'issue') && 'accounting.receipt.issue',
    ].filter((permission): permission is string => Boolean(permission));
    if (missing.length) throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
    if (!isBranchInScope(ctx.scopes, input.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    if (input.lines.length < 1) throw new UnprocessableEntityException('At least one income line is required');
    if (new Set(input.lines.map((line) => line.lineNumber)).size !== input.lines.length) {
      throw new UnprocessableEntityException('Income line numbers must be unique');
    }
    if (input.lines.some((line) => line.taxCodeDefinitionId || line.externalTaxCode)) {
      throw new UnprocessableEntityException('Simple income creates a plain invoice; Tax Code lines require the tax-invoice flow');
    }
    const vatStatus = (await this.vatRegistration.get(ctx.companyId, input.documentDate)).status;
    if (vatStatus === 'NOT_REGISTERED' && input.vatMode !== 'NO_VAT') {
      throw new UnprocessableEntityException('A company that is not VAT registered must record simple income without VAT');
    }
    const moneyError = validateAccountingDocumentMoneyInput({
      documentType: 'INVOICE', documentDate: input.documentDate, vatMode: input.vatMode,
      branchId: input.branchId, counterpartyId: input.counterpartyId, note: input.note,
      currency: 'THB', lines: input.lines,
    });
    if (moneyError) throw new UnprocessableEntityException(moneyError);

    const payloadFingerprint = simpleIncomePayloadFingerprint(input);
    const result = await this.repo.recordSimpleIncomeBundle(
      { ...input, companyId: ctx.companyId, createdByUserId: ctx.userId, payloadFingerprint },
      async (db, created) => this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'accounting.simple_income.record', targetType: 'accounting_document', targetId: created.invoice.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          invoiceId: created.invoice.id, paymentId: created.payment.id, receiptId: created.receipt.id,
          amount: created.invoice.grandTotalAmount, method: input.paymentMethod,
        },
      }, db),
    );
    if (result.replayed) return result;

    const occurredAt = result.invoice.issuedAt?.toISOString() ?? new Date().toISOString();
    await Promise.all([
      this.outbox.append('accounting.invoice.issued', 'accounting_document', result.invoice.id, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'accounting_document', aggregateId: result.invoice.id, occurredAt,
        data: { documentId: result.invoice.id, documentNumber: result.invoice.documentNumber, documentType: 'INVOICE', grandTotalAmount: result.invoice.grandTotalAmount },
      }),
      this.outbox.append('accounting.payment.recorded', 'accounting_payment', result.payment.id, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'accounting_payment', aggregateId: result.payment.id, occurredAt,
        data: { paymentId: result.payment.id, amount: result.payment.amount, whtAmount: result.payment.whtAmount, method: result.payment.method, direction: 'RECEIVED' },
      }),
      this.outbox.append('accounting.receipt.issued', 'accounting_document', result.receipt.id, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'accounting_document', aggregateId: result.receipt.id, occurredAt,
        data: { documentId: result.receipt.id, documentNumber: result.receipt.documentNumber, documentType: 'RECEIPT', sourceDocumentId: result.invoice.id },
      }),
    ]);
    return result;
  }
}

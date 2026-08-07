import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { SupplierRecord, SupplierBankAccountRecord } from '../../domain/models/procurement.model';
import type { CreateSupplierDto, UpdateSupplierDto, CreateSupplierBankAccountDto, ListSuppliersFilter, PaginatedProcurementResult, SupplierSummary, SupplierDetail } from '@watchdog-bms/contracts';
import { SUPPLIER_TYPES, SUPPLIER_STATUSES, PROCUREMENT_VAT_MODES, INPUT_VAT_CLAIM_STATUSES } from '@watchdog-bms/contracts';

// These four fields are Prisma enum columns. The procurement controllers take
// `@Body() body: any`, so an unknown value used to travel all the way to the
// insert and surface as a 500; check them here and answer 400 instead.
function assertSupplierEnums(dto: { supplierType?: string; status?: string; defaultVatMode?: string; defaultInputVatClaimStatus?: string }): void {
  const checks: Array<[string, string | undefined, readonly string[]]> = [
    ['supplierType', dto.supplierType, SUPPLIER_TYPES],
    ['status', dto.status, SUPPLIER_STATUSES],
    ['defaultVatMode', dto.defaultVatMode, PROCUREMENT_VAT_MODES],
    ['defaultInputVatClaimStatus', dto.defaultInputVatClaimStatus, INPUT_VAT_CLAIM_STATUSES],
  ];
  for (const [field, value, allowed] of checks) {
    if (value !== undefined && !allowed.includes(value)) {
      throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
    }
  }
}

function toSummary(r: SupplierRecord): SupplierSummary {
  return { id: r.id, companyId: r.companyId, counterpartyId: r.counterpartyId, supplierCode: r.supplierCode, supplierType: r.supplierType, displayNameSnapshot: r.displayNameSnapshot, taxId: r.taxId, branchCode: r.branchCode, status: r.status, defaultCurrency: r.defaultCurrency, email: r.email, phone: r.phone, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

function toDetail(r: SupplierRecord): SupplierDetail {
  return { ...toSummary(r), legalNameSnapshot: r.legalNameSnapshot, vatRegistered: r.vatRegistered, defaultVatMode: r.defaultVatMode, defaultInputVatClaimStatus: r.defaultInputVatClaimStatus, defaultWhtCategoryCode: r.defaultWhtCategoryCode, defaultPaymentTermsDays: r.defaultPaymentTermsDays, defaultExpenseCategoryKey: r.defaultExpenseCategoryKey, defaultAccountHint: r.defaultAccountHint, contactName: r.contactName, addressJson: r.addressJson, onHoldReason: r.onHoldReason };
}

@Injectable()
export class CreateSupplierUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, dto: CreateSupplierDto): Promise<SupplierDetail> {
    if (!ctx.permissions.includes('procurement.supplier.manage')) throw new ForbiddenException();
    if (!dto?.displayName?.trim()) throw new BadRequestException('displayName is required');
    assertSupplierEnums(dto);

    const supplier = await this.repo.createSupplierWithCounterparty(
      ctx.companyId,
      { displayName: dto.displayName, legalName: dto.legalName, taxId: dto.taxId, branchCode: dto.branchCode, email: dto.email, phone: dto.phone, addressJson: dto.addressJson, supplierCode: dto.supplierCode, supplierType: dto.supplierType, vatRegistered: dto.vatRegistered, defaultVatMode: dto.defaultVatMode, defaultInputVatClaimStatus: dto.defaultInputVatClaimStatus, defaultWhtCategoryCode: dto.defaultWhtCategoryCode, defaultPaymentTermsDays: dto.defaultPaymentTermsDays, defaultExpenseCategoryKey: dto.defaultExpenseCategoryKey, defaultAccountHint: dto.defaultAccountHint, defaultCurrency: dto.defaultCurrency, contactName: dto.contactName },
      ctx.userId,
    );

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.supplier.create', targetType: 'supplier', targetId: supplier.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { supplierCode: supplier.supplierCode, taxId: supplier.taxId } });
    void this.outbox.append('supplier.created', 'supplier', supplier.id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'supplier', aggregateId: supplier.id, occurredAt: supplier.createdAt.toISOString(), data: { displayName: supplier.displayNameSnapshot, status: supplier.status } });

    return toDetail(supplier);
  }
}

@Injectable()
export class UpdateSupplierUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, supplierId: string, dto: UpdateSupplierDto): Promise<SupplierDetail> {
    if (!ctx.permissions.includes('procurement.supplier.manage')) throw new ForbiddenException();
    assertSupplierEnums(dto);
    const supplier = await this.repo.updateSupplier(ctx.companyId, supplierId, { supplierCode: dto.supplierCode, supplierType: dto.supplierType, displayName: dto.displayName, legalName: dto.legalName, taxId: dto.taxId, branchCode: dto.branchCode, vatRegistered: dto.vatRegistered, defaultVatMode: dto.defaultVatMode, defaultInputVatClaimStatus: dto.defaultInputVatClaimStatus, defaultWhtCategoryCode: dto.defaultWhtCategoryCode, defaultPaymentTermsDays: dto.defaultPaymentTermsDays, defaultExpenseCategoryKey: dto.defaultExpenseCategoryKey, defaultAccountHint: dto.defaultAccountHint, defaultCurrency: dto.defaultCurrency, contactName: dto.contactName, email: dto.email, phone: dto.phone, addressJson: dto.addressJson, status: dto.status, onHoldReason: dto.onHoldReason }, ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.supplier.update', targetType: 'supplier', targetId: supplierId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('supplier.updated', 'supplier', supplier.id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'supplier', aggregateId: supplier.id, occurredAt: new Date().toISOString(), data: { status: supplier.status } });
    return toDetail(supplier);
  }
}

@Injectable()
export class GetSupplierUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, supplierId: string): Promise<SupplierDetail> {
    if (!ctx.permissions.includes('procurement.supplier.read')) throw new ForbiddenException();
    const supplier = await this.repo.findSupplierById(ctx.companyId, supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');
    return toDetail(supplier);
  }
}

@Injectable()
export class ListSuppliersUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, filter: ListSuppliersFilter): Promise<PaginatedProcurementResult<SupplierSummary>> {
    if (!ctx.permissions.includes('procurement.supplier.read')) throw new ForbiddenException();
    const { data, total } = await this.repo.listSuppliers(ctx.companyId, filter);
    return { data: data.map(toSummary), total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 20 };
  }
}

@Injectable()
export class ListSupplierBankAccountsUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, supplierId: string): Promise<SupplierBankAccountRecord[]> {
    if (!ctx.permissions.includes('procurement.supplier.bank.read')) throw new ForbiddenException();
    const supplier = await this.repo.findSupplierById(ctx.companyId, supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.supplier.bank.read', targetType: 'supplierBankAccount', targetId: supplierId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH' });
    return this.repo.listSupplierBankAccounts(ctx.companyId, supplierId);
  }
}

@Injectable()
export class CreateSupplierBankAccountUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, supplierId: string, dto: CreateSupplierBankAccountDto): Promise<SupplierBankAccountRecord> {
    if (!ctx.permissions.includes('procurement.supplier.bank.manage')) throw new ForbiddenException();
    const record = await this.repo.createSupplierBankAccount(ctx.companyId, supplierId, { bankName: dto.bankName, bankCode: dto.bankCode, accountName: dto.accountName, accountNumberLast4: dto.accountNumberLast4, branchName: dto.branchName, isDefault: dto.isDefault }, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.supplier.bank.create', targetType: 'supplierBankAccount', targetId: record.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { supplierId, bankName: dto.bankName, last4: dto.accountNumberLast4 } });
    return record;
  }
}

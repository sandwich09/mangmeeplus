import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext } from '@watchdog-bms/contracts';
import type {
  CreateCounterpartyInput,
  UpdateCounterpartyInput,
  CounterpartyRecord,
  CounterpartyUsage,
  CounterpartyListItem,
  ListCounterpartiesFilter,
} from '../../domain/models/accounting.model';
import {
  buildCounterpartyAddressV2,
  counterpartyAddressText,
  normalizeBranchCode,
  normalizeThaiAddress,
} from '../../domain/logic/vendor-counterparty-match.logic';

/** §6/§8: the same ceiling the expense column has, refused with a way forward, never truncated. */
const COUNTERPARTY_ADDRESS_MAX_LENGTH = 500;

/** The address fields the counterparty screen edits; `type` is deliberately absent (A5). */
export type CounterpartyAddressInput = {
  addressText?: string | null;
  postalCode?: string | null;
  /** A4: only a manager or this row's creator/uploader reaches this from the counterparty screen. */
  locked?: boolean;
};

const COUNTERPARTY_EDIT_GRANT = 'accounting.counterparty.manage';
const COUNTERPARTY_READ_GRANT = 'accounting.counterparty.read';

function canReadCounterpartyRegistry(ctx: RequestContext): boolean {
  return ctx.permissions.includes(COUNTERPARTY_READ_GRANT) || ctx.permissions.includes(COUNTERPARTY_EDIT_GRANT);
}

async function isCounterpartyOriginator(
  repo: PrismaAccountingRepository,
  ctx: RequestContext,
  counterparty: CounterpartyRecord,
): Promise<boolean> {
  return counterparty.createdByUserId === ctx.userId
    || await repo.isCounterpartyReceiptUploader(ctx.companyId, counterparty.id, ctx.userId);
}

async function assertCanEditCounterparty(
  repo: PrismaAccountingRepository,
  ctx: RequestContext,
  counterparty: CounterpartyRecord,
): Promise<void> {
  if (ctx.permissions.includes(COUNTERPARTY_EDIT_GRANT) || await isCounterpartyOriginator(repo, ctx, counterparty)) return;
  if (!canReadCounterpartyRegistry(ctx)) throw new NotFoundException(`Counterparty ${counterparty.id} not found`);
  throw new ForbiddenException('Missing permission: accounting.counterparty.manage');
}

type ManualCounterpartyInput = Omit<CreateCounterpartyInput, 'companyId' | 'createdByUserId' | 'type' | 'receiptUploaderUserId'> & CounterpartyAddressInput;
type CounterpartyDetailResult = Omit<CounterpartyRecord, 'createdByUserId'>
  & { createdByUserId?: string; canEdit: boolean }
  & Partial<CounterpartyUsage>;

/**
 * Turns the screen's two address fields into the stored v2 shape, keeping whatever a prior write
 * (an expense auto-save, an RD lookup) left behind: history, structured data, the lock.
 */
function manualAddressJson(
  input: CounterpartyAddressInput,
  previous: Record<string, unknown> | undefined,
  ctx: RequestContext,
): Record<string, unknown> | undefined {
  const touchesAddress = input.addressText !== undefined || input.postalCode !== undefined || input.locked !== undefined;
  if (!touchesAddress) return undefined;

  const addressText = input.addressText !== undefined
    ? (input.addressText ?? '').trim()
    : counterpartyAddressText(previous ?? null) ?? '';
  if (addressText.length > COUNTERPARTY_ADDRESS_MAX_LENGTH) {
    throw new BadRequestException({
      code: 'counterparty_address_too_long',
      message: `ที่อยู่ยาวเกิน ${COUNTERPARTY_ADDRESS_MAX_LENGTH} ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง`,
    });
  }

  const built = buildCounterpartyAddressV2({
    addressText,
    postalCode: input.postalCode !== undefined ? input.postalCode : (previous?.postalCode as string | null | undefined) ?? null,
    source: 'MANUAL',
    userId: ctx.userId,
    at: new Date().toISOString(),
    previous,
  }) as Record<string, unknown>;
  // `locked` is carried forward by the builder; an explicit value from the screen overrides it, and
  // `false` removes the key rather than storing a falsy one.
  if (input.locked === true) built.locked = true;
  else if (input.locked === false) delete built.locked;
  return built;
}

function assertBranchCode(branchCode: string | null | undefined): string | null | undefined {
  if (branchCode === undefined) return undefined;
  if (!String(branchCode ?? '').trim()) return null;
  const normalized = normalizeBranchCode(branchCode);
  if (!normalized) {
    throw new BadRequestException({
      code: 'counterparty_branch_code_invalid',
      message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000 สำหรับสำนักงานใหญ่ หรือเว้นว่างไว้ก็ได้',
    });
  }
  return normalized;
}

@Injectable()
export class CreateCounterpartyUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: ManualCounterpartyInput): Promise<CounterpartyRecord> {
    if (!ctx.permissions.includes('accounting.counterparty.manage')) throw new ForbiddenException('Missing permission: accounting.counterparty.manage');

    // This is a permissioned registry edit, not a new sales document root; feature entitlements
    // already filter the manage permission before the request reaches this use case.
    const { addressText, postalCode, locked, branchCode, ...rest } = input;
    const billingAddressJson = manualAddressJson({ addressText, postalCode, locked }, undefined, ctx);

    const result = await this.repo.createCounterparty({
      ...rest,
      ...(branchCode !== undefined ? { branchCode: assertBranchCode(branchCode) ?? undefined } : {}),
      ...(billingAddressJson ? { billingAddressJson } : {}),
      // A5: `type` is server-owned and there is no picker. A row added by hand has no usage
      // history to infer from, so it is BOTH — the only value that cannot silently hide it,
      // since `type` is read in exactly one place and that reader drops VENDOR (CON-1).
      type: 'BOTH',
      companyId: ctx.companyId,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.counterparty.create', targetType: 'accounting_counterparty', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });

    return result;
  }
}

@Injectable()
export class UpdateCounterpartyUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext,
    counterpartyId: string,
    input: Omit<UpdateCounterpartyInput, 'companyId' | 'counterpartyId' | 'updatedByUserId' | 'expectedUpdatedAt'>
      & CounterpartyAddressInput & { expectedUpdatedAt?: string },
  ): Promise<CounterpartyRecord> {
    const existing = await this.repo.findCounterpartyById(ctx.companyId, counterpartyId);
    if (!existing) throw new NotFoundException(`Counterparty ${counterpartyId} not found`);
    await assertCanEditCounterparty(this.repo, ctx, existing);

    const { addressText, postalCode, locked, branchCode, expectedUpdatedAt, ...rest } = input;
    const billingAddressJson = manualAddressJson({ addressText, postalCode, locked }, existing.billingAddressJson, ctx);

    const result = await this.repo.updateCounterparty({
      ...rest,
      ...(branchCode !== undefined ? { branchCode: assertBranchCode(branchCode) ?? undefined } : {}),
      ...(billingAddressJson ? { billingAddressJson } : {}),
      ...(expectedUpdatedAt ? { expectedUpdatedAt: new Date(expectedUpdatedAt) } : {}),
      companyId: ctx.companyId,
      counterpartyId,
      updatedByUserId: ctx.userId,
    });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.counterparty.update', targetType: 'accounting_counterparty', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });

    return result;
  }
}

/**
 * §7/§11.1: the only place a person chooses a primary address by hand. The review page has no such
 * control on purpose — the owner's round-1 feedback was that deciding there confused people — so
 * this endpoint is the counterparty screen's; company-wide managers and this row's creator/uploader
 * can use it even though the automatic writes do not need `accounting.counterparty.manage` (A3).
 */
@Injectable()
export class PromoteSeenAddressUseCase {
  constructor(private readonly repo: PrismaAccountingRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, counterpartyId: string, addressText: string, expectedUpdatedAt?: string): Promise<CounterpartyRecord> {
    const existing = await this.repo.findCounterpartyById(ctx.companyId, counterpartyId);
    if (!existing) throw new NotFoundException(`Counterparty ${counterpartyId} not found`);
    await assertCanEditCounterparty(this.repo, ctx, existing);

    const wanted = normalizeThaiAddress(addressText);
    const history = (existing.billingAddressJson?.seenOnDocuments ?? []) as Array<{ addressText: string }>;
    const entry = Array.isArray(history) ? history.find((row) => normalizeThaiAddress(row?.addressText) === wanted) : undefined;
    // The list the button was rendered from may be stale. Refusing beats promoting an address the
    // registry no longer remembers.
    if (!entry) throw new NotFoundException('Address is no longer in this counterparty history; reload the page.');

    const current = counterpartyAddressText(existing.billingAddressJson ?? null);
    const at = new Date().toISOString();
    const changed = await this.repo.saveCounterpartyVendorFields({
      companyId: ctx.companyId,
      counterpartyId,
      billingAddressJson: buildCounterpartyAddressV2({
        addressText: entry.addressText,
        source: 'MANUAL',
        userId: ctx.userId,
        at,
        previous: existing.billingAddressJson,
        // The address being displaced takes the promoted one's place in the history, so the swap is
        // reversible from the same card. It keeps the expense it came from, when it had one.
        ...(current
          ? { appendToHistory: { addressText: current, expenseId: String((existing.billingAddressJson?.provenance as { expenseId?: string } | undefined)?.expenseId ?? ''), at } }
          : {}),
      }),
      updatedByUserId: ctx.userId,
      // §11.1/§15: this was a blind read-modify-write. It now compares-and-sets like the PATCH path —
      // the client's token when the screen sent one, otherwise the row this call just read above.
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : existing.updatedAt,
    });
    if (!changed) {
      throw new ConflictException({ code: 'counterparty_conflict', message: 'Counterparty changed; reload before saving.' });
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'accounting.counterparty.update',
      targetType: 'accounting_counterparty', targetId: counterpartyId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      // CON-10: the source and the fact it changed, never the address itself.
      metadataJson: { source: 'promote_seen_address', addressChanged: true },
    });

    const updated = await this.repo.findCounterpartyById(ctx.companyId, counterpartyId);
    return updated!;
  }
}

@Injectable()
export class GetCounterpartyUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, counterpartyId: string): Promise<CounterpartyDetailResult> {
    const result = await this.repo.findCounterpartyById(ctx.companyId, counterpartyId);
    if (!result) throw new NotFoundException(`Counterparty ${counterpartyId} not found`);
    const canRead = canReadCounterpartyRegistry(ctx);
    const isOriginator = result.createdByUserId === ctx.userId
      || (!ctx.permissions.includes(COUNTERPARTY_EDIT_GRANT)
        && await this.repo.isCounterpartyReceiptUploader(ctx.companyId, result.id, ctx.userId));
    if (!canRead && !isOriginator) throw new NotFoundException(`Counterparty ${counterpartyId} not found`);

    const canEdit = ctx.permissions.includes(COUNTERPARTY_EDIT_GRANT) || isOriginator;
    if (canRead) return { ...result, canEdit, ...(await this.repo.counterpartyUsage(ctx.companyId, counterpartyId)) };

    // A creator/uploader can maintain their record without gaining access to its purchase history.
    const { createdByUserId: _createdByUserId, ...record } = result;
    return { ...record, canEdit };
  }
}

@Injectable()
export class ListCounterpartiesUseCase {
  constructor(private readonly repo: PrismaAccountingRepository) {}

  async execute(ctx: RequestContext, page = 1, pageSize = 20, filter: ListCounterpartiesFilter = {}): Promise<{ data: CounterpartyListItem[]; total: number }> {
    if (!ctx.permissions.includes('accounting.counterparty.read')) throw new ForbiddenException('Missing permission: accounting.counterparty.read');
    return this.repo.listCounterparties(ctx.companyId, page, pageSize, filter);
  }
}

import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateCrmBookingInput,
  UpdateCrmBookingInput,
  ListCrmBookingsFilter,
  CrmBookingSummary,
  CrmBookingAvailabilityQuery,
  CrmBookingAvailabilityResult,
  CrmBookingSettings,
  UpdateCrmBookingSettingsInput,
  CrmStaffBookingSource,
} from '@watchdog-bms/contracts';
import { CRM_BOOKING_BUFFER_MINUTE_OPTIONS } from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { toBookingSummary } from '../dto/crm.mapper';
import { assertCanManageOwned, assertCanReadOwned, ownerScopeForList, requirePermission } from '../crm-access';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import {
  validateBookingWindow,
  bookingWeekRange,
  bookingDayRange,
  computeFreeStartSlots,
  isValidBookingDuration,
} from '../../domain/logic/crm-booking.logic';

const VALIDATION_MESSAGE: Record<string, string> = {
  end_before_start: 'end_before_start',
  duration_out_of_range: 'duration_must_be_1_to_3_hours',
  duration_not_aligned: 'duration_must_be_30_minute_increments',
  start_in_past: 'start_in_past',
  outside_business_hours: 'outside_business_hours_09_00_20_00',
};

const SYSTEM_ACTOR = 'system';
const STAFF_BOOKING_SOURCES = new Set<CrmStaffBookingSource>(['STAFF', 'WEB', 'PHONE', 'FACEBOOK', 'WALK_IN', 'OTHER']);

/** Optional บาท amount from the create form → normalized 2-decimal string, or undefined when blank. */
function parseBookingAmount(value: string | undefined, error: string): string | undefined {
  if (value == null || value === '') return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException(error);
  return amount.toFixed(2);
}

async function requireBookableCustomer(repo: PrismaCrmRepository, companyId: string, customerId?: string) {
  if (!customerId) throw new BadRequestException('customerId_required');
  const customer = await repo.findCustomerById(companyId, customerId);
  if (!customer) throw new NotFoundException('Customer not found');
  if (customer.status !== 'ACTIVE') throw new BadRequestException('customer_not_active');
  return customer;
}

async function requireScopedActiveBranch(repo: PrismaCrmRepository, ctx: RequestContext, branchId: string): Promise<void> {
  if (!isBranchInScope(ctx.scopes, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope');
  if (!(await repo.hasActiveBranch(ctx.companyId, branchId))) throw new BadRequestException('branch_not_active_in_company');
}

async function requireScopedBookableCustomer(
  repo: PrismaCrmRepository,
  ctx: RequestContext,
  customerId: string | undefined,
  mutation: boolean,
) {
  const customer = await requireBookableCustomer(repo, ctx.companyId, customerId);
  if (!isBranchInScope(ctx.scopes, customer.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope');
  if (mutation) assertCanManageOwned(ctx, customer.ownerUserId);
  else assertCanReadOwned(ctx, customer.ownerUserId);
  return customer;
}

@Injectable()
export class GetCrmBookingSettingsUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext): Promise<CrmBookingSettings> {
    requirePermission(ctx, 'crm.booking.read');
    return { bufferMinutes: await this.repo.getBookingBufferMinutes(ctx.companyId) as CrmBookingSettings['bufferMinutes'] };
  }
}

@Injectable()
export class UpdateCrmBookingSettingsUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, input: UpdateCrmBookingSettingsInput): Promise<CrmBookingSettings> {
    requirePermission(ctx, 'crm.booking.update');
    if (!CRM_BOOKING_BUFFER_MINUTE_OPTIONS.includes(input.bufferMinutes)) throw new BadRequestException('invalid_booking_buffer_minutes');
    const before = await this.repo.getBookingBufferMinutes(ctx.companyId);
    const bufferMinutes = await this.repo.updateBookingBufferMinutes(ctx.companyId, input.bufferMinutes);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.booking.settings.update',
      targetType: 'company', targetId: ctx.companyId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { beforeBufferMinutes: before, afterBufferMinutes: bufferMinutes },
    });
    return { bufferMinutes: bufferMinutes as CrmBookingSettings['bufferMinutes'] };
  }
}

@Injectable()
export class ListCrmCustomerBookingsUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, customerId: string): Promise<{ items: CrmBookingSummary[] }> {
    requirePermission(ctx, 'crm.booking.read');
    await requireScopedBookableCustomer(this.repo, ctx, customerId, false);
    const rows = await this.repo.listBookingsForCustomer(ctx.companyId, customerId, 50, ctx.scopes.branchIds);
    return { items: rows.map(toBookingSummary) };
  }
}

export class GetCrmBookingAvailabilityUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}

  async execute(ctx: RequestContext, companyId: string, input: CrmBookingAvailabilityQuery): Promise<CrmBookingAvailabilityResult> {
    requirePermission(ctx, 'crm.booking.read');
    if (ctx.companyId !== companyId) throw new ForbiddenException('Company mismatch');
    if (!input.branchId) throw new BadRequestException('branchId_required');
    if (!input.staffUserId) throw new BadRequestException('staffUserId_required');
    if (!input.date) throw new BadRequestException('date_required');
    await requireScopedActiveBranch(this.repo, ctx, input.branchId);
    if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, input.staffUserId))) throw new BadRequestException('staff_not_company_member');
    const durationMinutes = Number(input.durationMinutes);
    if (!isValidBookingDuration(durationMinutes)) throw new BadRequestException('duration_must_be_1_to_3_hours_in_30_minute_increments');
    const day = bookingDayRange(input.date);
    if (!day) throw new BadRequestException('date_must_be_yyyy_mm_dd');

    const existingBookings = await this.repo.listBookingsForStaffOnDate({
      companyId: ctx.companyId,
      branchId: input.branchId,
      staffUserId: input.staffUserId,
      rangeStart: day.rangeStart,
      rangeEnd: day.rangeEnd,
    });
    const bufferMinutes = await this.repo.getBookingBufferMinutes(ctx.companyId);
    return {
      date: input.date,
      durationMinutes,
      bufferMinutes,
      freeStartTimes: computeFreeStartSlots({ date: input.date, durationMinutes, existingBookings, now: new Date(), bufferMinutes }),
    };
  }
}

@Injectable()
export class ListCrmBookingsUseCase {
  private readonly getAvailability: GetCrmBookingAvailabilityUseCase;

  constructor(private readonly repo: PrismaCrmRepository) {
    this.getAvailability = new GetCrmBookingAvailabilityUseCase(repo);
  }

  async execute(ctx: RequestContext, filter: ListCrmBookingsFilter): Promise<{ items: CrmBookingSummary[]; weekStart: string; weekEnd: string }> {
    requirePermission(ctx, 'crm.booking.read');
    if (filter.branchId) await requireScopedActiveBranch(this.repo, ctx, filter.branchId);
    const { rangeStart, rangeEnd } = bookingWeekRange(filter.weekStart);
    const rows = await this.repo.listBookings({
      companyId: ctx.companyId,
      branchId: filter.branchId,
      ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
      customerOwnerUserId: ownerScopeForList(ctx),
      rangeStart,
      rangeEnd,
    });
    return { items: rows.map(toBookingSummary), weekStart: rangeStart.toISOString(), weekEnd: rangeEnd.toISOString() };
  }

  async availability(ctx: RequestContext, companyId: string, input: CrmBookingAvailabilityQuery): Promise<CrmBookingAvailabilityResult> {
    return this.getAvailability.execute(ctx, companyId, input);
  }
}

@Injectable()
export class CreateCrmBookingUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, input: CreateCrmBookingInput): Promise<CrmBookingSummary> {
    requirePermission(ctx, 'crm.booking.create');
    if (!input.branchId) throw new BadRequestException('branchId_required');
    await requireScopedActiveBranch(this.repo, ctx, input.branchId);
    if (!input.serviceName || input.serviceName.trim() === '') throw new BadRequestException('serviceName_required');
    const source = input.source ?? 'STAFF';
    if (!STAFF_BOOKING_SOURCES.has(source)) throw new BadRequestException('invalid_staff_booking_source');
    const customer = await requireScopedBookableCustomer(this.repo, ctx, input.customerId, true);

    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    const error = validateBookingWindow(startAt, endAt, new Date());
    if (error) throw new BadRequestException(VALIDATION_MESSAGE[error]);

    // staffUserId is a User id (see CreateCrmBookingInput contract); rejects
    // EmployeeAccessProfile ids and users outside the company.
    if (input.staffUserId && !(await this.repo.hasActiveCompanyMember(ctx.companyId, input.staffUserId))) {
      throw new BadRequestException('staff_not_company_member');
    }

    const depositAmount = parseBookingAmount(input.depositAmount, 'invalid_deposit_amount');
    const totalAmount = parseBookingAmount(input.totalAmount, 'invalid_total_amount');
    if (depositAmount != null && totalAmount != null && Number(depositAmount) > Number(totalAmount)) {
      throw new BadRequestException('deposit_exceeds_total');
    }

    let created;
    try {
      created = await this.repo.createBookingIfSlotFree({
        companyId: ctx.companyId,
        branchId: input.branchId,
        customerId: customer.id,
        customerName: customer.displayName,
        serviceName: input.serviceName.trim(),
        staffUserId: input.staffUserId,
        startAt,
        endAt,
        source,
        depositAmount,
        totalAmount,
        createdByUserId: ctx.userId,
      });
    } catch (error) {
      throwBookingMutationError(error);
    }
    if (!created) throw new ConflictException('staff_already_booked_in_this_window');

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.booking.create',
      targetType: 'crm_booking', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { branchId: input.branchId, customerId: customer.id, source, startAt: created.startAt.toISOString() },
    });
    return toBookingSummary(created);
  }
}

/**
 * CUST-02: optional hooks the caller couples to the booking write — both run
 * INSIDE the booking $transaction (a throw rolls the booking back).
 */
export type AutonomousBookingTxHooks = {
  expectedCustomerContact?: { displayName: string; primaryPhone: string };
  assertWithinTx?: (tx: any) => Promise<void>;
  finalizeWithinTx?: (tx: any, bookingRow: any) => Promise<void>;
};

@Injectable()
export class CreateAutonomousCrmBookingUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}

  async execute(companyId: string, input: {
    branchId: string;
    customerId: string;
    serviceName: string;
    staffUserId: string;
    startAt: Date;
    endAt: Date;
    sourceConversationId?: string;
  }, hooks?: AutonomousBookingTxHooks): Promise<CrmBookingSummary> {
    const error = validateBookingWindow(input.startAt, input.endAt, new Date());
    if (error) throw new BadRequestException(VALIDATION_MESSAGE[error]);
    const customer = await requireBookableCustomer(this.repo, companyId, input.customerId);

    let created;
    try {
      created = await this.repo.createBookingIfSlotFree({
        companyId,
        ...input,
        serviceName: input.serviceName.trim(),
        customerId: customer.id,
        customerName: customer.displayName,
        source: 'LINE',
        createdByUserId: SYSTEM_ACTOR,
      }, {
        rejectRevokedConsent: true,
        requireCustomerContact: true,
        expectedCustomerContact: hooks?.expectedCustomerContact,
        assertWithinTx: hooks?.assertWithinTx,
        finalizeWithinTx: hooks?.finalizeWithinTx,
      });
    } catch (error) {
      if ((error as Error).message === 'customer_consent_revoked') throw new UnprocessableEntityException('customer_consent_revoked');
      if (['branch_not_active_in_company', 'staff_not_company_member', 'staff_branch_not_accessible', 'booking_contact_required', 'booking_review_changed'].includes((error as Error).message)) {
        throw new BadRequestException((error as Error).message);
      }
      throw error;
    }
    if (!created) throw new ConflictException('staff_already_booked_in_this_window');
    return toBookingSummary(created);
  }
}

@Injectable()
export class UpdateCrmBookingUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: UpdateCrmBookingInput): Promise<CrmBookingSummary> {
    requirePermission(ctx, 'crm.booking.update');
    const existing = await this.repo.findBookingById(ctx.companyId, id);
    if (!existing) throw new NotFoundException('Booking not found');
    if (!isBranchInScope(ctx.scopes, existing.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope');
    await requireScopedBookableCustomer(this.repo, ctx, existing.customerId, true);
    if (existing.status !== 'BOOKED') throw new BadRequestException('booking_not_editable');
    if (input.status !== undefined && !['DONE', 'NO_SHOW', 'CANCELLED'].includes(input.status)) {
      throw new BadRequestException('invalid_booking_status_transition');
    }
    if (input.status === 'CANCELLED') requirePermission(ctx, 'crm.booking.cancel');

    const startAt = input.startAt ? new Date(input.startAt) : existing.startAt;
    const endAt = input.endAt ? new Date(input.endAt) : existing.endAt;
    if (input.startAt || input.endAt) {
      const error = validateBookingWindow(startAt, endAt, new Date());
      if (error) throw new BadRequestException(VALIDATION_MESSAGE[error]);
    }

    const staffUserId = input.staffUserId !== undefined ? input.staffUserId : existing.staffUserId;
    if (input.staffUserId && !(await this.repo.hasActiveCompanyMember(ctx.companyId, input.staffUserId))) {
      throw new BadRequestException('staff_not_company_member');
    }
    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.customerId !== undefined) {
      const customer = await requireScopedBookableCustomer(this.repo, ctx, input.customerId, true);
      data.customerId = customer.id;
      data.customerName = customer.displayName;
    }
    if (input.serviceName !== undefined) data.serviceName = input.serviceName.trim();
    if (input.staffUserId !== undefined) data.staffUserId = input.staffUserId;
    if (input.startAt !== undefined) data.startAt = startAt;
    if (input.endAt !== undefined) data.endAt = endAt;
    if (input.status !== undefined) data.status = input.status;

    const rescheduling = Boolean(input.startAt || input.endAt || input.staffUserId !== undefined);
    const targetCustomerId = input.customerId ?? existing.customerId;
    let updated;
    try {
      updated = rescheduling
        ? await this.repo.updateBookingIfSlotFree({
            companyId: ctx.companyId,
            id,
            staffUserId: staffUserId ?? null,
            startAt,
            endAt,
            data,
            expectedCustomerId: existing.customerId,
            targetCustomerId,
          })
        : await this.repo.updateBooking(ctx.companyId, id, data, {
            expectedCustomerId: existing.customerId,
            targetCustomerId,
          });
    } catch (error) {
      throwBookingMutationError(error);
    }
    if (!updated) throw new ConflictException('staff_already_booked_in_this_window');
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.booking.update',
      targetType: 'crm_booking', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { beforeStatus: existing.status, afterStatus: updated.status },
    });
    return toBookingSummary(updated);
  }
}

@Injectable()
export class CancelCrmBookingUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string): Promise<CrmBookingSummary> {
    requirePermission(ctx, 'crm.booking.cancel');
    const existing = await this.repo.findBookingById(ctx.companyId, id);
    if (!existing) throw new NotFoundException('Booking not found');
    if (!isBranchInScope(ctx.scopes, existing.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope');
    await requireScopedBookableCustomer(this.repo, ctx, existing.customerId, true);
    if (existing.status !== 'BOOKED') throw new BadRequestException('booking_not_editable');
    let updated;
    try {
      updated = await this.repo.updateBooking(
        ctx.companyId,
        id,
        { status: 'CANCELLED', updatedByUserId: ctx.userId },
        { expectedCustomerId: existing.customerId, targetCustomerId: existing.customerId },
      );
    } catch (error) {
      throwBookingMutationError(error);
    }
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.booking.cancel',
      targetType: 'crm_booking', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { beforeStatus: existing.status, afterStatus: updated.status },
    });
    return toBookingSummary(updated);
  }
}

function throwBookingMutationError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'booking_not_found') throw new NotFoundException('Booking not found');
  if (code === 'customer_not_active') throw new UnprocessableEntityException({ code });
  if (code === 'branch_not_active_in_company' || code === 'staff_not_company_member') throw new BadRequestException(code);
  if (code === 'booking_customer_changed' || code === 'booking_changed') throw new ConflictException({ code });
  throw error;
}

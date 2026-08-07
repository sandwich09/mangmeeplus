import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { CrmBookingStatus } from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import {
  CancelCrmBookingUseCase,
  GetCrmBookingSettingsUseCase,
  UpdateCrmBookingSettingsUseCase,
  CreateAutonomousCrmBookingUseCase,
  CreateCrmBookingUseCase,
  ListCrmBookingsUseCase,
  ListCrmCustomerBookingsUseCase,
  UpdateCrmBookingUseCase,
} from './crm-booking.use-case';

const startAt = new Date('2099-07-10T07:00:00.000Z');
const endAt = new Date('2099-07-10T08:00:00.000Z');
const noopAudit = { log: async () => undefined } as any;

function bookingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'bk-1',
    companyId: 'co-1',
    branchId: 'br-1',
    customerId: 'cust-1',
    customerName: 'คุณลูกค้า',
    serviceName: 'ตัดผม',
    staffUserId: 'staff-1',
    startAt,
    endAt,
    status: 'BOOKED',
    source: 'STAFF',
    createdByUserId: 'staff-1',
    createdAt: new Date('2099-07-09T00:00:00.000Z'),
    updatedAt: new Date('2099-07-09T00:00:00.000Z'),
    ...overrides,
  };
}

function ctx(permission: string | string[]) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm-1', roles: ['STAFF'], permissions: Array.isArray(permission) ? permission : [permission], scopes: {}, authProvider: 'dev',
  } as any;
}

function recordingAudit() {
  const calls: any[] = [];
  return { calls, service: { log: async (input: any) => { calls.push(input); } } as any };
}

function makeRepo(overrides: Partial<any> = {}) {
  const calls = {
    createBookingIfSlotFree: [] as any[],
    updateBookingIfSlotFree: [] as any[],
    hasActiveCompanyMember: [] as any[],
    directCreate: 0,
    directUpdate: 0,
    listBookings: [] as any[],
    listBookingsForCustomer: [] as any[],
  };
  let bookingBufferMinutes = 60;
  return {
    calls,
    hasActiveCompanyMember: async (companyId: string, userId: string) => {
      calls.hasActiveCompanyMember.push({ companyId, userId });
      return true;
    },
    hasActiveBranch: async () => true,
    findCustomerById: async (companyId: string, customerId: string) => companyId === 'co-1' && customerId === 'cust-1'
      ? { id: 'cust-1', companyId: 'co-1', branchId: 'br-1', ownerUserId: 'staff-1', displayName: 'คุณลูกค้า', status: 'ACTIVE' }
      : null,
    findBookingById: async () => bookingRow(),
    getBookingBufferMinutes: async () => bookingBufferMinutes,
    updateBookingBufferMinutes: async (_companyId: string, value: number) => (bookingBufferMinutes = value),
    createBookingIfSlotFree: async (input: any) => {
      calls.createBookingIfSlotFree.push(input);
      return bookingRow(input);
    },
    updateBookingIfSlotFree: async (input: any) => {
      calls.updateBookingIfSlotFree.push(input);
      return bookingRow({ ...input.data, staffUserId: input.staffUserId, startAt: input.startAt, endAt: input.endAt });
    },
    listBookings: async (input: any) => { calls.listBookings.push(input); return [bookingRow()]; },
    listBookingsForCustomer: async (...input: any[]) => { calls.listBookingsForCustomer.push(input); return [bookingRow()]; },
    createBooking: async () => {
      calls.directCreate += 1;
      throw new Error('direct create bypass');
    },
    updateBooking: async () => {
      calls.directUpdate += 1;
      throw new Error('direct reschedule bypass');
    },
    ...overrides,
  } as any;
}

describe('CreateAutonomousCrmBookingUseCase', () => {
  it('routes staff create, autonomous create, and reschedule through the race-safe helpers', async () => {
    const repo = makeRepo();
    const create = new CreateCrmBookingUseCase(repo, noopAudit);
    const autonomous = new CreateAutonomousCrmBookingUseCase(repo);
    const update = new UpdateCrmBookingUseCase(repo, noopAudit);

    await create.execute(ctx('crm.booking.create'), {
      branchId: 'br-1',
      customerId: 'cust-1',
      serviceName: ' ตัดผม ',
      staffUserId: 'staff-1',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });
    const out = await autonomous.execute('co-1', {
      branchId: 'br-1',
      customerId: 'cust-1',
      serviceName: ' ตัดผม ',
      staffUserId: 'staff-1',
      startAt,
      endAt,
      sourceConversationId: 'cv-1',
    });
    await update.execute(ctx('crm.booking.update'), 'bk-1', {
      startAt: '2099-07-10T08:00:00.000Z',
      endAt: '2099-07-10T09:00:00.000Z',
    });

    assert.equal(repo.calls.createBookingIfSlotFree.length, 2);
    assert.equal(repo.calls.createBookingIfSlotFree[1].source, 'LINE');
    assert.equal(repo.calls.createBookingIfSlotFree[1].createdByUserId, 'system');
    assert.equal(repo.calls.createBookingIfSlotFree[1].serviceName, 'ตัดผม');
    assert.equal(repo.calls.updateBookingIfSlotFree.length, 1);
    assert.equal(repo.calls.directCreate, 0);
    assert.equal(repo.calls.directUpdate, 0);
    assert.equal(out.source, 'LINE');
  });

  it('throws ConflictException when the locked overlap check finds a clash', async () => {
    const order: string[] = [];
    const tx = {
      $queryRaw: async () => { order.push('lock'); return []; },
      company: { findUnique: async () => { order.push('setting'); return { bookingBufferMinutes: 60 }; } },
      crmCustomer: {
        findFirst: async () => {
          order.push('customer');
          return { id: 'cust-1', status: 'ACTIVE', displayName: 'คุณลูกค้า', primaryPhone: '0812345678' };
        },
      },
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: {
        findFirst: async () => ({
          id: 'membership-1',
          defaultBranchId: 'br-1',
          branchScopeMode: 'ALL_BRANCHES',
          branchScopes: [],
        }),
      },
      crmBooking: {
        findFirst: async () => { order.push('check'); return bookingRow({ id: 'bk-existing' }); },
        create: async () => { order.push('create'); return bookingRow(); },
      },
    };
    const repo = new PrismaCrmRepository({
      client: { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) },
    } as any);
    repo.findCustomerById = async () => ({
      id: 'cust-1',
      companyId: 'co-1',
      branchId: 'br-1',
      ownerUserId: 'staff-1',
      displayName: 'คุณลูกค้า',
      primaryPhone: '0812345678',
      status: 'ACTIVE',
    } as any);
    const uc = new CreateAutonomousCrmBookingUseCase(repo);

    await assert.rejects(
      () => uc.execute('co-1', {
        branchId: 'br-1',
        customerId: 'cust-1',
        serviceName: 'ตัดผม',
        staffUserId: 'staff-1',
        startAt,
        endAt,
      }),
      ConflictException,
    );
    assert.deepEqual(order, ['lock', 'customer', 'customer', 'lock', 'setting', 'check']);
  });

  it('rejects invalid booking windows', async () => {
    const repo = makeRepo();
    const uc = new CreateAutonomousCrmBookingUseCase(repo);

    await assert.rejects(
      () => uc.execute('co-1', {
        branchId: 'br-1',
        customerId: 'cust-1',
        serviceName: 'ตัดผม',
        staffUserId: 'staff-1',
        startAt: new Date('2099-07-10T13:00:00.000Z'), // 20:00 Bangkok
        endAt: new Date('2099-07-10T14:00:00.000Z'),
      }),
      BadRequestException,
    );
    assert.equal(repo.calls.createBookingIfSlotFree.length, 0);
    assert.equal(repo.calls.directCreate, 0);
  });
});

describe('booking staffUserId id-space validation', () => {
  it('rejects a staffUserId that is not an active company member (e.g. an EmployeeAccessProfile id)', async () => {
    const repo = makeRepo({ hasActiveCompanyMember: async () => false });
    const create = new CreateCrmBookingUseCase(repo, noopAudit);

    await assert.rejects(
      () => create.execute(ctx('crm.booking.create'), {
        branchId: 'br-1',
        customerId: 'cust-1',
        serviceName: 'ตัดผม',
        staffUserId: 'seed-room45-employee-toey',
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      }),
      (error: unknown) => error instanceof BadRequestException && (error as BadRequestException).message === 'staff_not_company_member',
    );
    assert.equal(repo.calls.createBookingIfSlotFree.length, 0);
  });

  it('rejects reassigning a booking to a non-member staffUserId', async () => {
    const repo = makeRepo({ hasActiveCompanyMember: async () => false });
    const update = new UpdateCrmBookingUseCase(repo, noopAudit);

    await assert.rejects(
      () => update.execute(ctx('crm.booking.update'), 'bk-1', { staffUserId: 'seed-room45-employee-toey' }),
      (error: unknown) => error instanceof BadRequestException && (error as BadRequestException).message === 'staff_not_company_member',
    );
    assert.equal(repo.calls.updateBookingIfSlotFree.length, 0);
  });

  it('validates membership in the actor company and allows unassigned bookings through', async () => {
    const repo = makeRepo();
    const create = new CreateCrmBookingUseCase(repo, noopAudit);

    await create.execute(ctx('crm.booking.create'), {
      branchId: 'br-1',
      customerId: 'cust-1',
      serviceName: 'ตัดผม',
      staffUserId: 'staff-1',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });
    assert.deepEqual(repo.calls.hasActiveCompanyMember, [{ companyId: 'co-1', userId: 'staff-1' }]);

    await create.execute(ctx('crm.booking.create'), {
      branchId: 'br-1',
      customerId: 'cust-1',
      serviceName: 'ตัดผม',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });
    assert.equal(repo.calls.hasActiveCompanyMember.length, 1);
    assert.equal(repo.calls.createBookingIfSlotFree.length, 2);
  });

  it('keeps the autonomous LINE path free of the membership check (inputs pre-validated at their seams)', async () => {
    const repo = makeRepo();
    const autonomous = new CreateAutonomousCrmBookingUseCase(repo);

    await autonomous.execute('co-1', {
      branchId: 'br-1',
      customerId: 'cust-1',
      serviceName: 'ตัดผม',
      staffUserId: 'staff-1',
      startAt,
      endAt,
    });
    assert.equal(repo.calls.hasActiveCompanyMember.length, 0);
    assert.equal(repo.calls.createBookingIfSlotFree.length, 1);
  });
});

describe('booking canonical customer link', () => {
  it('requires an active customer in the actor company and snapshots its current name', async () => {
    const repo = makeRepo();
    const create = new CreateCrmBookingUseCase(repo, noopAudit);

    await assert.rejects(
      () => create.execute(ctx('crm.booking.create'), {
        branchId: 'br-1', customerId: '', serviceName: 'ตัดผม', startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      }),
      (error: unknown) => error instanceof BadRequestException && error.message === 'customerId_required',
    );
    await assert.rejects(
      () => create.execute(ctx('crm.booking.create'), {
        branchId: 'br-1', customerId: 'other-company-customer', serviceName: 'ตัดผม', startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      }),
      NotFoundException,
    );

    await create.execute(ctx('crm.booking.create'), {
      branchId: 'br-1', customerId: 'cust-1', serviceName: 'ตัดผม', source: 'PHONE', startAt: startAt.toISOString(), endAt: endAt.toISOString(),
    });
    assert.equal(repo.calls.createBookingIfSlotFree[0].customerId, 'cust-1');
    assert.equal(repo.calls.createBookingIfSlotFree[0].customerName, 'คุณลูกค้า');
    assert.equal(repo.calls.createBookingIfSlotFree[0].source, 'PHONE');
  });

  it('rejects inactive customers and staff attempts to spoof the LINE source', async () => {
    const inactiveRepo = makeRepo({ findCustomerById: async () => ({ id: 'cust-1', displayName: 'ลูกค้าเก่า', status: 'ARCHIVED' }) });
    await assert.rejects(
      () => new CreateCrmBookingUseCase(inactiveRepo, noopAudit).execute(ctx('crm.booking.create'), {
        branchId: 'br-1', customerId: 'cust-1', serviceName: 'ตัดผม', startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      }),
      (error: unknown) => error instanceof BadRequestException && error.message === 'customer_not_active',
    );

    await assert.rejects(
      () => new CreateCrmBookingUseCase(makeRepo(), noopAudit).execute(ctx('crm.booking.create'), {
        branchId: 'br-1', customerId: 'cust-1', serviceName: 'ตัดผม', source: 'LINE' as any, startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      }),
      (error: unknown) => error instanceof BadRequestException && error.message === 'invalid_staff_booking_source',
    );
  });

  it('re-validates customer changes and refreshes the booking name snapshot', async () => {
    let updatedData: Record<string, unknown> | undefined;
    const repo = makeRepo({
      findCustomerById: async (_companyId: string, customerId: string) => ({ id: customerId, branchId: 'br-1', ownerUserId: 'staff-1', displayName: 'คุณลูกค้าใหม่', status: 'ACTIVE' }),
      updateBooking: async (_companyId: string, _id: string, data: Record<string, unknown>) => {
        updatedData = data;
        return bookingRow(data);
      },
    });
    await new UpdateCrmBookingUseCase(repo, noopAudit).execute(ctx('crm.booking.update'), 'bk-1', { customerId: 'cust-2' });
    assert.equal(updatedData?.customerId, 'cust-2');
    assert.equal(updatedData?.customerName, 'คุณลูกค้าใหม่');
    assert.equal(repo.calls.updateBookingIfSlotFree.length, 0);
  });
});

describe('booking customer ownership and branch ABAC', () => {
  it('scopes the calendar list by both caller branch and customer owner', async () => {
    const repo = makeRepo();
    const access = { ...ctx('crm.booking.read'), roles: ['SALES'], scopes: { branchIds: ['br-1'] } };
    await new ListCrmBookingsUseCase(repo).execute(access, { weekStart: '2099-07-06' });
    assert.equal(repo.calls.listBookings[0].customerOwnerUserId, 'staff-1');
    assert.deepEqual(repo.calls.listBookings[0].branchIds, ['br-1']);
  });

  it('blocks creating or reading bookings across customer/branch scope', async () => {
    const access = { ...ctx(['crm.booking.read', 'crm.booking.create']), roles: ['SALES'], scopes: { branchIds: ['br-1'] } };
    const otherOwner = makeRepo({
      findCustomerById: async () => ({ id: 'cust-1', companyId: 'co-1', branchId: 'br-1', ownerUserId: 'staff-2', displayName: 'ลูกค้าคนอื่น', status: 'ACTIVE' }),
    });
    await assert.rejects(
      () => new ListCrmCustomerBookingsUseCase(otherOwner).execute(access, 'cust-1'),
      /out of scope/,
    );
    await assert.rejects(
      () => new CreateCrmBookingUseCase(makeRepo(), noopAudit).execute(access, {
        branchId: 'br-2', customerId: 'cust-1', serviceName: 'ตัดผม', startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      }),
      /branch scope/,
    );
  });

  it('rechecks active branch and staff membership inside the final booking transaction', async () => {
    let writes = 0;
    const makeAtomicRepo = (branch: any, membership: any) => new PrismaCrmRepository({
      client: {
        $transaction: async (run: any) => run({
          branch: { findFirst: async () => branch },
          companyMembership: { findFirst: async () => membership },
          crmBooking: { create: async () => { writes += 1; return bookingRow(); } },
        }),
      },
    } as any);
    const input = {
      companyId: 'co-1', branchId: 'br-1', customerId: 'cust-1', customerName: 'ลูกค้า', serviceName: 'ตัดผม',
      staffUserId: 'staff-1', startAt, endAt, createdByUserId: 'staff-1',
    };
    await assert.rejects(() => makeAtomicRepo(null, { id: 'm-1' }).createBookingIfSlotFree(input), /branch_not_active/);
    await assert.rejects(() => makeAtomicRepo({ id: 'br-1' }, null).createBookingIfSlotFree(input), /staff_not_company_member/);
    assert.equal(writes, 0);
  });
});

describe('booking buffer settings', () => {
  it('reads, updates, and audits the company setting', async () => {
    const repo = makeRepo();
    const audit = recordingAudit();
    const read = new GetCrmBookingSettingsUseCase(repo);
    const update = new UpdateCrmBookingSettingsUseCase(repo, audit.service);
    assert.deepEqual(await read.execute(ctx('crm.booking.read')), { bufferMinutes: 60 });
    assert.deepEqual(await update.execute(ctx('crm.booking.update'), { bufferMinutes: 90 }), { bufferMinutes: 90 });
    assert.deepEqual(audit.calls[0].metadataJson, { beforeBufferMinutes: 60, afterBufferMinutes: 90 });
  });

  it('rejects unsupported buffer values', async () => {
    await assert.rejects(
      () => new UpdateCrmBookingSettingsUseCase(makeRepo(), noopAudit).execute(ctx('crm.booking.update'), { bufferMinutes: 45 as any }),
      BadRequestException,
    );
  });
});

describe('UpdateCrmBookingUseCase appointment lifecycle', () => {
  it('allows BOOKED to transition to each terminal status and audits before/after status', async () => {
    for (const status of ['DONE', 'NO_SHOW', 'CANCELLED'] as CrmBookingStatus[]) {
      const audit = recordingAudit();
      const repo = makeRepo({
        updateBooking: async (_companyId: string, _id: string, data: Record<string, unknown>) => bookingRow(data),
      });
      const uc = new UpdateCrmBookingUseCase(repo, audit.service);
      const permissions = status === 'CANCELLED'
        ? ['crm.booking.update', 'crm.booking.cancel']
        : ['crm.booking.update'];

      const updated = await uc.execute(ctx(permissions), 'bk-1', { status });

      assert.equal(updated.status, status);
      assert.equal(audit.calls.length, 1);
      assert.equal(audit.calls[0].action, 'crm.booking.update');
      assert.deepEqual(audit.calls[0].metadataJson, { beforeStatus: 'BOOKED', afterStatus: status });
    }
  });

  it('rejects DONE to BOOKED, CANCELLED to BOOKED, and NO_SHOW to DONE', async () => {
    for (const [beforeStatus, afterStatus] of [
      ['DONE', 'BOOKED'],
      ['CANCELLED', 'BOOKED'],
      ['NO_SHOW', 'DONE'],
    ] as const) {
      const audit = recordingAudit();
      const repo = makeRepo({ findBookingById: async () => bookingRow({ status: beforeStatus }) });
      const uc = new UpdateCrmBookingUseCase(repo, audit.service);

      await assert.rejects(
        () => uc.execute(ctx('crm.booking.update'), 'bk-1', { status: afterStatus }),
        BadRequestException,
      );
      assert.equal(repo.calls.updateBookingIfSlotFree.length, 0);
      assert.equal(audit.calls.length, 0);
    }
  });

  it('rejects rescheduling DONE and CANCELLED bookings', async () => {
    for (const status of ['DONE', 'CANCELLED'] as const) {
      const repo = makeRepo({ findBookingById: async () => bookingRow({ status }) });
      const uc = new UpdateCrmBookingUseCase(repo, noopAudit);

      await assert.rejects(
        () => uc.execute(ctx('crm.booking.update'), 'bk-1', {
          startAt: '2099-07-10T08:00:00.000Z',
          endAt: '2099-07-10T09:00:00.000Z',
        }),
        BadRequestException,
      );
      assert.equal(repo.calls.updateBookingIfSlotFree.length, 0);
    }
  });

  it('keeps the cancel route terminal and audits its BOOKED to CANCELLED transition', async () => {
    const audit = recordingAudit();
    const repo = makeRepo({
      updateBooking: async (_companyId: string, _id: string, data: Record<string, unknown>) => bookingRow(data),
    });
    const uc = new CancelCrmBookingUseCase(repo, audit.service);

    const cancelled = await uc.execute(ctx('crm.booking.cancel'), 'bk-1');
    assert.equal(cancelled.status, 'CANCELLED');
    assert.deepEqual(audit.calls[0].metadataJson, { beforeStatus: 'BOOKED', afterStatus: 'CANCELLED' });

    const terminalRepo = makeRepo({ findBookingById: async () => bookingRow({ status: 'DONE' }) });
    await assert.rejects(
      () => new CancelCrmBookingUseCase(terminalRepo, noopAudit).execute(ctx('crm.booking.cancel'), 'bk-1'),
      BadRequestException,
    );
  });
});

describe('PrismaCrmRepository booking race safety', () => {
  it('fills a missing phone without replacing a concurrent staff name or its provenance', async () => {
    const existing = {
      id: 'cust-1',
      companyId: 'co-1',
      displayName: 'ชื่อที่พนักงานแก้',
      displayNameNormalized: 'ชื่อที่พนักงานแก้',
      primaryPhone: null,
      primaryPhoneNormalized: null,
      status: 'ACTIVE',
      consentStatus: 'UNKNOWN',
      personalDataErasedAt: null,
      updatedByUserId: 'staff-1',
    };
    let reads = 0;
    let updateData: Record<string, unknown> | undefined;
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async (args: any) => {
          if (args.where.id?.in) return null;
          reads += 1;
          return reads === 1
            ? existing
            : { ...existing, primaryPhone: '0625598598', primaryPhoneNormalized: '625598598' };
        },
        updateMany: async (args: any) => {
          updateData = args.data;
          return { count: 1 };
        },
      },
    };
    const repo = new PrismaCrmRepository({
      client: { $transaction: async (fn: (client: typeof tx) => Promise<any>) => fn(tx) },
    } as any);

    const customer = await repo.fillMissingBookingContact('co-1', 'cust-1', {
      displayName: 'ชื่อจากแชท',
      primaryPhone: '0625598598',
      lineProfileDisplayName: 'ชื่อจาก LINE',
    });

    assert.equal(customer.displayName, 'ชื่อที่พนักงานแก้');
    assert.equal(customer.primaryPhone, '0625598598');
    assert.equal(updateData?.['displayName'], undefined);
    assert.equal(updateData?.['updatedByUserId'], undefined);
  });

  it('locks, checks the half-open overlap, then creates inside one transaction', async () => {
    const order: string[] = [];
    const rawCalls: any[][] = [];
    let transactionCallback: ((tx: any) => Promise<any>) | undefined;
    let overlapArgs: any;
    const tx = {
      $queryRaw: async (...args: any[]) => {
        rawCalls.push(args);
        order.push('lock');
        return [];
      },
      company: {
        findUnique: async () => { order.push('setting'); return { bookingBufferMinutes: 60 }; },
      },
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: {
        findFirst: async () => ({
          id: 'membership-1',
          defaultBranchId: 'br-1',
          branchScopeMode: 'ALL_BRANCHES',
          branchScopes: [],
        }),
      },
      crmCustomer: {
        findFirst: async () => { order.push('customer'); return { id: 'cust-1', status: 'ACTIVE' }; },
      },
      crmBooking: {
        findFirst: async (args: any) => {
          overlapArgs = args;
          order.push('check');
          return null;
        },
        create: async (args: any) => {
          order.push('create');
          return bookingRow(args.data);
        },
      },
    };
    let transactionCalls = 0;
    const repo = new PrismaCrmRepository({
      client: {
        $transaction: async (fn: (client: typeof tx) => Promise<any>) => {
          transactionCalls += 1;
          transactionCallback = fn;
          return fn(tx);
        },
      },
    } as any);

    const created = await repo.createBookingIfSlotFree({
      companyId: 'co-1',
      branchId: 'br-1',
      customerId: 'cust-1',
      customerName: 'คุณลูกค้า',
      serviceName: 'ตัดผม',
      staffUserId: 'staff-1',
      startAt,
      endAt,
      createdByUserId: 'staff-1',
    });

    assert.equal(transactionCalls, 1);
    assert.equal(typeof transactionCallback, 'function');
    assert.deepEqual(order, ['lock', 'customer', 'customer', 'lock', 'setting', 'check', 'create']);
    assert.equal(rawCalls.length, 2);
    assert.match(rawCalls[0][0].join('?'), /pg_advisory_xact_lock\(hashtext/);
    assert.deepEqual(rawCalls[0].slice(1), ['co-1', 'cust-1']);
    assert.deepEqual(rawCalls[1].slice(1), ['co-1', 'staff-1']);
    assert.deepEqual(overlapArgs.where, {
      companyId: 'co-1',
      staffUserId: 'staff-1',
      status: { not: 'CANCELLED' },
      id: undefined,
      startAt: { lt: new Date(endAt.getTime() + 60 * 60_000) },
      endAt: { gt: new Date(startAt.getTime() - 60 * 60_000) },
    });
    assert.equal(created?.id, 'bk-1');
  });

  it('rejects an autonomous booking when consent is revoked after the preflight but before the locked write', async () => {
    const order: string[] = [];
    const tx = {
      $queryRaw: async () => { order.push('lock'); return []; },
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: {
        findFirst: async () => ({
          id: 'membership-1',
          defaultBranchId: 'br-1',
          branchScopeMode: 'ALL_BRANCHES',
          branchScopes: [],
        }),
      },
      crmCustomer: {
        findFirst: async () => {
          order.push('customer');
          return { id: 'cust-1', companyId: 'co-1', status: 'ACTIVE', personalDataErasedAt: null, consentStatus: 'REVOKED' };
        },
      },
    };
    const repo = new PrismaCrmRepository({
      client: { $transaction: async (fn: (client: typeof tx) => Promise<any>) => fn(tx) },
    } as any);
    repo.findCustomerById = async () => ({
      id: 'cust-1', companyId: 'co-1', branchId: 'br-1', ownerUserId: 'staff-1', displayName: 'คุณลูกค้า', status: 'ACTIVE', consentStatus: 'UNKNOWN',
    } as any);
    const uc = new CreateAutonomousCrmBookingUseCase(repo);

    await assert.rejects(
      () => uc.execute('co-1', {
        branchId: 'br-1', customerId: 'cust-1', serviceName: 'ตัดผม', staffUserId: 'staff-1', startAt, endAt,
      }),
      UnprocessableEntityException,
    );
    assert.deepEqual(order, ['lock', 'customer', 'customer']);
  });

  it('rejects an autonomous booking when the active staff cannot access the selected branch at commit', async () => {
    let writes = 0;
    const tx = {
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: {
        findFirst: async () => ({
          id: 'membership-1',
          defaultBranchId: 'br-2',
          branchScopeMode: 'DEFAULT_BRANCH_ONLY',
          branchScopes: [],
        }),
      },
      crmBooking: { create: async () => { writes += 1; return bookingRow(); } },
    };
    const repo = new PrismaCrmRepository({
      client: { $transaction: async (fn: (client: typeof tx) => Promise<any>) => fn(tx) },
    } as any);
    repo.findCustomerById = async () => ({
      id: 'cust-1',
      companyId: 'co-1',
      displayName: 'คุณลูกค้า',
      status: 'ACTIVE',
      consentStatus: 'UNKNOWN',
    } as any);

    await assert.rejects(
      () => new CreateAutonomousCrmBookingUseCase(repo).execute('co-1', {
        branchId: 'br-1',
        customerId: 'cust-1',
        serviceName: 'ตัดผม',
        staffUserId: 'staff-1',
        startAt,
        endAt,
      }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === 'staff_branch_not_accessible',
    );
    assert.equal(writes, 0);
  });

  it('rejects an autonomous booking at the final transaction when customer contact is incomplete', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: {
        findFirst: async () => ({
          id: 'membership-1',
          defaultBranchId: 'br-1',
          branchScopeMode: 'ALL_BRANCHES',
          branchScopes: [],
        }),
      },
      crmCustomer: {
        findFirst: async () => ({
          id: 'cust-1',
          companyId: 'co-1',
          status: 'ACTIVE',
          personalDataErasedAt: null,
          consentStatus: 'UNKNOWN',
          displayName: 'Sunday',
          primaryPhone: null,
        }),
      },
      crmBooking: { create: async () => { writes += 1; return bookingRow(); } },
    };
    const repo = new PrismaCrmRepository({
      client: { $transaction: async (fn: (client: typeof tx) => Promise<any>) => fn(tx) },
    } as any);
    repo.findCustomerById = async () => ({
      id: 'cust-1',
      companyId: 'co-1',
      displayName: 'Sunday',
      status: 'ACTIVE',
      consentStatus: 'UNKNOWN',
    } as any);

    await assert.rejects(
      () => new CreateAutonomousCrmBookingUseCase(repo).execute('co-1', {
        branchId: 'br-1',
        customerId: 'cust-1',
        serviceName: 'ตัดผม',
        staffUserId: 'staff-1',
        startAt,
        endAt,
      }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === 'booking_contact_required',
    );
    assert.equal(writes, 0);
  });

  it('rejects an autonomous booking when final customer contact differs from the reviewed snapshot', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: {
        findFirst: async () => ({
          id: 'membership-1',
          defaultBranchId: 'br-1',
          branchScopeMode: 'ALL_BRANCHES',
          branchScopes: [],
        }),
      },
      crmCustomer: {
        findFirst: async () => ({
          id: 'cust-1',
          companyId: 'co-1',
          status: 'ACTIVE',
          personalDataErasedAt: null,
          consentStatus: 'UNKNOWN',
          displayName: 'ชื่อใหม่',
          primaryPhone: '0812345678',
        }),
      },
      crmBooking: { create: async () => { writes += 1; return bookingRow(); } },
    };
    const repo = new PrismaCrmRepository({
      client: { $transaction: async (fn: (client: typeof tx) => Promise<any>) => fn(tx) },
    } as any);
    repo.findCustomerById = async () => ({
      id: 'cust-1',
      companyId: 'co-1',
      displayName: 'ชื่อเดิม',
      primaryPhone: '0812345678',
      status: 'ACTIVE',
      consentStatus: 'UNKNOWN',
    } as any);

    await assert.rejects(
      () => new CreateAutonomousCrmBookingUseCase(repo).execute('co-1', {
        branchId: 'br-1',
        customerId: 'cust-1',
        serviceName: 'ตัดผม',
        staffUserId: 'staff-1',
        startAt,
        endAt,
      }, {
        expectedCustomerContact: { displayName: 'ชื่อเดิม', primaryPhone: '0812345678' },
      }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === 'booking_review_changed',
    );
    assert.equal(writes, 0);
  });

  it('CUST-02: runs the tx hooks in order — validations, assertWithinTx, clash check, write, then finalizeWithinTx', async () => {
    const order: string[] = [];
    const tx = {
      $queryRaw: async () => { order.push('lock'); return []; },
      company: { findUnique: async () => ({ bookingBufferMinutes: 60 }) },
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: { findFirst: async () => ({ id: 'm-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', status: 'ACTIVE' }) },
      crmBooking: {
        findFirst: async () => { order.push('clash'); return null; },
        create: async (args: any) => { order.push('write'); return bookingRow(args.data); },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);

    const created = await repo.createBookingIfSlotFree({
      companyId: 'co-1', branchId: 'br-1', customerId: 'cust-1', customerName: 'ลูกค้า',
      serviceName: 'ตัดผม', staffUserId: 'staff-1', startAt, endAt, createdByUserId: 'staff-1',
    }, {
      assertWithinTx: async () => { order.push('assert'); },
      finalizeWithinTx: async (_tx: any, row: any) => { order.push(`finalize:${row.id}`); },
    });

    assert.deepEqual(order, ['lock', 'assert', 'lock', 'clash', 'write', 'finalize:bk-1']);
    assert.equal(created?.id, 'bk-1');
  });

  it('CUST-02: assertWithinTx throwing aborts before any write', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      company: { findUnique: async () => ({ bookingBufferMinutes: 60 }) },
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: { findFirst: async () => ({ id: 'm-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', status: 'ACTIVE' }) },
      crmBooking: { findFirst: async () => null, create: async () => { writes += 1; return bookingRow(); } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);

    await assert.rejects(
      () => repo.createBookingIfSlotFree({
        companyId: 'co-1', branchId: 'br-1', customerId: 'cust-1', customerName: 'ลูกค้า',
        serviceName: 'ตัดผม', staffUserId: 'staff-1', startAt, endAt, createdByUserId: 'staff-1',
      }, { assertWithinTx: async () => { throw new Error('autonomy_disabled_at_commit'); } }),
      /autonomy_disabled_at_commit/,
    );
    assert.equal(writes, 0);
  });

  it('CUST-02: finalizeWithinTx throwing rejects the transaction so the booking write rolls back', async () => {
    const tx = {
      $queryRaw: async () => [],
      company: { findUnique: async () => ({ bookingBufferMinutes: 60 }) },
      branch: { findFirst: async () => ({ id: 'br-1' }) },
      companyMembership: { findFirst: async () => ({ id: 'm-1' }) },
      crmCustomer: { findFirst: async () => ({ id: 'cust-1', status: 'ACTIVE' }) },
      crmBooking: { findFirst: async () => null, create: async (args: any) => bookingRow(args.data) },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);

    await assert.rejects(
      () => repo.createBookingIfSlotFree({
        companyId: 'co-1', branchId: 'br-1', customerId: 'cust-1', customerName: 'ลูกค้า',
        serviceName: 'ตัดผม', staffUserId: 'staff-1', startAt, endAt, createdByUserId: 'staff-1',
      }, { finalizeWithinTx: async () => { throw new Error('booking_proposal_finalize_lost_race'); } }),
      /booking_proposal_finalize_lost_race/,
    );
  });
});

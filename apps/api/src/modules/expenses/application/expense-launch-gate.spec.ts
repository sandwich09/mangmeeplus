// The manual-draft half of the expenses kill switch, plus the runoff boundary it must not cross.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import type { CreateExpenseDraftInput, RequestContext } from '@watchdog-bms/contracts';
import {
  ConfirmExpenseUseCase,
  CreateExpenseDraftUseCase,
  MarkExpenseReadyUseCase,
} from './use-cases/expense-draft.use-case';
import { EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE } from './expense-launch-gate';
import { FEATURE_TEMPORARILY_UNAVAILABLE, featureTemporarilyUnavailable } from '../../employee-access/application/entitlement.helper';

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'mem-1', roles: [], permissions: ['expense.create', 'expense.review'],
  scopes: {}, authProvider: 'watchdog',
};

const input: CreateExpenseDraftInput = {
  captureSource: 'WEB_MANUAL',
  expenseDate: '2026-08-25',
  vatMode: 'NO_VAT',
  inputVatClaimStatus: 'NON_CLAIMABLE',
  lines: [],
};

function harness(launchGate: any) {
  const created: any[] = [];
  const audits: any[] = [];
  const useCase = new CreateExpenseDraftUseCase(
    {
      resolveCreateBranchId: async () => 'branch-1',
      createExpense: async (data: any) => { created.push(data); return { id: 'expense-1', ...data }; },
      // §5.1: an omitted chargeKind on a replacement PATCH keeps the stored one, so the
      // update path reads them back before it validates.
      listLineChargeKinds: async () => new Map<number, string | null>(),
      upsertLines: async () => undefined,
    } as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
    { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any,
    launchGate,
  );
  return { useCase, created, audits };
}

describe('CreateExpenseDraftUseCase launch gate', () => {
  it('refuses in plain Thai, audits the denial and creates no draft when closed', async () => {
    const { useCase, created, audits } = harness({
      assertLaunchRouteOpen: async () => { throw featureTemporarilyUnavailable('expenses'); },
    });

    await assert.rejects(() => useCase.execute(ctx, input), (error: any) => {
      const body = error.getResponse();
      assert.equal(body.code, FEATURE_TEMPORARILY_UNAVAILABLE);
      assert.equal(body.message, EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE);
      // The refusal names no gate or route key: those are internal control-plane identifiers.
      assert.equal(body.message.includes('expenses'), false);
      return true;
    });

    assert.deepEqual(created, []);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'expense.create');
    assert.equal(audits[0].result, 'DENIED');
    assert.deepEqual(audits[0].metadataJson, { reason: 'launch_route_closed' });
  });

  // Runbook R8 rule 2: availability problems degrade toward CLOSED. A guard that cannot read its
  // own row is not permission to create a record, and it is not a polite refusal either — the
  // caller's normal error path has to see the real failure.
  it('rethrows a guard-infrastructure failure instead of refusing politely', async () => {
    const { useCase, created, audits } = harness({
      assertLaunchRouteOpen: async () => { throw new Error('gate read failed'); },
    });

    await assert.rejects(() => useCase.execute(ctx, input), /gate read failed/);
    assert.deepEqual(created, []);
    assert.equal(audits.length, 0);
  });

  it('asks for the expenses DEFAULT route and passes straight through when open', async () => {
    const asked: string[][] = [];
    const { useCase, created, audits } = harness({
      assertLaunchRouteOpen: async (gateKey: string, routeKey: string) => { asked.push([gateKey, routeKey]); },
    });

    const record = await useCase.execute(ctx, input);

    assert.deepEqual(asked, [['expenses', 'DEFAULT']]);
    assert.equal(record.id, 'expense-1');
    assert.equal(record.branchId, 'branch-1');
    assert.equal(created.length, 1);
    assert.equal(audits[0].result, 'SUCCESS');
  });

  it('refuses before spending a gate read on a caller who lacks the permission', async () => {
    let reads = 0;
    const { useCase } = harness({ assertLaunchRouteOpen: async () => { reads += 1; } });

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ['expense.read'] }, input),
      /Missing permission/,
    );
    assert.equal(reads, 0);
  });
});

describe('expenses runoff stays open while the route is closed', () => {
  // `expenses/DEFAULT` is BLOCK_NEW_ROOT: a CLOSE refuses NEW roots and lets work already in the
  // system finish. Mark-ready and confirm are that runoff, so neither may take a launch gate —
  // gating them would strand half-reviewed drafts the CLOSE was never meant to touch. Constructor
  // arity is the fence: injecting a guard into either one fails here first.
  it('does not wire a launch gate into mark-ready or confirm', () => {
    assert.equal(MarkExpenseReadyUseCase.length, 1, 'mark-ready takes the repository only');
    assert.equal(ConfirmExpenseUseCase.length, 7, 'confirm takes repo, audit, tax, 3 numbering use cases, VAT registration');
  });

  it('moves an existing draft to READY_FOR_CONFIRMATION with no gate in the path', async () => {
    const updates: any[] = [];
    const repo = {
      findById: async () => ({ id: 'exp-1', branchId: null, status: 'NEEDS_REVIEW', createdByUserId: 'user-1' }),
      updateExpense: async (data: any) => { updates.push(data); return data; },
    } as any;

    await new MarkExpenseReadyUseCase(repo).execute(ctx, 'exp-1');

    assert.equal(updates[0].status, 'READY_FOR_CONFIRMATION');
  });
});

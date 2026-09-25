/**
 * The counterparty screen's own endpoints (spec §12, §12.1, A4, A5). What is being protected:
 * `type` can no longer be chosen by a client; the "ใช้อันนี้เป็นหลัก" button and the lock switch are
 * the only manual address decisions and they need `accounting.counterparty.manage` or having added
 * the row (owner 2026-09-25); two people editing at once get told to reload instead of overwriting
 * each other; and an over-long address or a four-digit branch code is refused with the sentence that
 * says how to fix it (§8).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CreateCounterpartyUseCase,
  UpdateCounterpartyUseCase,
  GetCounterpartyUseCase,
  ListCounterpartiesUseCase,
  PromoteSeenAddressUseCase,
} from './counterparty.use-case';

const ADDRESS = '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';
const OLD_ADDRESS = '99 หมู่ 2 ตำบลบางโฉลง อำเภอบางพลี จังหวัดสมุทรปราการ 10540';

function ctx(permissions: string[] = ['accounting.counterparty.manage', 'accounting.counterparty.read']) {
  return { requestId: 'req-1', userId: 'u-1', companyId: 'co-1', permissions, scopes: {} } as any;
}

const audit = { log: async () => undefined } as any;
const openGate = { assertLaunchRouteOpenInTransaction: async () => undefined } as any;

function repoWith(existing?: Record<string, any>) {
  const calls: any = { created: [], updated: [], saved: [], listed: [] };
  return {
    calls,
    repo: {
      findCounterpartyById: async () => existing ?? null,
      createCounterparty: async (input: any) => { calls.created.push(input); return { ...input, id: 'cp-new' }; },
      updateCounterparty: async (input: any) => { calls.updated.push(input); return { ...existing, ...input, id: 'cp-1' }; },
      // §11.1/§15: when the fixture carries an `updatedAt`, this mirrors the real CAS — a token that
      // does not match the row is a lost race (false), same as a PATCH conflict. Fixtures that don't
      // set `updatedAt` (most of this file) never hit the mismatch branch, so they keep succeeding.
      saveCounterpartyVendorFields: async (input: any) => {
        calls.saved.push(input);
        if (existing?.updatedAt && input.expectedUpdatedAt) {
          return new Date(input.expectedUpdatedAt).getTime() === new Date(existing.updatedAt).getTime();
        }
        return true;
      },
      listCounterparties: async (companyId: string, page: number, pageSize: number, filter: any) => {
        calls.listed.push({ companyId, page, pageSize, filter });
        return { data: [], total: 0 };
      },
      counterpartyUsage: async () => ({ usageCounts: { bought: 3, sold: 1 }, recentExpenses: [] }),
    } as any,
  };
}

describe('`type` is server-owned (A5, §12)', () => {
  it('creates a manually added counterparty as BOTH, because no screen picks a type any more', async () => {
    const { repo, calls } = repoWith();

    await new CreateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), { displayName: 'ร้านใหม่' });

    assert.equal(calls.created[0].type, 'BOTH',
      'VENDOR would hide its receipts from the AI revenue tool, which reads CUSTOMER/BOTH only (CON-1)');
  });

  it('never writes `type` on an update — a purchase or a sale moves it, not a form', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR' });

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { displayName: 'ชื่อใหม่' });

    assert.equal('type' in calls.updated[0], false);
  });
});

describe('the address fields on the counterparty screen', () => {
  it('stores what was typed as the v2 shape with a MANUAL provenance', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR', billingAddressJson: null });

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { addressText: ADDRESS, postalCode: '10110' });

    assert.equal(calls.updated[0].billingAddressJson.addressText, ADDRESS);
    assert.equal(calls.updated[0].billingAddressJson.postalCode, '10110');
    assert.equal(calls.updated[0].billingAddressJson.provenance.source, 'MANUAL');
  });

  it('keeps the history an expense auto-save built when a person edits the primary', async () => {
    const { repo, calls } = repoWith({
      id: 'cp-1', type: 'VENDOR',
      billingAddressJson: { addressText: OLD_ADDRESS, seenOnDocuments: [{ addressText: OLD_ADDRESS, expenseId: 'exp-9', at: '2026-01-01T00:00:00.000Z' }], provenance: { source: 'EXPENSE_AUTO', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } },
    });

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { addressText: ADDRESS });

    assert.equal(calls.updated[0].billingAddressJson.seenOnDocuments.length, 1);
  });

  it('turns the lock on and off, and off means the key is gone rather than stored false', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR', billingAddressJson: { addressText: ADDRESS, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } } });
    const useCase = new UpdateCounterpartyUseCase(repo, audit, openGate);

    await useCase.execute(ctx(), 'cp-1', { locked: true });
    assert.equal(calls.updated[0].billingAddressJson.locked, true);
    assert.equal(calls.updated[0].billingAddressJson.addressText, ADDRESS, 'flipping the switch may not blank the address');

    const relocked = repoWith({ id: 'cp-1', type: 'VENDOR', billingAddressJson: { addressText: ADDRESS, locked: true, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } } });
    await new UpdateCounterpartyUseCase(relocked.repo, audit, openGate).execute(ctx(), 'cp-1', { locked: false });
    assert.equal('locked' in relocked.calls.updated[0].billingAddressJson, false);
  });

  it('leaves the address column untouched when the body only changes a name', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR', billingAddressJson: { addressText: ADDRESS } });

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { displayName: 'ชื่อใหม่' });

    assert.equal(calls.updated[0].billingAddressJson, undefined);
  });

  it('refuses an over-long address with the limit and the fix in the message (§8)', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR' });

    await assert.rejects(
      () => new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { addressText: 'ก'.repeat(501) }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as { code: string; message: string };
        assert.equal(body.code, 'counterparty_address_too_long');
        assert.match(body.message, /500/);
        assert.match(body.message, /ตัดให้สั้นลง/);
        return true;
      },
    );
    assert.deepEqual(calls.updated, [], 'nothing half-saves behind a refusal');
  });

  it('refuses a four-digit branch code (CON-8)', async () => {
    const { repo } = repoWith({ id: 'cp-1', type: 'VENDOR' });

    await assert.rejects(
      () => new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { branchCode: '0001' }),
      (error: unknown) => {
        assert.equal(((error as BadRequestException).getResponse() as { code: string }).code, 'counterparty_branch_code_invalid');
        return true;
      },
    );
  });

  it('clears a blank branch code instead of storing the head-office placeholder', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR' });

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { branchCode: '  ' });

    assert.equal(calls.updated[0].branchCode, undefined);
  });

  it('passes the loaded version through for the conflict check (§11.1)', async () => {
    const { repo, calls } = repoWith({ id: 'cp-1', type: 'VENDOR' });

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(), 'cp-1', { displayName: 'ชื่อใหม่', expectedUpdatedAt: '2026-09-20T10:00:00.000Z' });

    assert.equal(calls.updated[0].expectedUpdatedAt.toISOString(), '2026-09-20T10:00:00.000Z');
  });
});

describe('promote-seen-address (§7, §12.1)', () => {
  const withHistory = {
    id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
    billingAddressJson: {
      addressText: ADDRESS,
      provenance: { source: 'EXPENSE_AUTO', expenseId: 'exp-2', userId: 'u-0', at: '2026-02-01T00:00:00.000Z' },
      seenOnDocuments: [{ addressText: OLD_ADDRESS, expenseId: 'exp-1', at: '2026-01-01T00:00:00.000Z' }],
    },
  };

  it('swaps the chosen history entry with the current primary, so the move is reversible', async () => {
    const { repo, calls } = repoWith(withHistory);

    await new PromoteSeenAddressUseCase(repo, audit).execute(ctx(), 'cp-1', OLD_ADDRESS);

    assert.equal(calls.saved[0].billingAddressJson.addressText, OLD_ADDRESS);
    assert.deepEqual(calls.saved[0].billingAddressJson.seenOnDocuments.map((entry: any) => entry.addressText), [ADDRESS]);
    assert.equal(calls.saved[0].billingAddressJson.provenance.source, 'MANUAL', 'a person chose this one');
  });

  it('needs accounting.counterparty.manage or having added it, unlike the automatic writes (A3)', async () => {
    const { repo, calls } = repoWith(withHistory);

    await assert.rejects(
      () => new PromoteSeenAddressUseCase(repo, audit).execute(ctx(['accounting.counterparty.read']), 'cp-1', OLD_ADDRESS),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.deepEqual(calls.saved, []);
  });

  it('refuses an address the registry no longer remembers instead of inventing one', async () => {
    const { repo, calls } = repoWith(withHistory);

    await assert.rejects(
      () => new PromoteSeenAddressUseCase(repo, audit).execute(ctx(), 'cp-1', 'ที่อยู่ที่ไม่เคยมี'),
      (error: unknown) => error instanceof NotFoundException,
    );
    assert.deepEqual(calls.saved, []);
  });

  it('keeps the address out of the audit metadata (CON-10)', async () => {
    const audits: any[] = [];
    const { repo } = repoWith(withHistory);

    await new PromoteSeenAddressUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any)
      .execute(ctx(), 'cp-1', OLD_ADDRESS);

    assert.deepEqual(audits[0].metadataJson, { source: 'promote_seen_address', addressChanged: true });
  });

  it('compares-and-sets even with no token: falls back to the row it just read (§11.1/§15)', async () => {
    const { repo, calls } = repoWith({ ...withHistory, updatedAt: new Date('2026-09-20T10:00:00.000Z') });

    await new PromoteSeenAddressUseCase(repo, audit).execute(ctx(), 'cp-1', OLD_ADDRESS);

    assert.equal(calls.saved[0].expectedUpdatedAt.toISOString(), '2026-09-20T10:00:00.000Z');
  });

  it('promotes when the client sends the token the row still has', async () => {
    const { repo, calls } = repoWith({ ...withHistory, updatedAt: new Date('2026-09-20T10:00:00.000Z') });

    const result = await new PromoteSeenAddressUseCase(repo, audit)
      .execute(ctx(), 'cp-1', OLD_ADDRESS, '2026-09-20T10:00:00.000Z');

    assert.equal(calls.saved[0].expectedUpdatedAt.toISOString(), '2026-09-20T10:00:00.000Z');
    assert.ok(result);
  });

  it('answers a stale token with 409 counterparty_conflict — the same code the PATCH path uses', async () => {
    const { repo } = repoWith({ ...withHistory, updatedAt: new Date('2026-09-20T10:00:00.000Z') });

    await assert.rejects(
      () => new PromoteSeenAddressUseCase(repo, audit).execute(ctx(), 'cp-1', OLD_ADDRESS, '2026-09-20T09:00:00.000Z'),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error.getResponse() as { code: string }).code, 'counterparty_conflict');
        return true;
      },
    );
  });
});

describe('list and detail (§12)', () => {
  it('forwards search, the usage chip and the missing-address chip — and no type filter exists', async () => {
    const { repo, calls } = repoWith();

    await new ListCounterpartiesUseCase(repo).execute(ctx(), 1, 20, { search: 'ตัวอย่าง', usage: 'bought', addressMissing: true });

    assert.deepEqual(calls.listed[0].filter, { search: 'ตัวอย่าง', usage: 'bought', addressMissing: true });
  });

  it('answers the detail with usage counts, because the badges replaced the type picker (A5)', async () => {
    const { repo } = repoWith({ id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม' });

    const detail = await new GetCounterpartyUseCase(repo).execute(ctx(), 'cp-1');

    assert.deepEqual(detail.usageCounts, { bought: 3, sold: 1 });
    assert.deepEqual(detail.recentExpenses, []);
  });

  it('refuses a reader without accounting.counterparty.read', async () => {
    const { repo } = repoWith({ id: 'cp-1' });

    await assert.rejects(() => new GetCounterpartyUseCase(repo).execute(ctx([]), 'cp-1'), (error: unknown) => error instanceof ForbiddenException);
    await assert.rejects(() => new ListCounterpartiesUseCase(repo).execute(ctx([])), (error: unknown) => error instanceof ForbiddenException);
  });
});

describe('whoever added a counterparty may open and edit it (owner 2026-09-25)', () => {
  // `ctx()` is user u-1. The relation key is what lets such a caller past the route guard at all.
  const creatorOnly = ['expense.read_related'];
  const added = {
    id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม', createdByUserId: 'u-1',
    billingAddressJson: { addressText: ADDRESS, seenOnDocuments: [{ addressText: OLD_ADDRESS, expenseId: 'exp-1', at: '2026-01-01T00:00:00.000Z' }] },
  };
  const someoneElses = { ...added, createdByUserId: 'u-9' };

  it('lets the person who added it edit and promote without accounting.counterparty.manage', async () => {
    const { repo, calls } = repoWith(added);

    await new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(creatorOnly), 'cp-1', { displayName: 'ชื่อใหม่' });
    await new PromoteSeenAddressUseCase(repo, audit).execute(ctx(creatorOnly), 'cp-1', OLD_ADDRESS);

    assert.equal(calls.updated[0].displayName, 'ชื่อใหม่');
    assert.equal(calls.saved[0].billingAddressJson.addressText, OLD_ADDRESS);
  });

  it('refuses a row someone else added, and a missing one, with the same 403 and writes nothing', async () => {
    const { repo, calls } = repoWith(someoneElses);
    const missing = repoWith();
    const forbidden = (error: unknown) => error instanceof ForbiddenException;

    await assert.rejects(() => new UpdateCounterpartyUseCase(repo, audit, openGate).execute(ctx(creatorOnly), 'cp-1', { displayName: 'ชื่อใหม่' }), forbidden);
    await assert.rejects(() => new PromoteSeenAddressUseCase(repo, audit).execute(ctx(creatorOnly), 'cp-1', OLD_ADDRESS), forbidden);
    await assert.rejects(() => new UpdateCounterpartyUseCase(missing.repo, audit, openGate).execute(ctx(creatorOnly), 'cp-x', { displayName: 'ชื่อใหม่' }), forbidden);
    await assert.rejects(() => new PromoteSeenAddressUseCase(missing.repo, audit).execute(ctx(creatorOnly), 'cp-x', OLD_ADDRESS), forbidden);
    assert.deepEqual(calls.updated, []);
    assert.deepEqual(calls.saved, []);
    // Only a manage holder learns the row does not exist.
    await assert.rejects(
      () => new UpdateCounterpartyUseCase(missing.repo, audit, openGate).execute(ctx(), 'cp-x', { displayName: 'ชื่อใหม่' }),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it('opens the row for whoever added it, without the company-wide usage and purchases', async () => {
    const { repo } = repoWith(added);

    const detail = await new GetCounterpartyUseCase(repo).execute(ctx(creatorOnly), 'cp-1');

    assert.equal(detail.displayName, 'ร้านเดิม');
    assert.equal(detail.canEdit, true);
    assert.equal('usageCounts' in detail, false);
    assert.equal('recentExpenses' in detail, false);
  });

  it('tells the screen who may edit: not a reader who did not add it, always a manage holder', async () => {
    const { repo } = repoWith(someoneElses);

    const reader = await new GetCounterpartyUseCase(repo).execute(ctx(['accounting.counterparty.read']), 'cp-1');
    assert.equal(reader.canEdit, false);
    assert.deepEqual(reader.usageCounts, { bought: 3, sold: 1 });

    const manager = await new GetCounterpartyUseCase(repo).execute(ctx(), 'cp-1');
    assert.equal(manager.canEdit, true);
  });

  it('answers a missing row with 403, not 404, to a caller without read', async () => {
    const { repo } = repoWith();

    await assert.rejects(() => new GetCounterpartyUseCase(repo).execute(ctx(creatorOnly), 'cp-x'), (error: unknown) => error instanceof ForbiddenException);
    await assert.rejects(
      () => new GetCounterpartyUseCase(repo).execute(ctx(['accounting.counterparty.read']), 'cp-x'),
      (error: unknown) => error instanceof NotFoundException,
    );
  });
});

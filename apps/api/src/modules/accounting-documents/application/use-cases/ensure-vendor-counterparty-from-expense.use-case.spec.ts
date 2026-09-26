/**
 * Spec §7 cases a-d and the rules around them. The assertions that matter here are the ones a shop
 * owner would feel: a counterparty per employee (CON-4), an expense save that fails because sales
 * documents are closed (CON-3), a duplicate row beside the one CRM already made (CON-12), a
 * confirm button still blocked on a WHT expense (CON-7), a home address in the audit log (CON-10),
 * and a lost save because the registry hiccuped (§8/AC06).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EnsureVendorCounterpartyFromExpenseUseCase } from './ensure-vendor-counterparty-from-expense.use-case';

const ctx = { companyId: 'co-1', userId: 'u-1', requestId: 'req-1' };
const ADDRESS = '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';
const ADDRESS_ABBREVIATED = '123/4 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';
const OTHER_ADDRESS = '99 หมู่ 2 ตำบลบางโฉลง อำเภอบางพลี จังหวัดสมุทรปราการ 10540';

type Counterparty = Record<string, any>;

/**
 * `saveResults` drives the §11.1/§15 CAS return value one call at a time — `true` (the default once
 * the list runs out) is "won the race", `false` is "lost it, retry". `refetched` counts the re-reads
 * a lost race triggers, so a test can prove the retry actually happened instead of just trusting the
 * outcome.
 */
function harness(rows: Counterparty[] = [], saveResults: boolean[] = []) {
  const audits: any[] = [];
  const created: any[] = [];
  const saved: any[] = [];
  const refetched: string[] = [];
  let searchedFor: any = null;
  let saveCalls = 0;
  const repo = {
    findCounterpartyByVendorKey: async (_companyId: string, key: unknown) => {
      searchedFor = key;
      return rows[0] ?? null;
    },
    findCounterpartyById: async (_companyId: string, id: string) => {
      refetched.push(id);
      return rows[0] ? { ...rows[0], id } : null;
    },
    isCounterpartyReceiptUploader: async (_companyId: string, id: string, userId: string) => rows.some((row) => row.id === id && row.receiptUploaderUserId === userId),
    createCounterparty: async (input: any) => {
      created.push(input);
      return { ...input, id: 'cp-new' };
    },
    saveCounterpartyVendorFields: async (input: any) => {
      saved.push(input);
      const result = saveCalls < saveResults.length ? saveResults[saveCalls] : true;
      saveCalls += 1;
      return result;
    },
  } as any;
  const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
  return { useCase: new EnsureVendorCounterpartyFromExpenseUseCase(repo, audit), audits, created, saved, refetched, key: () => searchedFor };
}

const vendor = {
  expenseId: 'exp-1',
  receiptUploaderUserId: 'u-1',
  captureSource: 'WEB_MANUAL',
  vendorName: 'บริษัท ตัวอย่าง จำกัด',
  vendorTaxId: '0105558123456',
  vendorAddressText: ADDRESS,
};

describe('case a — no counterparty matches the vendor key', () => {
  it('creates a VENDOR row with the printed address and hands the expense the link', async () => {
    const { useCase, created } = harness();

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.case, 'CREATE');
    assert.equal(outcome.linkCounterpartyId, 'cp-new', 'GAP-4: the field no web or LINE path ever filled');
    assert.equal(created[0].type, 'VENDOR', 'A5: born from a purchase');
    assert.equal(created[0].displayName, 'บริษัท ตัวอย่าง จำกัด');
    assert.equal(created[0].billingAddressJson.addressText, ADDRESS);
    assert.equal(created[0].billingAddressJson.provenance.source, 'EXPENSE_AUTO');
    assert.equal(created[0].billingAddressJson.provenance.expenseId, 'exp-1');
    assert.equal(created[0].receiptUploaderUserId, 'u-1');
    assert.equal(outcome.result.canOpenCounterparty, true);
  });

  it('keeps the source receipt uploader when another employee triggers the auto-save', async () => {
    const { useCase, created } = harness();

    await useCase.execute({ ...ctx, userId: 'u-reviewer' }, { ...vendor, receiptUploaderUserId: 'u-1' });

    assert.equal(created[0].createdByUserId, 'u-reviewer');
    assert.equal(created[0].receiptUploaderUserId, 'u-1');
  });

  it('names a branch row so two rows of one shop are told apart (§13)', async () => {
    const { useCase, created } = harness();

    await useCase.execute(ctx, { ...vendor, vendorBranchCode: '00001' });

    assert.equal(created[0].displayName, 'บริษัท ตัวอย่าง จำกัด (สาขา 00001)');
    assert.equal(created[0].branchCode, '00001');
  });

  it('leaves head office unsuffixed, while still storing the code the receipt printed (CON-8)', async () => {
    const { useCase, created } = harness();

    await useCase.execute(ctx, { ...vendor, vendorBranchCode: '00000' });

    assert.equal(created[0].displayName, 'บริษัท ตัวอย่าง จำกัด', '"(สาขา 00000)" would name the thing a bare name already means');
    assert.equal(created[0].branchCode, '00000', 'a typed 00000 is a real answer; only a BLANK field is null (CON-8)');
  });

  it('stores no branch code when the receipt printed none', async () => {
    const { useCase, created } = harness();

    await useCase.execute(ctx, { ...vendor, vendorBranchCode: '' });

    assert.equal(created[0].branchCode, undefined);
  });

  it('creates the row even with no address at all — an expense may be saved before anyone types one', async () => {
    const { useCase, created } = harness();

    const outcome = await useCase.execute(ctx, { ...vendor, vendorAddressText: null });

    assert.equal(outcome.result.case, 'CREATE');
    assert.equal(created[0].billingAddressJson, undefined);
  });
});

describe('case b — the counterparty exists but has no address', () => {
  it('fills the registry from the document and keeps the existing row', async () => {
    const { useCase, saved, created } = harness([{ id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม', billingAddressJson: null }]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.case, 'FILL');
    assert.deepEqual(created, [], 'CON-12: never a second row beside one that already exists');
    assert.equal(saved[0].billingAddressJson.addressText, ADDRESS);
    assert.equal(outcome.linkCounterpartyId, 'cp-1');
  });

  it('returns a scoped open link to the original uploader of an existing row', async () => {
    const row = { id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม', receiptUploaderUserId: 'u-1', billingAddressJson: null };
    const { useCase } = harness([row]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.canOpenCounterparty, true);
  });

  it('matches a row CRM created as CUSTOMER and promotes it to BOTH (CON-12)', async () => {
    const { useCase, saved, created } = harness([{ id: 'cp-1', type: 'CUSTOMER', displayName: 'ลูกค้าที่เราก็ซื้อของด้วย', billingAddressJson: null }]);

    await useCase.execute(ctx, vendor);

    assert.deepEqual(created, []);
    assert.equal(saved[0].promoteToBoth, true);
  });
});

describe('case c — the registry address differs from the one on this document', () => {
  it('makes the document address primary and remembers the old one (A4)', async () => {
    const { useCase, saved } = harness([{
      id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
      billingAddressJson: { addressText: OTHER_ADDRESS, provenance: { source: 'EXPENSE_AUTO', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } },
    }]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.case, 'HISTORY');
    assert.equal(outcome.result.locked, undefined);
    assert.equal(saved[0].billingAddressJson.addressText, ADDRESS, 'the latest reviewed address wins');
    assert.deepEqual(saved[0].billingAddressJson.seenOnDocuments.map((entry: any) => entry.addressText), [OTHER_ADDRESS]);
  });

  it('keeps the primary when the registry is locked, and remembers only the document address', async () => {
    const previousProvenance = { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' };
    const { useCase, saved } = harness([{
      id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
      billingAddressJson: { addressText: OTHER_ADDRESS, locked: true, provenance: previousProvenance },
    }]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.case, 'HISTORY');
    assert.equal(outcome.result.locked, true, 'the review page shows the "…ทะเบียนล็อกไว้" wording instead');
    assert.equal(saved[0].billingAddressJson.addressText, OTHER_ADDRESS);
    assert.equal(saved[0].billingAddressJson.locked, true, 'a rebuild may never quietly unlock what the owner locked');
    assert.deepEqual(saved[0].billingAddressJson.provenance, previousProvenance, 'the primary did not change, so neither did its provenance');
    assert.deepEqual(saved[0].billingAddressJson.seenOnDocuments.map((entry: any) => entry.addressText), [ADDRESS]);
  });
});

describe('§11.1/§15 — another writer changes the matched row mid-save', () => {
  const matchedRow = {
    id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    billingAddressJson: { addressText: OTHER_ADDRESS, provenance: { source: 'EXPENSE_AUTO', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } },
  };

  it('wins after one lost race: re-reads once and the retry write succeeds', async () => {
    const { useCase, saved, refetched } = harness([matchedRow], [false, true]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.case, 'HISTORY');
    assert.equal(saved.length, 2, 'the lost attempt, then the winning retry');
    assert.deepEqual(refetched, ['cp-1'], 'exactly one re-read for the one lost race');
  });

  it('gives up after two retries and reports FAILED without throwing (§8)', async () => {
    const { useCase, saved, refetched } = harness([matchedRow], [false, false, false]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.deepEqual(outcome.result, { case: 'FAILED', failed: true }, 'the ordinary registry-failure outcome, not a thrown error');
    assert.equal(saved.length, 3, '1 initial attempt + 2 retries, never a 3rd retry');
    assert.deepEqual(refetched, ['cp-1', 'cp-1'], 'one re-read per lost race, none after the final loss');
  });
});

describe('case d — the addresses are the same', () => {
  it('writes nothing and only links the expense', async () => {
    const { useCase, saved, audits } = harness([{
      id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
      billingAddressJson: { addressText: ADDRESS, provenance: { source: 'EXPENSE_AUTO', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } },
    }]);

    const outcome = await useCase.execute(ctx, vendor);

    assert.equal(outcome.result.case, 'NOOP');
    assert.deepEqual(saved, []);
    assert.deepEqual(audits, [], 'a save that changed nothing is not an audit event');
    assert.equal(outcome.linkCounterpartyId, 'cp-1');
  });

  it('treats an abbreviated address as the same address, not a new one', async () => {
    const { useCase, saved } = harness([{
      id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
      billingAddressJson: { addressText: ADDRESS, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } },
    }]);

    const outcome = await useCase.execute(ctx, { ...vendor, vendorAddressText: ADDRESS_ABBREVIATED });

    assert.equal(outcome.result.case, 'NOOP', '"ถ.สุขุมวิท" and "ถนนสุขุมวิท" are one address');
    assert.deepEqual(saved, []);
  });

  it('does not re-link an expense that already points somewhere', async () => {
    const { useCase } = harness([{
      id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม',
      billingAddressJson: { addressText: ADDRESS, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } },
    }]);

    const outcome = await useCase.execute(ctx, { ...vendor, vendorCounterpartyId: 'cp-existing' });

    assert.equal(outcome.linkCounterpartyId, undefined);
  });
});

describe('CON-4 — expenses the system generated from a reimbursement', () => {
  it('skips API_INTERNAL entirely, so no counterparty is born per employee', async () => {
    const { useCase, created, saved } = harness();

    const outcome = await useCase.execute(ctx, {
      ...vendor, captureSource: 'API_INTERNAL', vendorName: 'เบิกคืนพนักงาน: สมชาย ใจดี', vendorTaxId: null,
    });

    assert.equal(outcome.result.case, 'SKIPPED');
    assert.deepEqual(created, []);
    assert.deepEqual(saved, []);
  });

  it('skips anything carrying a source reimbursement request, whatever its capture source', async () => {
    const { useCase, created } = harness();

    const outcome = await useCase.execute(ctx, { ...vendor, sourceReimbursementRequestId: 'rr-1' });

    assert.equal(outcome.result.case, 'SKIPPED');
    assert.deepEqual(created, []);
  });

  it('skips a vendor with no name and no tax id rather than collapsing them all into one row', async () => {
    const { useCase, created } = harness();

    const outcome = await useCase.execute(ctx, { ...vendor, vendorName: '   ', vendorTaxId: null });

    assert.equal(outcome.result.case, 'SKIPPED');
    assert.deepEqual(created, []);
  });
});

describe('CON-7 — the taxpayer class moves both ways', () => {
  it('hands the expense the registry value when the expense has none, unblocking a WHT confirm', async () => {
    const { useCase, saved } = harness([{ id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม', entityKind: 'JURISTIC', billingAddressJson: { addressText: ADDRESS, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } } }]);

    const outcome = await useCase.execute(ctx, { ...vendor, vendorEntityKind: null });

    assert.equal(outcome.fillEntityKind, 'JURISTIC');
    assert.deepEqual(saved, [], 'reading the registry is not a reason to write to it');
  });

  it("writes a reviewer's own choice back when the registry has none", async () => {
    const { useCase, saved } = harness([{ id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม', billingAddressJson: { addressText: ADDRESS, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } } }]);

    const outcome = await useCase.execute(ctx, { ...vendor, vendorEntityKind: 'INDIVIDUAL' });

    assert.equal(saved[0].entityKind, 'INDIVIDUAL');
    assert.equal(outcome.fillEntityKind, undefined);
  });

  it('leaves the registry alone when it already agrees', async () => {
    const { useCase, saved } = harness([{ id: 'cp-1', type: 'VENDOR', displayName: 'ร้านเดิม', entityKind: 'JURISTIC', billingAddressJson: { addressText: ADDRESS, provenance: { source: 'MANUAL', userId: 'u-0', at: '2026-01-01T00:00:00.000Z' } } }]);

    await useCase.execute(ctx, { ...vendor, vendorEntityKind: 'JURISTIC' });

    assert.deepEqual(saved, []);
  });
});

describe('the rules that keep this from hurting anything else', () => {
  it('CON-3: no launch gate — it never touches one, so closed sales documents cannot fail an expense save', async () => {
    // The customer-side twin takes `LaunchGateGuardService` as its third constructor argument. This
    // one has two arguments and no gate to inject, which is the structural version of the rule.
    assert.equal(EnsureVendorCounterpartyFromExpenseUseCase.length, 2);
  });

  it('CON-10: the audit carries the source and that something changed, never the address', async () => {
    const { useCase, audits } = harness();

    await useCase.execute(ctx, vendor);

    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'accounting.counterparty.create');
    assert.deepEqual(audits[0].metadataJson, { source: 'expense_auto_link', expenseId: 'exp-1', addressChanged: true });
    assert.equal(JSON.stringify(audits[0]).includes('สุขุมวิท'), false,
      'the audit sanitizer only redacts token/password/body/content — an address it would carry straight through');
  });

  it('§8/AC06: a registry failure is reported, never thrown at the expense', async () => {
    const repo = {
      findCounterpartyByVendorKey: async () => { throw new Error('deadlock detected'); },
    } as any;
    const useCase = new EnsureVendorCounterpartyFromExpenseUseCase(repo, { log: async () => undefined } as any);

    const outcome = await useCase.execute(ctx, vendor);

    assert.deepEqual(outcome.result, { case: 'FAILED', failed: true });
    assert.equal(outcome.linkCounterpartyId, undefined);
  });

  it('CON-8: the match key reads a blank branch code as head office without storing the placeholder', async () => {
    const { useCase, key } = harness();

    await useCase.execute(ctx, { ...vendor, vendorBranchCode: null });

    assert.deepEqual(key(), { kind: 'TAX_ID', taxId: '0105558123456', branchCode: '00000' });
  });

  it('falls back to the exact name when there is no tax id (A2)', async () => {
    const { useCase, key } = harness();

    await useCase.execute(ctx, { ...vendor, vendorTaxId: null });

    assert.equal((key() as any).kind, 'NAME');
  });
});

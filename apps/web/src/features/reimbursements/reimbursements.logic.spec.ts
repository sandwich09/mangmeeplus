import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentReferenceRequired, validatePaymentForm, validateRequestForm, sumLineAmounts, summariseQueue,
  matchesSearch, formatMoney, parseHubTab, visibleHubTabs, reimbursementListScope, errorMessage, errorText,
  isStaleApprovalError, diffApprovalFields, collectReceiptUploadResults, mergeDraftLineEvidence, withAssignedApprovalTab,
  buildClaimTimeline, buildJourneySteps, activeJourneyStep, policyDecisionPreview, isMissingSavedSignatureError,
  approverNotReadyHelp, approverPaymentWarning, hubCardFilter, hubList, hubListStatusText, hubNextPage, NO_HUB_LIST, QUEUE_PAGE_SIZE, withHubPage,
  type HubFilter,
} from './reimbursements.logic';
import { currentDeskText } from './reimbursements.model';
import { REIMBURSEMENT_DESK_LABELS, isReimbursementClaimApprover, reimbursementHubBucket } from '@watchdog-bms/contracts';

const line = (overrides: Record<string, unknown> = {}) => ({
  incurredDate: '2026-01-01', description: 'แท็กซี่', categoryKey: 'travel', amount: '100', hasReceipt: true, ...overrides,
});

describe('paymentReferenceRequired', () => {
  it('requires reference for bank transfer and cheque', () => {
    assert.equal(paymentReferenceRequired('BANK_TRANSFER'), true);
    assert.equal(paymentReferenceRequired('CHEQUE'), true);
    assert.equal(paymentReferenceRequired('CASH'), false);
  });
});

describe('isStaleApprovalError', () => {
  it('detects the raw stale code in API error messages', () => {
    assert.equal(isStaleApprovalError(new Error('stale_approval_snapshot')), true);
    assert.equal(isStaleApprovalError(new Error('other_code,stale_approval_snapshot')), true);
  });

  it('rejects unrelated errors and non-Error values without throwing', () => {
    assert.equal(isStaleApprovalError(new Error('other_code')), false);
    assert.equal(isStaleApprovalError('stale_approval_snapshot'), false);
    assert.equal(isStaleApprovalError(null), false);
    assert.equal(isStaleApprovalError(undefined), false);
  });
});

describe('diffApprovalFields', () => {
  const same = { reason: 'เดินทาง', amount: '123.00', currency: 'THB', categoryLabel: 'เดินทาง', lineCount: 1 };

  it('marks identical inputs as unchanged', () => {
    assert.equal(diffApprovalFields(same, same).every(row => !row.changed), true);
  });

  it('marks only a changed amount with the right before and after values', () => {
    const diff = diffApprovalFields(same, { ...same, amount: '456.00' });
    assert.deepEqual(diff.filter(row => row.changed), [{
      key: 'amount', label: 'จำนวนเงิน', before: '123.00', after: '456.00', changed: true,
    }]);
  });

  it('normalises null, undefined, and empty values to an unchanged dash', () => {
    const diff = diffApprovalFields(
      { reason: null, amount: undefined, currency: '' },
      { reason: undefined, amount: '', currency: null },
    );
    for (const key of ['reason', 'amount', 'currency']) {
      assert.deepEqual(diff.find(row => row.key === key), {
        key,
        label: key === 'reason' ? 'เหตุผล' : key === 'amount' ? 'จำนวนเงิน' : 'สกุลเงิน',
        before: '—',
        after: '—',
        changed: false,
      });
    }
  });

  it('marks a value appearing only after the edit as changed', () => {
    assert.deepEqual(
      diffApprovalFields({}, { categoryLabel: 'อาหาร' }).find(row => row.key === 'categoryLabel'),
      { key: 'categoryLabel', label: 'หมวด', before: '—', after: 'อาหาร', changed: true },
    );
  });
});

describe('validatePaymentForm', () => {
  const ok = { paidAmount: '500', outstandingAmount: '500', paymentMethod: 'CASH' };
  it('accepts full payment', () => {
    assert.equal(validatePaymentForm(ok), null);
  });
  it('rejects partial payment, in the words the API and the user guide use', () => {
    assert.equal(validatePaymentForm({ ...ok, paidAmount: '250' }), 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น');
  });
  it('rejects overpayment', () => {
    assert.ok(validatePaymentForm({ ...ok, paidAmount: '600' }));
  });
  it('requires reference for bank transfer', () => {
    assert.ok(validatePaymentForm({ ...ok, paymentMethod: 'BANK_TRANSFER' }));
    assert.equal(validatePaymentForm({ ...ok, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1', hasSlip: true }), null);
  });
});

describe('validateRequestForm (multi-line claim)', () => {
  it('accepts past/today but identifies a future or malformed row without changing its value', () => {
    const rows = [line({ incurredDate: '2026-08-26' }), line({ incurredDate: '2026-08-27' })];
    assert.equal(validateRequestForm({ reason: 'r', lines: rows }, '2026-08-27'), null);
    rows[1]!.incurredDate = '2026-08-28';
    assert.match(validateRequestForm({ reason: 'r', lines: rows }, '2026-08-27') ?? '', /รายการที่ 2: วันที่รายการเบิกต้องไม่เกินวันนี้/);
    assert.equal(rows[1]!.incurredDate, '2026-08-28');
    rows[1]!.incurredDate = '2026-02-30';
    assert.match(validateRequestForm({ reason: 'r', lines: rows }, '2026-08-27') ?? '', /รายการที่ 2: กรุณาระบุวันที่รายการเบิกให้ถูกต้อง/);
  });
  it('accepts a claim with several complete rows', () => {
    assert.equal(validateRequestForm({ reason: 'r', lines: [line(), line({ amount: '50', description: 'ที่พัก' })] }), null);
  });
  it('requires a reason and at least one row', () => {
    assert.ok(validateRequestForm({ reason: '', lines: [line()] }));
    assert.ok(validateRequestForm({ reason: 'r', lines: [] }));
  });
  it('names the offending row', () => {
    assert.match(validateRequestForm({ reason: 'r', lines: [line(), line({ amount: '0' })] }) ?? '', /รายการที่ 2/);
    assert.match(validateRequestForm({ reason: 'r', lines: [line({ description: '  ' })] }) ?? '', /รายการที่ 1/);
    assert.match(validateRequestForm({ reason: 'r', lines: [line({ incurredDate: '' })] }) ?? '', /รายการที่ 1/);
  });
  it('caps a claim at 50 rows', () => {
    const rows = Array.from({ length: 51 }, () => line());
    assert.match(validateRequestForm({ reason: 'r', lines: rows }) ?? '', /50/);
  });
  // Mirrors the server's `missing_receipt_reason_required`: a receipt-less row becomes an
  // expense at ตรวจสอบการเงิน that only this reason can carry.
  it('requires the missing-receipt reason when a row has no receipt', () => {
    const rows = [line(), line({ hasReceipt: false })];
    assert.match(validateRequestForm({ reason: 'r', lines: rows }) ?? '', /เหตุผลที่ไม่มีใบเสร็จ/);
    assert.equal(validateRequestForm({ reason: 'r', missingReceiptReason: 'ใบเสร็จหาย', lines: rows }), null);
    assert.match(validateRequestForm({ reason: 'r', missingReceiptReason: '   ', lines: rows }) ?? '', /ใบเสร็จ/);
  });
  it('asks for no reason when every row carries a receipt', () => {
    assert.equal(validateRequestForm({ reason: 'r', lines: [line(), line()] }), null);
  });
});

describe('sumLineAmounts', () => {
  it('adds the typed rows and tolerates blanks', () => {
    assert.equal(sumLineAmounts([{ amount: '100.50' }, { amount: '49.5' }]), 150);
    assert.equal(sumLineAmounts([{ amount: '' }, { amount: 'abc' }]), 0);
  });
});

describe('collectReceiptUploadResults', () => {
  it('keeps successful attachment ids and names failed line numbers', () => {
    const failure = new Error('bad image');
    assert.deepEqual(collectReceiptUploadResults([
      { status: 'fulfilled', value: 'att-1' },
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: null },
      { status: 'fulfilled', value: 'att-4' },
    ]), {
      attachmentIds: ['att-1', null, null, 'att-4'],
      failedLineNumbers: [2],
      firstFailure: failure,
    });
  });

  it('reports every failed line while retaining the first failure for copy', () => {
    const first = new Error('first');
    const summary = collectReceiptUploadResults([
      { status: 'rejected', reason: first },
      { status: 'fulfilled', value: 'att-2' },
      { status: 'rejected', reason: new Error('third') },
    ]);
    assert.deepEqual(summary.attachmentIds, [null, 'att-2', null]);
    assert.deepEqual(summary.failedLineNumbers, [1, 3]);
    assert.equal(summary.firstFailure, first);
  });
});

describe('mergeDraftLineEvidence', () => {
  it('retains current evidence when no replacement was uploaded', () => {
    assert.deepEqual(mergeDraftLineEvidence({ attachmentId: 'att-old' }), { attachmentId: 'att-old', linkedExpenseId: null });
    assert.deepEqual(mergeDraftLineEvidence({ linkedExpenseId: 'exp-1' }, null), { attachmentId: null, linkedExpenseId: 'exp-1' });
  });

  it('replaces current receipt or linked expense with the new attachment', () => {
    assert.deepEqual(
      mergeDraftLineEvidence({ attachmentId: 'att-old', linkedExpenseId: 'exp-1' }, 'att-new'),
      { attachmentId: 'att-new', linkedExpenseId: null },
    );
  });
});

describe('summariseQueue', () => {
  it('returns an all-zero summary for an empty queue', () => {
    assert.deepEqual(summariseQueue([]), { count: 0, totalAmount: 0, outstandingAmount: 0, flagged: 0 });
  });

  it('sums queue amounts and counts each flagged row once', () => {
    assert.deepEqual(
      summariseQueue([
        { amount: '100.50', outstandingAmount: 50, slaRisk: true },
        { amount: 200, outstandingAmount: '125.25', hasDuplicateBlocker: true },
        { amount: '30', outstandingAmount: '10', slaRisk: true, hasDuplicateBlocker: true },
      ]),
      { count: 3, totalAmount: 330.5, outstandingAmount: 185.25, flagged: 3 },
    );
  });

  it('treats missing and non-numeric amounts as zero', () => {
    const summary = summariseQueue([{ amount: 'not-a-number' }, { outstandingAmount: undefined }, {}]);
    assert.deepEqual(summary, { count: 3, totalAmount: 0, outstandingAmount: 0, flagged: 0 });
    assert.equal(Number.isNaN(summary.totalAmount), false);
    assert.equal(Number.isNaN(summary.outstandingAmount), false);
  });
});

describe('matchesSearch', () => {
  it('matches empty queries and single terms case-insensitively', () => {
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติ'], ''), true);
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติ'], '   '), true);
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติ'], 'rb-202607'), true);
  });

  it('requires every search term to match', () => {
    assert.equal(matchesSearch(['RB-202607', 'อนุมัติแล้ว'], 'RB-202607 อนุมัติ'), true);
    assert.equal(matchesSearch(['RB-202607', 'รอดำเนินการ'], 'RB-202607 อนุมัติ'), false);
  });

  it('skips empty parts and makes numeric parts searchable', () => {
    assert.equal(matchesSearch([null, 'abc'], 'null'), false);
    assert.equal(matchesSearch([undefined, '', 'abc'], 'undefined'), false);
    assert.equal(matchesSearch([123], '12'), true);
  });
});

describe('parseHubTab', () => {
  it('honours every real tab from a deep link', () => {
    assert.equal(parseHubTab('approvals'), 'approvals');
    assert.equal(parseHubTab('finance'), 'finance');
    assert.equal(parseHubTab('policy'), 'policy');
    assert.equal(parseHubTab('mine'), 'mine');
  });
  it('falls back to the default tab for absent or unknown values', () => {
    assert.equal(parseHubTab(null), 'mine');
    assert.equal(parseHubTab(undefined), 'mine');
    assert.equal(parseHubTab(''), 'mine');
    assert.equal(parseHubTab('Approvals'), 'mine');
    assert.equal(parseHubTab('__proto__'), 'mine');
  });
});

describe('visibleHubTabs', () => {
  it('shows every tab to an owner-grade permission set', () => {
    assert.deepEqual(
      visibleHubTabs(
        ['reimbursement.read_own', 'reimbursement.approve', 'reimbursement.finance_review', 'reimbursement.policy.manage'],
        ['OWNER'],
      ),
      ['mine', 'approvals', 'finance', 'policy'],
    );
  });
  it('shows ตั้งค่านโยบาย to an admin with policy.manage', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], ['ADMIN']), ['policy']);
  });
  it('shows ตั้งค่านโยบาย to any role that holds policy.manage', () => {
    assert.deepEqual(
      visibleHubTabs(
        ['reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.policy.manage'],
        ['FINANCE'],
      ),
      ['mine', 'finance', 'policy'],
    );
  });
  it('does not require a hard-coded role name for policy.manage', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], []), ['policy']);
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage']), ['policy']);
  });
  it('still requires policy.manage from an owner', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_own'], ['OWNER']), ['mine']);
  });
  it('shows the related-record tab with the view-only relation permission', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_related']), ['mine']);
  });
  it('hides ตั้งค่านโยบาย from a manager who only approves', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.read_own', 'reimbursement.approve']), ['mine', 'approvals']);
  });
  it('shows the decision queue to a reject-only custom role', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.reject']), ['approvals']);
  });
  it('requires policy.manage for ตั้งค่านโยบาย — read alone is not enough', () => {
    assert.deepEqual(visibleHubTabs(['reimbursement.policy.manage'], ['OWNER']), ['policy']);
    // FINANCE holds policy.read but not .manage, so it still cannot edit policy.
    assert.deepEqual(
      visibleHubTabs(['reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.policy.read'], ['FINANCE']),
      ['mine', 'finance'],
    );
  });
  it('shows nothing without a hub permission and accepts company-wide read', () => {
    assert.deepEqual(visibleHubTabs([]), []);
    assert.deepEqual(visibleHubTabs(['reimbursement.read', 'expense.read']), ['mine']);
  });
});

describe('withAssignedApprovalTab', () => {
  it('adds the frozen-task queue in the canonical position after server confirmation', () => {
    assert.deepEqual(withAssignedApprovalTab(['mine', 'finance', 'policy'], true), ['mine', 'approvals', 'finance', 'policy']);
    assert.deepEqual(withAssignedApprovalTab([], true), ['approvals']);
  });

  it('does not expose an empty approval queue or duplicate an authorized one', () => {
    assert.deepEqual(withAssignedApprovalTab(['mine'], false), ['mine']);
    assert.deepEqual(withAssignedApprovalTab(['mine', 'approvals'], true), ['mine', 'approvals']);
  });
});

describe('reimbursementListScope', () => {
  it('uses company-wide scope for reimbursement.read', () => {
    assert.equal(reimbursementListScope(['reimbursement.read', 'reimbursement.read_related']), undefined);
  });
  it('uses related before own and falls back to own', () => {
    assert.equal(reimbursementListScope(['reimbursement.read_related', 'reimbursement.read_own']), 'related');
    assert.equal(reimbursementListScope(['reimbursement.read_own']), 'own');
  });
});

describe('parseHubTab against the visible set', () => {
  it('honours a deep link the session can actually open', () => {
    assert.equal(parseHubTab('approvals', ['mine', 'approvals']), 'approvals');
  });
  it('falls back to the first VISIBLE tab, not always mine', () => {
    // A finance-only member deep-linked at ?tab=approvals must land on their own queue.
    assert.equal(parseHubTab('approvals', ['finance']), 'finance');
    assert.equal(parseHubTab(null, ['approvals', 'finance']), 'approvals');
    assert.equal(parseHubTab('policy', ['mine']), 'mine');
  });
  it('degrades to mine when nothing is visible', () => {
    assert.equal(parseHubTab('finance', []), 'mine');
  });
});

// Spec §18.1 (AC38) and the owner's consistency rule 2026-10-01: a card count is the number of rows its filter
// shows, and the chips add up to ทั้งหมด. The API counts and filters by `reimbursementHubBucket` (its own spec
// walks every page of every bucket); this is the rule itself, which lives in contracts.
describe('hub buckets', () => {
  const HUB_BUCKETS = ['draft', 'review', 'payment', 'paid', 'closed'] as const;
  // Each row carries the desk the list API answers with (terminal claims have none).
  const rows = [
    { id: 'draft', status: 'DRAFT', currentDesk: { kind: 'REQUESTER' } },
    { id: 'pending', status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['คุณสมชาย'] } },
    { id: 'finance', status: 'FINANCE_REVIEW', currentDesk: { kind: 'FINANCE' } },
    { id: 'to-finance', status: 'APPROVED', currentDesk: { kind: 'FINANCE' } },
    { id: 'ready', status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' } },
    { id: 'ready-2', status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' } },
    { id: 'to-payment', status: 'APPROVED', currentDesk: { kind: 'PAYMENT' } },
    { id: 'part-paid', status: 'PARTIALLY_PAID', currentDesk: { kind: 'PAYMENT' } },
    { id: 'paid', status: 'PAID' },
    { id: 'rejected', status: 'REJECTED' },
    { id: 'cancelled', status: 'CANCELLED', currentDesk: null },
    { id: 'voided', status: 'VOIDED' },
  ];
  const ids = (bucket: string) => rows.filter((row) => reimbursementHubBucket(row) === bucket).map((row) => row.id);

  it('keeps a claim approved and waiting for payment out of รออนุมัติ/ตรวจสอบ', () => {
    // Before: the card counted every status from PENDING_APPROVAL to READY_FOR_PAYMENT, 7 of these rows.
    assert.deepEqual(ids('review'), ['pending', 'finance', 'to-finance']);
    assert.deepEqual(ids('payment'), ['ready', 'ready-2', 'to-payment', 'part-paid']);
    assert.deepEqual(ids('draft'), ['draft']);
    assert.deepEqual(ids('paid'), ['paid']);
    assert.deepEqual(ids('closed'), ['rejected', 'cancelled', 'voided']);
    assert.equal(reimbursementHubBucket({ status: 'A_STATE_ADDED_LATER' }), 'closed');
    // No claim sits in two buckets, and none in no bucket: the chips add up to ทั้งหมด.
    assert.deepEqual(HUB_BUCKETS.flatMap(ids).sort(), rows.map((row) => row.id).sort());
  });

  // Before: any row without a desk that was not PAID counted under ปฏิเสธ/ยกเลิก, a draft included.
  it('places a claim with no desk, or a desk kind it does not know, by its status', () => {
    const byStatus: Array<[Record<string, unknown>, string]> = [
      [{ status: 'DRAFT' }, 'draft'],
      [{ status: 'PENDING_APPROVAL' }, 'review'],
      [{ status: 'FINANCE_REVIEW' }, 'review'],
      [{ status: 'APPROVED', financeReviewStatus: 'PENDING' }, 'review'],
      [{ status: 'APPROVED', financeReviewStatus: 'NOT_REQUIRED' }, 'payment'],
      [{ status: 'APPROVED' }, 'payment'],
      [{ status: 'READY_FOR_PAYMENT' }, 'payment'],
      [{ status: 'PARTIALLY_PAID' }, 'payment'],
      [{ status: 'PAID' }, 'paid'],
      [{ status: 'REJECTED' }, 'closed'],
      [{ status: 'CANCELLED' }, 'closed'],
      [{ status: 'VOIDED' }, 'closed'],
    ];
    for (const [row, bucket] of byStatus) {
      for (const currentDesk of [undefined, null, {}, { kind: 'A_DESK_ADDED_LATER' }]) {
        assert.equal(reimbursementHubBucket({ ...row, currentDesk }), bucket, `${JSON.stringify(row)} with desk ${JSON.stringify(currentDesk)}`);
      }
    }
    // A known desk still decides: it is what the row prints as "อยู่ที่ …".
    assert.equal(reimbursementHubBucket({ status: 'APPROVED', financeReviewStatus: 'NOT_REQUIRED', currentDesk: { kind: 'FINANCE' } }), 'review');
    // And the status rule agrees with the desk the API resolves for every live status, so the two never split a claim.
    for (const row of rows) {
      assert.equal(reimbursementHubBucket({ status: row.status, financeReviewStatus: row.currentDesk?.kind === 'FINANCE' ? 'PENDING' : 'NOT_REQUIRED' }),
        reimbursementHubBucket(row), row.id);
    }
  });
});

// Review 2026-10-01: with a search the server's counts are of what the search found, and the hub says so.
describe('the line above the hub list', () => {
  it('says what the numbers count, with a search and without one, in plain Thai', () => {
    assert.equal(hubListStatusText(54, 54, 'all', false), 'ทั้งหมด 54 รายการ');
    assert.equal(hubListStatusText(6, 54, 'payment', false), 'พบ 6 จาก 54 รายการ');
    const hint = 'ตัวเลขบนการ์ดและตัวกรองนับเฉพาะรายการที่ตรงกับคำค้น';
    assert.equal(hubListStatusText(12, 12, 'all', true), `พบ 12 รายการที่ตรงกับคำค้น · ${hint}`);
    assert.equal(hubListStatusText(3, 12, 'payment', true), `พบ 3 จาก 12 รายการที่ตรงกับคำค้น · ${hint}`);
    assert.equal(hubListStatusText(0, 0, 'all', true), `พบ 0 รายการที่ตรงกับคำค้น · ${hint}`);
    for (const filter of ['all', 'draft', 'review', 'payment', 'paid', 'closed'] as const) {
      for (const searching of [true, false]) assert.doesNotMatch(hubListStatusText(1, 2, filter, searching), /[A-Za-z]/, `${filter} ${searching}`);
    }
  });
});

describe('hub cards and the lazy list', () => {
  // Review follow-up 2026-10-01: nothing pinned what a second tap on a card does.
  it('opens a card\'s filter on the first tap and returns to ทั้งหมด on a tap of the open card', () => {
    const cards: HubFilter[] = ['draft', 'review', 'payment'];
    for (const card of cards) {
      assert.equal(hubCardFilter('all', card), card);
      assert.equal(hubCardFilter(card, card), 'all', `${card} tapped while open`);
      for (const other of cards.filter((candidate) => candidate !== card)) assert.equal(hubCardFilter(other, card), card, `${other} to ${card}`);
    }
    // ยอดรวมที่ขอเบิก is the ทั้งหมด card: tapping it always lands on ทั้งหมด.
    assert.equal(hubCardFilter('payment', 'all'), 'all');
    assert.equal(hubCardFilter('all', 'all'), 'all');
  });

  it('asks for a first page, then for more only when the table page shown, or a search, reaches past what is held', () => {
    const summary = { counts: { all: 230, draft: 0, review: 0, payment: 230, paid: 0, closed: 0 }, totalAmount: '0.0000', blockedDraftCount: 0 };
    const firstPage = { items: Array.from({ length: 100 }, (_, index) => ({ id: `rb-${index}` })), total: 230, page: 1, pageSize: 100, hub: summary };
    // Nothing held yet: the first page, whatever the screen needs.
    assert.equal(hubNextPage(hubList(NO_HUB_LIST, 'payment'), QUEUE_PAGE_SIZE), 1);
    const held = withHubPage(NO_HUB_LIST, 'payment', firstPage);
    assert.deepEqual([held.rows.length, held.total, held.nextPage, held.summary], [100, 230, 2, summary]);
    // Table pages 1 to 10 are covered by the 100 rows held: no call.
    for (const tablePage of [1, 5, 10]) assert.equal(hubNextPage(held, tablePage * QUEUE_PAGE_SIZE), null, `table page ${tablePage}`);
    // Table page 11 reaches past them: the next server page, and only that one.
    assert.equal(hubNextPage(held, 11 * QUEUE_PAGE_SIZE), 2);
    // A search reads every row of the filter, so it takes the rest.
    assert.equal(hubNextPage(held, Infinity), 2);
    // Another filter is another list: it starts from its own first page, shows none of these rows, and keeps the counts on the cards.
    const other = hubList(held, 'paid');
    assert.deepEqual([other.rows.length, other.nextPage, other.summary], [0, 1, summary]);
    assert.equal(hubNextPage(other, QUEUE_PAGE_SIZE), 1);
  });
});

describe('errorMessage', () => {
  it('translates the API error codes the banners actually surface', () => {
    assert.match(errorMessage('missing_receipt'), /ใบเสร็จ/);
    assert.match(errorMessage('self_approval_denied'), /ตนเอง/);
    // Audit H-18: the refusal has to say the rule is a setting, and name the toggle the way the
    // settings page labels it, or the reader cannot find what to change.
    assert.match(errorMessage('self_approval_denied'), /การตั้งค่า/);
    assert.match(errorMessage('self_approval_denied'), /"อนุญาตให้อนุมัติคำขอตนเอง"/);
    assert.match(errorMessage('claim_form_requires_submitted'), /เลขที่เอกสาร/);
    for (const code of ['stale_approval_snapshot', 'expense_already_claimed', 'attachment_already_claimed',
      'duplicate_unresolved', 'partial_payment_not_allowed', 'missing_receipt_reason_required',
      'finance_approval_already_decided']) {
      assert.notEqual(errorMessage(code), code, `${code} must not reach the user raw`);
    }
  });
  it('translates each code of a comma-joined list', () => {
    const message = errorMessage('lines_required,amount_must_be_positive');
    assert.match(message, /1 รายการ/);
    assert.match(message, /มากกว่า 0/);
    assert.doesNotMatch(message, /lines_required|amount_must_be_positive/);
  });
  it('hides unreviewed API diagnostics behind the shared safe fallback', () => {
    for (const raw of ['brand_new_server_code', 'เกิดข้อผิดพลาด', 'Request failed (500)', '']) {
      assert.equal(errorMessage(raw), 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  });
});

describe('errorText', () => {
  it('answers from the object code when the message is the synthetic API error text', () => {
    const denied = Object.assign(new Error('API error 403'), { status: 403, code: 'feature_not_enabled' });
    assert.equal(errorText(denied), 'ยังไม่ได้เปิดฟีเจอร์นี้');
    const domain = Object.assign(new Error('API error 400'), { status: 400, code: 'missing_receipt' });
    assert.match(errorText(domain), /ใบเสร็จ/);
  });
  it('falls back to message translation and the generic API copy', () => {
    assert.match(errorText(new Error('lines_required')), /1 รายการ/);
    assert.equal(errorText(undefined), 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
  });
});

describe('formatMoney', () => {
  it('formats to 2 decimals', () => {
    assert.equal(formatMoney('500'), '500.00');
    assert.equal(formatMoney('500', 'THB'), '500.00 บาท');
    assert.equal(formatMoney('500', 'USD'), '500.00 USD');
  });
});

describe('buildClaimTimeline', () => {
  const labels = (detail: any) => buildClaimTimeline(detail).map(row => `${row.state}:${row.label}`);

  it('waits on the requester while the claim is still a draft', () => {
    assert.deepEqual(labels({ status: 'DRAFT', currentDesk: { kind: 'REQUESTER' } }), [
      'current:รอผู้ยื่นส่งคำขอ',
      'future:รอบันทึกจ่าย',
    ]);
  });

  it('marks the submitted and approved rows done and highlights the waiting approver', () => {
    const rows = buildClaimTimeline({
      status: 'PENDING_APPROVAL',
      submittedAt: '2026-08-20T03:00:00.000Z',
      currentDesk: { kind: 'APPROVER', names: ['คุณยุนกิ', 'คุณสมชาย'] },
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'APPROVED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-21T03:00:00.000Z' },
        { id: 's2', sequenceNo: 2, status: 'PENDING' },
      ],
    });
    assert.deepEqual(rows.map(r => `${r.state}:${r.label}`), [
      'done:ยื่นใบ',
      'done:อนุมัติโดย คุณสมชาย',
      'current:กำลังรอ คุณยุนกิ หรือ คุณสมชาย อนุมัติ',
      'future:รอบันทึกจ่าย',
    ]);
    assert.equal(rows[0]?.date, '2026-08-20T03:00:00.000Z');
    assert.equal(rows[1]?.date, '2026-08-21T03:00:00.000Z');
  });

  it('skips invalidated approval steps', () => {
    const rows = labels({
      status: 'PENDING_APPROVAL',
      submittedAt: '2026-08-20T03:00:00.000Z',
      currentDesk: { kind: 'APPROVER' },
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'PENDING', invalidatedAt: '2026-08-21T03:00:00.000Z' },
        { id: 's2', sequenceNo: 2, status: 'PENDING' },
      ],
    });
    assert.deepEqual(rows.filter(row => row.startsWith('current')), ['current:กำลังรอ ผู้มีสิทธิ์อนุมัติ อนุมัติ']);
  });

  it('ends the journey at a rejection — no finance or payment row follows', () => {
    assert.deepEqual(labels({
      status: 'REJECTED',
      submittedAt: '2026-08-20T03:00:00.000Z',
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'REJECTED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-21T03:00:00.000Z' }],
    }), ['done:ยื่นใบ', 'done:ปฏิเสธโดย คุณสมชาย']);
  });

  it('ends a cancelled claim on its own terminal row', () => {
    assert.deepEqual(labels({ status: 'CANCELLED', submittedAt: '2026-08-20T03:00:00.000Z' }), ['done:ยื่นใบ', 'done:ยกเลิกคำขอ']);
  });

  it('drops the finance row when the policy path went straight to payment', () => {
    assert.deepEqual(labels({
      status: 'READY_FOR_PAYMENT',
      submittedAt: '2026-08-20T03:00:00.000Z',
      financeReviewStatus: 'NOT_REQUIRED',
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decidedByName: 'คุณสมชาย' }],
    }), ['done:ยื่นใบ', 'done:อนุมัติโดย คุณสมชาย', 'current:กำลังรอผู้มีสิทธิ์บันทึกจ่าย']);
  });

  it('closes both finance and payment rows on a paid claim', () => {
    assert.deepEqual(labels({
      status: 'PAID',
      submittedAt: '2026-08-20T03:00:00.000Z',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT',
      financeReviewedAt: '2026-08-22T03:00:00.000Z',
      financeReviewedByName: 'คุณมานี',
      payments: [{ status: 'RECORDED', paidByName: 'คุณมานี', paidAt: '2026-08-23T03:00:00.000Z' }],
    }), ['done:ยื่นใบ', 'done:ฝ่ายการเงินตรวจแล้ว โดย คุณมานี', 'done:จ่ายแล้ว โดย คุณมานี']);
  });

  // Spec §18.3 (AC39). Before: every claim not yet approved carried "รอฝ่ายการเงินตรวจ", finance step or not.
  it('shows the finance row only on a claim that has a finance-review step', () => {
    assert.deepEqual(labels({ status: 'DRAFT', financeReviewRequired: true }), ['current:รอผู้ยื่นส่งคำขอ', 'future:รอฝ่ายการเงินตรวจ', 'future:รอบันทึกจ่าย']);
    assert.deepEqual(labels({ status: 'DRAFT', financeReviewRequired: false }), ['current:รอผู้ยื่นส่งคำขอ', 'future:รอบันทึกจ่าย']);
    const approved = { submittedAt: '2026-08-20T03:00:00.000Z', approvedAt: '2026-08-21T03:00:00.000Z' };
    // Approved and still being routed on: the row the claim waits at is the journey's own step.
    assert.deepEqual(labels({ ...approved, status: 'APPROVED', financeReviewStatus: 'PENDING' }), ['done:ยื่นใบ', 'current:กำลังรอฝ่ายการเงินตรวจ', 'future:รอบันทึกจ่าย']);
    assert.deepEqual(labels({ ...approved, status: 'APPROVED', financeReviewStatus: 'NOT_REQUIRED' }), ['done:ยื่นใบ', 'current:กำลังรอผู้มีสิทธิ์บันทึกจ่าย']);
    // The detail names who can record the payment; a list row or an action response does not.
    assert.deepEqual(labels({ ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', paymentDesk: { names: ['สมศรี', 'วิชัย'], moreCount: 1 } }),
      ['done:ยื่นใบ', 'current:กำลังรอ สมศรี หรือ วิชัย และอีก 1 คน บันทึกจ่าย']);
    // A claim finance reviewed is paid by whoever holds the pay right, like any other.
    assert.deepEqual(labels({ ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedAt: '2026-08-22T03:00:00.000Z' }),
      ['done:ยื่นใบ', 'done:ฝ่ายการเงินตรวจแล้ว', 'current:กำลังรอผู้มีสิทธิ์บันทึกจ่าย']);
  });
});

// Payout spec §17.2: the claim's journey says who attested the account, and keeps a payment that was taken back.
describe('buildClaimTimeline: the account attestation and voided payments', () => {
  const labels = (detail: any) => buildClaimTimeline(detail).map(row => `${row.state}:${row.label}`);
  const account = { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', source: 'DEFAULT_ACCOUNT', frozenAt: '2026-10-01T02:00:00.000Z' };
  const approved = (overrides: Record<string, unknown> = {}) => ({
    status: 'READY_FOR_PAYMENT', requesterUserId: 'staff', submittedAt: '2026-10-01T02:00:00.000Z', approvedAt: '2026-10-01T03:00:00.000Z', financeReviewStatus: 'NOT_REQUIRED',
    approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: 'สมหญิง', decidedAt: '2026-10-01T03:00:00.000Z' }],
    ...overrides,
  });
  /** The account's history row as the API sends it: `approvalStepId` only when an approval attested it. */
  const attestedBy = (userId: string, step: { approvalStepId?: string } = { approvalStepId: 's1' }) => [{ version: 1, ...account, verifiedByUserId: userId, verifiedAt: '2026-10-01T03:00:00.000Z', ...step }];

  it('says "อนุมัติและตรวจบัญชีรับเงินโดย …" for the approval that attested the account, and nothing more where none did', () => {
    assert.deepEqual(labels(approved({ payoutHistory: attestedBy('boss') })), ['done:ยื่นใบ', 'done:อนุมัติและตรวจบัญชีรับเงินโดย สมหญิง', 'current:กำลังรอผู้มีสิทธิ์บันทึกจ่าย']);
    // A cash or a legacy claim, an action response (it carries no history), an account nobody attested.
    for (const payoutHistory of [undefined, [], [{ version: 1, ...account }]]) {
      assert.deepEqual(labels(approved({ payoutHistory })), ['done:ยื่นใบ', 'done:อนุมัติโดย สมหญิง', 'current:กำลังรอผู้มีสิทธิ์บันทึกจ่าย']);
    }
    // Attested when the payment was recorded, by whoever recorded it: no approval did.
    assert.equal(labels(approved({ payoutHistory: attestedBy('payer', {}) }))[1], 'done:อนุมัติโดย สมหญิง');
    // It is the step the account names, not every approval the claim has had.
    const twoRounds = approved({
      submittedAt: '2026-10-02T02:00:00.000Z',
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: 'สมหญิง', decidedAt: '2026-10-01T03:00:00.000Z' },
        { id: 's2', sequenceNo: 2, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: 'สมหญิง', decidedAt: '2026-10-02T03:00:00.000Z' },
      ],
      payoutHistory: [{ version: 1, ...account }, { version: 2, ...account, accountLast4: '9012', verifiedByUserId: 'boss', verifiedAt: '2026-10-02T03:00:00.000Z', approvalStepId: 's2' }],
    });
    assert.deepEqual(labels(twoRounds).slice(1, 3), ['done:อนุมัติโดย สมหญิง', 'done:อนุมัติและตรวจบัญชีรับเงินโดย สมหญิง']);
  });

  // Spec §10.2: a requester who approves their own claim checked nobody's account but their own. The card says
  // "ผู้เบิกยืนยันบัญชีของตนเอง"; the journey must not call the same act a check.
  it('says the requester confirmed their own account when they approved their own claim', () => {
    const own = approved({ approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'staff', decidedByName: 'สมชาย', decidedAt: '2026-10-01T03:00:00.000Z' }],
      payoutHistory: attestedBy('staff') });
    assert.equal(labels(own)[1], 'done:อนุมัติโดย สมชาย · ผู้เบิกยืนยันบัญชีของตนเอง');
  });

  const transfer = { id: 'p1', paymentNo: 'RBPAY-202610-00001', status: 'RECORDED', paymentMethod: 'BANK_TRANSFER', paidByName: 'สมศรี', paidAt: '2026-10-01T04:00:00.000Z',
    slipCount: 1, payoutDestination: { version: 1, ...account } };
  const voided = { ...transfer, status: 'VOIDED', voidedAt: '2026-10-02T05:00:00.000Z', voidReason: 'บันทึกเลขอ้างอิงผิด' };

  it('keeps a voided payment in the journey with why it was voided, then waits for the payment again', () => {
    const rows = buildClaimTimeline(approved({ payments: [voided], paymentDesk: { names: ['สมศรี'], moreCount: 0 } }));
    assert.deepEqual(rows.map((row) => `${row.state}:${row.label}`), [
      'done:ยื่นใบ', 'done:อนุมัติโดย สมหญิง',
      'done:จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป', 'done:ยกเลิกการจ่ายแล้ว: บันทึกเลขอ้างอิงผิด',
      'current:กำลังรอ สมศรี บันทึกจ่าย',
    ]);
    // Each of the two things that happened has its own date: when it was paid, and when that was taken back.
    assert.deepEqual(rows.slice(2, 4).map((row) => row.date), ['2026-10-01T04:00:00.000Z', '2026-10-02T05:00:00.000Z']);
    // Every row has a key of its own; the row the claim stands on is still the one named `payment`.
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
    assert.equal(rows.find((row) => row.key === 'payment')!.state, 'current');
  });

  it('shows a claim paid again after a void: what was voided, then the payment that stands', () => {
    const again = { ...transfer, id: 'p2', paymentNo: 'RBPAY-202610-00002', paidAt: '2026-10-03T04:00:00.000Z' };
    const cashFirst = { ...voided, paymentMethod: 'CASH', slipCount: 0, payoutDestination: undefined, methodMismatchReason: 'ผู้เบิกมารับเงินสดเอง', voidReason: undefined };
    const rows = buildClaimTimeline(approved({ status: 'PAID', payments: [cashFirst, again] }));
    assert.deepEqual(rows.slice(2).map((row) => `${row.state}:${row.label}`), [
      'done:จ่ายแล้ว โดย สมศรี · เงินสด · จ่ายต่างจากที่ผู้เบิกขอ', 'done:ยกเลิกการจ่ายแล้ว',
      'done:จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป',
    ]);
    assert.equal(rows.at(-1)!.key, 'payment');
    assert.equal(rows.at(-1)!.date, '2026-10-03T04:00:00.000Z');
  });

  it('keeps the voided payment on a claim cancelled afterwards, before the row that ends it', () => {
    assert.deepEqual(labels(approved({ status: 'CANCELLED', payments: [voided] })).slice(2), [
      'done:จ่ายแล้ว โดย สมศรี · โอนเข้าบัญชีลงท้าย 6789 · มีสลิป', 'done:ยกเลิกการจ่ายแล้ว: บันทึกเลขอ้างอิงผิด', 'done:ยกเลิกคำขอ',
    ]);
  });
});

describe('buildClaimTimeline after a reopen', () => {
  it('keeps a refused round as history once the claim was fixed and resubmitted', () => {
    assert.deepEqual(buildClaimTimeline({
      status: 'READY_FOR_PAYMENT',
      submittedAt: '2026-08-25T03:00:00.000Z',
      financeReviewStatus: 'NOT_REQUIRED',
      approvalSteps: [
        { id: 's1', sequenceNo: 1, status: 'REJECTED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-21T03:00:00.000Z' },
        { id: 's2', sequenceNo: 1, status: 'APPROVED', decidedByName: 'คุณสมชาย', decidedAt: '2026-08-26T03:00:00.000Z' },
      ],
    }).map(row => `${row.state}:${row.label}`), [
      'done:ยื่นใบ', 'done:ปฏิเสธโดย คุณสมชาย', 'done:อนุมัติโดย คุณสมชาย', 'current:กำลังรอผู้มีสิทธิ์บันทึกจ่าย',
    ]);
  });
});

// Owner 2026-09-21: a claim nobody can approve is refused, but the refusal says who fixes it and where.
describe('approverNotReadyHelp', () => {
  const notReady = Object.assign(new Error('reimbursement_approver_not_ready'), { status: 400 });

  it('sends a policy manager to the settings to pick an approver', () => {
    const help = approverNotReadyHelp(notReady, ['reimbursement.submit', 'reimbursement.policy.manage']);
    assert.equal(help?.policyLink, true);
    assert.match(help?.text ?? '', /^ยังไม่มีผู้อนุมัติใบเบิกนี้ เลือกบทบาทผู้อนุมัติในตั้งค่าเบิกจ่าย/);
  });

  it('tells anyone else to ask the owner for an approver or approve permission, with no link', () => {
    const help = approverNotReadyHelp(notReady, ['reimbursement.submit']);
    assert.equal(help?.policyLink, false);
    assert.match(help?.text ?? '', /ขอให้เจ้าของกิจการเลือกผู้อนุมัติในตั้งค่าเบิกจ่าย หรือเพิ่มสิทธิ์อนุมัติการเบิกให้บทบาทของคุณ/);
  });

  it('shows people no codes and leaves every other error to the usual message', () => {
    for (const permissions of [[], ['reimbursement.policy.manage']]) {
      assert.doesNotMatch(approverNotReadyHelp(notReady, permissions)?.text ?? '', /[a-z_]{4,}/);
    }
    assert.equal(approverNotReadyHelp(new Error('stale_approval_snapshot'), ['reimbursement.policy.manage']), null);
    assert.equal(approverNotReadyHelp('reimbursement_approver_not_ready', []), null);
    assert.equal(approverNotReadyHelp(null, []), null);
  });
});

describe('isMissingSavedSignatureError', () => {
  it('recognises the saved-signature refusal by code or message only', () => {
    assert.equal(isMissingSavedSignatureError(Object.assign(new Error('API error 422'), { code: 'claim_saved_signature_required' })), true);
    assert.equal(isMissingSavedSignatureError(new Error('claim_saved_signature_required')), true);
    assert.equal(isMissingSavedSignatureError(new Error('stale_claim_snapshot')), false);
    assert.equal(isMissingSavedSignatureError(null), false);
  });
});

describe('buildJourneySteps', () => {
  const OWNER = ['reimbursement.read', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft',
    'reimbursement.cancel_own', 'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
    'reimbursement.payment.record', 'reimbursement.payment.void'];
  const APPROVER = ['reimbursement.read_related', 'reimbursement.approve', 'reimbursement.reject'];
  const STAFF = ['reimbursement.read_own', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.update_own_draft', 'reimbursement.cancel_own'];
  const FINANCE = ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.payment.record'];
  const claim = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1', requestNo: 'RB-1', requesterUserId: 'staff', branchId: 'branch-1', status: 'DRAFT', financeReviewStatus: 'NOT_REQUIRED',
    approvalSteps: [], payments: [], signatures: [], ...overrides,
  });
  const submitted = { submittedAt: '2026-09-20T03:00:00.000Z' };
  const approved = { ...submitted, approvedAt: '2026-09-20T04:00:00.000Z',
    approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedAt: '2026-09-20T04:00:00.000Z' }] };
  const shape = (detail: any, permissions: string[] = [], userId = 'someone') =>
    buildJourneySteps(detail, permissions, userId).map(step => `${step.key}:${step.state}`);
  const active = (detail: any, permissions: string[] = [], userId = 'someone') =>
    activeJourneyStep(buildJourneySteps(detail, permissions, userId))!;

  it('counts 4 steps without finance review and 5 when the claim went through it', () => {
    assert.deepEqual(shape(claim()), ['items:current', 'approval:upcoming', 'payment:upcoming', 'document:upcoming']);
    assert.deepEqual(shape(claim({ ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' })),
      ['items:done', 'approval:done', 'finance:current', 'payment:upcoming', 'document:upcoming']);
    // Decided per claim: a paid claim that finance approved keeps its 5 steps, one that skipped it has 4.
    assert.equal(buildJourneySteps(claim({ ...approved, status: 'PAID', financeReviewStatus: 'APPROVED_FOR_PAYMENT' }), [], 'x').length, 5);
    assert.equal(buildJourneySteps(claim({ ...approved, status: 'PAID' }), [], 'x').length, 4);
    // A finance correction sends the claim back to a draft that will pass finance again.
    assert.equal(buildJourneySteps(claim({ financeReviewStatus: 'NEEDS_INFO' }), [], 'x').length, 5);
  });

  it('counts the finance step from the claim\'s own policy before approval', () => {
    const pending = claim({ ...submitted, status: 'PENDING_APPROVAL' });
    assert.deepEqual(shape({ ...pending, financeReviewRequired: true }),
      ['items:done', 'approval:current', 'finance:upcoming', 'payment:upcoming', 'document:upcoming']);
    assert.equal(buildJourneySteps({ ...pending, financeReviewRequired: false }, [], 'x').length, 4);
    assert.equal(buildJourneySteps(claim({ financeReviewRequired: true }), [], 'x').length, 5, 'a draft follows the current policy');
    // Once approved, the finance state the claim shows decides.
    assert.equal(buildJourneySteps(claim({ ...approved, status: 'READY_FOR_PAYMENT', financeReviewRequired: true }), [], 'x').length, 4);
  });

  it('finishes the document step once the paid claim is signed in the system or on paper (A4, AC17)', () => {
    const paid = claim({ ...approved, requesterUserId: 'owner', status: 'PAID', approvalSteps: [{ ...approved.approvalSteps[0], decisionByUserId: 'owner' }],
      payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'owner', paidAt: '2026-09-20T06:00:00.000Z' }] });
    // Paid, not signed: the document step is where the claim stands, with sign, print and attach.
    const unsigned = active(paid, OWNER, 'owner');
    assert.deepEqual([unsigned.key, unsigned.state, unsigned.actions], ['document', 'current', ['sign', 'print', 'attach-signed-copy', 'void-payment']]);

    const paper = { ...paid, documentSignedVia: 'PAPER', signedCopies: [
      { attachmentId: 'a2', fileName: 'scan.jpg', uploadedAt: '2026-09-21T05:00:00.000Z' },
      { attachmentId: 'a1', fileName: 'signed.pdf', uploadedAt: '2026-09-21T04:00:00.000Z', acknowledgedAt: '2026-09-21T04:00:00.000Z', acknowledgedByName: 'คุณสมชาย' },
    ] };
    assert.deepEqual(shape(paper, OWNER, 'owner'), ['items:done', 'approval:done', 'payment:done', 'document:done']);
    // Every step done: the card stays on the document for a reprint, a newer copy or a void.
    const done = active(paper, OWNER, 'owner');
    assert.deepEqual([done.key, done.state, done.actions], ['document', 'done', ['print', 'attach-signed-copy', 'void-payment']]);
    assert.equal(done.note, 'ลงนามบนกระดาษ · แนบเมื่อ 21 ก.ย. 2569 โดย คุณสมชาย');
    assert.equal(active({ ...paper, documentSignedVia: 'BOTH', signedCopies: [] }, OWNER, 'owner').note, 'ลงนามบนกระดาษ');
    assert.equal(active({ ...paid, documentSignedVia: 'DIGITAL' }, OWNER, 'owner').note, 'ลงนามในระบบครบแล้ว');
  });

  // Spec §18.2 (AC39). Before: "ลงนามในใบเบิก พิมพ์เก็บไว้ หรือแนบสำเนาที่เซ็นแล้ว", which named nobody.
  it('names who has not signed the document, and tells a viewer who can sign to sign', () => {
    const paid = claim({ ...approved, status: 'PAID', requesterDisplayNameSnapshot: 'สมชาย',
      approvalSteps: [{ ...approved.approvalSteps[0], decidedByName: 'สมศรี' }],
      payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'fin', paidByName: 'วราภรณ์', paidAt: '2026-09-20T06:00:00.000Z' }] });
    const waiting = 'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้เบิก (สมชาย) และผู้อนุมัติ (สมศรี)';
    // The payer signs nothing on the two-block form: they read who is awaited.
    const payer = active(paid, FINANCE, 'fin');
    assert.deepEqual([payer.note, payer.actions.includes('sign')], [waiting, false]);
    // The requester and the approver each read the same list, and are told to sign.
    for (const [permissions, userId] of [[STAFF, 'staff'], [APPROVER, 'boss']] as const) {
      const signer = active(paid, [...permissions], userId);
      assert.deepEqual([signer.note, signer.actions[0]], [`${waiting} · คุณยังไม่ได้ลงนาม กดลงนามในใบเบิก`, 'sign']);
    }
    // Once the requester has signed, only the approver is named, and the requester is not asked again.
    const requesterSigned = { ...paid, signatures: [{ role: 'REQUESTER' }] };
    assert.equal(active(requesterSigned, STAFF, 'staff').note, 'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้อนุมัติ (สมศรี)');
    assert.equal(active(requesterSigned, APPROVER, 'boss').note, 'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้อนุมัติ (สมศรี) · คุณยังไม่ได้ลงนาม กดลงนามในใบเบิก');
    // Policy needed no approval: the form waits for the requester alone.
    const auto = claim({ ...submitted, approvedAt: submitted.submittedAt, status: 'PAID', requesterDisplayNameSnapshot: 'สมชาย', payments: paid.payments });
    assert.equal(active(auto, FINANCE, 'fin').note, 'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้เบิก (สมชาย)');
    // A name the detail does not carry leaves the block's own label, never an id.
    assert.equal(active(claim({ ...approved, status: 'PAID', payments: paid.payments }), FINANCE, 'fin').note, 'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้เบิก และผู้อนุมัติ');
    // A claim already signed in the old accounting and payer blocks keeps all four.
    const legacy = { ...paid, claimFormLayout: 'LEGACY_FOUR_SIGNERS', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByName: 'มานี',
      signatures: [{ role: 'REQUESTER' }, { role: 'APPROVER' }] };
    assert.equal(active(legacy, STAFF, 'staff').note, 'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ฝ่ายบัญชี (มานี) และฝ่ายการเงิน (วราภรณ์)');
  });

  // Before: "ยังไม่ลงนาม: ฝ่ายการเงิน (วราภรณ์)" on a claim that never passed a finance desk (spec §18.3).
  it('names the payer of a legacy four-block claim with no finance-review step as ผู้บันทึกจ่าย, never ฝ่ายการเงิน', () => {
    const paid = claim({ ...approved, status: 'PAID', requesterDisplayNameSnapshot: 'สมชาย', claimFormLayout: 'LEGACY_FOUR_SIGNERS',
      approvalSteps: [{ ...approved.approvalSteps[0], decidedByName: 'สมศรี' }], signatures: [{ role: 'REQUESTER' }, { role: 'APPROVER' }],
      payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'fin', paidByName: 'วราภรณ์', paidAt: '2026-09-20T06:00:00.000Z' }] });
    for (const viewer of [[STAFF, 'staff'], [APPROVER, 'boss'], [FINANCE, 'fin'], [OWNER, 'owner']] as const) {
      const note = active(paid, [...viewer[0]], viewer[1]).note ?? '';
      assert.match(note, /^จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้บันทึกจ่าย \(วราภรณ์\)/, viewer[1]);
      assert.doesNotMatch(note, /ฝ่ายการเงิน/, viewer[1]);
    }
    // No payer name in the detail: the same words, without one.
    assert.equal(active({ ...paid, payments: [{ id: 'p1', status: 'RECORDED', paidAt: '2026-09-20T06:00:00.000Z' }] }, STAFF, 'staff').note,
      'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ผู้บันทึกจ่าย');
    // A claim that did pass finance review keeps the form's own block titles.
    assert.equal(active({ ...paid, financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByName: 'มานี' }, STAFF, 'staff').note,
      'จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ฝ่ายบัญชี (มานี) และฝ่ายการเงิน (วราภรณ์)');
  });

  it('leaves a document signed before payment upcoming while the claim waits at payment (§15)', () => {
    const ready = claim({ ...approved, status: 'READY_FOR_PAYMENT', documentSignedVia: 'PAPER' });
    assert.deepEqual(shape(ready, OWNER, 'owner'), ['items:done', 'approval:done', 'payment:current', 'document:upcoming']);
    assert.equal(active(ready, OWNER, 'owner').key, 'payment');
  });

  it('puts the current step where the claim stands for every live status', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ status: 'DRAFT' }, 'items:current'],
      [{ ...submitted, status: 'PENDING_APPROVAL' }, 'approval:current'],
      [{ ...approved, status: 'APPROVED', financeReviewStatus: 'PENDING' }, 'finance:current'],
      [{ ...approved, status: 'APPROVED' }, 'payment:current'],
      [{ ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' }, 'finance:current'],
      [{ ...approved, status: 'READY_FOR_PAYMENT' }, 'payment:current'],
      [{ ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT' }, 'payment:current'],
      [{ ...approved, status: 'PARTIALLY_PAID' }, 'payment:current'],
      [{ ...approved, status: 'PAID' }, 'document:current'],
      [{ ...submitted, status: 'REJECTED' }, 'approval:needs-fix'],
    ];
    for (const [overrides, expected] of cases) {
      const step = active(claim(overrides));
      assert.equal(`${step.key}:${step.state}`, expected, JSON.stringify(overrides));
    }
    // Everything before the current step is done, everything after it upcoming.
    assert.deepEqual(shape(claim({ ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT' })),
      ['items:done', 'approval:done', 'finance:done', 'payment:current', 'document:upcoming']);
  });

  it('marks a refusal as step 2 to fix, with the reason and the reopen for the requester', () => {
    const rejected = claim({ ...submitted, status: 'REJECTED', rejectionReason: 'ยอดไม่ตรงใบเสร็จ',
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'REJECTED', decidedAt: '2026-09-20T05:00:00.000Z' }] });
    assert.deepEqual(shape(rejected, STAFF, 'staff'), ['items:done', 'approval:needs-fix', 'payment:upcoming', 'document:upcoming']);
    const step = active(rejected, STAFF, 'staff');
    assert.equal(step.note, 'ปฏิเสธ: ยอดไม่ตรงใบเสร็จ');
    assert.deepEqual(step.actions, ['reopen', 'print']);
    // Someone else reads the reason but cannot reopen the claim.
    assert.deepEqual(active(rejected, APPROVER, 'boss').actions, ['print']);
  });

  it('ends a cancelled or voided claim at the step where it happened', () => {
    const cancelled = (overrides: Record<string, unknown>) => claim({ status: 'CANCELLED', rejectionReason: 'ซื้อซ้ำ', ...overrides });
    assert.deepEqual(shape(cancelled({ requestNo: undefined })), ['items:ended']);
    assert.deepEqual(shape(cancelled(submitted)), ['items:done', 'approval:ended']);
    assert.deepEqual(shape(cancelled({ ...approved, financeReviewStatus: 'PENDING' })), ['items:done', 'approval:done', 'finance:ended']);
    assert.deepEqual(shape(cancelled(approved)), ['items:done', 'approval:done', 'payment:ended']);
    const step = active(cancelled(submitted), OWNER, 'staff');
    assert.equal(step.note, 'ยกเลิกคำขอแล้ว: ซื้อซ้ำ');
    assert.deepEqual(step.actions, ['print'], 'read-only: only the document can still be printed');
    assert.deepEqual(active(cancelled({ requestNo: undefined }), OWNER, 'staff').actions, []);
    assert.deepEqual(shape(claim({ ...approved, status: 'VOIDED' })), ['items:done', 'approval:done', 'payment:ended']);
    assert.equal(active(claim({ ...approved, status: 'VOIDED' })).note, 'เพิกถอนรายการแล้ว');
  });

  it('shows an auto-approved claim with step 2 passed by policy', () => {
    const auto = claim({ ...submitted, approvedAt: submitted.submittedAt, status: 'READY_FOR_PAYMENT' });
    const approval = buildJourneySteps(auto, [], 'x').find(step => step.key === 'approval')!;
    assert.deepEqual([approval.state, approval.note], ['done', 'ไม่ต้องอนุมัติตามนโยบาย']);
    const human = buildJourneySteps(claim({ ...approved, status: 'READY_FOR_PAYMENT' }), [], 'x').find(step => step.key === 'approval')!;
    assert.equal(human.note, undefined);
    // An approval from before a finance correction does not count for the resubmitted round.
    const resubmittedAuto = claim({ submittedAt: '2026-09-21T03:00:00.000Z', approvedAt: '2026-09-21T03:00:00.000Z', status: 'READY_FOR_PAYMENT',
      approvalSteps: approved.approvalSteps });
    assert.equal(buildJourneySteps(resubmittedAuto, [], 'x').find(step => step.key === 'approval')!.note, 'ไม่ต้องอนุมัติตามนโยบาย');
  });

  // Review 2026-10-01: the page kept its own copy of "this round's approval". It compared the two dates as text and,
  // on a claim with no submission date, counted every approved step. It now asks the contracts rule the API asks.
  it('takes this round\'s approval from the one rule for a claim\'s approver, so the page and the API name the same person', () => {
    const step = approved.approvalSteps[0]!;
    const approvalNote = (detail: any) => buildJourneySteps(detail, [], 'x').find((item) => item.key === 'approval')!.note;
    /** Whether the payment step tells this viewer, who cannot pay, that they are the claim's approver. */
    const toldTheyApproved = (detail: any, userId: string) => /^คุณอนุมัติใบนี้แล้ว/.test(active(detail, APPROVER, userId).note ?? '');
    /** The contracts rule's answer for the same claim detail the page was given. */
    const approverByRule = (userId: string, detail: any) => isReimbursementClaimApprover(userId, detail);

    // No submission date on the claim: nobody is its approver, whatever steps it carries.
    const noRound = claim({ approvedAt: '2026-09-20T04:00:00.000Z', status: 'READY_FOR_PAYMENT', approvalSteps: [step] });
    assert.equal(approverByRule('boss', noRound), false);
    // Before: the old step counted, so the approval read as a person's and 'boss' was told "คุณอนุมัติใบนี้แล้ว".
    assert.equal(approvalNote(noRound), 'ไม่ต้องอนุมัติตามนโยบาย');
    assert.equal(toldTheyApproved(noRound, 'boss'), false);

    // Decided at the very instant the claim was sent, the two dates written differently: the same instant counts.
    const sameInstant = claim({ submittedAt: '2026-09-20T04:00:00Z', approvedAt: '2026-09-20T04:00:00.000Z', status: 'READY_FOR_PAYMENT', approvalSteps: [step] });
    assert.equal(approverByRule('boss', sameInstant), true);
    // Before: "…04:00:00.000Z" sorted below "…04:00:00Z" as text, so the approval was taken for an earlier round's.
    assert.equal(approvalNote(sameInstant), undefined);
    assert.equal(toldTheyApproved(sameInstant, 'boss'), true);

    // On every shape of claim the page says "you approved this" to exactly the person the rule names.
    const resubmitted = claim({ submittedAt: '2026-09-21T03:00:00.000Z', approvedAt: '2026-09-21T03:00:00.000Z', status: 'READY_FOR_PAYMENT', approvalSteps: [step] });
    const withdrawn = claim({ ...approved, status: 'READY_FOR_PAYMENT', approvalSteps: [{ ...step, invalidatedAt: '2026-09-20T05:00:00.000Z' }] });
    const undecided = claim({ ...approved, status: 'READY_FOR_PAYMENT', approvalSteps: [{ ...step, decisionByUserId: undefined }] });
    for (const [name, detail] of Object.entries({ noRound, sameInstant, resubmitted, withdrawn, undecided, thisRound: claim({ ...approved, status: 'READY_FOR_PAYMENT' }) })) {
      for (const userId of ['boss', 'someone-else']) {
        assert.equal(toldTheyApproved(detail, userId), approverByRule(userId, detail), `${name} ${userId}`);
      }
    }
    assert.equal(toldTheyApproved(claim({ ...approved, status: 'READY_FOR_PAYMENT' }), 'boss'), true, 'the plain case is still told');
  });

  it('offers the solo owner submit, approve, then pay on the same page', () => {
    assert.deepEqual(active(claim({ requesterUserId: 'owner', requestNo: undefined }), OWNER, 'owner').actions, ['submit', 'edit', 'cancel']);
    const pending = claim({ ...submitted, requesterUserId: 'owner', status: 'PENDING_APPROVAL',
      approvalActions: { canApprove: true, canReject: true }, currentDesk: { kind: 'APPROVER', names: ['เจ้าของ'] } });
    assert.deepEqual(active(pending, OWNER, 'owner').actions, ['approve', 'reject', 'reopen', 'cancel', 'print']);
    assert.deepEqual(active(claim({ ...approved, requesterUserId: 'owner', status: 'READY_FOR_PAYMENT' }), OWNER, 'owner').actions, ['pay', 'cancel', 'print']);
    // AC03 path when finance review is off: the claim can still be APPROVED while its projection runs.
    assert.deepEqual(active(claim({ ...approved, requesterUserId: 'owner', status: 'APPROVED' }), OWNER, 'owner').actions, ['pay', 'cancel', 'print']);
    const paid = claim({ ...approved, requesterUserId: 'owner', status: 'PAID', approvalSteps: [{ ...approved.approvalSteps[0], decisionByUserId: 'owner' }],
      payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'owner', paidAt: '2026-09-20T06:00:00.000Z' }] });
    assert.deepEqual(active(paid, OWNER, 'owner').actions, ['sign', 'print', 'attach-signed-copy', 'void-payment']);
    // Every role already signed: no sign prompt, printing leads.
    assert.deepEqual(active({ ...paid, signatures: ['REQUESTER', 'APPROVER', 'PAYER'].map(role => ({ role })) }, OWNER, 'owner').actions,
      ['print', 'attach-signed-copy', 'void-payment']);
  });

  it('takes approval buttons from the server-resolved task, not from the permission list', () => {
    const pending = claim({ ...submitted, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['คุณสมชาย'] } });
    const bystander = active({ ...pending, approvalActions: { canApprove: false, canReject: false } }, APPROVER, 'boss');
    assert.deepEqual(bystander.actions, ['print']);
    assert.equal(bystander.note, 'รอ คุณสมชาย อนุมัติ');
    const assignee = active({ ...pending, approvalActions: { canApprove: true, canReject: true } }, [], 'boss');
    assert.deepEqual(assignee.actions, ['approve', 'reject', 'print']);
  });

  it('opens payment to an approver who holds payment.record and says who it waits for otherwise', () => {
    const ready = claim({ ...approved, status: 'READY_FOR_PAYMENT' });
    const withPay = active(ready, [...APPROVER, 'reimbursement.payment.record'], 'boss');
    assert.deepEqual(withPay.actions, ['pay', 'print']);
    // The approver who cannot pay is told so plainly (spec §13.4, AC27); before: "รอผู้มีสิทธิ์บันทึกจ่าย", as for anyone.
    const withoutPay = active(ready, APPROVER, 'boss');
    assert.deepEqual(withoutPay.actions, ['print'], 'no payment form');
    assert.equal(withoutPay.note, 'คุณอนุมัติใบนี้แล้ว แต่บัญชีของคุณยังไม่มีสิทธิ์บันทึกจ่าย ถ้าต้องการจ่ายเอง ขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ');
    assert.match(active({ ...ready, duplicateStatus: 'POSSIBLE_DUPLICATE' }, APPROVER, 'boss').note ?? '', /อาจเป็นรายการซ้ำ/);
    // A legacy partial payment cannot be topped up through this endpoint.
    const partial = active(claim({ ...approved, status: 'PARTIALLY_PAID' }), OWNER, 'owner');
    assert.deepEqual([partial.actions, partial.note], [['print'], 'รอผู้มีสิทธิ์บันทึกจ่าย']);
  });

  // Spec §18.3 (AC27, AC39). Before: everyone who could not pay read "รอผู้มีสิทธิ์บันทึกจ่าย", with no name.
  it('names who can record the payment for a viewer who cannot', () => {
    const ready = claim({ ...approved, status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' } });
    const two = { ...ready, paymentDesk: { names: ['สมศรี', 'วิชัย'], moreCount: 0 } };
    assert.equal(active(two, STAFF, 'staff').note, 'รอ สมศรี หรือ วิชัย บันทึกจ่าย');
    assert.equal(active({ ...ready, paymentDesk: { names: ['สมศรี', 'วิชัย'], moreCount: 3 } }, STAFF, 'staff').note, 'รอ สมศรี หรือ วิชัย และอีก 3 คน บันทึกจ่าย');
    // The approver of this claim, without the pay right: who can pay, and how to pay it themselves.
    assert.equal(active(two, APPROVER, 'boss').note,
      'คุณอนุมัติใบนี้แล้ว แต่บัญชีของคุณยังไม่มีสิทธิ์บันทึกจ่าย ผู้ที่บันทึกจ่ายได้: สมศรี หรือ วิชัย ถ้าต้องการจ่ายเอง ขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ');
    // Someone who holds approve but did not decide this claim is not "คุณอนุมัติใบนี้แล้ว".
    assert.equal(active(two, APPROVER, 'another-approver').note, 'รอ สมศรี หรือ วิชัย บันทึกจ่าย');
    // Nobody covers the claim's branch: say so, to the approver as well.
    const nobody = { ...ready, paymentDesk: { names: [], moreCount: 0 } };
    for (const [permissions, userId] of [[STAFF, 'staff'], [APPROVER, 'boss']] as const) {
      assert.equal(active(nobody, [...permissions], userId).note, 'ยังไม่มีผู้ที่บันทึกจ่ายใบของสาขานี้ได้ ขอให้เจ้าของกิจการบันทึกจ่ายหรือเพิ่มสิทธิ์');
    }
    // Whoever can pay keeps the form and its own instruction, named payers or not.
    const payer = active(two, [...APPROVER, 'reimbursement.payment.record'], 'boss');
    assert.deepEqual([payer.actions, payer.note], [['pay', 'print'], 'บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่าย วันที่ และเลขอ้างอิง']);
  });

  // Phase 0.6 (spec §13.3 F1): the deploy-time back-fill gives a company role that approves the two pay keys, and
  // apps/api/prisma/sync-permissions.spec.ts proves the API then takes that role's payment. The page reads the same
  // keys, so the same person gets the button: before the back-fill neither side lets them pay, after it both do.
  it('offers บันทึกจ่าย and ยกเลิกการจ่าย to an approver role once it holds the pay rights', () => {
    const beforeBackfill = ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.approve', 'reimbursement.reject'];
    const afterBackfill = [...beforeBackfill, 'reimbursement.payment.record', 'reimbursement.payment.void'];
    const ready = claim({ ...approved, status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' }, paymentDesk: { names: ['เจ้าของ'], moreCount: 0 } });
    assert.deepEqual(active(ready, beforeBackfill, 'boss').actions, ['print']);
    assert.deepEqual(active(ready, afterBackfill, 'boss').actions, ['pay', 'print']);
    const paid = claim({ ...approved, status: 'PAID', payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'boss', paidAt: '2026-09-20T06:00:00.000Z' }] });
    assert.equal(active(paid, beforeBackfill, 'boss').actions.includes('void-payment'), false);
    assert.equal(active(paid, afterBackfill, 'boss').actions.includes('void-payment'), true);
  });

  it('gives a staff requester only requester actions at every step (AC12)', () => {
    const requesterOnly = new Set(['submit', 'edit', 'cancel', 'reopen', 'print', 'sign', 'attach-signed-copy']);
    const statuses: Array<Record<string, unknown>> = [
      { status: 'DRAFT', requestNo: undefined },
      { ...submitted, status: 'PENDING_APPROVAL', approvalActions: { canApprove: false, canReject: false } },
      { ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' },
      { ...approved, status: 'READY_FOR_PAYMENT' },
      { ...approved, status: 'PAID', payments: [{ id: 'p1', status: 'RECORDED', paidByUserId: 'fin', paidAt: '2026-09-20T06:00:00.000Z' }] },
    ];
    for (const overrides of statuses) {
      const step = active(claim(overrides), STAFF, 'staff');
      assert.ok(step.actions.every(action => requesterOnly.has(action)), `${overrides.status}: ${step.actions.join(',')}`);
    }
    assert.deepEqual(active(claim({ ...submitted, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER' } }), STAFF, 'staff').actions, ['reopen', 'cancel', 'print']);
    assert.equal(active(claim({ ...approved, status: 'READY_FOR_PAYMENT' }), STAFF, 'staff').note, 'รอผู้มีสิทธิ์บันทึกจ่าย');
    // Somebody else's claim: read only.
    assert.deepEqual(active(claim({ ...submitted, status: 'PENDING_APPROVAL' }), STAFF, 'other').actions, ['print']);
  });

  it('gives finance review its three decisions only while the claim is at that desk', () => {
    const review = claim({ ...approved, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    assert.deepEqual(active(review, FINANCE, 'fin').actions, ['finance-approve', 'finance-return', 'finance-block', 'cancel', 'print']);
    // อนุมัติจ่าย already durable: only "continue" is left.
    assert.deepEqual(active({ ...review, financeReviewStatus: 'APPROVED_FOR_PAYMENT' }, FINANCE, 'fin').actions, ['finance-approve', 'cancel', 'print']);
    const blocked = active({ ...review, financeReviewStatus: 'BLOCKED', financeReviewNote: 'รอใบกำกับฉบับจริง' }, FINANCE, 'fin');
    assert.deepEqual(blocked.actions, ['finance-approve', 'finance-return', 'cancel', 'print']);
    assert.equal(blocked.note, 'ฝ่ายการเงินระงับการจ่าย: รอใบกำกับฉบับจริง');
    // Approved and still being routed to finance: nothing to decide yet.
    assert.deepEqual(active(claim({ ...approved, status: 'APPROVED', financeReviewStatus: 'PENDING' }), FINANCE, 'fin').actions, ['cancel', 'print']);
    assert.deepEqual(active(review, APPROVER, 'boss').actions, ['print']);
  });

  it('leads a finance correction with the edit and carries finance\'s note', () => {
    const corrected = active(claim({ financeReviewStatus: 'NEEDS_INFO', financeReviewNote: 'แนบใบเสร็จตัวจริง' }), STAFF, 'staff');
    assert.deepEqual(corrected.actions, ['edit', 'submit', 'cancel']);
    assert.equal(corrected.note, 'ฝ่ายการเงินขอให้แก้ไข: แนบใบเสร็จตัวจริง');
  });

  it('lets the requester withdraw a claim nobody has decided yet, beside cancel', () => {
    const waiting = claim({ ...submitted, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['คุณสมชาย'] },
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'PENDING' }] });
    const step = active(waiting, STAFF, 'staff');
    assert.deepEqual(step.actions, ['reopen', 'cancel', 'print']);
    assert.equal(step.note, 'รอ คุณสมชาย อนุมัติ');
    // Decided (the claim stays PENDING_APPROVAL while an approval's projection runs): nothing to withdraw.
    // The step as the API answers it: a decided step always names who decided it, which the approver rule reads.
    const decided = { ...waiting, approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedAt: '2026-09-20T04:00:00.000Z' }] };
    assert.deepEqual(active(decided, STAFF, 'staff').actions, ['cancel', 'print']);
    // Only the requester, and only with the draft permission.
    assert.deepEqual(active(waiting, [...STAFF, 'reimbursement.finance_review'], 'fin').actions, ['cancel', 'print']);
    assert.deepEqual(active(waiting, STAFF.filter(key => key !== 'reimbursement.update_own_draft'), 'staff').actions, ['cancel', 'print']);
  });

  it('shows a duplicate block at payment with its reason and lets the payer or a duplicate.resolve holder clear it', () => {
    const blocked = claim({ ...approved, status: 'READY_FOR_PAYMENT', duplicateBlocksPayment: true,
      duplicateCandidates: [
        { id: 'd1', candidateType: 'ATTACHMENT_CHECKSUM', status: 'OPEN', score: 80 },
        { id: 'd2', candidateType: 'EXPENSE_LINK', status: 'DISMISSED', score: 60 },
      ] });
    const resolver = active(blocked, [...OWNER, 'reimbursement.duplicate.resolve'], 'owner');
    assert.deepEqual(resolver.actions, ['resolve-duplicate', 'cancel', 'print'], 'no pay button the API would refuse');
    assert.equal(resolver.note, 'ติดรายการซ้ำ: ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น ตรวจแล้วถ้าไม่ซ้ำ กดปลดรายการซ้ำพร้อมเหตุผล จึงจะบันทึกจ่ายได้');
    // Owner 2026-09-21: only the requester and the approver take part, so the approver who records
    // the payment clears the block too. The requester still sees whose desk it is.
    const payer = active(blocked, [...APPROVER, 'reimbursement.payment.record'], 'boss');
    assert.deepEqual(payer.actions, ['resolve-duplicate', 'print']);
    assert.match(payer.note ?? '', /^ติดรายการซ้ำ: ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น ตรวจแล้วถ้าไม่ซ้ำ/);
    assert.match(active(blocked, STAFF, 'staff').note ?? '', /รอผู้บันทึกจ่ายตรวจรายการซ้ำ/);
    // The no-finance claim still waiting for its projection is blocked the same way.
    assert.deepEqual(active({ ...blocked, status: 'APPROVED' }, [...OWNER, 'reimbursement.duplicate.resolve'], 'owner').actions,
      ['resolve-duplicate', 'cancel', 'print']);
    // Once cleared, the payment form is back.
    assert.deepEqual(active({ ...blocked, duplicateBlocksPayment: false }, [...OWNER, 'reimbursement.duplicate.resolve'], 'owner').actions,
      ['pay', 'cancel', 'print']);
  });

  it('explains a self-approval block to the requester and links the settings only for policy managers', () => {
    const own = claim({ ...submitted, status: 'PENDING_APPROVAL', requesterUserId: 'solo', currentDesk: { kind: 'APPROVER', names: ['เจ้าของ'] },
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'PENDING' }],
      approvalActions: { canApprove: false, canReject: false, selfApprovalBlocked: true } });
    const custom = [...STAFF, 'reimbursement.approve', 'reimbursement.reject'];
    const manager = active(own, [...custom, 'reimbursement.policy.manage'], 'solo');
    assert.deepEqual(manager.actions, ['policy-settings', 'reopen', 'cancel', 'print']);
    assert.match(manager.note ?? '', /^รอ เจ้าของ อนุมัติ · ใบนี้เป็นของคุณเอง/);
    assert.match(manager.note ?? '', /"ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้"/);
    assert.match(manager.note ?? '', /เปิดได้ที่ตั้งค่าเบิกจ่าย แล้วเปิดคำขอกลับเป็นร่างและส่งอนุมัติใหม่$/);
    const member = active(own, custom, 'solo');
    assert.deepEqual(member.actions, ['reopen', 'cancel', 'print']);
    assert.match(member.note ?? '', /ขอให้เจ้าของกิจการเปิดในตั้งค่าเบิกจ่าย/);
    // No server flag, no hint: an ordinary wait reads as before.
    assert.equal(active({ ...own, approvalActions: { canApprove: false, canReject: false } }, custom, 'solo').note, 'รอ เจ้าของ อนุมัติ');
  });
});

// Owner rule 2026-10-01: for one claim state, the "อยู่ที่ …" line, the step note, the timeline row and the LINE
// backlog label name the same party. The three web surfaces are checked here; the backlog builds its labels from
// the same REIMBURSEMENT_DESK_LABELS (reimbursement-approval-backlog.use-case.spec.ts checks that side).
describe('who a claim waits for is the same on every surface', () => {
  const submitted = { submittedAt: '2026-09-20T03:00:00.000Z' };
  const approved = { ...submitted, approvedAt: '2026-09-20T04:00:00.000Z',
    approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'boss', decidedByName: 'สมศรี', decidedAt: '2026-09-20T04:00:00.000Z' }] };
  const claim = (overrides: Record<string, unknown>): any => ({ id: 'r1', requestNo: 'RB-1', requesterUserId: 'staff', branchId: 'branch-1', financeReviewStatus: 'NOT_REQUIRED',
    approvalSteps: [], payments: [], signatures: [], ...overrides });
  /** What a viewer with no part in the claim reads in the three places. */
  const surfaces = (detail: any) => ({
    desk: currentDeskText(detail.currentDesk, detail.paymentDesk)!,
    note: activeJourneyStep(buildJourneySteps(detail, [], 'someone'))!.note!,
    timeline: buildClaimTimeline(detail).find((row) => row.state === 'current')!.label,
  });
  const pending = { ...submitted, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['สมศรี'] },
    approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'PENDING' }] };

  it('names one party for a claim with no finance step, and never ฝ่ายการเงิน', () => {
    const noFinance = { financeReviewRequired: false };
    assert.deepEqual(surfaces(claim({ ...noFinance, ...pending })),
      { desk: 'สมศรี', note: 'รอ สมศรี อนุมัติ', timeline: 'กำลังรอ สมศรี อนุมัติ' });
    // Waiting for payment, as a list row or an action response knows it: the pool, in the backlog's words.
    for (const status of ['READY_FOR_PAYMENT', 'APPROVED']) {
      assert.deepEqual(surfaces(claim({ ...noFinance, ...approved, status, currentDesk: { kind: 'PAYMENT' } })),
        { desk: REIMBURSEMENT_DESK_LABELS.PAYMENT, note: `รอ${REIMBURSEMENT_DESK_LABELS.PAYMENT}`, timeline: `กำลังรอ${REIMBURSEMENT_DESK_LABELS.PAYMENT}` });
    }
    // The claim page knows who: the same names in all three.
    const named = surfaces(claim({ ...noFinance, ...approved, status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' },
      paymentDesk: { names: ['สมศรี', 'วิชัย'], moreCount: 0 } }));
    assert.deepEqual(named, { desk: 'สมศรี หรือ วิชัย', note: 'รอ สมศรี หรือ วิชัย บันทึกจ่าย', timeline: 'กำลังรอ สมศรี หรือ วิชัย บันทึกจ่าย' });
    // AC39: no surface of a claim without a finance step says ฝ่ายการเงิน, at any state.
    for (const state of [{ status: 'DRAFT', currentDesk: { kind: 'REQUESTER' } }, pending,
      { ...approved, status: 'APPROVED', currentDesk: { kind: 'PAYMENT' } }, { ...approved, status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' } },
      { ...approved, status: 'PAID', payments: [{ id: 'p1', status: 'RECORDED', paidByName: 'วิชัย', paidAt: '2026-09-20T06:00:00.000Z' }] }]) {
      const detail = claim({ ...noFinance, ...state });
      const texts = [currentDeskText(detail.currentDesk), ...buildJourneySteps(detail, [], 'someone').map((step) => `${step.label} ${step.note ?? ''}`),
        ...buildClaimTimeline(detail).map((row) => row.label)].join(' | ');
      assert.doesNotMatch(texts, /การเงิน/u, String(state.status));
    }
  });

  // Owner rule 2026-10-01: the API names whoever's turn it is first, then one more person, then a count. The page
  // prints that list as it came, through one function, so its three places cannot name or order people differently.
  it('names the same people in the same order in the header, the step note and the timeline', () => {
    const waiting = (paymentDesk: object) => claim({ financeReviewRequired: false, ...approved, status: 'READY_FOR_PAYMENT', currentDesk: { kind: 'PAYMENT' }, paymentDesk });
    assert.deepEqual(surfaces(waiting({ names: ['สมศรี', 'กมล'], moreCount: 3 })),
      { desk: 'สมศรี หรือ กมล และอีก 3 คน', note: 'รอ สมศรี หรือ กมล และอีก 3 คน บันทึกจ่าย', timeline: 'กำลังรอ สมศรี หรือ กมล และอีก 3 คน บันทึกจ่าย' });
    // The order is the API's own: nothing on the page sorts the names again.
    assert.deepEqual(surfaces(waiting({ names: ['กมล', 'สมศรี'], moreCount: 3 })),
      { desk: 'กมล หรือ สมศรี และอีก 3 คน', note: 'รอ กมล หรือ สมศรี และอีก 3 คน บันทึกจ่าย', timeline: 'กำลังรอ กมล หรือ สมศรี และอีก 3 คน บันทึกจ่าย' });
    assert.deepEqual(surfaces(waiting({ names: ['สมศรี'], moreCount: 0 })), { desk: 'สมศรี', note: 'รอ สมศรี บันทึกจ่าย', timeline: 'กำลังรอ สมศรี บันทึกจ่าย' });
    // The approver who cannot pay is told the same list, in the same words (spec §13.4).
    const detail = waiting({ names: ['กมล', 'วิชัย'], moreCount: 2 });
    const toldApprover = activeJourneyStep(buildJourneySteps(detail, ['reimbursement.approve'], 'boss'))!.note!;
    assert.ok(toldApprover.includes(`ผู้ที่บันทึกจ่ายได้: ${currentDeskText(detail.currentDesk, detail.paymentDesk)} `), toldApprover);
    // Whoever is offered the payment reads what to do, not who to wait for; the header and the timeline still say who.
    const forPayer = activeJourneyStep(buildJourneySteps(detail, ['reimbursement.payment.record'], 'payer'))!;
    assert.deepEqual([forPayer.actions.includes('pay'), forPayer.note], [true, 'บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่าย วันที่ และเลขอ้างอิง']);
  });

  it('names the finance desk while finance reviews, then the same payment desk', () => {
    const withFinance = { financeReviewRequired: true };
    assert.deepEqual(surfaces(claim({ ...withFinance, ...pending })),
      { desk: 'สมศรี', note: 'รอ สมศรี อนุมัติ', timeline: 'กำลังรอ สมศรี อนุมัติ' });
    // Under review, or approved and still being handed to finance: the same desk the backlog calls "ฝ่ายการเงิน (รอตรวจสอบ)".
    for (const status of ['FINANCE_REVIEW', 'APPROVED']) {
      const reviewing = surfaces(claim({ ...withFinance, ...approved, status, financeReviewStatus: 'PENDING', currentDesk: { kind: 'FINANCE' } }));
      assert.deepEqual(reviewing, { desk: REIMBURSEMENT_DESK_LABELS.FINANCE, note: `รอ${REIMBURSEMENT_DESK_LABELS.FINANCE}ตรวจ`, timeline: `กำลังรอ${REIMBURSEMENT_DESK_LABELS.FINANCE}ตรวจ` });
    }
    // Reviewed: whoever holds the pay right, exactly as on a claim that skipped finance.
    const reviewed = { ...withFinance, ...approved, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'APPROVED_FOR_PAYMENT',
      financeReviewedAt: '2026-09-20T05:00:00.000Z', currentDesk: { kind: 'PAYMENT' } };
    assert.deepEqual(surfaces(claim(reviewed)),
      { desk: REIMBURSEMENT_DESK_LABELS.PAYMENT, note: `รอ${REIMBURSEMENT_DESK_LABELS.PAYMENT}`, timeline: `กำลังรอ${REIMBURSEMENT_DESK_LABELS.PAYMENT}` });
    assert.deepEqual(surfaces(claim({ ...reviewed, paymentDesk: { names: ['วราภรณ์'], moreCount: 0 } })),
      { desk: 'วราภรณ์', note: 'รอ วราภรณ์ บันทึกจ่าย', timeline: 'กำลังรอ วราภรณ์ บันทึกจ่าย' });
  });
});

// Spec §13.3 F2 (Phase 0.7): the policy screen warns, and never blocks, when a chosen approver role cannot pay.
describe('approverPaymentWarning', () => {
  const manager = { label: 'ผู้จัดการ', selectable: true, canRecordPayment: true };
  const checker = { label: 'ผู้ตรวจ', selectable: true, canRecordPayment: false };

  it('names the chosen roles that approve but cannot record payment while finance review is off', () => {
    assert.equal(approverPaymentWarning([manager, checker], false),
      'บทบาท ผู้ตรวจ อนุมัติได้ แต่บันทึกจ่ายไม่ได้ ใบที่อนุมัติแล้วจะรอผู้ที่มีสิทธิ์บันทึกจ่าย ถ้าต้องการให้ผู้อนุมัติจ่ายเองได้ ให้เพิ่มสิทธิ์บันทึกจ่ายให้บทบาทนี้ในหน้าบทบาทและสิทธิ์');
    assert.match(approverPaymentWarning([checker, { label: 'หัวหน้าสาขา', selectable: true, canRecordPayment: false }], false) ?? '', /^บทบาท ผู้ตรวจ และ หัวหน้าสาขา อนุมัติได้ แต่บันทึกจ่ายไม่ได้/);
  });

  it('says nothing when every chosen role can pay, when finance review pays, or when the answer is unknown', () => {
    assert.equal(approverPaymentWarning([manager], false), null);
    assert.equal(approverPaymentWarning([], false), null);
    // A company with a finance desk may split the two duties on purpose.
    assert.equal(approverPaymentWarning([checker], true), null);
    // An older API response without the field must not raise a false alarm.
    assert.equal(approverPaymentWarning([{ label: 'ผู้ตรวจ', selectable: true }], false), null);
  });

  // Before: a ticked role that had lost its approve right or its last member was still said to "อนุมัติได้".
  it('never says อนุมัติได้ of a chosen role that can no longer approve', () => {
    const notReady = { label: 'หัวหน้าสาขา', selectable: false, canRecordPayment: false };
    assert.equal(approverPaymentWarning([notReady], false), null);
    assert.equal(approverPaymentWarning([manager, notReady], false), null);
    assert.match(approverPaymentWarning([checker, notReady], false) ?? '', /^บทบาท ผู้ตรวจ อนุมัติได้ แต่บันทึกจ่ายไม่ได้/);
  });
});

describe('policyDecisionPreview', () => {
  it('reads the approver line with the owner fallback and goes straight to payment when finance review is off', () => {
    assert.deepEqual(policyDecisionPreview({ approvalRequiredFromAmount: '1', approverLabel: 'ผู้จัดการ', ownerRoute: false, financeReviewRequired: false }), [
      { title: 'ยอดตั้งแต่ 1.00 บาท', path: 'ผู้จัดการ (ถ้าไม่มี เจ้าของกิจการ) → จ่ายเงินคืน' },
      { title: 'ยอดต่ำกว่า 1.00 บาท', path: 'ไม่ต้องรอผู้อนุมัติ → จ่ายเงินคืน' },
    ]);
  });

  it('adds finance review to both paths when the switch is on', () => {
    const [from, below] = policyDecisionPreview({ approvalRequiredFromAmount: '500', approverLabel: 'ผู้จัดการ', ownerRoute: false, financeReviewRequired: true });
    assert.equal(from?.path, 'ผู้จัดการ (ถ้าไม่มี เจ้าของกิจการ) → ฝ่ายการเงินตรวจ → จ่ายเงินคืน');
    assert.equal(below?.path, 'ไม่ต้องรอผู้อนุมัติ → ฝ่ายการเงินตรวจ → จ่ายเงินคืน');
  });

  it('drops the fallback on the owner route and names a missing role generically', () => {
    assert.equal(policyDecisionPreview({ approvalRequiredFromAmount: '1', approverLabel: 'เจ้าของกิจการ', ownerRoute: true, financeReviewRequired: false })[0]?.path,
      'เจ้าของกิจการ → จ่ายเงินคืน');
    assert.equal(policyDecisionPreview({ approvalRequiredFromAmount: '1', approverLabel: '', ownerRoute: false, financeReviewRequired: false })[0]?.path,
      'บทบาทที่เลือก (ถ้าไม่มี เจ้าของกิจการ) → จ่ายเงินคืน');
  });
});

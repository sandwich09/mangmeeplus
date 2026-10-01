import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReimbursementGuide } from './reimbursement-guide.content';
import { buildSubstituteReceiptGuide } from './substitute-receipt-guide.content';
import { buildExpensesGuide } from './expenses-guide.content';
import { buildTaxGuide } from './tax-guide.content';
import { buildReportsGuide } from './reports-guide.content';
import type { UserGuide } from './user-guide.model';

/** Every shortcut a reader is offered, parent action included. */
function links(guide: UserGuide): string[] {
  return [
    ...(guide.primaryLink ? [guide.primaryLink.href] : []),
    ...guide.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === 'items'
        ? block.items.flatMap((item) => (item.link ? [item.link.href] : []))
        : []))),
  ];
}

const OWNER = [
  'reimbursement.read_own', 'reimbursement.create', 'reimbursement.approve',
  'reimbursement.finance_review', 'reimbursement.policy.manage',
  'expense.read', 'expense.review', 'expense.confirm', 'company.setup.manage',
  'expense.receipt.upload', 'expense.create', 'expense.category.manage', 'expense.evidence.read',
  'tax.period.read', 'report.catalog.read',
];

describe('user guide shortcuts', () => {
  it('sends each role shortcut to the tab that role actually works in', () => {
    const guide = buildReimbursementGuide('co', OWNER, ['OWNER']);
    const hrefs = links(guide);

    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=mine'));
    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=approvals'));
    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=finance'));
    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=policy'));
  });

  // The staff account is the one that used to be offered ตั้งค่านโยบาย and land on คำขอของฉัน.
  it('offers a staff reader only the tab their session can open', () => {
    const guide = buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']);
    const hrefs = links(guide);

    assert.deepEqual(hrefs, [
      '/companies/co/reimbursements',
      '/companies/co/reimbursements?tab=mine',
      '/companies/co/reimbursements/new',
      // Whoever can file a claim sets where it is paid back (the page asks for the same right).
      '/companies/co/reimbursements/payout-account',
    ]);
    assert.ok(!hrefs.some((href) => href.includes('tab=policy')));
  });

  // Role names are descriptive only: a custom role with the exact permission must receive the
  // same guide shortcut as OWNER/ADMIN, matching the real hub and API guard.
  it('offers the policy tab to any role that holds policy.manage', () => {
    const guide = buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.policy.manage'], ['FINANCE']);
    assert.ok(links(guide).some((href) => href.includes('tab=policy')));
  });

  it('drops every shortcut when the session holds no reimbursement permission', () => {
    const guide = buildReimbursementGuide('co', [], []);
    assert.deepEqual(links(guide), []);
    // The manual itself still renders in full — only the buttons go away.
    assert.equal(guide.sections.length, 21);
  });

  it('gates the substitute-receipt shortcuts on the same keys as the sidebar', () => {
    const owner = links(buildSubstituteReceiptGuide('co', OWNER));
    assert.ok(owner.includes('/companies/co/expenses/substitute-receipts'));
    assert.ok(owner.includes('/companies/co/expenses'));
    assert.ok(owner.includes('/companies/co/settings/substitute-receipt'));

    const reader = links(buildSubstituteReceiptGuide('co', ['expense.read_own']));
    assert.ok(!reader.some((href) => href.includes('/settings/substitute-receipt')));
    assert.equal(buildSubstituteReceiptGuide('co', []).sections.length, 12);
  });

  it('gates the expenses shortcuts on the same keys as the expenses submenu', () => {
    const owner = links(buildExpensesGuide('co', OWNER));
    assert.ok(owner.includes('/companies/co/expenses/upload'));
    assert.ok(owner.includes('/companies/co/expenses/manual'));
    assert.ok(owner.includes('/companies/co/expenses/categories'));
    assert.ok(owner.includes('/companies/co/expenses/evidence'));

    // A staff reader sees the manual in full but is only offered the list they can open.
    const staff = links(buildExpensesGuide('co', ['expense.read_own']));
    assert.deepEqual([...new Set(staff)], ['/companies/co/expenses']);
    assert.equal(buildExpensesGuide('co', []).sections.length, 10);
  });

  it('drops the tax and reports shortcuts for a session without those permissions', () => {
    assert.ok(links(buildTaxGuide('co', OWNER)).includes('/companies/co/tax'));
    assert.deepEqual(links(buildTaxGuide('co', [])), []);
    assert.equal(buildTaxGuide('co', []).sections.length, 6);

    assert.ok(links(buildReportsGuide('co', OWNER)).includes('/companies/co/reports'));
    assert.deepEqual(links(buildReportsGuide('co', [])), []);
    assert.equal(buildReportsGuide('co', []).sections.length, 6);
  });
});

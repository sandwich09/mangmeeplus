import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periodCloseCheckCopy } from './ledger.logic.js';

describe('period close check presentation', () => {
  it('maps every stable check key to actionable Thai copy', () => {
    for (const checkKey of [
      'no_draft_journals',
      'trial_balance_balanced',
      'source_postings_complete',
      'no_source_posting_errors',
      'chart_conflict_remediation_clear',
      'chart_semantics_valid',
      'suspense_balance_zero',
      'tax_account_mapping_valid',
      'transaction_tax_reconciliation_clear',
      'reimbursement_postings_complete',
    ]) {
      const copy = periodCloseCheckCopy({ checkKey, status: 'FAILED', count: 2, amount: '10.00' });
      assert.notEqual(copy.label, 'การตรวจสอบก่อนปิดงวด', checkKey);
      assert.equal(copy.statusLabel, 'ไม่ผ่าน', checkKey);
      assert.match(copy.message, /กรุณา/, checkKey);
    }
  });

  it('never renders an unknown check message from the server', () => {
    assert.deepEqual(
      periodCloseCheckCopy({ checkKey: 'database_secret_check', status: 'FAILED' }),
      {
        label: 'การตรวจสอบก่อนปิดงวด',
        statusLabel: 'ไม่ผ่าน',
        message: 'รายการนี้ยังไม่พร้อมสำหรับการปิดงวด กรุณาติดต่อผู้ดูแลระบบ',
      },
    );
  });

  it('uses reviewed passed copy instead of the response message', () => {
    assert.deepEqual(periodCloseCheckCopy({ checkKey: 'source_postings_complete', status: 'PASSED' }), {
      label: 'การลงบัญชีเอกสารต้นทาง',
      statusLabel: 'ผ่าน',
      message: 'เอกสารที่เสร็จสิ้นลงบัญชีครบแล้ว',
    });
  });
});

// A refused close has to say WHAT is pending and how to get there. For claim money that is up to
// three different things on two different screens, so one "N รายการ" total is not an answer.
describe('claim money on the period close check', () => {
  const failed = (breakdown?: Record<string, number>) => periodCloseCheckCopy({
    checkKey: 'reimbursement_postings_complete', status: 'FAILED',
    count: breakdown ? Object.values(breakdown).reduce((sum, part) => sum + part, 0) : 4,
    ...(breakdown ? { breakdown } : {}),
  });

  it('names an unposted claim payout and links to the screen that posts it', () => {
    assert.deepEqual(failed({ unconfirmedClaimExpenses: 0, pendingPayments: 2, paymentErrors: 0 }), {
      label: 'การลงบัญชีใบเบิก',
      statusLabel: 'ไม่ผ่าน',
      message: 'พบการจ่ายเงินคืนใบเบิกที่ยังไม่ลงบัญชี 2 รายการ กรุณาดำเนินการก่อนปิดงวด',
      links: [{ label: 'เปิดรายการจ่ายเงินคืนที่ยังไม่ลงบัญชี', path: '/expenses/evidence' }],
    });
  });

  it('names every kind that is pending, each with its own count, and one link per screen', () => {
    const copy = failed({ unconfirmedClaimExpenses: 1, pendingPayments: 2, paymentErrors: 3 });
    assert.equal(
      copy.message,
      'พบค่าใช้จ่ายจากใบเบิกที่ยังไม่ยืนยัน 1 รายการ · การจ่ายเงินคืนใบเบิกที่ยังไม่ลงบัญชี 2 รายการ · การจ่ายเงินคืนใบเบิกที่ลงบัญชีไม่สำเร็จ 3 รายการ กรุณาดำเนินการก่อนปิดงวด',
    );
    // Waiting and failed payouts are fixed on the same screen: it is offered once, not twice.
    assert.deepEqual(copy.links, [
      { label: 'เปิดค่าใช้จ่ายที่รอตรวจ', path: '/expenses?view=pending' },
      { label: 'เปิดรายการจ่ายเงินคืนที่ยังไม่ลงบัญชี', path: '/expenses/evidence' },
    ]);
    assert.doesNotMatch(copy.message, /[A-Za-z_]/, 'plain Thai: no key or code in the sentence');
  });

  it('leaves out the kinds with nothing pending', () => {
    const copy = failed({ unconfirmedClaimExpenses: 0, pendingPayments: 0, paymentErrors: 1 });
    assert.equal(copy.message, 'พบการจ่ายเงินคืนใบเบิกที่ลงบัญชีไม่สำเร็จ 1 รายการ กรุณาดำเนินการก่อนปิดงวด');
    assert.deepEqual(copy.links, [{ label: 'เปิดรายการจ่ายเงินคืนที่ยังไม่ลงบัญชี', path: '/expenses/evidence' }]);
  });

  it('still explains and still offers both ways when a response carries only the total', () => {
    const copy = failed();
    assert.equal(copy.message, 'พบรายการจากใบเบิกที่ยังลงบัญชีไม่ครบ 4 รายการ กรุณาดำเนินการก่อนปิดงวด');
    assert.deepEqual(copy.links?.map((link) => link.path), ['/expenses?view=pending', '/expenses/evidence']);
  });

  it('offers no link once the check has passed, or on any other check', () => {
    assert.equal('links' in periodCloseCheckCopy({ checkKey: 'reimbursement_postings_complete', status: 'PASSED', count: 0 }), false);
    assert.equal('links' in periodCloseCheckCopy({ checkKey: 'source_postings_complete', status: 'FAILED', count: 2 }), false);
  });

  it('the page renders the links under the check, as tap targets, to this company', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(new URL('./LedgerReportsPage.tsx', import.meta.url), 'utf8');
    assert.match(page, /links\?\.map\(\(link\) => \(\s*<a key=\{link\.path\} className="flex min-h-11 items-center[^"]*" href=\{`\/companies\/\$\{companyId\}\$\{link\.path\}`\}>\{link\.label\} →<\/a>/);
  });
});

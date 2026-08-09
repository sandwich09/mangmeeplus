import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountsPayableTab, visibleAccountsPayableTabs, whtLinkErrorOutcome } from './accounts-payable.logic';

describe('visibleAccountsPayableTabs', () => {
  it('keeps the page order for every readable AP panel', () => {
    assert.deepEqual(
      visibleAccountsPayableTabs([
        'procurement.ap.report',
        'procurement.supplier_payment.read',
        'procurement.vendor_bill.read',
        'wht.certificate.read',
      ]),
      ['bills', 'payments', 'wht', 'aging'],
    );
  });

  it('shows only panels whose primary endpoint the session can read', () => {
    assert.deepEqual(visibleAccountsPayableTabs(['procurement.vendor_bill.read']), ['bills']);
    assert.deepEqual(visibleAccountsPayableTabs(['procurement.supplier_payment.read']), ['payments']);
    assert.deepEqual(visibleAccountsPayableTabs(['procurement.ap.report']), ['aging']);
    assert.deepEqual(visibleAccountsPayableTabs(['procurement.supplier_payment.create']), []);
    assert.deepEqual(visibleAccountsPayableTabs([]), []);
  });

  it('shows related AP documents without widening aging or WHT access', () => {
    assert.deepEqual(visibleAccountsPayableTabs([
      'procurement.vendor_bill.read_related',
      'procurement.supplier_payment.read_related',
    ]), ['bills', 'payments']);
  });

  // H4: the 50 ทวิ handoff panel is the fallback for a company the system cannot issue a
  // certificate for. Gating it on a Tax permission would make it invisible to exactly the
  // companies that need it.
  it('opens the 50 ทวิ handoff panel on its own key, never a thai_tax one', () => {
    assert.deepEqual(visibleAccountsPayableTabs(['wht.certificate.read']), ['wht']);
    assert.deepEqual(visibleAccountsPayableTabs(['tax.certificate.read', 'tax.certificate.issue']), []);
  });
});

describe('parseAccountsPayableTab', () => {
  it('honours a visible deep link', () => {
    assert.equal(parseAccountsPayableTab('aging', ['payments', 'aging']), 'aging');
  });

  it('falls back to the first visible panel for hidden or unknown values', () => {
    assert.equal(parseAccountsPayableTab('bills', ['payments', 'aging']), 'payments');
    assert.equal(parseAccountsPayableTab('__unknown__', ['aging']), 'aging');
    assert.equal(parseAccountsPayableTab(null, ['payments']), 'payments');
  });

  it('keeps a typed fallback when no panel is visible', () => {
    assert.equal(parseAccountsPayableTab('aging', []), 'bills');
  });
});

describe('whtLinkErrorOutcome', () => {
  /**
   * The EXACT shape `authedApiFetch` throws (authed-fetch.ts): an Error with `status`, `details`
   * and an optional `code`. Earlier fixtures invented a `statusCode` field that this client never
   * sets, so every status-based branch below passed its test while being dead in the real app.
   */
  const authedApiFetchError = (status: number, body: { code?: string; message?: string } = {}) =>
    Object.assign(new Error(body.message ?? `API error ${status}`), {
      status,
      details: body,
      ...(body.code ? { code: body.code } : {}),
    });

  it('refreshes the list whenever the server says the screen is stale', () => {
    for (const code of ['wht_handoff_already_linked', 'wht_handoff_link_command_reused', 'wht_handoff_not_linkable']) {
      const outcome = whtLinkErrorOutcome(authedApiFetchError(409, { code }));
      assert.equal(outcome.reload, true, `${code} must refetch`);
      assert.ok(outcome.message.length > 0);
    }
    assert.equal(whtLinkErrorOutcome(authedApiFetchError(404)).reload, true);
  });

  it('gives a field-level hint for validation rejections without refetching', () => {
    const outcome = whtLinkErrorOutcome(authedApiFetchError(400, { message: 'Validation failed.' }));
    assert.equal(outcome.reload, false);
    assert.match(outcome.message, /เลขที่หนังสือรับรอง/);
    assert.notEqual(outcome.message, 'Validation failed.');
  });

  it('distinguishes already-linked from a permission failure', () => {
    assert.notEqual(
      whtLinkErrorOutcome(authedApiFetchError(409, { code: 'wht_handoff_already_linked' })).message,
      whtLinkErrorOutcome(authedApiFetchError(403)).message,
    );
    assert.equal(whtLinkErrorOutcome(authedApiFetchError(403)).reload, false);
  });

  it('falls back to the server message, then to a usable default', () => {
    assert.equal(whtLinkErrorOutcome(authedApiFetchError(500, { message: 'boom' })).message, 'boom');
    assert.equal(whtLinkErrorOutcome(null).message, 'ไม่สามารถแนบหนังสือรับรองได้');
    assert.equal(whtLinkErrorOutcome({}).reload, false);
  });

  // The HttpClient path exposes `statusCode` instead. Both must keep working.
  it('reads the ApiError shape as well as the authedApiFetch one', () => {
    assert.equal(whtLinkErrorOutcome({ statusCode: 404 }).reload, true);
    assert.equal(whtLinkErrorOutcome({ status: 404 }).reload, true);
    assert.equal(whtLinkErrorOutcome({ statusCode: 403 }).reload, false);
    assert.equal(whtLinkErrorOutcome({ status: 403 }).reload, false);
    assert.match(whtLinkErrorOutcome({ statusCode: 400 }).message, /เลขที่หนังสือรับรอง/);
    assert.match(whtLinkErrorOutcome({ status: 400 }).message, /เลขที่หนังสือรับรอง/);
  });
});

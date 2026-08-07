import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CivilDate, VatRegistrationStatus } from '@watchdog-bms/contracts';
import { effectiveVatStatus } from '../../../data-model-core/domain/logic/company-vat-registration.logic';
import { capturePolicyDate, expenseCaptureMode } from './expense-capture-policy.logic';

const STATUSES: VatRegistrationStatus[] = ['REGISTERED', 'NOT_REGISTERED', 'UNKNOWN'];

describe('expenseCaptureMode (spec §5)', () => {
  it('derives the full table', () => {
    const table = STATUSES.flatMap((vatStatus) => [true, false].map((thaiTaxEnabled) => ({
      vatStatus, thaiTaxEnabled, mode: expenseCaptureMode({ vatStatus, thaiTaxEnabled }),
    })));

    assert.deepEqual(table, [
      { vatStatus: 'REGISTERED',     thaiTaxEnabled: true,  mode: 'FULL' },
      { vatStatus: 'REGISTERED',     thaiTaxEnabled: false, mode: 'FULL' },
      // An answered NOT_REGISTERED beats the entitlement: thai_tax is on by default, and the
      // claim guard would reject anything the full UI invited here.
      { vatStatus: 'NOT_REGISTERED', thaiTaxEnabled: true,  mode: 'SIMPLE' },
      { vatStatus: 'NOT_REGISTERED', thaiTaxEnabled: false, mode: 'SIMPLE' },
      { vatStatus: 'UNKNOWN',        thaiTaxEnabled: true,  mode: 'FULL' },
      { vatStatus: 'UNKNOWN',        thaiTaxEnabled: false, mode: 'SIMPLE' },
    ]);
  });

  // AC3 / plan R1. Every real company reads UNKNOWN today because no UI writes a fact, so this
  // row is the one that decides whether the change ships dark or breaks every existing tenant.
  it('keeps an UNKNOWN company on FULL while it holds thai_tax', () => {
    assert.equal(expenseCaptureMode({ vatStatus: 'UNKNOWN', thaiTaxEnabled: true }), 'FULL');
  });

  // AC5. The mode follows the document's own date, so the composition with the accessor — not the
  // accessor alone — is what has to be right.
  it('follows the document date across a registration boundary', () => {
    const facts = [
      { id: 'f1', status: 'NOT_REGISTERED' as const, effectiveFrom: '2026-01-01' as CivilDate, effectiveTo: '2026-07-01' as CivilDate, supersededAt: null },
      { id: 'f2', status: 'REGISTERED' as const, effectiveFrom: '2026-07-01' as CivilDate, effectiveTo: null, supersededAt: null },
    ];
    // thai_tax on, as it is for every new company — the dates alone must still decide.
    const modeOn = (on: CivilDate) => expenseCaptureMode({ vatStatus: effectiveVatStatus(facts, on), thaiTaxEnabled: true });

    assert.equal(modeOn('2026-06-30' as CivilDate), 'SIMPLE');
    assert.equal(modeOn('2026-07-01' as CivilDate), 'FULL');
    // Before any fact covers the company at all: UNKNOWN, so the entitlement decides.
    assert.equal(modeOn('2025-12-31' as CivilDate), 'FULL');
  });
});

// BUG-5. The date part is taken literally, never re-zoned: `expenseDate` is a civil date the API
// renders at UTC midnight, so its own date part is the day the user picked.
describe('capturePolicyDate', () => {
  it('accepts a civil date and any datetime naming that day', () => {
    for (const [sent, day] of [
      ['2026-08-05', '2026-08-05'],
      ['2026-08-05T00:00:00.000Z', '2026-08-05'],
      ['2026-08-05T00:00:00Z', '2026-08-05'],
      ['2026-08-05T14:30:00+07:00', '2026-08-05'],
    ] as const) {
      assert.equal(capturePolicyDate(sent), day, sent);
    }
  });

  it('refuses anything that is not a day', () => {
    for (const sent of ['', 'yesterday', '2026-8-5', '2026-02-30', '05/08/2026', '2026-08-05Tnoon']) {
      assert.equal(capturePolicyDate(sent), null, sent);
    }
  });
});

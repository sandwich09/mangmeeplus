import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAttachmentPurgeable, retentionCutoffs, subtractMonths } from './crm-pdpa-purge.logic';
import { PDPA_MEDIA_RETENTION_MONTHS, PDPA_TEXT_RETENTION_MONTHS } from '../crm-inbox.constants';

describe('subtractMonths', () => {
  it('subtracts whole months across year boundaries', () => {
    assert.equal(subtractMonths(new Date('2026-07-09T10:30:00Z'), 24).toISOString(), '2024-07-09T10:30:00.000Z');
    assert.equal(subtractMonths(new Date('2026-07-09T10:30:00Z'), 12).toISOString(), '2025-07-09T10:30:00.000Z');
  });

  it('clamps to the last day of a shorter target month instead of overflowing', () => {
    // Naive `setMonth(month-1)` on Mar 31 would roll into Mar (Feb has no 31st).
    assert.equal(subtractMonths(new Date('2024-03-31T00:00:00Z'), 1).toISOString(), '2024-02-29T00:00:00.000Z');
    assert.equal(subtractMonths(new Date('2025-03-31T00:00:00Z'), 1).toISOString(), '2025-02-28T00:00:00.000Z');
  });

  it('preserves the time-of-day component', () => {
    const d = subtractMonths(new Date('2026-01-15T23:59:59.500Z'), 12);
    assert.equal(d.toISOString(), '2025-01-15T23:59:59.500Z');
  });
});

describe('retentionCutoffs', () => {
  it('uses the 24-month text / 12-month media windows', () => {
    const now = new Date('2026-07-09T00:00:00Z');
    const { textBefore, mediaBefore } = retentionCutoffs(now);
    assert.equal(textBefore.toISOString(), subtractMonths(now, PDPA_TEXT_RETENTION_MONTHS).toISOString());
    assert.equal(mediaBefore.toISOString(), subtractMonths(now, PDPA_MEDIA_RETENTION_MONTHS).toISOString());
    // media window is more recent (shorter retention) than text
    assert.ok(mediaBefore.getTime() > textBefore.getTime());
  });
});

describe('isAttachmentPurgeable', () => {
  it('purges only ACTIVE, unlinked (non-finance) attachments', () => {
    assert.equal(isAttachmentPurgeable({ status: 'ACTIVE', linkCount: 0 }), true);
    // linked to a finance/accounting doc → legally retained
    assert.equal(isAttachmentPurgeable({ status: 'ACTIVE', linkCount: 1 }), false);
    // already deleted or quarantined → nothing to purge
    assert.equal(isAttachmentPurgeable({ status: 'DELETED', linkCount: 0 }), false);
    assert.equal(isAttachmentPurgeable({ status: 'QUARANTINED', linkCount: 0 }), false);
  });
});

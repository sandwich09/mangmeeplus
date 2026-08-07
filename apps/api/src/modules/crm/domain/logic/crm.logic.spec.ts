import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePhone,
  normalizeEmail,
  normalizeTaxId,
  normalizeName,
  scoreCustomerDuplicate,
  validatePipelineStages,
  canMoveStage,
  validateClose,
  canReopen,
  canTransitionFollowUp,
  effectiveFollowUpStatus,
  scoreFollowUpPriority,
  sanitizeCsvCell,
  toCsvRow,
  crmCanReadAll,
  crmCanManageAll,
  sumAmounts,
} from './crm.logic';

test('normalization is deterministic', () => {
  assert.equal(normalizePhone('+66 (081) 234-5678'), '812345678');
  assert.equal(normalizePhone('+66 81 234 5678'), '812345678');
  assert.equal(normalizePhone('0066 81 234 5678'), '812345678');
  assert.equal(normalizePhone('081-234-5678'), '812345678');
  assert.equal(normalizePhone('0812345678'), '812345678');
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(normalizeTaxId('0-1055-12345-67-8'), '0105512345678');
  assert.equal(normalizeName('  Acme   Co  '), 'acme co');
  assert.equal(normalizePhone(''), undefined);
  assert.equal(normalizeEmail(null), undefined);
});

test('duplicate scoring ranks tax id/email higher than fuzzy name', () => {
  const input = { taxIdNormalized: '123', primaryEmailNormalized: 'a@b.com', primaryPhoneNormalized: '999', nameNormalized: 'acme co' };
  assert.deepEqual(scoreCustomerDuplicate(input, { taxIdNormalized: '123' }), { matchType: 'TAX_ID', confidence: 'HIGH' });
  assert.deepEqual(scoreCustomerDuplicate(input, { primaryEmailNormalized: 'a@b.com' }), { matchType: 'EMAIL', confidence: 'HIGH' });
  assert.deepEqual(scoreCustomerDuplicate(input, { primaryPhoneNormalized: '999' }), { matchType: 'PHONE', confidence: 'MEDIUM' });
  assert.deepEqual(scoreCustomerDuplicate(input, { nameNormalized: 'acme co' }), { matchType: 'NAME', confidence: 'LOW' });
  assert.equal(scoreCustomerDuplicate(input, { nameNormalized: 'other' }), null);
  // tax id wins over name when both present
  assert.deepEqual(scoreCustomerDuplicate(input, { taxIdNormalized: '123', nameNormalized: 'acme co' }), { matchType: 'TAX_ID', confidence: 'HIGH' });
});

test('pipeline config rejects missing terminal groups and duplicate names', () => {
  assert.deepEqual(validatePipelineStages([]), ['stages_required']);
  const noTerminal = validatePipelineStages([{ name: 'New', canonicalGroup: 'NEW_LEAD', sortOrder: 0 }]);
  assert.ok(noTerminal.includes('missing_won_group'));
  assert.ok(noTerminal.includes('missing_lost_group'));
  const dup = validatePipelineStages([
    { name: 'A', canonicalGroup: 'WON', sortOrder: 0 },
    { name: 'A', canonicalGroup: 'LOST', sortOrder: 1 },
  ]);
  assert.ok(dup.includes('duplicate_stage_name'));
  const ok = validatePipelineStages([
    { name: 'New', canonicalGroup: 'NEW_LEAD', sortOrder: 0 },
    { name: 'Won', canonicalGroup: 'WON', sortOrder: 1 },
    { name: 'Lost', canonicalGroup: 'LOST', sortOrder: 2 },
  ]);
  assert.deepEqual(ok, []);
});

test('opportunity close rules', () => {
  assert.ok(canMoveStage('OPEN'));
  assert.ok(!canMoveStage('WON'));
  assert.equal(validateClose('LOST', { hasQuotationLink: false }), 'lost_reason_required');
  assert.equal(validateClose('LOST', { reason: 'price', hasQuotationLink: false }), null);
  assert.equal(validateClose('WON', { hasQuotationLink: false }), 'won_requires_quote_or_reason');
  assert.equal(validateClose('WON', { hasQuotationLink: true }), null);
  assert.equal(validateClose('WON', { winReason: 'verbal ok', hasQuotationLink: false }), null);
  assert.ok(canReopen('WON'));
  assert.ok(canReopen('LOST'));
  assert.ok(!canReopen('OPEN'));
});

test('follow-up transitions and overdue derivation', () => {
  assert.ok(canTransitionFollowUp('OPEN', 'DONE'));
  assert.ok(canTransitionFollowUp('SNOOZED', 'OPEN'));
  assert.ok(!canTransitionFollowUp('DONE', 'OPEN'));
  assert.ok(!canTransitionFollowUp('CANCELED', 'DONE'));
  const now = new Date('2026-07-01T10:00:00Z');
  assert.equal(effectiveFollowUpStatus('OPEN', new Date('2026-06-30T10:00:00Z'), now), 'OVERDUE');
  assert.equal(effectiveFollowUpStatus('OPEN', new Date('2026-07-02T10:00:00Z'), now), 'OPEN');
  assert.equal(effectiveFollowUpStatus('DONE', new Date('2026-06-30T10:00:00Z'), now), 'DONE');
});

test('AI priority ranking orders overdue/high-priority/high-value predictably', () => {
  const now = new Date('2026-07-01T10:00:00Z');
  const overdueUrgent = scoreFollowUpPriority({ priority: 'URGENT', dueAt: new Date('2026-06-29T10:00:00Z'), now });
  const upcomingLow = scoreFollowUpPriority({ priority: 'LOW', dueAt: new Date('2026-07-05T10:00:00Z'), now });
  assert.ok(overdueUrgent > upcomingLow);
  const highValue = scoreFollowUpPriority({ priority: 'NORMAL', dueAt: new Date('2026-07-01T09:00:00Z'), now, opportunityAmount: '50000' });
  const lowValue = scoreFollowUpPriority({ priority: 'NORMAL', dueAt: new Date('2026-07-01T09:00:00Z'), now, opportunityAmount: '100' });
  assert.ok(highValue > lowValue);
});

test('CSV cell sanitization guards formula injection', () => {
  assert.equal(sanitizeCsvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(sanitizeCsvCell('+1'), `"'+1"`);
  assert.equal(sanitizeCsvCell('safe'), `"safe"`);
  assert.equal(sanitizeCsvCell('he said "hi"'), `"he said ""hi"""`);
  assert.equal(toCsvRow(['a', '=b', 'c']), `"a","'=b","c"`);
});

test('scope helpers', () => {
  assert.ok(!crmCanReadAll(['MANAGER']));
  assert.ok(crmCanReadAll(['FINANCE']));
  assert.ok(!crmCanReadAll(['SALES']));
  assert.ok(crmCanManageAll(['ADMIN']));
  assert.ok(!crmCanManageAll(['MANAGER']));
  assert.ok(!crmCanManageAll(['SALES']));
  assert.ok(!crmCanManageAll(['FINANCE']));
});

test('sumAmounts is decimal-safe', () => {
  assert.equal(sumAmounts(['0.1', '0.2']), '0.3000');
  assert.equal(sumAmounts(['1000.5', '2000.25', '0.25']), '3001.0000');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./SubstituteReceiptWizardPage.tsx', import.meta.url), 'utf8');

test('pending certificates expose the existing guarded cancellation and revision history', () => {
  assert.ok(source.includes('{renderVersionHistory()}'));
  assert.ok(source.includes("canReview && receiptEvidence.status !== 'SUPERSEDED'"));
  assert.ok(source.includes("['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status)"));
  const supersede = source.slice(source.indexOf('const supersede = async'), source.indexOf('const copyWizardLink'));
  assert.ok(supersede.includes("setActiveStep('done')"));
});

test('a cancelled version does not claim successful issuance or offer confirmation next steps', () => {
  const done = source.slice(source.indexOf('const renderDoneStep'), source.indexOf('const renderVersionHistory'));
  assert.ok(done.includes("receiptEvidence.status === 'ISSUED' ? 'expenses.substitute_wizard.done_title' : 'expenses.substitute_hub.status_superseded'"));
  assert.ok(done.includes("{receiptEvidence.status === 'ISSUED' && receiptEvidence.fundingSource !== 'PERSONAL_ADVANCE' && <div"));
  assert.ok(done.includes("{receiptEvidence.status === 'ISSUED' && receiptEvidence.fundingSource === 'PERSONAL_ADVANCE' && <div"));
});

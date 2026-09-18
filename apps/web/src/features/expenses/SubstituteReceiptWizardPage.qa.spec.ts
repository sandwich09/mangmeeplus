import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./SubstituteReceiptWizardPage.tsx', import.meta.url), 'utf8');

test('pending certificates expose the existing guarded cancellation and revision history', () => {
  assert.ok(source.includes('{!editingPrepared && renderVersionHistory()}'));
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

// ─── W06 §12.3: a certificate that came from a capture group has two ways back ─

test('the wizard offers the evidence job beside the certificate list, and again when it is done', () => {
  const eyebrow = source.indexOf('eyebrow={(');
  const header = source.slice(eyebrow, source.indexOf('title={t(', eyebrow));
  assert.ok(header.includes("t('expenses.substitute_wizard.back_hub', locale)"));
  assert.ok(header.includes('detail?.captureGroup && <Link href={detail.captureGroup.webPath}>'));

  const done = source.slice(source.indexOf('const renderDoneStep'), source.indexOf('const renderVersionHistory'));
  assert.ok(done.includes("href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}"), 'the expense link stays');
  assert.ok(done.includes('detail.captureGroup && <Link className={ghostClass} href={detail.captureGroup.webPath}>'));
  // The path is the server's own (§10 "กรอกข้อมูลต่อ"), never rebuilt from ids on the client.
  assert.equal(source.includes('/expenses/capture/${'), false);
});

test('a derived source starts from the reviewed facts, and the payer still writes the reason', () => {
  assert.ok(source.includes('const capturePrefill = nextDetail.captureGroup'));
  assert.ok(source.includes('captureCertificatePrefill(group, nextDetail.id)'));
  // A42: the reviewed payment date, else the expense date the group settled — never todayIso().
  assert.ok(source.includes('setPaymentDate(coerceCivilDate(capturePrefill.paymentDate ?? nextDetail.expenseDate))'));
  // The reason field is offered a suggestion and only fills on a deliberate tap.
  assert.ok(source.includes('missingReasonSuggestion && !missingReason.trim()'));
  assert.ok(source.includes('onClick={() => setMissingReason(missingReasonSuggestion)}'));
  assert.equal(source.includes('setMissingReason(capturePrefill'), false, 'a suggestion is never typed for the payer');
  // A read the viewer may not do leaves the form exactly as it was.
  assert.ok(source.includes('.catch(() => null)'));
});

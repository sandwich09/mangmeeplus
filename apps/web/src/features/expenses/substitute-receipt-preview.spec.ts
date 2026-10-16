import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const featureDir = dirname(fileURLToPath(import.meta.url));
const hubSource = readFileSync(join(featureDir, 'SubstituteReceiptHubPage.tsx'), 'utf8');
const reviewSource = readFileSync(join(featureDir, 'ExpenseReviewPage.tsx'), 'utf8');
const wizardSource = readFileSync(join(featureDir, 'SubstituteReceiptWizardPage.tsx'), 'utf8');
const legacyReviewSource = readFileSync(join(featureDir, 'ExpensesPages.tsx'), 'utf8');

describe('substitute signing method actions', () => {
  it('keeps paper download/upload on the paper panel while online signing retains document review', () => {
    const paperSource = readFileSync(join(featureDir, 'SubstitutePaperSigningPanel.tsx'), 'utf8');
    assert.doesNotMatch(wizardSource, /downloadSubstituteReceiptFormPdf|substitute_wizard\.download_form/);
    assert.match(wizardSource, /onClick=\{\(\) => void run\(previewPrepared\)\}/);
    assert.match(paperSource, /downloadSubstituteReceiptFormPdf/);
    assert.match(paperSource, /submitSubstitutePaperFile/);
  });
});

describe('check-bill canonical preparation wiring', () => {
  it('derives the route from the selected server expense on deep link and reload, not URL or LINE flags', () => {
    assert.match(wizardSource, /const checkBillRoute = isCheckBillClassification\(detail\?\.aiVerificationSummaryJson\)/);
    assert.match(wizardSource, /checkBillRoute \? \{ routeCheckBill: true as const \}/);
    // New preparation needs explicit evidence review; check-bill classification alone cannot approve it.
    assert.doesNotMatch(wizardSource, /sourceDocumentType: !checkBillRoute && detail\.sourceDocumentType === 'NEEDS_REVIEW'/);
    assert.doesNotMatch(wizardSource, /<DocumentReviewSection/);
    const continueStep = sourceSection(wizardSource, 'const continueFromExpense = async', 'const prepare = async');
    assert.equal((continueStep.match(/await updateExpenseReviewFields\(/g) ?? []).length, 1);
    assert.match(continueStep, /if \(!continuingExisting\)/);
    assert.match(continueStep, /route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE'/);
    assert.match(continueStep, /sourceDocumentType: 'EXPENSE_NOTE_TEXT'/);
    assert.match(continueStep, /lines: clearExpenseTaxSelections\(currentReview.lines\)/);
    assert.match(continueStep, /\.\.\.sanitizedReview/);
    assert.doesNotMatch(wizardSource, /item.blockedReason/);
    assert.doesNotMatch(wizardSource, /บันทึกว่ามีใบเสร็จแล้ว จึงเลือกทำใบรับรองไม่ได้/);
    assert.match(wizardSource, />เปิดค่าใช้จ่าย<\/Link>/);
    assert.match(wizardSource, /paymentCount: selectedPaymentCount/);
    assert.match(wizardSource, /String\(selectedCount\)/, 'a stale selected id must not count as a ready evidence file');
  });
  it('routes both expense entry points to the canonical wizard without an embedded signing path', () => {
    for (const source of [legacyReviewSource, reviewSource]) {
      assert.match(source, /expenseSubstituteReceiptAction\(companyId, detail\.id, detail\.aiVerificationSummaryJson/);
      assert.match(source, /href=\{substituteAction\.href\}/);
    }
    const section = sourceSection(legacyReviewSource, 'export function DocumentReviewSection', 'type EditableReviewLineField');
    assert.doesNotMatch(section, /generateSubstituteReceipt|certifySubstituteReceipt|approveSubstituteReceipt|supersedeSubstituteReceipt|listSubstituteReceiptPayers/);
    assert.match(section, /!classificationBlocked && \(!evidence \|\| evidence\.status === 'SUPERSEDED'\)/);
    assert.match(section, /aria-disabled=\{busy \|\| dirty\}/);
    assert.match(section, /if \(busy \|\| dirty\) event\.preventDefault\(\)/);
    const navigate = sourceSection(reviewSource, 'const openSubstituteReceipt = async', 'const ocrTotalUnacknowledged');
    assert.match(navigate, /if \(aiReading \|\| stepSaving \|\| evidenceDirty\) return/);
    // Superseded documents open read-only before this save. Active navigation saves first.
    assert.match(navigate, /detail\.substituteReceiptEvidence\?\.status === 'SUPERSEDED'/);
    assert.ok(navigate.indexOf('await reviewSaveRef.current()') < navigate.lastIndexOf('router.push('));
    assert.match(navigate, /!detail\.substituteReceiptEvidence && !canStartSubstitute/);
    assert.match(navigate, /if \(!saved\) return/);
  });
});

function sourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

describe('substitute-receipt hub opens the document page', () => {
  it('removes the separate preview button and modal; the document page retains its preview and download actions', () => {
    assert.doesNotMatch(hubSource, /ReceiptPrintPreview|previewIssuedSubstitutePaper|openDocument|ดูเอกสาร|<Modal/);
    assert.match(hubSource, /router\.push\(wizardHref\(item\.evidenceId\)\)/);
    assert.match(hubSource, /event\.key === 'Enter'/);
    assert.match(wizardSource, /const openArtifact = async/);
    assert.match(wizardSource, /const openIssuedPdf = async/);
    assert.match(wizardSource, /URL\.revokeObjectURL/);
  });
});

describe('expense review preview lifecycle', () => {
  it('checks the request epoch before creating a URL and publishing the response', () => {
    const openPreview = sourceSection(reviewSource, 'const openPreview = async', 'const doAction = async');
    const fetchIndex = openPreview.indexOf('await fetchAttachmentPreviewBlob');
    const guardIndex = openPreview.indexOf('if (requestId !== previewRequestRef.current) return;');
    const createIndex = openPreview.indexOf('URL.createObjectURL(blob)');
    const commitIndex = openPreview.indexOf('commitPreview(requestId');
    assert.ok(fetchIndex >= 0 && fetchIndex < guardIndex && guardIndex < createIndex && createIndex < commitIndex);
    assert.match(openPreview, /if \(requestId === previewRequestRef\.current\) setError/);
    assert.match(openPreview, /if \(requestId === previewRequestRef\.current\) setPreviewLoading\(false\)/);
  });

  it('invalidates key changes and close, revokes stale URLs, and guards viewed callbacks', () => {
    assert.match(reviewSource, /\[companyId, expenseId, detail\?\.substituteReceiptEvidence\?\.id, detail\?\.substituteReceiptEvidence\?\.updatedAt, releasePreviewUrl\]/);
    assert.match(reviewSource, /if \(requestId !== previewRequestRef\.current\) \{\s*if \(source\.url\.startsWith\('blob:'\)\) URL\.revokeObjectURL\(source\.url\)/);
    assert.match(reviewSource, /onViewed: \(\) => \{\s*if \(requestId !== previewRequestRef\.current\) return;/);
    assert.match(reviewSource, /onClose=\{closePreview\}/);
  });
});

describe('substitute-receipt wizard preview lifecycle', () => {
  it('binds reader lifetime to document identity and signing validity to the evidence revision', () => {
    assert.match(wizardSource, /const previewScope = \[companyId, detail\?\.id \?\? '', receiptEvidence\?\.id \?\? ''\]\.join/);
    assert.match(wizardSource, /const previewRevision = \[previewScope, receiptEvidence\?\.updatedAt \?\? '', signerPosition\]\.join/);
    assert.match(wizardSource, /\[companyId, detail\?\.id, receiptEvidence\?\.id, releasePreviewUrl\]/);
    assert.match(wizardSource, /requestId === previewRequestRef\.current && requestScope === previewScopeRef\.current/);
    for (const [start, end] of [
      ['const previewPrepared = async', 'const certify = async'],
      ['const openArtifact = async', 'const openIssuedPdf = async'],
      ['const openIssuedPdf = async', 'const openEvidenceAttachment = async'],
      ['const openEvidenceAttachment = async', 'const approve = async'],
    ] as const) {
      const section = sourceSection(wizardSource, start, end);
      assert.match(section, /const requestId = \+\+previewRequestRef\.current/);
      assert.match(section, /const requestScope = previewScopeRef\.current/);
      assert.match(section, /if \(!isPreviewRequestCurrent\(requestId, requestScope\)\) return/);
      assert.match(section, /commitPreview\(requestId, requestScope/);
    }
  });

  it('revokes Blob URLs and prevents a stale media load from satisfying signing gates', () => {
    assert.match(wizardSource, /if \(source\.url\.startsWith\('blob:'\)\) URL\.revokeObjectURL\(source\.url\)/);
    assert.match(wizardSource, /if \(requestId !== previewRequestRef\.current \|\| requestScope !== previewScopeRef\.current\) return;/);
    assert.match(wizardSource, /if \(requestRevision !== previewRevisionRef\.current\) \{[\s\S]*?return;\s*\}\s*source\.onViewed\?\.\(\)/);
    assert.match(wizardSource, /setPreviewChecksum\(null\);[\s\S]*await previewSubstituteReceipt/);
    assert.match(wizardSource, /if \(certified\) setCertifiedPreviewed\(false\)/);
    assert.match(wizardSource, /onClose=\{closePreview\}/);
  });
});


it('creation waits for the certificate route before offering its signing reader', () => {
  const prepare = sourceSection(wizardSource, 'const result = await generateSubstituteReceipt', 'const selectSignatureFile');
  assert.match(prepare, /setLoading\(true\);\s*router.push/);
  assert.doesNotMatch(prepare, /setActiveStep\('certify'\)/);
});

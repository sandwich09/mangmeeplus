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
    assert.match(wizardSource, /<DocumentReviewSection/);
    const continueStep = sourceSection(wizardSource, 'const continueFromExpense = async', 'const prepare = async');
    assert.match(continueStep, /!continuingExisting && \(!hasCurrentExpenseEvidenceReview\(detail\)/);
    assert.match(continueStep, /expenseEvidenceAssessment\(detail\)\?\.route !== 'SUBSTITUTE_RECEIPT'/);
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

describe('substitute-receipt state-aware document preview', () => {
  it('opens the modal before waiting and covers its document area through image readiness', () => {
    const openDocument = sourceSection(hubSource, 'async function openDocument', 'async function confirmCancellation');
    const pending = openDocument.indexOf('setPreview({ item, data: null })');
    const request = openDocument.indexOf('await previewIssuedSubstitutePaper');
    assert.ok(pending >= 0 && pending < request, 'the visible modal must not wait for the API');
    assert.match(hubSource, /<CoverLoader active=\{loading \|\| \(!failed && !!target\.data && loaded\.length !== pages\.length\)\} scope="section"/);
    assert.match(hubSource, /min-h-\[50dvh\]/);
    assert.match(hubSource, /error && <ErrorBanner message=\{error\}/);
    assert.match(hubSource, /disabled=\{loading\} aria-busy=\{loading\} onClick=\{onRetry\}/);
    assert.doesNotMatch(hubSource, /previewLoadingId && <p role="status"/);
  });

  it('only publishes the newest authenticated preview and invalidates close/company changes', () => {
    assert.match(hubSource, /previewIssuedSubstitutePaper\(companyId, item\.expenseId, item\.evidenceId\)/);
    assert.match(hubSource, /const requestId = \+\+previewRequestRef\.current/);
    assert.match(hubSource, /if \(requestId === previewRequestRef\.current\) setPreview/);
    assert.match(hubSource, /previewRequestRef\.current \+= 1/);
    assert.match(hubSource, /\[companyId, closePreview\]/);
  });

  it('releases PDF URLs and waits for every page before allowing printing', () => {
    assert.match(hubSource, /URL\.revokeObjectURL\(url\)/);
    assert.match(hubSource, /target\.data\.pdfDataUrl\.startsWith\(prefix\)/);
    assert.doesNotMatch(hubSource, /fetch\(target\.data\.pdfDataUrl\)/);
    assert.match(hubSource, /loaded\.length !== pages\.length/);
    assert.match(hubSource, /pages\.map\(\(page, index\)/);
    assert.match(hubSource, /printSurface/);
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
  it('binds every async preview to the active company, expense, and evidence revision', () => {
    assert.match(wizardSource, /const previewScope = \[\s*companyId,[\s\S]*receiptEvidence\?\.updatedAt \?\? '',[\s\S]*signerPosition[\s\S]*\]\.join/);
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
    assert.match(wizardSource, /if \(requestId !== previewRequestRef\.current \|\| requestScope !== previewScopeRef\.current\) return;\s*source\.onViewed\?\.\(\)/);
    assert.match(wizardSource, /setPreviewChecksum\(null\);[\s\S]*await previewSubstituteReceipt/);
    assert.match(wizardSource, /if \(certified\) setCertifiedPreviewed\(false\)/);
    assert.match(wizardSource, /onClose=\{closePreview\}/);
  });
});

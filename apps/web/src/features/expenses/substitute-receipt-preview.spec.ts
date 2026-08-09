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

function sourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

describe('substitute-receipt issued document preview', () => {
  it('only publishes the newest authenticated PDF response', () => {
    assert.match(hubSource, /fetchSubstituteReceiptPdfBlob\(companyId, target\.expenseId, target\.evidenceId\)/);
    assert.match(hubSource, /const requestId = \+\+previewRequestRef\.current/);
    assert.match(hubSource, /if \(requestId !== previewRequestRef\.current\) return/);
    assert.match(hubSource, /previewUrlRef\.current = url/);
  });

  it('invalidates close and unmount, revokes Blob URLs, and retries the same target', () => {
    assert.match(hubSource, /previewRequestRef\.current \+= 1/);
    assert.match(hubSource, /URL\.revokeObjectURL\(url\)/);
    assert.match(hubSource, /onClose=\{closePreview\}/);
    assert.match(hubSource, /onRetry=\{previewTarget \? \(\) => loadIssuedArtifactPreview\(previewTarget\) : undefined\}/);
    assert.match(hubSource, /disabled=\{previewLoadingId === item\.evidenceId\}/);
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
    assert.match(reviewSource, /onOpenFile=\{showPreview\}/);
    assert.match(reviewSource, /onClose=\{closePreview\}/);
  });
});

describe('substitute-receipt wizard preview lifecycle', () => {
  it('binds every async preview to the active company, expense, and evidence revision', () => {
    assert.match(wizardSource, /const previewScope = \[\s*companyId,[\s\S]*receiptEvidence\?\.updatedAt \?\? '',\s*\]\.join/);
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

describe('legacy document-review preview lifecycle', () => {
  it('invalidates pending previews when the active evidence revision changes', () => {
    assert.match(legacyReviewSource, /const previewScope = \[\s*companyId,\s*detail\.id,[\s\S]*detail\.substituteReceiptEvidence\?\.updatedAt \?\? '',\s*\]\.join/);
    assert.match(legacyReviewSource, /return \(\) => \{ previewRequestRef\.current \+= 1; \};\s*\}, \[companyId, detail\.id, detail\.substituteReceiptEvidence\?\.id, detail\.substituteReceiptEvidence\?\.updatedAt\]\);/);
  });

  it('guards prepared/certified success gates and revokes an unpublished stale Blob URL', () => {
    const prepared = sourceSection(legacyReviewSource, 'const previewPreparedSubstitute = async', 'const certifySubstitute = async');
    assert.match(prepared, /if \(!isPreviewRequestCurrent\(requestId, requestScope\)\) return false/);
    assert.match(prepared, /onViewed: \(\) => \{\s*if \(!isPreviewRequestCurrent\(requestId, requestScope\)\) return;/);

    const artifact = sourceSection(legacyReviewSource, 'const openSubstituteArtifact = async', 'const requiresPaymentEvidence =');
    assert.match(artifact, /if \(!isPreviewRequestCurrent\(requestId, requestScope\)\) return false;\s*const url = URL\.createObjectURL\(blob\)/);
    assert.match(artifact, /URL\.revokeObjectURL\(url\);\s*return false/);
    assert.match(artifact, /onViewed: \(\) => \{\s*if \(!isPreviewRequestCurrent\(requestId, requestScope\)\) return;/);
  });
});

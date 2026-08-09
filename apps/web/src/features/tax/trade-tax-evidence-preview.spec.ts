import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'TradeTaxEvidencePage.tsx'), 'utf8');

describe('trade tax-evidence preview', () => {
  it('fetches validated bytes into the shared preview instead of navigating to a signed URL', () => {
    assert.match(source, /fetchAttachmentPreviewBlob\(companyId, target\.attachmentId\)/);
    assert.match(source, /<DocumentPreviewModal/);
    assert.doesNotMatch(source, /window\.open\(/);
    assert.doesNotMatch(source, /getTradeTaxEvidenceAttachmentDownloadUrl/);
  });

  it('revokes Blob URLs, invalidates closed requests, and exposes loading and retry states', () => {
    assert.match(source, /URL\.revokeObjectURL\(url\)/);
    assert.match(source, /previewRequestRef\.current \+= 1/);
    assert.match(source, /previewLoadingId === attachmentId/);
    assert.match(source, /onClose=\{closeAttachmentPreview\}/);
    assert.match(source, /onRetry=\{previewTarget \? \(\) => loadAttachmentPreview\(previewTarget\)/);
  });

  it('invalidates and closes an in-flight preview when the active company changes', () => {
    assert.match(source, /useEffect\(\(\) => \{\s*previewRequestRef\.current \+= 1;\s*releaseAttachmentPreviewUrl\(\);\s*setAttachmentPreview\(null\);\s*setPreviewTarget\(null\);\s*setPreviewLoadingId\(null\);\s*setError\(''\);\s*\}, \[companyId, releaseAttachmentPreviewUrl\]\);/);
  });

  it('does not publish an error or clear a newer loader when an invalidated request rejects', () => {
    assert.match(source, /loadAttachmentPreview\(target, requestId\)/);
    assert.match(source, /if \(requestId === previewRequestRef\.current\) setError\(transactionTaxErrorMessage\(cause\)\)/);
    assert.match(source, /if \(requestId === previewRequestRef\.current\) \{\s*setPreviewLoadingId/);
  });
});

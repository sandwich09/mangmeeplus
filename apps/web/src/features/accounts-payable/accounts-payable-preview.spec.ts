import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AccountsPayablePages.tsx'), 'utf8');

describe('vendor bill tax-evidence preview', () => {
  it('fetches validated bytes into the shared preview instead of navigating to a signed URL', () => {
    assert.match(source, /fetchAttachmentPreviewBlob\(companyId, target\.attachmentId\)/);
    assert.match(source, /<DocumentPreviewModal/);
    assert.doesNotMatch(source, /window\.open\(downloadUrl/);
    assert.doesNotMatch(source, /getVendorBillAttachmentDownloadUrl/);
  });

  it('makes the latest request win and invalidates pending work on close, bill change, and unmount', () => {
    assert.match(source, /const requestId = \+\+previewRequestRef\.current/);
    assert.match(source, /if \(requestId !== previewRequestRef\.current\) return/);
    assert.match(source, /previewRequestRef\.current \+= 1/);
    assert.match(source, /URL\.revokeObjectURL\(url\)/);
    assert.match(source, /\[bill\.id, bill\.taxInvoiceDate, bill\.taxInvoiceNumber, bill\.attachmentId, companyId, releaseAttachmentPreviewUrl\]/);
    assert.match(source, /onClose=\{closeAttachmentPreview\}/);
    assert.match(source, /onRetry=\{previewTarget \? \(\) => loadAttachmentPreview\(previewTarget\) : undefined\}/);
    assert.match(source, /disabled=\{busy \|\| previewLoading\}/);
  });
});

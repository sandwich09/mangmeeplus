import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ReimbursementsPages.tsx'), 'utf8');

describe('reimbursement document preview lifecycle', () => {
  it('uses one latest-request gate for generated claim forms and authenticated attachments', () => {
    assert.match(source, /previewReimbursementClaimForm\(companyId, target\.reimbursementId\)/);
    assert.match(source, /fetchAttachmentPreviewBlob\(companyId, target\.attachmentId, target\.mimeType\)/);
    assert.match(source, /const requestId = \+\+previewRequestRef\.current/);
    assert.match(source, /if \(requestId !== previewRequestRef\.current\) return/);
    assert.match(source, /previewUrlRef\.current = url/);
  });

  it('invalidates requests on close, unmount, company change, and drawer changes', () => {
    assert.match(source, /previewRequestRef\.current \+= 1/);
    assert.match(source, /URL\.revokeObjectURL\(url\)/);
    assert.match(source, /const openDetail = useCallback[\s\S]*?closeDocumentPreview\(\)/);
    assert.match(source, /onClose=\{\(\) => \{ closeDocumentPreview\(\); setDetail\(null\)/);
    assert.match(source, /\[companyId, detail\?\.id, closeDocumentPreview\]/);
  });

  it('keeps retries target-specific and exposes preview loading to the drawer', () => {
    assert.match(source, /busy=\{drawerBusy \|\| previewLoadingKey !== null\}/);
    assert.match(source, /onRetry=\{previewTarget\?\.kind === 'claim-form' \? \(\) => loadDocumentPreview\(previewTarget\) : undefined\}/);
    assert.match(source, /onRetry=\{previewTarget\?\.kind === 'attachment' \? \(\) => loadDocumentPreview\(previewTarget\) : undefined\}/);
    assert.match(source, /if \(requestId === claimFormSaveRequestRef\.current\) setClaimFormSaving\(false\)/);
  });
});

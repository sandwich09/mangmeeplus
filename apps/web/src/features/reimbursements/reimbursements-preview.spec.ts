import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The drawer's sections and the preview lifecycle live in ReimbursementDetailSections, shared with the journey page.
const source = ['ReimbursementsPages.tsx', 'ReimbursementDetailSections.tsx']
  .map((file) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8'))
  .join('\n');

describe('reimbursement self-service entry', () => {
  it('uses the effective create permission on every screen width, with matching unavailable-create guidance', () => {
    assert.match(source, /canCreate=\{permissions\.includes\('reimbursement\.create'\)\}/);
    assert.match(source, /actions=\{permissions\.includes\('reimbursement\.create'\) && tab === 'mine' \? \([\s\S]*?reimbursements\/new[\s\S]*?min-h-11 w-full sm:w-auto/);
    assert.match(source, /\? canCreate \? 'กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ' : REIMBURSEMENT_CREATE_UNAVAILABLE/);
    const createPage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ReimbursementCreatePage.tsx'), 'utf8');
    assert.match(createPage, /editing \? !canUpdate : !canCreate/);
    assert.match(createPage, /description=\{editing \? [^\n]+ : REIMBURSEMENT_CREATE_UNAVAILABLE\}/);
  });
});

describe('reimbursement document preview lifecycle', () => {
  it('uses one latest-request gate for generated claim forms and authenticated attachments', () => {
    assert.match(source, /previewReimbursementClaimForm\(companyId, target\.reimbursementId\)/);
    assert.match(source, /fetchAttachmentPreviewBlob\(companyId, target\.attachmentId, target\.mimeType\)/);
    // A payment slip shares the gate and the viewer, but its bytes come from the claim's own slip endpoint.
    assert.match(source, /target\.kind === 'payment-slip'\s+\? await fetchReimbursementPaymentSlipBlob\(companyId, target\.reimbursementId, target\.paymentId, target\.attachmentId\)/);
    assert.match(source, /const requestId = \+\+previewRequestRef\.current/);
    assert.match(source, /if \(requestId !== previewRequestRef\.current\) return/);
    assert.match(source, /previewUrlRef\.current = url/);
  });

  it('invalidates requests on close and unmount', () => {
    assert.match(source, /previewRequestRef\.current \+= 1/);
    assert.match(source, /URL\.revokeObjectURL\(url\)/);
  });

  it('keeps retries target-specific', () => {
    assert.match(source, /onRetry=\{previewTarget\?\.kind === 'claim-form' \? \(\) => loadDocumentPreview\(previewTarget\) : undefined\}/);
    // The file viewer retries an attachment or a slip, each by its own fetch path; never a claim form.
    assert.match(source, /onRetry=\{previewTarget && previewTarget\.kind !== 'claim-form' \? \(\) => loadDocumentPreview\(previewTarget\) : undefined\}/);
    assert.match(source, /if \(requestId === claimFormSaveRequestRef\.current\) setClaimFormSaving\(false\)/);
  });
});

describe('reimbursement policy role-picker contract', () => {
  it('uses constrained role checkboxes (any holder decides) with human outcome copy and no holder-count helper', () => {
    assert.match(source, /<legend[^>]*>ส่งใบเบิกให้ใครอนุมัติ\?<\/legend>[\s\S]*?roleOptions\.map[\s\S]*?type="checkbox"[\s\S]*?toggleRole\(option\.key\)/);
    assert.match(source, /defaultApproverRoles: form\.defaultApproverRoles/);
    assert.match(source, /policyDecisionPreview\(\{\s*approvalRequiredFromAmount: form\.approvalRequiredFromAmount/);
    assert.doesNotMatch(source, /บทบาทผู้อนุมัติเริ่มต้น/);
    assert.doesNotMatch(source, /บทบาทนี้มีผู้รับผิดชอบ/);
    assert.doesNotMatch(source, /eligibleApproverCount/);
  });

  it('sends policy CAS/status and offers an explicit reload after a conflict', () => {
    assert.match(source, /expectedUpdatedAt: form\.updatedAt/);
    assert.match(source, /status: form\.status/);
    assert.match(source, /reimbursement_policy_changed/);
    assert.match(source, />โหลดค่าล่าสุด</);
  });
});

describe('frozen approval actions', () => {
  // The hub itself no longer renders an approve/reject control (the drawer that did was retired
  // in Phase 6); the same server-resolved-action invariant is covered where approve/reject now
  // live, in reimbursements.logic.spec.ts's buildJourneySteps coverage.
  it('reveals the approval tab only after an exact server assignment and binds it to the company', () => {
    assert.match(source, /listApprovalQueue\(companyId\)/);
    assert.match(source, /assignedApprovalCompanyId === companyId/);
    assert.match(source, /withAssignedApprovalTab\(permissionTabs, hasAssignedApprovalTask\)/);
  });
});

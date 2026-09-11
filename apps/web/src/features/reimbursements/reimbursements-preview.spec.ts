import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ReimbursementsPages.tsx'), 'utf8');

describe('reimbursement self-service entry', () => {
  it('uses the effective create permission on every screen width, with matching unavailable-create guidance', () => {
    assert.match(source, /canCreate=\{permissions\.includes\('reimbursement\.create'\)\}/);
    assert.match(source, /\{canCreate && \([\s\S]*?reimbursements\/new[\s\S]*?min-h-11 w-full sm:w-auto/);
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
    assert.match(source, /const requestId = \+\+previewRequestRef\.current/);
    assert.match(source, /if \(requestId !== previewRequestRef\.current\) return/);
    assert.match(source, /previewUrlRef\.current = url/);
  });

  it('invalidates requests on close, unmount, company change, and drawer changes', () => {
    assert.match(source, /previewRequestRef\.current \+= 1/);
    assert.match(source, /URL\.revokeObjectURL\(url\)/);
    assert.match(source, /const openDetail = useCallback[\s\S]*?closeDocumentPreview\(\)/);
    assert.match(source, /onClose=\{\(\) => \{\s*closeDocumentPreview\(\); setDetail\(null\)/);
    assert.match(source, /\[companyId, detail\?\.id, closeDocumentPreview\]/);
  });

  it('keeps retries target-specific and exposes preview loading to the drawer', () => {
    assert.match(source, /busy=\{drawerBusy \|\| previewLoadingKey !== null\}/);
    assert.match(source, /onRetry=\{previewTarget\?\.kind === 'claim-form' \? \(\) => loadDocumentPreview\(previewTarget\) : undefined\}/);
    assert.match(source, /onRetry=\{previewTarget\?\.kind === 'attachment' \? \(\) => loadDocumentPreview\(previewTarget\) : undefined\}/);
    assert.match(source, /if \(requestId === claimFormSaveRequestRef\.current\) setClaimFormSaving\(false\)/);
  });
});

describe('reimbursement policy role-picker contract', () => {
  it('uses a constrained role select with human outcome copy and no holder-count helper', () => {
    assert.match(source, /<ThemedSelect[\s\S]*?id="reimbursement-approver-role"/);
    assert.match(source, /ส่งใบเบิกให้ใครอนุมัติ\?/);
    assert.match(source, /ยอดต่ำกว่า \{formatMoney\(form\.approvalRequiredFromAmount\)\} บาท:/);
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
  it('renders only server-resolved task actions instead of inferring them from the tab', () => {
    assert.match(source, /detail\.approvalActions\?\.canApprove === true/);
    assert.match(source, /detail\.approvalActions\?\.canReject === true/);
    assert.doesNotMatch(source, /const canApprove = context === 'approvals'/);
  });

  it('reveals the approval tab only after an exact server assignment and binds it to the company', () => {
    assert.match(source, /listApprovalQueue\(companyId\)/);
    assert.match(source, /assignedApprovalCompanyId === companyId/);
    assert.match(source, /withAssignedApprovalTab\(permissionTabs, hasAssignedApprovalTask\)/);
  });
});

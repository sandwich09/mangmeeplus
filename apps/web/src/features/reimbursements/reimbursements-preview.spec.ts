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
    // One answer for the page's button, the list's empty state and the notice of an account that cannot create.
    assert.match(source, /const canCreate = permissions\.includes\('reimbursement\.create'\);/);
    assert.match(source, /canCreate=\{canCreate\}/);
    // The page's one green button, full width on a phone through the shared button group.
    assert.match(source, /actions=\{<div className="grid w-full auto-cols-fr grid-flow-col gap-3/);
    assert.match(source, /canCreate && <Link[^>]*className=\{btnClass\}>\+ สร้างใบเบิก<\/Link>/);
    assert.match(source, /description=\{canCreate \? [^\n]+ : REIMBURSEMENT_CREATE_UNAVAILABLE\}/);
    // Said once above the lists, as advice and not as an error, whichever list is open.
    assert.match(source, /\{!canCreate && <Notice tone="info">\{REIMBURSEMENT_CREATE_UNAVAILABLE\}<\/Notice>\}/);
    const createPage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ReimbursementCreatePage.tsx'), 'utf8');
    assert.match(createPage, /editing \? !canUpdate : !canCreate/);
    assert.match(createPage, /description=\{editing \? [^\n]+ : REIMBURSEMENT_CREATE_UNAVAILABLE\}/);
  });
});

describe('hub list loading', () => {
  // The loader and the list it fills are exercised in reimbursements.api.spec.ts; this holds the page to them.
  it('takes its own list through the page loader, and lets go of a request it no longer wants', () => {
    assert.match(source, /const nextPage = hubNextPage\(list, [^)]+\);\s+useEffect\(\(\) => \{\s+if \(nextPage === null\) return;[\s\S]*?return loadHubPage\(companyId, \{ scope, [^}]*page: nextPage \}, \{\s+onPage: \(result\) => \{ setHeld\(\(current\) => withHubPage\(current, listKey, result\)\);[^\n]+\},\s+onError: \(e\) => setHeld\(\(current\) => withHubFailure\(current, listKey, err\(e\)\)\),\s+\}\);\s+\}, \[/);
    // No other way into the list: an unpaged or unguarded call would bring the old faults back.
    assert.doesNotMatch(source, /listAllReimbursements|listReimbursements\(/);
    assert.match(source, /onClick=\{\(\) => setHeld\(withHubRetry\)\}>ลองอีกครั้ง</);
    // Lazy: what the screen needs is the table page shown, with a search as without one; the open filter and the search
    // are part of which list is held, and go to the API with every page.
    // Nothing on a row changes a claim any more, so the list has no reload count of its own (0).
    assert.match(source, /const listKey = hubListKey\(companyId, scope, statusFilter, refreshKey, 0, search, order\);/);
    assert.match(source, /hubNextPage\(list, page \* QUEUE_PAGE_SIZE\)/);
    assert.match(source, /loadHubPage\(companyId, \{ scope, filter: statusFilter, search, order, page: nextPage \}/);
    // The search is the text typed once the typing has paused, and the API does the searching: the hub filters no rows itself.
    assert.match(source, /const timer = setTimeout\(\(\) => setSearch\(query\.trim\(\)\), HUB_SEARCH_DELAY_MS\);\s+return \(\) => clearTimeout\(timer\);\s+\}, \[query\]\);/);
    assert.doesNotMatch(source, /searching \? Infinity|rows\.filter\(r => matchesSearch/);
    // Nonempty statuses use one chooser; queue tabs remain separate.
    assert.match(source, /<ThemedSelect aria-label="สถานะ"[^\n]+value=\{statusFilter\}/);
    assert.match(source, /statusChips\.filter\(chip => chip\.key === 'all' \|\| summary\.counts\[chip\.key\] > 0\)/);
    assert.doesNotMatch(source, /<FilterTabs[^\n]+aria-label="สถานะ"/);
    assert.doesNotMatch(source, /reimbursements-mine-summary|hubCardFilter/);
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
    assert.match(source, /<legend[^>]*>ส่งใบเบิกให้ใครอนุมัติ<\/legend>[\s\S]*?roleOptions\.map[\s\S]*?type="checkbox"[\s\S]*?toggleRole\(option\.key\)/);
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

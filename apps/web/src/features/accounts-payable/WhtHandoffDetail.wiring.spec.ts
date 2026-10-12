import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// `WhtHandoffDetail` is a large, deeply-stateful component (network calls, many hooks) inside
// AccountsPayablePages.tsx — impractical to fully render (mirrors the technique
// ForeignCurrencyNotice.spec.ts already uses for the same reason: read the source and assert on
// its structure). Pure branching logic lives in accounts-payable.model.ts
// (canIssueSystemWhtCertificate) and is unit-tested there; this file only proves the component
// actually wires that logic in, instead of a parallel condition that could drift from it.
const page = readFileSync(new URL('./AccountsPayablePages.tsx', import.meta.url), 'utf8');

test('WhtHandoffDetail recognizes SYSTEM_ISSUED as its own terminal state, not folded into EXTERNAL_LINKED', () => {
  // The drift the plan flagged (spec §4.1 note): this used to check only EXTERNAL_LINKED, so a
  // SYSTEM_ISSUED row kept showing the "แนบเอกสารที่ออกภายนอก" form.
  assert.match(page, /const issued = handoff\.status === 'SYSTEM_ISSUED';/);
  assert.match(page, /const linked = handoff\.status === 'EXTERNAL_LINKED';/);
});

test('the issue button renders through the shared canIssueSystemWhtCertificate predicate, not a duplicated condition', () => {
  assert.match(page, /\{canIssueSystemWhtCertificate\(handoff, permissions\) && !handoff\.payerMissing\?\.length && payeeAddress\.text && \(/);
});

test('issuing calls the system-certificate endpoint and downloads the returned PDF immediately', () => {
  // Confirmed by plan §2/finding: nothing ever populates WhtCertificate.pdfAttachmentId, so the
  // mint response is the only place the bytes exist — the download must happen right there.
  assert.match(page, /await issueSystemWhtCertificate\(companyId, handoff\.id\)/);
  assert.match(page, /downloadArtifact\(result\.pdfArtifact\)/);
});

test('the issued banner renders before the external-linked banner, and the issue button sits beside the external-attach form', () => {
  const issuedAt = page.indexOf('{issued ? (');
  const linkedAt = page.indexOf(') : linked ? (');
  const issueButtonAt = page.indexOf('{canIssueSystemWhtCertificate(handoff, permissions) && !handoff.payerMissing?.length && payeeAddress.text && (');
  const externalFormAt = page.indexOf('{canLink && (');
  assert.ok(issuedAt >= 0 && linkedAt > issuedAt, 'issued must be checked before linked');
  assert.ok(issueButtonAt >= 0 && externalFormAt > issueButtonAt, 'the issue button must precede the external-attach form in the same branch');
});

// Correction & replacement plan §5.1/§5.3: the two new buttons live inside the SAME `issued` block,
// gated by the shared predicates from accounts-payable.model.ts — never a duplicated condition.
test('the correction form and replacement button render through the shared predicates, inside the issued block', () => {
  const issuedAt = page.indexOf('{issued ? (');
  const linkedAt = page.indexOf(') : linked ? (');
  const correctAt = page.indexOf('{canCorrectWhtCertificate(handoff, permissions) && (');
  const replaceAt = page.indexOf('{canIssueWhtReplacementCopy(handoff, permissions) && (');
  assert.ok(correctAt > issuedAt && correctAt < linkedAt, 'the correction block must be inside the issued branch');
  assert.ok(replaceAt > issuedAt && replaceAt < linkedAt, 'the replacement button must be inside the issued branch');
});

test('correcting calls the correction endpoint and downloads the returned PDF immediately', () => {
  assert.match(page, /await correctSystemWhtCertificate\(companyId, handoff\.id, \{/);
  const downloadCalls = page.match(/downloadArtifact\(result\.pdfArtifact\)/g) ?? [];
  assert.ok(downloadCalls.length >= 3, 'issue, correct, and replace must each download the mint response immediately');
});

test('issuing a replacement copy calls the replacement-copy endpoint and downloads the returned PDF immediately, with no form', () => {
  assert.match(page, /await issueSystemWhtReplacementCopy\(companyId, handoff\.id\)/);
});

test('the correction form requires a reason before it can be submitted', () => {
  assert.match(page, /disabled=\{correctBusy \|\| !correctForm\.reason\.trim\(\)\}/);
});


test('an issuer without external-link permission can enter the address before the issue button appears', () => {
  assert.match(page, /whtHandoffPayeeAddress\(handoff, canLink \|\| permissions\.includes\('wht\.certificate\.issue'\)\)/);
  assert.match(page, /canIssueSystemWhtCertificate\(handoff, permissions\) && !handoff\.payerMissing\?\.length && payeeAddress\.text/);
  assert.equal((page.match(/wht\.print_certificate/g) ?? []).length, 2);
});
test('accounts-payable previews through the shared issue confirmation and keeps the address and payer guards before it', () => {
  assert.match(page, /<WhtIssueButton handoff=\{handoff\} busy=\{issuing\} label=\{workspaceDictionary.th\['wht.print_certificate'\]\} onIssue=\{doIssue\}/);
  assert.doesNotMatch(page, /onClick=\{\(\) => void doIssue\(\)\}/);
  assert.match(page, /canIssueSystemWhtCertificate\(handoff, permissions\) && !handoff\.payerMissing\?\.length && payeeAddress\.text/);
});

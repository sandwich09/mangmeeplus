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
  assert.match(page, /\{canIssueSystemWhtCertificate\(handoff, permissions\) && \(/);
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
  const issueButtonAt = page.indexOf('{canIssueSystemWhtCertificate(handoff, permissions) && (');
  const externalFormAt = page.indexOf('{canLink && (');
  assert.ok(issuedAt >= 0 && linkedAt > issuedAt, 'issued must be checked before linked');
  assert.ok(issueButtonAt >= 0 && externalFormAt > issueButtonAt, 'the issue button must precede the external-attach form in the same branch');
});

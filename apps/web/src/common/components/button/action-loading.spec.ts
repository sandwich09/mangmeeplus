import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('shared text/icon/file controls distinguish busy from permission locks', async () => {
  const { Button } = await import('./Button');
  const { IconButton } = await import('./IconButton');
  const { ThemedFile } = await import('../field/ThemedFile');
  for (const loading of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Button, { loading, disabled: !loading }, 'บันทึก'));
    assert.match(html, /disabled=""/);
    assert.match(html, new RegExp(`aria-busy="${loading}"`));
    assert.equal(html.includes('action-loading-spinner'), loading);
    assert.match(html, /data-loading-indicator/); // No second CSS spinner.
    const icon = renderToStaticMarkup(React.createElement(IconButton, { loading, label: 'ดาวน์โหลด', icon: React.createElement('svg', { 'data-icon': true }) }));
    assert.equal(icon.includes('action-loading-spinner'), loading);
    assert.equal(icon.includes('data-icon'), !loading);
    assert.match(icon, /aria-label="ดาวน์โหลด"/);
    const file = renderToStaticMarkup(React.createElement(ThemedFile, { loading, file: 'receipt.heic', disabled: !loading, accept: '.heic,.pdf' }));
    assert.match(file, /receipt.heic/);
    assert.match(file, /accept=".heic,.pdf"/);
    assert.match(file, /disabled=""/);
    assert.equal(file.includes('action-loading-spinner'), loading);
    assert.equal(file.includes('role="status"'), loading);
  }
});

test('native busy styling is explicit, does not duplicate existing spinners, and respects reduced motion', () => {
  const css = readFileSync(new URL('../../../../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /button\[aria-busy='true'\]:not\(\[data-loading-indicator\]\)::before/);
  assert.doesNotMatch(css, /button\[disabled\].*::before/);
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.match(motion, /action-loading-spin 750ms linear infinite/);
  for (const file of ['loading.tsx', 'system/loading.tsx']) assert.match(readFileSync(new URL(`../../../../app/${file}`, import.meta.url), 'utf8'), /LoadingState/);
});

test('all audited live pending controls are wired; disabled-only predicates do not become busy', async () => {
  const url = new URL('../../../../../../scripts/qa/action-loading-coverage.mjs', import.meta.url);
  const { auditSource } = await import(url.href);
  for (const predicate of ['!canEdit', '!name.trim()', 'fieldsLocked', 'controlsLocked', 'choice.disabled', '!!validationError']) {
    assert.equal(auditSource(`<button disabled={${predicate}} onClick={save}>Save</button>`).gaps.length, 0);
  }
  for (const predicate of ['busy || !canEdit', 'saving || !!validationError', '!file || receiptUploading', 'verifying?.id === item.id', 'busyAction !== null']) {
    const result = auditSource(`<button disabled={${predicate}} onClick={save}>Save</button>`);
    assert.equal(result.gaps.length, 1, predicate);
    assert.doesNotMatch(result.gaps[0].predicate, /canEdit|validationError|!file/);
  }
  assert.equal(auditSource('<button disabled={saving} onClick={() => setOpen(false)}>Cancel</button>').gaps.length, 0);
  assert.equal(auditSource('<button disabled={busy} aria-busy={busy} onClick={save}>Save</button>').covered, 1);
  const check = spawnSync(process.execPath, [fileURLToPath(url), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /"gaps":0/);
});

// Execute the actual handler bodies, not a reimplementation of their state transitions.
function handlers(file: string, names: string[], deps: Record<string, unknown>) {
  const text = readFileSync(new URL(`../../../features/${file}`, import.meta.url), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.push(node.getText(source));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer) found.push(`const ${node.name.text} = ${node.initializer.getText(source)};`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.length, names.length);
  const js = ts.transpileModule(found.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('deps', `const {${Object.keys(deps).join(',')}} = deps; ${js}; return {${names.join(',')}};`)(deps);
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('clipboard actions stay busy while permission/write waits and settle after rejection or retry', async () => {
  for (const [file, name] of [['crm-inbox/LineOaSettingsPage.tsx', 'copyWebhook'], ['expenses/SubstituteReceiptWizardPage.tsx', 'copyWizardLink'], ['external-signup/SignupStatusPage.tsx', 'copyLink']]) {
    let busy = false;
    let wait = deferred<void>();
    const action = handlers(file, [name], {
      copying: false, webhookUrl: 'https://example.test/webhook',
      navigator: { clipboard: { writeText: () => wait.promise } }, window: { location: { href: 'https://example.test' } },
      setCopying: (value: boolean) => { busy = value; }, setCopied: () => {}, setLinkCopied: () => {},
      setError: () => {}, apiErrorMessage: String, t: String, locale: 'th', setTimeout: () => {},
    })[name];
    const first = action(); assert.equal(busy, true, file);
    wait.reject(new Error('clipboard denied')); await first; assert.equal(busy, false, file);
    wait = deferred<void>(); const retry = action(); assert.equal(busy, true, file);
    wait.resolve(); await retry; assert.equal(busy, false, file);
  }
});

test('AI usage retry has visible pending and releases after a rejected read', async () => {
  let busy = false;
  const wait = deferred<unknown>();
  const { loadUsage } = handlers('system-partners/PartnerDetailPage.tsx', ['loadUsage'], {
    companyId: 'company', generation: {current:0}, getPartnerAiUsage: () => wait.promise,
    setUsageLoading: (value: boolean) => { busy = value; }, setUsageError: () => {}, apiErrorMessage: String,
  });
  const first = loadUsage(); assert.equal(busy, true);
  wait.reject(new Error('read failed')); await first; assert.equal(busy, false);
  assert.match(readFileSync(new URL('../../../features/system-partners/PartnerDetailPage.tsx', import.meta.url), 'utf8'), /usageLoading && <p role="status" aria-busy="true"/);
});

test('opening an existing reconciliation marks the selected run and releases on read failure', async () => {
  let busy = false, runId: string | null = null;
  const wait = deferred<unknown>();
  const { loadRun } = handlers('tax/TaxReconciliationPage.tsx', ['loadRun'], {
    companyId: 'company', busy: false, getTaxReconciliation: () => wait.promise,
    setBusy: (value: boolean) => { busy = value; }, setOpeningRunId: (value: string | null) => { runId = value; },
    setError: () => {}, transactionTaxErrorMessage: String,
  });
  const first = loadRun({ id: 'run', formType: 'PP36' }); assert.equal(busy, true); assert.equal(runId, 'run');
  wait.reject(new Error('read failed')); await first; assert.equal(busy, false); assert.equal(runId, null);
});

test('period checks show busy before waiting, reject duplicate clicks, and clear on failure/retry', async () => {
  let busy: unknown, result: unknown, calls = 0;
  let wait = deferred<string>();
  const pending = { current: false };
  const { checks } = handlers('ledger/LedgerReportsPage.tsx', ['checks'], {
    selectedPeriod: { id: 'period' }, companyId: 'company', loading: false, actionPendingRef: pending,
    setBusyAction: (value: unknown) => { busy = value; }, setError: () => {}, err: String,
    setCloseRun: (value: unknown) => { result = value; }, runCloseChecks: () => { calls++; return wait.promise; },
  });
  const first = checks();
  assert.equal(busy, 'checks'); assert.equal(pending.current, true);
  await checks(); assert.equal(calls, 1);
  wait.reject(new Error('failed')); await first;
  assert.equal(busy, null); assert.equal(pending.current, false);
  wait = deferred<string>();
  const retry = checks(); wait.resolve('PASS'); await retry;
  assert.equal(calls, 2); assert.equal(result, 'PASS'); assert.equal(busy, null);
});

test('closing a period waits for confirmation then shows busy through refresh; cancellation writes nothing', async () => {
  let busy: unknown, approved = false, calls = 0, refreshed = 0, checkRuns = 0, shown: unknown;
  let wait = deferred<void>();
  const pending = { current: false };
  const { close } = handlers('ledger/LedgerReportsPage.tsx', ['close'], {
    selectedPeriod: { id: 'period' }, companyId: 'company', loading: false, actionPendingRef: pending,
    setBusyAction: (value: unknown) => { busy = value; }, setError: () => {}, err: String,
    confirm: async () => approved, closePeriod: () => { calls++; return wait.promise; },
    load: async () => { refreshed++; }, toast: { success: () => {} },
    apiErrorCode: (error: { code?: string }) => error.code ?? null,
    runCloseChecks: async () => { checkRuns++; return 'FAILED CHECKS'; }, setCloseRun: (value: unknown) => { shown = value; },
  });
  await close(); assert.equal(calls, 0); assert.equal(pending.current, false);
  approved = true;
  const first = close(); await Promise.resolve();
  assert.equal(busy, 'close'); await close(); assert.equal(calls, 1);
  wait.reject(new Error('failed')); await first;
  assert.equal(busy, null); assert.equal(pending.current, false); assert.equal(refreshed, 0);
  assert.equal(checkRuns, 0, 'an unrelated failure does not pretend the checks failed');
  // A refused close shows the checks by itself: what is still pending, and where to fix it.
  wait = deferred<void>(); const refused = close(); await Promise.resolve();
  wait.reject(Object.assign(new Error('refused'), { code: 'close_check_failed' })); await refused;
  assert.equal(checkRuns, 1); assert.equal(shown, 'FAILED CHECKS');
  assert.equal(busy, null); assert.equal(pending.current, false); assert.equal(refreshed, 0);
  wait = deferred<void>(); const retry = close(); await Promise.resolve(); wait.resolve(); await retry;
  assert.equal(calls, 3); assert.equal(refreshed, 1); assert.equal(busy, null);
});

test('posting a claim payout shows busy, reloads the worklist either way, and keeps a refusal on screen', async () => {
  let busy: unknown, error: unknown = 'stale', loads = 0, toasts = 0;
  let wait = deferred<void>();
  const posted: unknown[][] = [];
  const { post } = handlers('expenses/ClaimPaymentPosting.tsx', ['post'], {
    companyId: 'company', setPostingId: (value: unknown) => { busy = value; }, setError: (value: unknown) => { error = value; },
    err: (cause: Error) => `ไทย:${cause.message}`, toast: { success: () => { toasts++; } },
    generateSourceJournal: (...args: unknown[]) => { posted.push(args); return wait.promise; }, load: async () => { loads++; },
  });
  const refused = post('pay-1');
  assert.equal(busy, 'pay-1'); assert.equal(error, null, 'a new attempt clears the last refusal');
  wait.reject(new Error('posting_rule_missing')); await refused;
  assert.deepEqual(posted, [['company', 'reimbursement.payment', 'pay-1']]);
  assert.equal(error, 'ไทย:posting_rule_missing'); assert.equal(toasts, 0);
  assert.equal(loads, 1, 'a refused payout changes status, so the list is read again'); assert.equal(busy, null);
  wait = deferred<void>(); const accepted = post('pay-1'); wait.resolve(); await accepted;
  assert.equal(error, null); assert.equal(toasts, 1); assert.equal(loads, 2); assert.equal(busy, null);
});

test('signature background preparation locks until image/blob completes and unlocks on decode failure', async () => {
  for (const fail of [false, true]) {
    let busy = false, imageLoads = 0, blobReady: ((value: Blob | null) => void) | undefined;
    const pending = { current: false }, revoked: string[] = [];
    const { buildPreview } = handlers('expenses/ExpensesWorkspacePanels.tsx', ['buildPreview'], {
      preparedFile: {}, saving: false, preparingFile: false, previewPendingRef: pending,
      setPreviewing: (value: boolean) => { busy = value; }, setActionError: () => {}, uploadErrorMessage: String,
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL: (url: string) => revoked.push(url) },
      Image: class { naturalWidth = 1; naturalHeight = 1; onload = () => {}; onerror = () => {}; set src(_value: string) { imageLoads++; queueMicrotask(() => fail ? this.onerror() : this.onload()); } },
      canvasRef: { current: { getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({}), putImageData() {} }), toDataURL: () => 'data:preview', toBlob: (callback: (value: Blob | null) => void) => { blobReady = callback; } } },
      removeLightBackground: () => ({}), setDerivedBlob: () => {}, setPreview: () => {},
    });
    const first = buildPreview(); assert.equal(busy, true); assert.equal(pending.current, true);
    await buildPreview(); assert.equal(imageLoads, 1);
    await Promise.resolve(); await Promise.resolve();
    if (!fail) { assert.equal(busy, true); blobReady!(new Blob()); }
    await first; assert.equal(busy, false); assert.equal(pending.current, false);
    assert.deepEqual(revoked, fail ? ['blob:test'] : []);
  }
});

test('bill opening shares loading across row/deep-link/create paths and ignores stale scope responses', async () => {
  let loading = false, selected: unknown, calls = 0;
  const pending = { current: false }, scope = { current: 0 };
  const firstWait = deferred<string>(), secondWait = deferred<string>();
  const { openBill } = handlers('accounts-payable/AccountsPayablePages.tsx', ['openBill'], {
    useCallback: (fn: unknown) => fn, companyId: 'company', billOpenPendingRef: pending, billOpenRequestRef: scope,
    setDeepLinkLoading: (value: boolean) => { loading = value; }, setOpeningBillId: () => {}, setError: () => {}, err: String,
    setSelected: (value: unknown) => { selected = value; }, getVendorBill: () => ++calls === 1 ? firstWait.promise : secondWait.promise,
  });
  const first = openBill('first'); assert.equal(loading, true);
  await openBill('first'); assert.equal(calls, 1);
  scope.current++; pending.current = false; // Company/unmount cleanup invalidates the old read.
  const second = openBill('second'); firstWait.resolve('stale'); await first;
  assert.equal(selected, undefined); assert.equal(loading, true); assert.equal(pending.current, true);
  secondWait.resolve('current'); await second;
  assert.equal(selected, 'current'); assert.equal(loading, false); assert.equal(pending.current, false);
});

// The hub's claim-opening pending state (openDetail/drawerBusy) was retired with the detail
// drawer in Phase 6: every queue row now navigates straight to the journey page, which owns its
// own loading state (see ReimbursementJourneyPage.tsx's LoadingState while `detail` is null).

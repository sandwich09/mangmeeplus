import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertIsolatedReplayDatabase, captureRuntimeTurnEvidence, runLineReliabilityRuntime, runtimeAttachmentMessage, runtimeFailureDiagnostic, runtimeAskedSlots, runtimeDatabaseEffects, runtimeBusinessSnapshot, runtimeBusinessEffects, runtimeAttemptId, runtimeEventIdPrefix, runtimeAssetMessageId, resetRuntimeAfterHook, runtimeDeliveryEvidence, runtimeSourceFacts, runtimeSourceId, runtimeSemanticOutcome, instrumentRuntimeMethod, selectRuntimePostback, type RuntimeTurnEvidence } from './line-ai-reliability-runtime';
import { capRejectionCount, installEvalGuard } from './line-ai-expense-advisor/eval-spend';

test('real PostgreSQL: eval_guard blocks an over-cap reservation and preserves the rejection sequence', { skip: !process.env['BILLING_TEST_DATABASE_URL'] }, async () => {
  const databaseUrl = process.env['BILLING_TEST_DATABASE_URL']!;
  assertIsolatedReplayDatabase(databaseUrl);
  const requireApi = createRequire(resolve(process.cwd(), 'apps/api/package.json'));
  const { Client } = requireApi('pg') as { Client: new (options: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> } };
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let installed = false;
  try {
    await installEvalGuard(client, databaseUrl, '1.00');
    installed = true;
    await client.query('UPDATE eval_guard.ledger_satang SET amount = 100 WHERE id = true');
    const before = await capRejectionCount(client);
    await assert.rejects(client.query(`INSERT INTO public."AiBudgetReservation"
      ("id","companyId","monthKey","bucket","policyRevision","sourceRoute","stepKind","attemptKey","invocationKey","upperBoundSatang","pricingSnapshot","ownerToken")
      VALUES ('eval-guard-test','no-company-needed-before-trigger','2026-11','CHAT','test','line-turn','test','attempt','eval-guard-test-invocation',1,'{}','owner')`), /EVAL_RUN_CAP/);
    const after = await capRejectionCount(client);
    assert.equal(BigInt(after), BigInt(before) + 1n);
  } finally {
    try {
      if (installed) {
        await client.query('UPDATE eval_guard.ledger_satang SET amount = 0 WHERE id = true');
        const maxThb = process.env['MANGMEE_EVAL_MAX_THB'] ?? '2000.00';
        const [baht, fraction = ''] = maxThb.split('.');
        await client.query('UPDATE eval_guard.settings SET max_satang = $1 WHERE id = true', [String(BigInt(baht!) * 100n + BigInt(fraction.padEnd(2, '0')))]);
      }
    } finally { await client.end(); }
  }
});

test('onBeforeReset runs before the database reset and receives its conversation attempt', async () => {
  const order: string[] = [];
  const conversation = { id: 'sample' } as any;
  const attemptId = runtimeAttemptId('sample', 2);
  await resetRuntimeAfterHook((row, id) => { order.push(`hook:${row.id}:${id}`); }, conversation, attemptId, async () => {
    order.push('truncate');
  });
  assert.deepEqual(order, [`hook:sample:${attemptId}`, 'truncate']);
});

test('event IDs use an attempt-specific prefix while the legacy attempt number remains stable', () => {
  const firstAttempt = runtimeAttemptId('sample', 0), retry = runtimeAttemptId('sample', 0);
  assert.notEqual(firstAttempt, retry);
  assert.notEqual(runtimeEventIdPrefix(firstAttempt, 1), runtimeEventIdPrefix(retry, 1));
  assert.notEqual(runtimeAssetMessageId(firstAttempt, 1, 'receipt-1'), runtimeAssetMessageId(retry, 1, 'receipt-1'));
  assert.equal(runtimeEventIdPrefix(firstAttempt, 1), runtimeEventIdPrefix(firstAttempt, 1));
});

test('collectionState is snapshotted separately and excluded from scored business effects', () => {
  const before = { ReimbursementDraftAction: [{ id: 'draft', status: 'COLLECTING' }],
    ExpenseRecord: [{ id: 'expense', amount: '10', sourceChannelMetadataJson: null, updatedAt: 'one', updatedByUserId: 'actor' }] };
  const after = { ReimbursementDraftAction: [{ id: 'draft', status: 'PREVIEW' }],
    ExpenseRecord: [{ id: 'expense', amount: '10', sourceChannelMetadataJson: { step: 2 }, updatedAt: 'two', updatedByUserId: 'actor-2' }] };
  const prior = runtimeBusinessSnapshot(before), next = runtimeBusinessSnapshot(after);
  assert.equal(next.collectionState.ReimbursementDraftAction?.[0]?.status, 'PREVIEW');
  assert.equal(next.business.ExpenseRecord?.[0]?.amount, '10');
  assert.deepEqual(runtimeDatabaseEffects(prior.business, next.business), []);
  assert.deepEqual(runtimeDatabaseEffects(before, after).map(row => row.kind).sort(), ['ExpenseRecord.update', 'ReimbursementDraftAction.update']);
  assert.deepEqual(runtimeBusinessEffects(before, after), []);
  assert.equal(runtimeBusinessEffects(before, { ...after, ExpenseRecord: [{ ...after.ExpenseRecord[0]!, updatedByUserId: 'actor' }] }).length, 1,
    'an incomplete continuation-only change remains a business effect');
});

test('existing turns keep their message and attachment defaults without a typed action', () => {
  const oldTurn = { user: 'ใบเสร็จนี้', attachmentIds: ['receipt-1'] };
  const currentTurn = { ...oldTurn, action: undefined };
  assert.equal(currentTurn.user, oldTurn.user);
  assert.deepEqual(currentTurn.attachmentIds, oldTurn.attachmentIds);
});

test('clarification trace keeps nested typed missing fields without guessing slots from prose', () => {
  assert.deepEqual(runtimeAskedSlots({ missingFields: ['amount'], captureHints: { missingFields: ['expenseDate', 'amount'] },
    reimbursementHints: { missingFields: ['purpose'] }, correctionHints: { missingFields: ['targetExpenseId'] } }),
  ['amount', 'expenseDate', 'purpose', 'targetExpenseId']);
  assert.deepEqual(runtimeAskedSlots({ clarifyQuestion: 'Which period?', semanticCoverage: [{ status: 'needs_user', question: 'Which account?' }] }), []);
  assert.deepEqual(runtimeAskedSlots({ missingFields: [null, {}, '', 'not a field'] }), []);
});

test('runtime replay refuses production, ordinary development databases and foreign schemas before reset', () => {
  assert.doesNotThrow(() => assertIsolatedReplayDatabase('postgresql://test:test@127.0.0.1:15440/watchdog_ai_reliability_replay_smoke?schema=public'));
  for (const url of ['postgresql://test:test@db.prod/watchdog_ai_reliability_replay_smoke', 'postgresql://test:test@localhost/watchdog_bms',
    'postgresql://test:test@localhost/watchdog_ai_reliability_replay_smoke?schema=customer', 'https://localhost/watchdog_ai_reliability_replay_smoke']) assert.throws(() => assertIsolatedReplayDatabase(url), /DEDICATED_LOCAL/);
});

test('launch bootstrap refuses a truthy non-boolean before touching runtime services', async () => {
  await assert.rejects(runLineReliabilityRuntime({ version: 2, databaseUrl: 'postgresql://test:test@127.0.0.1:15440/watchdog_ai_reliability_replay_smoke', bootstrapLaunchGates: 'true' } as any, '/unused'), /REPLAY_INVALID_LAUNCH_BOOTSTRAP_FLAG/);
});

test('PDF webhook metadata comes from verified asset bytes; image shape remains unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'line-replay-file-'));
  try {
    mkdirSync(join(root, 'docs/research'), { recursive: true });
    const bytes = Buffer.from('synthetic ใบเสร็จ');
    const asset = { path: 'docs/research/receipt.pdf', sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'application/pdf' };
    writeFileSync(join(root, asset.path), bytes);
    assert.deepEqual(runtimeAttachmentMessage('file-a', asset, root), { type: 'file', id: 'file-a', fileName: 'receipt.pdf', fileSize: bytes.length });
    assert.deepEqual(runtimeAttachmentMessage('image-a', { ...asset, mimeType: 'image/png' }, root), { type: 'image', id: 'image-a' });
    assert.throws(() => runtimeAttachmentMessage('file-a', { ...asset, sha256: '0'.repeat(64) }, root), /REPLAY_ASSET_BYTES_CHANGED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('effect evidence detects create/update/delete even when the application throws after commit', () => {
  const changes = runtimeDatabaseEffects({ ExpenseRecord: [{ id: 'same', version: 1 }, { id: 'edit', version: 2 }, { id: 'gone' }] },
    { ExpenseRecord: [{ id: 'same', version: 1 }, { id: 'edit', version: 3 }, { id: 'new', version: 1 }] });
  assert.deepEqual(changes.map(row => [row.kind, row.recordId, row.revision]), [
    ['ExpenseRecord.create', 'new', '1'], ['ExpenseRecord.delete', 'gone', 'deleted'], ['ExpenseRecord.update', 'edit', '3'],
  ]);
  assert.ok(changes.every(row => row.evidence === 'database_snapshot' && /^[a-f0-9]{64}$/.test(row.evidenceHash)));
});

test('collector uses cited permission-checked source facts without copying oracle values', () => {
  const result = { status: 'ok', sourceRefs: [{ id: 'source-1', permissionChecked: true }], facts: [{ id: 'f1', metric: 'expense_total', value: '12.50', unit: 'money', currency: 'THB',
    period: { startDate: '2026-09-01', endDate: '2026-09-30', timezone: 'Asia/Bangkok' }, dateBasis: 'expense_date', statusBasis: 'not_voided', sourceRefIds: ['source-1'], asOf: '2026-09-27T00:00:00Z', state: 'known' }] } as any;
  assert.equal(runtimeSourceFacts([result], new Set()).length, 0);
  const [fact] = runtimeSourceFacts([result], new Set(['source-1']));
  assert.equal(fact!.basis, 'expense_date|not_voided'); assert.equal(fact!.value, '12.50'); assert.equal(fact!.sourceRef, 'source-1');
  assert.deepEqual(runtimeSourceFacts([{ ...result, status: 'forbidden' }], new Set(['source-1'])), []);
  const source = { label: 'Expense summary', module: 'expense', entityType: 'expense_summary', permissionChecked: true } as const;
  const canonical = runtimeSourceId(source);
  const idless = { ...result, sourceRefs: [source], facts: [{ ...result.facts[0], sourceRefIds: [canonical] }] };
  assert.equal(runtimeSourceFacts([idless], new Set([canonical]))[0]?.sourceRef, 'expense:expense_summary:summary');
  assert.equal(runtimeSourceFacts([idless], new Set(['some-other-source'])).length, 0);
  assert.equal(runtimeSourceFacts([{ ...idless, sourceRefs: [{ ...source, permissionChecked: false }] } as any], new Set([canonical])).length, 0);
});

test('semantic outcome preserves partial clauses and normalizes actual typed terminal evidence', () => {
  assert.equal(runtimeSemanticOutcome([{ index: 0, status: 'handled' }, { index: 1, status: 'needs_user' }], [], []), 'partial');
  assert.equal(runtimeSemanticOutcome([{ index: 0, status: 'denied' }], [], []), 'access_denied');
  assert.equal(runtimeSemanticOutcome([{ index: 0, status: 'unsupported' }], [], []), 'unsupported_action');
  assert.equal(runtimeSemanticOutcome([{ index: 0, status: 'needs_user' }], [], []), 'needs_input');
  assert.equal(runtimeSemanticOutcome([], [{ status: 'batched' }, { status: 'completed' }], []), 'answered');
  assert.equal(runtimeSemanticOutcome([], [{ status: 'completed' }], [{ refused: true, refusalReason: 'mutation_blocked' } as any]), 'policy_blocked');
  assert.equal(runtimeSemanticOutcome([], [{ status: 'no_membership' }], []), 'access_denied');
  assert.equal(runtimeSemanticOutcome([], [{ status: 'clarification_required' }], []), 'needs_input');
  assert.equal(runtimeSemanticOutcome([], [{ status: 'new_unclassified_status' }], []), 'event:new_unclassified_status');
  assert.equal(runtimeSemanticOutcome([], [], []), 'missing_terminal_event');
});

test('delivery completeness comes from every frozen batch, not merely the batches sent', () => {
  const one = [{ type: 'text', text: 'first' }], two = [{ type: 'text', text: 'last' }];
  const plans = [{ planJson: { batches: [{ id: 'b1', primary: { wireHash: 'a'.repeat(64), messages: one } }, { id: 'b2', primary: { wireHash: 'b'.repeat(64), messages: two } }] },
    batchStateJson: [{ batchId: 'b1', status: 'ACCEPTED', variant: 'primary', providerRequestId: 'receipt-1' }, { batchId: 'b2', status: 'READY', variant: 'primary', providerRequestId: null }] }];
  const partial = runtimeDeliveryEvidence(plans, [], [{ messages: one, at: 10, receiptId: 'receipt-1' }]);
  assert.deepEqual(partial.requiredBatchIds, ['b1', 'b2']); assert.equal(partial.accepted.length, 1); assert.equal(partial.status, 'INCOMPLETE');
  assert.equal(runtimeDeliveryEvidence(plans, [], [{ messages: two, at: 10, receiptId: 'receipt-1' }]).accepted.length, 0, 'wrong payload cannot prove acceptance');
});

test('instrumented actual methods retain receiver and thrown effects', async () => {
  const service = { value: 0, async mutate(n: number) { this.value += n; if (n < 0) throw new Error('after-write'); return this.value; } };
  const seen: string[] = [];
  instrumentRuntimeMethod(service, 'mutate', async (original, args) => { try { const result = await original(...args); seen.push(`ok:${result}`); return result; } catch (error) { seen.push('failed'); throw error; } });
  assert.equal(await service.mutate(2), 2); await assert.rejects(service.mutate(-1), /after-write/);
  assert.equal(service.value, 1); assert.deepEqual(seen, ['ok:2', 'failed']);
});

 test('runtime clicks only one exact action already accepted in the preceding wire', () => {
  const message = { type: 'flex', contents: { footer: { contents: [{ type: 'button', action: { type: 'postback', label: 'ยืนยัน', data: 'action=confirm&previewId=actual-current-preview' } }] } } };
  assert.equal(selectRuntimePostback(message, 'ยืนยัน'), 'action=confirm&previewId=actual-current-preview');
  assert.throws(() => selectRuntimePostback(message, 'ยกเลิก'), /NOT_UNIQUELY/);
  assert.throws(() => selectRuntimePostback([message, { type: 'postback', label: 'ยืนยัน', data: 'other-preview' }], 'ยืนยัน'), /NOT_UNIQUELY/);
});

test('human evidence preserves wire, raw intake/tool results and review state without later mutation', () => {
  const original: RuntimeTurnEvidence = {
    scenarioId: 'NAT-01', repeat: 0, turnIndex: 0, user: 'ใบนี้เท่าไหร่', attachmentIds: ['receipt-a'], companyId: 'company-a',
    sourceSnapshot: 'source-a', snapshotDigest: 'a'.repeat(64), acceptedAtMs: 100, modelWorkCompletedAtMs: 180,
    receipts: [{ messages: [{ type: 'text', text: '250.00 บาท' }], at: 200, receiptId: 'sink-1', path: '/v2/bot/message/reply', payloadHash: 'b'.repeat(64) }],
    toolResults: [{ tool: 'expense.get_detail', input: { id: 'expense-a' }, startedAtMs: 110, completedAtMs: 140, result: { status: 'ok', data: { amount: '250.00' } } as any }],
    gatewayResponses: [{ method: 'requestLineIntakeRoute', requestId: 'request-a', startedAtMs: 105, completedAtMs: 180,
      response: { semanticSubrequests: [{ text: 'ใบนี้เท่าไหร่' }], preparedPlan: { steps: ['read'] } } }],
    webhookEvents: [{ status: 'completed' }], providerUsage: [{ modelId: 'actual-model', inputTokens: 200, outputTokens: 30, usageBasis: 'PROVIDER_REPORTED' }], reservations: [],
    reviewState: { before: { draftActions: [], conversations: [], truncated: false }, after: { draftActions: [{ status: 'PREVIEW' }], conversations: [{ preferenceJson: { brevity: 'short' } }], truncated: false } },
    delivery: { requiredBatchIds: ['batch-a'], accepted: [{ batchId: 'batch-a', wireHash: 'c'.repeat(64), acceptedAtMs: 200, receiptId: 'sink-1' }], status: 'ACCEPTED' },
  };
  const captured = captureRuntimeTurnEvidence(original);
  (original.receipts[0]!.messages as any[])[0].text = 'changed';
  (original.gatewayResponses[0]!.response as any).preparedPlan.steps.push('write');
  (original.reviewState.after.conversations[0] as any).preferenceJson.brevity = 'long';
  assert.equal((captured.receipts[0]!.messages as any[])[0].text, '250.00 บาท');
  assert.deepEqual((captured.gatewayResponses[0]!.response as any).preparedPlan.steps, ['read']);
  assert.equal((captured.reviewState.after.conversations[0] as any).preferenceJson.brevity, 'short');
  assert.equal(captured.receipts[0]!.at - captured.acceptedAtMs, 100);
  assert.equal((captured.toolResults[0]!.result as any).data.amount, '250.00');
});

test('failure diagnostics retain assertion and Prisma code but never arbitrary secret-bearing text', () => {
  assert.equal(runtimeFailureDiagnostic(new Error('REPLAY_ENTITLEMENT_SEED_MISMATCH')).assertion, 'REPLAY_ENTITLEMENT_SEED_MISMATCH');
  const diagnostic = runtimeFailureDiagnostic({ name: 'PrismaClientKnownRequestError', code: 'P2002', message: 'postgresql://user:secret@localhost/private',
    meta: { modelName: 'User', target: ['email', 'https://secret@example.com'] } });
  assert.deepEqual(diagnostic, { name: 'PrismaClientKnownRequestError', code: 'P2002', assertion: undefined, model: 'User', target: ['email'] });
  assert.ok(!JSON.stringify(diagnostic).includes('secret'));
});

test('unlinked replay actors reach the before-link path without resolving a company role', async () => {
  const { runtimeActorContext } = await import('./line-ai-reliability-runtime');
  let calls = 0;
  const fallback = { companyId: 'company-b', userId: 'owner-b', lineUserId: 'Ulinked' };
  const resolveAccess = async () => { calls++; throw new Error('must not resolve an unlinked identity'); };
  assert.deepEqual(await runtimeActorContext({ kind: 'unlinked', lineUserId: 'Uunknown' }, fallback, resolveAccess), { companyId: '', userId: '', lineUserId: 'Uunknown' });
  assert.equal(calls, 0);
  assert.deepEqual(await runtimeActorContext(undefined, fallback, resolveAccess), fallback);
  const creator = { companyId: 'company-b', userId: 'creator', lineUserId: 'Ucreator', role: 'STAFF', runtimeRole: 'EVAL_DRAFT_CREATOR', branchIds: ['branch-1'] };
  assert.deepEqual(await runtimeActorContext(creator, fallback, async () => ({ roles: ['EVAL_DRAFT_CREATOR'], scopes: { branchIds: ['branch-1'] } })), { companyId: 'company-b', userId: 'creator', lineUserId: 'Ucreator' });
  for (const companyId of ['company-paid', 'company-free']) {
    const actor = { companyId, userId: 'member', lineUserId: 'Umember', role: 'STAFF', branchIds: ['branch-1'] };
    assert.deepEqual(await runtimeActorContext(actor, fallback, async () => ({ roles: ['STAFF'], scopes: { branchIds: ['branch-1'] } })), { companyId, userId: 'member', lineUserId: 'Umember' });
    await assert.rejects(() => runtimeActorContext(actor, fallback, async () => ({ roles: ['STAFF'], scopes: { branchIds: ['branch-2'] } })), /REPLAY_ACTOR_BRANCH_SCOPE_MISMATCH/);
    await assert.rejects(() => runtimeActorContext(actor, fallback, async () => ({ roles: [], scopes: { branchIds: ['branch-1'] } })), /REPLAY_ACTOR_ROLE_MISMATCH/);
  }
});

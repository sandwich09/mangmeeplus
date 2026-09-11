// Executable SPEC, not production behavior. Reachability assumes the named external facts/actors.
// Run: node docs/research/expense-evidence-recovery-model-2026-09-11.mjs
import assert from 'node:assert/strict';

// A checkpoint preserves/waits for work; it is NOT synonymous with a completed expense.
// User removed accounting handoff: no assignment, queue, notification or request-review action.
const checkpoints = new Set(['SAVED_DRAFT', 'WAIT_FACTS', 'WAIT_EVIDENCE', 'WAIT_PAYMENT', 'WAIT_NETWORK', 'WAIT_AUTH', 'WAIT_APPROVER', 'WAIT_PERIOD', 'ACTION_REQUIRED', 'ACCESS_NOTICE', 'VIEW_ONLY', 'VIEW_EXISTING', 'CONFIRMED']);
// [from, to, action, external prerequisite (null = an available local recovery action)]
const edges = [
  ['PENDING_REVIEW', 'SAVED_DRAFT', 'save partial review without acknowledgement', null],
  ['PENDING_REVIEW', 'WAIT_FACTS', 'save known facts and record what is missing', null],
  ['SAVED_DRAFT', 'REVIEW_DIRTY', 'reopen same expense and retrieve saved fields', 'the user returns with existing access; unresolved facts still need completion'],
  ['REVIEW_DIRTY', 'SAVED_DRAFT', 'save current draft without asserting reviewed', null],
  ['REVIEW_DIRTY', 'SOURCE_REVIEWED', 'explicitly review resolved source document', 'authorized reviewer and valid source facts'],
  ['SOURCE_REVIEWED', 'FINAL_SOURCE', 'next with current source review', null],
  ['FINAL_SOURCE', 'READY_SOURCE', 'submit current source expense', 'minimum submission facts are complete'],
  ['READY_SOURCE', 'CONFIRMED', 'confirm existing expense', 'authorized confirmer and current finance/tax validations pass'],
  ['ALT_REVIEWED', 'FINAL_ALT', 'next with referenced accepted alternative evidence', null],
  ['FINAL_ALT', 'READY_ALT', 'submit current alternative-evidence expense', 'minimum submission facts are complete'],
  ['READY_ALT', 'CONFIRMED', 'confirm accepted alternative evidence in repository transaction', 'authorized confirmer and current finance/tax validations pass'],
  ['CERT_REVIEWED', 'CERT_DETAILS', 'open existing certificate workflow', null],
  ['CERT_DETAILS', 'SAVED_DRAFT', 'save certificate working data without issuing', null],
  ['CERT_DETAILS', 'PREPARED', 'prepare once', 'valid source/payment/payee facts, permitted policy, reviewer and CAS'],
  ['PREPARED', 'WAIT_APPROVER', 'keep existing form and pending signing state', null],
  ['PREPARED', 'SIGNED', 'certify current revision', 'authorized signer and truthful current payment facts'],
  ['SIGNED', 'WAIT_APPROVER', 'keep signed revision awaiting approval', null],
  ['SIGNED', 'ISSUED', 'approve same revision with existing payment policy', 'authorized approver and matching signed snapshot'],
  ['ISSUED', 'FINAL_CERT', 'return to the same expense', null],
  ['FINAL_CERT', 'READY_CERT', 'submit with current issued evidence', 'minimum submission facts are complete'],
  ['READY_CERT', 'CONFIRMED', 'confirm with issued artifact authority', 'authorized confirmer and current finance/tax validations pass'],
  ['MISSING_PROOF', 'WAIT_EVIDENCE', 'save and request specific missing proof', null],
  ['WAIT_EVIDENCE', 'REVIEW_DIRTY', 'resume existing draft with new evidence', 'genuine sufficient evidence becomes available'],
  ['UNKNOWN_AMOUNT', 'WAIT_FACTS', 'save draft with unknown amount, not a fabricated zero', null],
  ['WAIT_FACTS', 'REVIEW_DIRTY', 'supply and review missing facts', 'truthful facts become available'],
  ['CASH_STRICT', 'WAIT_EVIDENCE', 'save and obtain the policy-required payment proof', null],
  ['CHECK_BILL_UNPAID', 'WAIT_PAYMENT', 'keep unpaid business draft', null],
  ['WAIT_PAYMENT', 'MISSING_PROOF', 'record actual payment facts for review', 'actual payment occurs; not an invented paid date'],
  ['NO_REVIEW_PERMISSION', 'ACCESS_NOTICE', 'preserve existing draft and explain review permission; only save fields already writable', null],
  ['NO_CONFIRM_PERMISSION', 'ACCESS_NOTICE', 'preserve reviewed expense and explain required confirmation permission', null],
  ['ACCESS_REVOKED', 'ACCESS_NOTICE', 'show permission recovery without exposing inaccessible records or claiming save', null],
  ['NETWORK_FAILED', 'WAIT_NETWORK', 'retain unsent form in current session and expose retry', null],
  ['WAIT_NETWORK', 'REVIEW_DIRTY', 'retry after checking source revision', 'network returns; current-session edits are still available'],
  ['SESSION_EXPIRED', 'WAIT_AUTH', 'retain current-session form and request sign-in', null],
  ['WAIT_AUTH', 'REVIEW_DIRTY', 'resume same principal and recheck source', 'same authorized principal signs in again'],
  ['CAS_CONFLICT', 'REVIEW_DIRTY', 'compare current server version and retained input', null],
  ['READ_ONLY', 'VIEW_ONLY', 'view/history/download according to scope', null],
  ['ISSUED_CHANGE', 'ACTION_REQUIRED', 'preserve issued facts and show existing correction/cancellation requirements', null],
  ['CLOSED_PERIOD', 'WAIT_PERIOD', 'preserve facts for authorized period correction', null],
  ['UNSUPPORTED_CURRENCY', 'ACTION_REQUIRED', 'save expense and state unsupported certificate currency', null],
  ['RENDER_LIMIT', 'ACTION_REQUIRED', 'preserve complete lines and explain format limit', null],
  ['PARTIAL_FUNDING', 'ACTION_REQUIRED', 'preserve actual payments and explain unsupported flow; no fake full-payment acknowledgement', null],
  ['NO_APPROVER', 'WAIT_APPROVER', 'keep document and request permitted policy/member setup', null],
  ['POSSIBLE_DUPLICATE', 'REVIEW_DIRTY', 'compare and resolve duplicate with scoped permission', null],
  ['KNOWN_DUPLICATE', 'VIEW_EXISTING', 'open existing expense; no extra posting', null],
  ['VAT_DIFFERENCE', 'REVIEW_DIRTY', 'use existing authorized source-VAT decision or correct VAT-bearing line', null],
  ['WHT_CLASS_MISSING', 'WAIT_FACTS', 'save and request actual payee taxpayer class', null],
  ['SOURCE_CHANGED_AFTER_SIGN', 'CERT_DETAILS', 'amend same mutable document and require fresh signature', null],
  ['REJECTED', 'REVIEW_DIRTY', 'reopen existing record within permission and status rules', null],
];

function path(start, targets, graph = edges, allowExternal = false, forbidden = new Set()) {
  const queue = [{ node: start, trace: [] }], visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (targets.has(current.node)) return current.trace;
    if (visited.has(current.node)) continue;
    visited.add(current.node);
    for (const edge of graph.filter(([from]) => from === current.node)) {
      if (forbidden.has(edge[1]) || (!allowExternal && edge[3])) continue;
      queue.push({ node: edge[1], trace: [...current.trace, { action: edge[2], to: edge[1], requires: edge[3] }] });
    }
  }
  return null;
}

const blockedStates = ['PENDING_REVIEW', 'REVIEW_DIRTY', 'CERT_DETAILS', 'PREPARED', 'SIGNED', 'MISSING_PROOF', 'UNKNOWN_AMOUNT', 'CASH_STRICT', 'CHECK_BILL_UNPAID', 'NO_REVIEW_PERMISSION', 'NO_CONFIRM_PERMISSION', 'ACCESS_REVOKED', 'NETWORK_FAILED', 'SESSION_EXPIRED', 'CAS_CONFLICT', 'READ_ONLY', 'ISSUED_CHANGE', 'CLOSED_PERIOD', 'UNSUPPORTED_CURRENCY', 'RENDER_LIMIT', 'PARTIAL_FUNDING', 'NO_APPROVER', 'POSSIBLE_DUPLICATE', 'KNOWN_DUPLICATE', 'VAT_DIFFERENCE', 'WHT_CLASS_MISSING', 'SOURCE_CHANGED_AFTER_SIGN', 'REJECTED'];
const recoveries = blockedStates.map(state => {
  const trace = path(state, checkpoints);
  assert(trace, `No recovery/checkpoint without inventing an external event: ${state}`);
  return { state, trace };
});
const certificateStates = new Set(['CERT_REVIEWED', 'CERT_DETAILS', 'PREPARED', 'SIGNED', 'ISSUED', 'FINAL_CERT', 'READY_CERT']);
const completion = ['SOURCE_REVIEWED', 'ALT_REVIEWED', 'CERT_REVIEWED'].map(start => {
  const trace = path(start, new Set(['CONFIRMED']), edges, true, start === 'CERT_REVIEWED' ? new Set() : certificateStates);
  assert(trace, `No completion path for selected route: ${start}`);
  return { start, trace, conditional: true };
});
assert(!path('CHECK_BILL_UNPAID', new Set(['CONFIRMED']), edges, false), 'Unpaid facts must not become completed payment by clicking');
assert(!path('NETWORK_FAILED', new Set(['CONFIRMED']), edges, false), 'Offline must never claim server save/confirmation');
assert(!path('ACCESS_REVOKED', new Set(['CONFIRMED']), edges, true), 'No implicit permission escalation');
assert(path('PENDING_REVIEW', new Set(['CONFIRMED']), edges, true, certificateStates), 'Saved pending work must have a conditional resume path without accounting handoff or a certificate');
assert(!edges.some(edge => /REQUEST_REVIEW|WAIT_REVIEWER|ACCOUNTING_HANDOFF|assign|hand.?off/i.test(edge.join(' '))), 'Removed accounting handoff must not remain a recovery dependency');

// Fault injection: this proof must detect the exact kind of missing recovery/final-route edges found in the app.
const faults = [
  { name: 'remove pending draft recovery', check: () => path('PENDING_REVIEW', checkpoints, edges.filter(([from]) => from !== 'PENDING_REVIEW')) },
  { name: 'remove alternative evidence final path', check: () => path('ALT_REVIEWED', new Set(['CONFIRMED']), edges.filter(([from]) => from !== 'READY_ALT'), true) },
  { name: 'force certificate entry to wait before preparation', check: () => path('CERT_REVIEWED', new Set(['CONFIRMED']), edges.filter(([from]) => from !== 'CERT_REVIEWED'), true) },
];
for (const fault of faults) assert.equal(fault.check(), null, `Proof failed to detect: ${fault.name}`);
console.log(JSON.stringify({ kind: 'conditional-spec-reachability', operationalRecoveryStates: recoveries.length, completionRoutes: completion.length, faultInjectionsDetected: faults.length,
  pendingDraftResumeWithoutHandoff: true,
  claim: 'The declared spec graph has reachable save/wait/action-required checkpoints and conditional completion for three supported routes without accounting handoff. This is NOT browser/API E2E proof, durable offline storage, or a guarantee that external facts/permissions will arrive.', recoveries, completion }, null, 2));

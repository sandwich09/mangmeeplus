# Mangmee AI: durable delivery contract v2.4

Status: implementation-ready specification; application code and migrations are **not implemented** by this document. Date: 2026-09-27. Source baseline: `f932b57766f5dd22c0d28aedd4bc06f210e374ef`. Normative appendix to [understanding/reliability spec](mangmee-ai-understanding-and-advisor-reliability-spec-th.md) §19.4–19.6; evidence is in [dependency audit](../research/mangmee-ai-dependency-impact-audit-2026-09-27-th.md). “Ticket” in this work means รายการรายจ่าย / ใบทดแทน / ใบเบิก; it does not authorize support-ticket creation or a developer issue integration.

## 1. Frozen decisions and boundaries

1. Preserve the existing webhook outcome, ledger reservation and capture outbox as the owners. Add **one child table**, `LineDeliveryPlan`, for immutable v2 payloads and bounded batch checkpoints. This is part of the existing API/worker and Prisma transaction model, not a new deployed service, queue or framework. Existing `LineLedgerDeliveryService` owns the persistence helpers; producer use cases retain their business logic.
2. Separate `businessCommitted`, `answerComplete`, `allRequiredApiAccepted`. Provider acceptance means the LINE API accepted the request; it does not prove device delivery, reading, semantic correctness or completion of a business mutation.
3. Canonical answer and source-bound logical items are authoritative. Card previews, altText, telemetry previews and cached conversation summaries are never recovery payloads. A long answer uses text parts; a Flex card is optional presentation and cannot remove a logical item.
4. Every batch has frozen primary/fallback wire payloads, destination binding and retry keys before its first provider attempt. UNKNOWN blocks later batches. A retry cannot regenerate the answer, rewrite a link, change its recipient or run the business operation again.
5. Reserve decision controls before splitting. A confirmation button is emitted only after every required before/after value has been included in the accepted prefix and the current batch. Its server handler still rechecks preview ID, revision, actor, company, permission and expiry. Delivery never grants authority.
6. Use existing permission-checked owner APIs and source-read methods. AI Gateway receives no repository access. Delivery retries never call OCR, model generation, expense capture, substitute preparation, approval, payment or posting.
7. Private delivery is one-to-one LINE only: `chatId === lineUserId`, same verified messaging channel and recipient hash. Apply this guard to the existing capture notifier **before reading its private snapshot**, including the v1/flag-off path; its current stored-target/hash check alone permits a group target and is insufficient under parent §12/§16 and CI09/CI10. A group receives only approved generic/public notices, never private financial result text; terminalize blocked notification with `GROUP_PRIVATE_DELIVERY_BLOCKED`, delivered=false. This is an explicit security correction, not a compatibility exception that preserves the old private group push.

## 2. Existing facts that require changes

Source references below are pinned-source line numbers, not a claim that current workspace lines are unchanged.

| Pinned source | Current behavior and required repair |
|---|---|
| `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts:75,603,609` | Body slices to 1,200 code points; cards slice to 12; structured cards omit canonicalText. Replace loss by explicit logical-item coverage and text rendering. |
| `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts:46,88,213` | Stored outcome accepts 1–5 messages, canonicalText itself is limited to 5,000 UTF-16 units, retry hash includes internal fields, text helper slices. Preserve v1 parser; add separate v2 plan parser and wire-only identity. |
| `apps/api/src/modules/line-ai/domain/logic/line-draft-update-card.logic.ts:22,107` | Five displayed changes and unbounded altText can omit required differences or exceed 400. Render all changed values in canonical diff; use preview helper for altText. |
| `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.ts:720` | Raw UTF-16 slices can split surrogate/grapheme boundaries. Replace splitter, preserving its existing short-response callers. |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3090,3578` | Link append can enlarge an already split part; one array is persisted; private draft/receipt/substitute proof lives in memory. Plan after final link composition; persist typed proof before send. |
| `apps/api/src/modules/line-ai/application/line-ledger-delivery.service.ts:20,43,54` | Existing advisory lock, first-result save, lease fencing and UNKNOWN-before-send are correct patterns; one row has one array/acceptance. Extend without changing entry identity or business acknowledgement rules. |
| `apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.ts:234` | Recovery replays the saved array and does not rerun decided business work. Keep that invariant across batches. |
| `apps/api/src/modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.ts:79,221` | A failed push returns `skipped`, then outbox is published. Classify non-delivery separately and preserve retryable/UNKNOWN work. |

## 3. Wire and logical-answer contract

Add internal types in `apps/api/src/modules/line-ai/domain/logic/line-delivery-plan.logic.ts`. Export only the needed discriminated DTOs from contracts if another package consumes them; do not expose provider credentials or internal authorization to AI output.

```ts
type DeliveryPlanV2 = {
  v: 2;
  planId: string;                 // SHA256 of JSON ["line-delivery-v2", ownerKind, ownerId]
  producerKind: "WEBHOOK" | "LEDGER" | "CAPTURE_OUTBOX";
  producerId: string;             // immutable owner primary key
  createdAt: string; expiresAt: string;
  readyAt: string; firstDispatchDeadlineAt: string; // server-frozen, not reset by retry
  answer: {
    status: "COMPLETE" | "PARTIAL";
    pendingSubrequestIds: string[];
    items: Array<{
      id: string;                 // `${planId}:item:${zeroBasedOrdinal}`
      kind: "answer" | "source" | "business_result" | "decision_diff" | "limitation";
      text: string; sourceProofIds: string[];
      required: boolean;          // true for all requested answer/diff/evidence/limitation items
    }>;
  };
  businessResult: null | {
    kind: "EXPENSE_CAPTURE" | "EXPENSE_EDIT" | "SUBSTITUTE_PREPARE" | "REIMBURSEMENT_DRAFT";
    operationKey: string; committedAt: string;
    recordIds: string[]; resultingRevisions: string[];
  };
  authorization: DeliveryAuthorizationV2;
  control: null | {
    kind: "EXPENSE_EDIT_CONFIRM"; previewId: string; previewRevision: string;
    expiresAt: string; requiredItemIds: string[];
  } | {
    kind: "REIMBURSEMENT_DRAFT_CONFIRM"; actionId: string; previewRevision: number;
    confirmationDigest: string; expiresAt: string; requiredItemIds: string[];
  };
  batches: Array<{
    id: string;                   // `${planId}:batch:${zeroBasedOrdinal}`
    index: number;
    spans: Array<{ itemId: string; start: number; end: number; messageIndex: number }>;
    primary: FrozenRepresentation;
    fallback: FrozenRepresentation | null;
  }>;
};
type FrozenRepresentation = {
  messages: ProviderMessage[];    // exact wire projection, no canonicalText/internal proof
  wireHash: string;               // SHA256 canonical JSON [channelId, recipientHash, messages]
  pushRetryKey: string;           // existing UUID-shaped SHA256 conversion over v2 batch+variant+wire
};
```

`ProviderMessage` reuses existing adapter text/image/flex/quickReply shapes **after** removal of internal `canonicalText`. `spans` are offsets into the exact item text, measured in UTF-16; they neither split a Unicode grapheme nor overlap. Coverage validator reconstructs each item byte-for-byte from spans, excluding separately typed renderer labels. Generated numbering, separators and completion menus cannot count as answer coverage. A `PARTIAL` answer requires a nonempty limitation item and pending subrequest IDs; it cannot be recorded as task complete merely because all its available text was accepted.

Primary/fallback map to the same item spans, have the same message count, and each fit one batch. If a Flex fallback needs more slots than its primary, use canonical text as primary from the start. A decision card may downgrade to a bounded text message with the **same preview-bound postback controls**; never downgrade it to unbound “พิมพ์ยืนยัน”. Precompute both variants before dispatch. No fallback is synthesized from altText.

For `businessResult`, the owner returns its committed idempotency key and resulting revision; the AI cannot populate this object. When a business operation has already committed but durable answer persistence fails, return/recover the existing operation result by that key. Never rerun the mutation to recreate a notification. A business result does not require the user to have received its chat acknowledgement to be committed.

### 3.1 Fixed bounds for delivery policy `line_delivery_v2_1`

These are application decisions, not claimed LINE provider quotas. LINE request bounds remain five messages and 5,000 UTF-16 units per text; altText remains at most 400. Plan parsing enforces all bounds before saving.

| Dimension | Limit / behavior |
|---|---|
| Canonical text across items | 60,000 UTF-16 units; at most 64 items and 64 unique read evidence IDs; no implicit slice |
| Entire immutable plan JSON | 256 KiB UTF-8 including both representations, proof and controls; producer receives explicit `PLAN_TOO_LARGE` before send |
| Text payload target | 4,800 UTF-16 units including numbering/labels; hard validation after composition remains 5,000 |
| Messages / batches | At most 15 messages, three batches, five messages per batch; actions count toward occupied message slots |
| Automatic window | At most two batches / ten messages. If a third is needed, second batch explicitly marks remaining content and carries bounded continuation postback. No false “complete”. |
| Explicit continuation | One additional batch, same plan and source versions, no model/tool mutation; no further chain after batch three |
| Network | Request timeout is min(5,000ms, remaining lease, remaining plan lifetime, and remaining final-turn deadline for the first foreground dispatch); do not require the full 5 seconds when the reserved delivery window is 3 seconds; at most one first reply attempt; at most five push attempts per batch/representation identity within expiry |
| Scheduling | No parallel batches for a plan; recovery claims at most 25 plans per worker tick; one pending batch per plan per tick; retry delay 2, 4, 8, 16, then 30 seconds, subject to existing worker tick frequency |
| Lease / deadline | Three-minute plan lease, clamped to expiry; dispatch requires at least 500ms remaining; freeze the smaller request timeout before stamping UNKNOWN. Timeout stays active through response body reading |
| Proof / plan lifetime | Webhook min(event-created+60min, proof expiry); ledger min(original-entry-created+15min, proof expiry); capture min(outbox-created+60min, proof expiry). Never reset on retry/continuation. |
| IDs / error text | IDs at most 200 characters except 64-hex hashes; error code at most 120 characters; no raw provider/customer payload in errors |

Answers requiring three batches are not rejected as out of scope: the user sees the accepted prefix plus “ยังเหลือ …” and can continue in chat. Answers that fit two batches do not require another user message. If a complete requested answer cannot fit the plan bounds, the upstream bounded-answer contract must produce an honest partial result with identified unfinished subrequests; delivery does not silently drop items or invent an unsupported export/browser capability. Candidate quality evaluation must include this boundary before release; bounds cannot excuse regression on previously successful workloads.

Use `Intl.Segmenter('th', { granularity: 'grapheme' })` from the existing runtime, preferring paragraph/newline boundaries within the target. Never alter item text through normalization. URLs remain indivisible; a URL or grapheme larger than a text slot is an explicit planning error, not a split string. Stable application URLs are used for persisted v2 plans; no expiring handoff token is minted into a replayable payload. The target page performs normal authentication/authorization. Existing non-durable dedicated handoff flows keep their own policy. If URL composition changes, plan and validate afterward, before first save.

## 4. Durable authorization, including document replies

```ts
type DeliveryAuthorizationV2 = PrivateDeliveryAuthorizationV2 | PublicGeneralDeliveryAuthorizationV2;
type PrivateDeliveryAuthorizationV2 = {
  v: 2; kind: "PRIVATE";
  actor: {
    userId: string; companyId: string; membershipId: string; requestId: string;
    accessFingerprint: string;    // existing canonical resolved fingerprint, <=32768 characters
    channelId: string; channel: "line"; channelKind: "USER"; recipientHash: string; chatKeyHash: string;
    conversationId: string; ownerEpoch: number;
  };
  issuedAt: string; expiresAt: string;
  proofs: Array<
    | { id: string; kind: "READ"; evidenceIds: string[] }
    | { id: string; kind: "EXPENSE_REVISION"; records: Array<{ id: string; revision: string }>;
        categories: Array<{ id: string; name: string }>; choices: LineExpenseDraftRouteContext[] | null }
    | { id: string; kind: "EXPENSE_EDIT_PREVIEW"; previewId: string; requestId: string;
        phase: "PENDING" | "APPLIED"; previewRevision: string }
    | { id: string; kind: "SUBSTITUTE"; source: LineSubstituteReplySource }
    | { id: string; kind: "CAPTURE_RESULT"; expenseId: string | null; groupId: string | null;
        jobId: string; resultRevision: string; recordIds: string[];
        businessEffect: "NONE" | "LEGACY_HANDOFF" | "EMPTY_DRAFT_DELETED" }
    | { id: string; kind: "CANDIDATES"; ids: string[]; snapshotHash: string; originalChoices: boolean }
    | { id: string; kind: "REIMBURSEMENT_DRAFT"; actionId: string;
        phase: "PREVIEW" | "APPLIED"; previewRevision: number; confirmationDigest: string;
        requestId: string | null; expectedRequestUpdatedAt: string | null;
        appliedRequestUpdatedAt: string | null; sourceProofDigest: string }
    | { id: string; kind: "LINE_DOCUMENT_QA"; jobId: string; jobRevision: number;
        inputSetHash: string; readerVersion: string;
        attachments: Array<{ attachmentId: string; contentHash: string;
          requestedPages: number[]; readPages: number[] }>;
        resultHash: string }
  >;
};
```

`LineExpenseDraftRouteContext` is the existing contracts type; serialize no raw transcript. `LineSubstituteReplySource` is the existing exported continuation result source shape (records with revision/evidenceHash/attachmentsHash, categoriesHash, signature availability, policy branch/payer/hash). Reuse that exact type and its owner checker instead of redefining tax/signature policy in LINE. Each proof has at most five source records/candidates and all IDs are unique. At most 16 proof objects; expiry is no later than the earliest referenced source/preview lifetime. `previewRevision` is the SHA256 canonical hash of the complete owner-returned preview, not a new mutable preview field. `CAPTURE_RESULT` contains exactly one expense/capture-group owner; capture-group here is the legacy document grouping entity, **not** permission to send to a LINE group chat. `resultRevision` is the hash of the exact owner-returned finished-job result, record revisions and business effect used to compose the answer. Verify it through a read-only owner method. For `EMPTY_DRAFT_DELETED`, verify the owner's soft-deleted record revision and original finished job, not an active-expense query that will fail merely because the intended deletion succeeded. Add that read-only projection next to existing snapshot methods, with the same actor/branch scope; never reuse delete/handoff as a verification method.

For PRIVATE plans, every first send **and every retry/continuation**: resolve current LINE identity → require active user, same company selection and private recipient, no opt-out/pause → resolve current membership, branch/location permissions and entitlement fingerprint → run each proof's existing read-only checker → check plan lease again. For PRIVATE plans, a proof identifies what to check; it is not authority. PUBLIC_GENERAL uses §4.1 instead of private context/source checks. Never persist `RequestContext.permissions` as permission to replay. Rebuild current context from the actor IDs. If any lookup fails or mismatches, stop unsent work with `AUTH_CHANGED` / `SOURCE_CHANGED` / `PROOF_UNAVAILABLE`; never send private cached text while “checking later”.

The actor is the same full owner as [core capability contract](mangmee-ai-core-capability-contract-2026-09-27.md) §3: company/user/membership/channel transport/channel kind/messaging channel/chat hash, bound to its deterministic conversation ID and lifecycleEpoch (`ownerEpoch` in this DTO). Compare every field and current epoch before private source access and again before dispatch; unlink/relink, owner revocation or attachment invalidation cannot resurrect old results merely because IDs/fingerprints happen to match again. Current authorization reads do not increment/reset the epoch. The child stores that epoch in its immutable proof; pending invalidation stops sends without undoing a committed business result.

`REIMBURSEMENT_DRAFT` uses [business write contract](mangmee-ai-business-document-write-contract-2026-09-27.md) §§5–6. Its read-only checker loads the exact action and current full owner; PREVIEW requires matching integer previewRevision/digest, unexpired action, request/source revisions and current permissions. APPLIED requires its durable result receipt, matching action/digest/request, current read permission and exact applied/current revision for any cached values echoed. If the record changed, stop the cached result and let a new authorized read report current state; never rerun create/update. `sourceProofDigest` hashes canonical action.sourceProofJson captured at preparation; after APPLIED proposal cleanup, verify through the retained receipt/digest and resulting record revision, not deleted proposal JSON.

`LINE_DOCUMENT_QA` uses core §6's **one job per admitted task** and complete attachment set, with a WEBHOOK or LEDGER delivery owner (no fourth owner table or OCR outbox). The verifier requires same full owner/epoch, ANSWER_READY, exact jobRevision/inputSetHash/readerVersion/resultHash, authorized live AttachmentLink target LINE_DOCUMENT_QA for every attachment, and unchanged attachment ownership/deletion/contentHash. The proof contains at most five unique attachment IDs in the admitted order; each requested/read list contains unique 1-based ordinals, read is a subset of requested, and total requested/read pages across the entire set are each <=20. Claim/page locators are keyed by `(attachmentId,pageOrdinal)`, never page number alone. The source-provided inputSetHash binds that entire ordered input set. Unlink/delete of any referenced attachment, job cancel/revision replacement, scope/epoch change, result purge or deadline expiry invalidates unsent batches. Plan expiry is additionally clamped to the QA job's fixed `jobDeadlineAt` and 15-minute owner follow-up lifetime; its 24-hour raw-result retention is not a 24-hour delivery authorization. Read-only validation does not start a reader/capture job or create an expense.

`READ` reuses `LineReadEvidenceService.verify`, whose existing maximum evidence age is 60 minutes. `EXPENSE_REVISION` reuses the checks behind `receiptDeliverySourcesCurrent`, including own/chat-scoped draft choices. `EXPENSE_EDIT_PREVIEW` uses `pendingPreview` or read-only `appliedResult` and verifies exact preview revision. `SUBSTITUTE` uses `replySourcesCurrent`. `CANDIDATES` reruns the same bounded candidate read and compares ID order and canonical snapshot hash. Status-only public notices keep the existing v1 explicit `publicPolicy` allowlist with no business values and do not require a private v2 plan; absent private proof never becomes public permission.

Current v1 private outcomes missing typed proof remain fail-closed; do not backfill a proof by reading today's newer revision and pretending it was the original answer source.

### 4.1 Stateless/public general authorization

Long general/help answers also use the same durable v2 planner, without requiring a private conversation row or ERP proof. Add this discriminated server-issued branch:

```ts
type PublicGeneralDeliveryAuthorizationV2 = {
  v: 2; kind: "PUBLIC_GENERAL";
  admissionOwner: { kind: "WEBHOOK" | "LEDGER"; id: string; revision: number };
  destination: { channelId: string; channel: "line";
    channelKind: "USER" | "GROUP" | "ROOM";
    lineTargetId: string; targetHash: string; chatKeyHash: string };
  actorUserId: string | null; // verified identity only, never a company inferred from text
  initiatorHash: string; // existing verified LINE user hash for continuation/cancel binding
  admissionPolicyDigest: string; sourceManifestDigest: string;
  approvedPublicSourceIds: string[]; // <=64 public pack/search refs; no ERP/entity refs
  issuedAt: string; expiresAt: string;
};
```

The API issues this only for a general/public subrequest whose inputs and generated facts contain no private ERP context, financial source results, pending document, attachment, stored personal preferences, confirmation or business mutation. `businessResult` and `control` must be null; all source locators are public approved pack/search references or user-supplied text from the same conversation. A mixed company/general answer uses PRIVATE authorization in a verified one-to-one chat. A model-provided label cannot change this classification. Public grouping does not enable any private group capability.

At initial save bind destination to the signature-verified event's source, exact active messaging channel and authoritative admitted event/ledger revision. The minimal LINE destination ID is required for durable stateless/group routing after event payload cleanup: keep it only in the bounded child plan under existing database access/at-rest controls, never logs/model input/telemetry, and purge with the plan; do not retain a full webhook payload for routing. Hash must match the exact destination. On every send verify the stored admission owner/route has not been invalidated, current channel/global legal/support/AI pause/rate policies and applicable current opt-out for the verified actor, plus public source eligibility. Use existing authoritative payer/admission policy for any AI spend; missing payer authority is not permission to guess a company. These checks **must not** load company profiles, private conversations, pending media or financial permissions. Unavailable required authority parks the send; missing private context alone does not block it.

Public plans use WEBHOOK/LEDGER owners, nullable company/member context and the same wire hashes, source-independent plan checkpoints, UNKNOWN handling, continuation/cancel binding and original destination. No recipient fallback or rerouting to an actor's different chat. Group/room continuations must also match the initiating verified actor/event lineage; do not let another participant change the plan. Generic deterministic notices may remain v1; requested long general answers must not be truncated into those notices.

### 4.2 Work deadlines versus saved delivery obligations

A conversational answer must be finished and frozen by its work deadline (`readyAt`); first ordinary dispatch must start by the original `firstDispatchDeadlineAt=finalDeadlineAt`. If less than500ms remains, no first ordinary send is started: terminalize unavailable with a bounded deterministic notice through the existing status path, without re-generating a late answer. When the first attempt began in time, subsequent frozen batches/retries are durable delivery obligations within the original plan/source lifetime; they never authorize more model/tool work or extend the turn's thinking budget. Cancel/source/access checks still run for every batch. Measure completion at the **last required LINE acceptance**, so delayed batches are visible as a latency miss, not hidden behind the first message.

QA is already a durably accepted job: its ready/source/first-dispatch ceiling is the fixed `jobDeadlineAt` from initial admission, not the40-second foreground waiting cutoff. Progress uses its separate foreground deadline; the final QA plan is clamped to `jobDeadlineAt` and source lifetime. Missing that original job deadline cannot be repaired by minting another grant, task or delivery plan. Network timeouts are UNKNOWN regardless of whether the clamp was500ms,3s or5s.

## 5. Additive schema and migration

Add `apps/api/prisma/migrations/20260927120000_line_delivery_plan_v2/migration.sql` and the matching model/relations in `apps/api/prisma/schema.prisma` during implementation. No existing financial table or outbox payload schema is repurposed.

```prisma
model LineDeliveryPlan {
  id                   String   @id
  outcomeId            String?  @unique
  ledgerDeliveryId     String?  @unique
  outboxEventId        String?  @unique
  companyId            String?
  userId               String?
  version              Int      @default(2)
  planJson             Json
  planHash             String
  batchStateJson       Json
  status               String   @default("READY")
  leaseToken           String?
  leaseExpiresAt       DateTime?
  expiresAt            DateTime
  purgeAt              DateTime
  acceptedAt           DateTime?
  cancelledAt          DateTime?
  cancelReason         String?
  nextAttemptAt        DateTime @default(now())
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  outcome              LineTurnOutcome? @relation(fields: [outcomeId], references: [id], onDelete: Cascade)
  ledger               LineLedgerDelivery? @relation(fields: [ledgerDeliveryId], references: [id], onDelete: Cascade)
  outbox               OutboxEvent? @relation(fields: [outboxEventId], references: [id], onDelete: Cascade)
  @@index([status, nextAttemptAt, expiresAt])
  @@index([purgeAt])
  @@index([companyId, userId, createdAt])
}
```

SQL adds `CHECK (num_nonnulls("outcomeId", "ledgerDeliveryId", "outboxEventId") = 1)`, `version=2`, hash shape, and status allowlist `READY, UNKNOWN, WAITING_CONTINUATION, ACCEPTED, CANCELLED, REFUSED, EXPIRED`. Add optional inverse `deliveryPlan LineDeliveryPlan?` to all three parents. Private plan owner company/user must equal the actor and existing parent; validate under lock, not just at request parsing. `planHash` is SHA256 of canonical plan JSON and checked before every dispatch. `planJson` never changes after save; permitted fallback is already stored. For v2 parents, required legacy `messagesJson` stores only the non-private sentinel `[{"type":"text","text":"ผลลัพธ์นี้ใช้การส่งรุ่นใหม่"}]`, and outcome `presentationKind` is `delivery_plan_v2`. It is **never** dispatched: upgraded readers must require the v2 child for that marker (ledger uses its child relation and stored completion version marker). Missing child means `LINE_OUTCOME_RECOVERY_REQUIRED`, not sentinel fallback or rerouting. Do not duplicate canonical text/first batch into a longer-lived parent and bypass source-specific purge limits. V1 parent arrays remain unchanged.

Mutable `batchStateJson` is strictly parsed as:

```ts
type BatchState = {
  batchId: string; variant: "primary" | "fallback";
  status: "READY" | "UNKNOWN" | "ACCEPTED" | "REFUSED" | "CANCELLED";
  transport: null | "REPLY" | "PUSH";
  replyAttempted: boolean; pushAttempts: number;
  firstAttemptAt: string | null; lastAttemptAt: string | null;
  acceptedAt: string | null; providerRequestId: string | null;
  lastErrorCode: string | null;
};
```

Exactly one state per stored batch, same IDs/order; accepted prefix is monotonic. Response IDs are optional audit evidence, not a license to infer delivery. Accepted batches' variant/hash never changes. Initial arrays are written in the same transaction as the parent outcome/reservation save. For capture, create the plan once under the claimed outbox row before first push; do not modify the original business-event payload. A unique-parent violation means another producer won: load its exact plan and validate owner binding, never overwrite it.

Exact compatibility markers: ledger `completionJson.deliveryPlanVersion=2` and `completionJson.deliveryPlanId=planId` (add optional fields to `LineLedgerCompletion`); capture `headersJson.lineDeliveryPlanVersion=2` and `headersJson.lineDeliveryPlanId=planId`, preserving all other headers. Write marker and child atomically. A marker without its child always fails closed, including operator retry of an old outbox row after plan purge. Removing a plan never permits the notifier to compose/auto-handoff/delete again.

Retention: plan expiry is send eligibility, not permission to erase a business result. Set `purgeAt` when saving to the earliest of `createdAt + AI_DATA_RETENTION_DAYS`, QA-job creation +24 hours when a QA proof exists, and reimbursement preview expiry/cancellation +24 hours when the plan contains that preview. Source-specific shorter privacy retention wins over generic AI retention. Existing webhook retention cascade and ledger retention remain unchanged. Add the new table to existing orphan/retention sweep: terminalize expired delivery obligations first, then delete child plans with `purgeAt <= now`, in batches of 500 even if their outbox parent is retained. Cascaded parent deletion can remove it sooner. No new raw media/transcript retention or indefinite storage; private plans resolve recipients through existing identity; stateless PUBLIC_GENERAL keeps only the bounded verified destination in §4.1, never a raw event or transcript. Legal/business action receipts and idempotency tombstones stay with their financial owner, independent of chat-plan deletion.

## 6. Transactions, locking and state transitions

Lock order for a send: existing producer claim/owner fence → transaction-scoped advisory lock `line-delivery-plan:<planId>` → child row. If locking both webhook and ledger is necessary, use existing webhook ownership transaction first and the plan lock second; never hold a plan lock while later attempting to acquire a different producer's lock. All parent checkpoints performed with plan checkpoints use the same Prisma transaction, in that order. No model/API/provider calls inside a SQL transaction.

1. Produce verified answer and business result outside delivery transaction. Commit financial change using its existing idempotency/revision transaction. Build final stable links, canonical items, controls, representations and authorization.
2. Claim producer; under owner + plan lock create child or reuse winner. Check immutable hash, scope, original timestamps and expiry. Set random lease token, expiry `min(now+3min, plan.expiresAt)`. Outbox also retains its existing claimToken.
3. Outside transaction perform current authorization/source reads. In a short new transaction CAS on plan lease, owner fence, expiry and batch prefix; stamp the selected batch UNKNOWN and chosen transport **before** network dispatch. A lease must cover the actual clamped request timeout, not an unconditional 5-second minimum. Update parent attempt counters for observability, not completion.
4. Call adapter once. In a short transaction under the same lock/fences checkpoint result. Only the current lease may advance or terminalize. A late worker whose claim was replaced can log its result but cannot overwrite the new state. UNKNOWN recovery uses the same payload/key, so an acceptance followed by lost checkpoint remains safely retryable for push.
5. Reconcile parent bookkeeping after all required batches are accepted; source-read completion/clarification consumption is idempotent. Failed bookkeeping never starts the answer/model/business operation again.

| From / event | Next / exact behavior |
|---|---|
| READY + valid proof + dispatch | Batch UNKNOWN before send; persist first reply flag or increment push count |
| UNKNOWN PUSH + no response / timeout / connection or ambiguous server failure | Remain UNKNOWN, retry same representation/to/channel/key after backoff; no later batch |
| UNKNOWN REPLY + ambiguous response | Remain UNKNOWN with `REPLY_ACCEPTANCE_UNKNOWN`; no automatic push or reply replay, since reply and push do not share a proven deduplication identity. Park at expiry; user can see uncertainty/status. |
| Definitive expired/invalid reply-token rejection | Same unsent batch may use PUSH with its stored key after reauthorization; replyAttempted stays true |
| Definitive request-body Flex rejection | Mark this attempt rejected; choose pre-saved fallback under CAS only if this batch has no prior ambiguous attempt. Retry frozen fallback; never rewrite an UNKNOWN/accepted payload |
| Explicit accepted response, or existing adapter's recognized retry-key acceptance response | Batch ACCEPTED. Send next only after checkpoint and fresh auth. Do not claim “read by user”. |
| Definitive permanent rejection | REFUSED; stop later batches; preserve accepted prefix and required-unaccepted item list |
| Last automatic batch accepted with stored remainder | Plan WAITING_CONTINUATION; parent delivery remains pending/ready-to-continue, not completed |
| All required batches accepted | Plan ACCEPTED + acceptedAt. Parent delivery timestamp/status can now be completed; partial semantic answer remains partial in turn outcome |
| Recipient, tenant, permission or source changed | REFUSED with exact reason; no remaining private payload; existing financial commit remains intact |
| Cancel before dispatch | Plan CANCELLED, unsent batches CANCELLED; keep accepted prefix and financial result |
| Cancel while network is in flight | Record cancellation immediately; do not send later batches. The current result may still become accepted/UNKNOWN; cancellation does not retract a provider request or undo a financial write |
| Expiry/attempt bound | EXPIRED or REFUSED `ATTEMPTS_EXHAUSTED`; UNKNOWN evidence stays recorded. Never call it not-sent/accepted without evidence |

The plan's CANCELLED/REFUSED/EXPIRED status remains terminal even if an already dispatched batch later records acceptance; accepted batch facts may advance, but no unsent suffix resumes. Capture attempts are additionally limited by the existing outbox maximum of five failed claims: effective retry allowance is the smaller remaining plan/outbox allowance, not five new attempts for each worker claim. At WAITING_CONTINUATION, release the outbox PROCESSING claim using its existing fenced `markFailed` with `countsTowardMax:false`, `nextAvailableAt:plan.expiresAt`, and reason `WAITING_CONTINUATION`; this is scheduling, not a provider failure or publication. A validated continuation atomically brings that same outbox event's availableAt forward, then uses the ordinary claim path. If expiry arrives first, the sweep terminalizes it as undelivered. Ledger waiting keeps the original pending entry and consults the child before any generator/drain action; a delivery continuation never appends a new business subrequest.

Adapter adds a structured v2 result `{ kind: 'accepted' | 'rejected' | 'unknown', code, requestId?, rejection?: 'TOKEN' | 'FLEX' | 'PERMANENT' }` and retains a compatibility mapping for v1 callers. Only an explicit response that the adapter can classify from its existing body/status checks is “rejected”; a caught exception never is. Unknown provider behavior stays UNKNOWN. `sendPush` v2 requires an explicit stored key and cannot default to randomUUID. Rate-limit response schedules retry without changing payload/key; it still respects finite attempt/age bounds. Do not infer undocumented provider deduplication duration; retry horizon is the application horizon above and release tests must verify the supported provider behavior.

## 7. Continuation, cancellation and confirmation

Continuation postback data is `action=line_answer_continue&plan=<64hex>&next=<0..2>`; cancellation is `action=line_answer_cancel&plan=<64hex>`. These IDs are locators, never bearer authority. Bind the webhook sender/channel/chat/company to stored actor and recipient hash, check plan status and expiry, current source proof and expected next index under lock. Repeated clicks enqueue/claim the same plan, not a second outcome. The continuation trigger's webhook event records the reference; it does not become another owner or acquire a new financial idempotency key. No free-text “ต่อ” selects a plan unless exactly one active eligible plan is bound to that actor/chat; otherwise ask the existing choice clarification.

Cancel affects delivery only. Do not reuse an expense/substitute business-cancel command for answer cancellation. A cancelled/expired plan cannot be resumed by blindly replaying it. A later explicit request opens a new turn that reads current state; it may state that an earlier response had unknown delivery, but must not repeat a financial mutation. Batch three is available once via explicit continuation; double-clicks use the same checkpoint/key. New unrelated user input does not silently cancel a committed financial outcome or a known pending batch.

Expense confirm payload remains the existing preview-bound postback from `line-draft-update-card.logic.ts`; no new financial authorization endpoint is introduced. Full before/after diff includes every changed field, source record identity and limitations. The confirm card is the terminal message and is included only in the final required batch. If diff needs continuation, no confirm control appears in earlier windows. An UNKNOWN earlier batch prevents dispatch of the final control. Existing preview expiry applies even if plan has time left. `appliedResult` supplies an already committed result on duplicate confirmation; replay only its answer. Pending-signature requests for substitutes remain a separate workflow and cannot be consumed as expense edit confirmations.

Reimbursement controls are distinct: `{action:'reimbursement_draft_confirm'|'reimbursement_draft_cancel',actionId,previewRevision,confirmationDigest}`. They use the new business contract's deterministic API handlers, never the expense confirmation parser. Financial preview has the stricter owner bound: complete diff/resulting total/evidence effects in **one batch of at most five messages, each text <=4,500 UTF-16 including labels and final control**, or use the authenticated full preview route `/companies/:companyId/reimbursements/draft-actions/:actionId` specified by that contract. A large preview receives no LINE confirm control. The action handler requires the matching complete-preview batch ACCEPTED checkpoint (or the owner-validated complete web preview); UNKNOWN, missing coverage or changed digest returns `preview_not_fully_delivered` without a write. Action expiry remains fixed 600 seconds even if an answer plan could live longer. APPLIED replay reports the same action/request ID and cannot reapply. This owner-specific financial preview limit overrides the ordinary answer continuation policy.

Substitute replies preserve collection/prepare versus final certification/approval/issue distinctions. Preparing/reserving a document number can already be committed while chat delivery is pending. Delivery of “เตรียมแล้ว” does not authorize sign/approve/issue, and retry cannot prepare again. Reimbursement draft replies similarly report only the owner use case's committed state; unsupported create/update/submit operations remain capability gaps until their own permission/state contract is implemented.

## 8. Caller and dependency implementation checklist

| Existing caller / owner | Required implementation in the same delivery slice |
|---|---|
| `process-line-webhook.use-case.ts` main business answer, `deliverCompletedReply(s)`, receipt saved/catch, capture/continuation, substitute and confirm paths | Build logical items once; replace direct single-card bypasses; link-before-plan; save typed proofs; v2 child first; no success/clarification delivery ACK after only one accepted batch |
| `line-business-card.logic.ts` / `line-draft-update-card.logic.ts` | Retain existing short-card styling; derive complete canonical source separately; remove body/card-count silent loss; bound altText with existing preview helper; return overflow to planner |
| `line-expense-draft-conversation.logic.ts`; `expense-document.use-case.ts`; `line-expense-draft-conversation.use-case.ts` | Replace shared raw splitter; preserve full field values or reject with explicit limit error; no document data edits caused by render truncation |
| `line-substitute-receipt-continuation.use-case.ts` in expenses | Serialize existing source proof and committed prepare outcome; mixed data/question parsing fix belongs to owner contract; no delivery-driven review/prepare/certify rerun |
| New `ReimbursementDraftAction` preview/apply handlers in business write contract | Action-bound control/proof, complete-preview checkpoint, fixed 600-second expiry, durable APPLIED receipt; delivery retry only reads action/current record |
| New `LineDocumentQaJob` reader/answer consumer in core contract | Reuse webhook/ledger owner; page-bound logical answer items and QA proof; full-owner epoch/attachment/job invalidation before late answer; no capture fallback or reader rerun |
| `line-ledger-delivery.service.ts`; `drain-line-ledger.use-case.ts` | Keep original `[entry.key,entry.id]` owner identity, TTL and webhook arbitration; child tracks batch IDs instead of inventing one ledger entry per fragment; ACK only after required acceptance or explicit terminal park with reason |
| `recover-orphan-line-events.use-case.ts` | Read v2 child before v1 messages; accepted prefix reconciliation; replay next eligible stored batch only; never route a decided result back through business handler |
| `line-capture-result-notifier.use-case.ts` / outbox repository | Explicit `{accepted, terminalSkip, retryable, unknown}` result. Publish accepted only after required batches; publish intentional terminal skips with reason and delivered=false; unknown/retryable calls fenced markFailed, never markPublished. Plan retry bypasses original compose/autoHandoff/delete branch. |
| `line-read-evidence.service.ts` / `line-delivery-access.ts` | V2 typed-proof parsing/verification; current actor/recipient and branch/entitlement recheck for every send; do not weaken old fail-closed behavior |
| `line-handoff-link.service.ts` | Durable v2 uses stable app links; no remint on retry. Other handoff flows remain distinct. Validate complete payload after any permitted transformation. |
| `line-reply.adapter.ts` | Strict v2 wire validation, explicit retry identity/result, no slicing of business messages, no internal metadata on provider wire; preserve v1 key algorithm for existing UNKNOWN records |
| `line-message-buffer.service.ts` legal acceptance, dispatch error, rate/wait notices | These are bounded public/status messages, not long business results. Use explicit deterministic operation identity for fallback pushes and verify each constant <=5000; never promote a status notice to successful business-answer completion. Existing event recovery ownership remains authoritative. |

Notifier first preparation still calls existing owner operations only where current code requires them (legacy auto-handoff, non-business empty-draft deletion). Their existing idempotency is a prerequisite before saving the notification. A retry after the saved plan exists must not enter those branches. For `terminalSkip`, allowed reasons are `NOT_LINE_SOURCE`, `NO_NOTIFYABLE_RESULT`, `NO_RECIPIENT_ACCESS`, `GROUP_PRIVATE_DELIVERY_BLOCKED`, `SOURCE_GONE`; log reason without private content. A provider failure is never one of these. If a plan expires or permanent rejection occurs, park/dead the outbox with delivered=false and reason; never call it pushed. Add a fenced repository `markDead` operation for this notification terminalization using the same `{id,status:PROCESSING,claimToken,expectedEventType}` predicate as markPublished; it writes DEAD/lastError, clears the lease, and returns whether the CAS won. Do not fabricate five failed attempts merely to reach DEAD. Consume outbox claimToken exactly once; a failed CAS is not success.

## 9. Rollout and rollback sequence

Owner update 2026-09-27: the parent spec overrides the initial OFF/test-cohort rollout below. Delivery and terminal replay now default ON; empty company/channel rollout lists impose no extra restriction on authorized admission. Nonempty lists still restrict, explicit OFF still pauses new work, and v1/v2 readers, migration/contract compatibility, current authorization, maintenance suppression and release acceptance remain mandatory. Public/general conversation here is not public web lookup, which stays OFF.

1. Add schema and code that reads v1/v2 but writes v1; retain all v1 payload/hash semantics. Deploy these readers to every API and worker before enabling any v2 writer. Do not backfill accepted/UNKNOWN v1 payloads into newly rendered answers.
2. Add config `LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS` (empty by default, validated messaging-channel allowlist) for stateless/public v2 admission; known-company private admission uses the company allowlist. All routes require the same versioned readers. Add config `LINE_AI_DELIVERY_PLAN_V2_ENABLED=false` and `LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS` (explicit company allowlist). Reader support is unconditional after migration; disabling writes must never stop recovery of existing v2 plans. Existing terminal-replay feature must be enabled for an allowlisted company before v2 writes can start.
3. Shadow-plan synthetic/regression traffic without sending extra messages. Validate coverage, controls, bounds, authorization and payload hash. Compare canonical answer to visible text; no provider shadow requests.
4. Enable v2 writes for the test company across webhook, ledger and notifier together. Verify on actual LINE only under the release protocol, including permanent/ambiguous failures using controlled fixtures and provider-supported tests. No claim of live acceptance from unit tests.
5. Expand only after all acceptance cases below pass, quality/performance comparison passes, and no required-capability regression occurs. Metrics distinguish answer/commit/batch acceptance and include plan-version/producer; never raw message values.
6. Rollback stops new v2 writes first but keeps upgraded readers/recovery running. Existing plans finish or reach terminal expiry. Do **not** deploy an old binary that ignores v2 children while any plan is READY/UNKNOWN/WAITING_CONTINUATION; it could dispatch a legacy sentinel and falsely complete. Confirm zero nonterminal v2 rows **and zero replay-eligible parent v2 markers** before binary downgrade. Keep additive table until retained rows age out; no destructive down migration during incident recovery.

## 10. Required fixtures and runnable verification

These are implementation acceptance fixtures, not a statement they already pass. Put them into the following existing tests or the one new planner/plan-storage test; use existing node:test/tsx and isolated PostgreSQL pattern, with no new package or script.

| Fixture | Required assertion | Target file under `apps/api/src/modules/` |
|---|---|---|
| Thai 1300 + final negation; 13 structured items; 5001 units; Thai marks/emoji around 4800 | Concatenated logical text exactly equals canonical; no surrogate/grapheme split, omitted card or missing final condition | `line-ai/domain/logic/line-delivery-plan.logic.spec.ts` (new), existing card/splitter tests |
| 24001 units + source link + preview controls | Valid 1–5 messages per batch; all sources/diff kept; actions occupy reserved final slot | new planner test; `line-ai/domain/logic/line-draft-update-card.logic.spec.ts` |
| Four realistic changed fields whose old altText is 500 units; more than five changed fields | altText <=400; complete diff; no confirm before all required parts | existing draft-card + webhook tests |
| Exactly 10 messages versus 11–15; 60,001 canonical units; 256KiB+1 | Two batches auto; remaining batch only authorized continue; explicit over-limit errors, no truncation | new planner test |
| Acceptance then process dies before checkpoint; UNKNOWN push; two workers; stale lease | Same payload/key and parent identity; one accepted prefix; stale worker cannot overwrite; no later batch while UNKNOWN | `line-ai/line-delivery-plan.pg.spec.ts` (new, existing isolated DB fixture pattern) |
| Reply timeout versus explicit invalid token; explicit Flex rejection versus unknown | Unknown reply never blind-pushes; token reject uses frozen push; only definite Flex rejection selects saved fallback | `line-ai/infrastructure/line-reply.adapter.spec.ts`, webhook/recovery specs |
| Same wire with changed internal canonical metadata; different batch/variant | V2 key unchanged for same frozen wire/identity; different batch/variant distinct; v1 keys unchanged | adapter spec |
| Permission revoked/company changed/recipient changed/expense revised between batches | No further private send; committed expense remains; no fake rollback or final completion | `line-ai/line-delivery-access.pg.spec.ts`, new plan PG test |
| Async capture target is a LINE group, including flag-off legacy path | Private snapshot/financial payload is not loaded or pushed; terminal reason is explicit, no fallback to a different recipient | notifier spec + delivery access PG test |
| Draft pending/applied, receipt, substitute prepared, capture job proofs after restart | Read-only proof succeeds for same source, fails for changed/stale source; zero mutation/model/OCR invocations | recovery spec; `expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts` |
| Reimbursement PREVIEW/APPLIED restart, changed digest/revision, missing preview acceptance | Correct action/receipt only; zero duplicate create/update; UNKNOWN cannot authorize confirm; oversized preview uses exact authenticated page | new action tests specified in business write contract + new delivery PG test |
| General/help with unavailable private context; long reply in USER/GROUP/ROOM; invalidated route/opt-out | PUBLIC_GENERAL uses zero private queries and same exact durable answer; other actor cannot resume; private-source item/control rejected before save | new planner/PG tests + webhook/recovery specs |
| 3s delivery reserve, network takes2s or stalls, first dispatch misses deadline, QA passes40s foreground | Clamp timeout rather than refuse due5s floor; UNKNOWN truthful; no late first ordinary dispatch; QA uses originaljobdeadline; later frozenbatch latency counted | adapter/new planner/PG tests |
| QA ANSWER_READY after attachment unlink/delete, owner epoch change, job replacement, page/result hash change | No late private answer and no reader/capture rerun; same current proof can resume saved text | new QA job tests specified in core contract + recovery/delivery PG tests |
| Capture push failed_other, permanent reject, accepted, intentional skip, stale outbox claim | Unknown remains retryable, accepted publishes, permanent parks, skip reason explicit, stale CAS cannot publish; no repeated auto-handoff/delete | `line-ai/application/use-cases/line-capture-result-notifier.use-case.spec.ts` |
| Cancel before send / during send; duplicate continuation; expired preview | Cancel stops unsent suffix; in-flight remains honest; continuation one checkpoint; expired confirm cannot mutate | webhook spec, new plan PG test |
| V1 null proof, accepted, UNKNOWN; v2 flag turned off during retry | Old behavior fail-closed/exact; no migration rerender; v2 drain continues; rollback guard detects nonterminal plans | recovery + ledger specs; new plan PG test |

Focused commands from repository root, after implementing named files:

```sh
pnpm --dir apps/api exec tsx --test src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts src/modules/line-ai/domain/logic/line-draft-update-card.logic.spec.ts src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts
pnpm --dir apps/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.spec.ts src/modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.spec.ts src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts
pnpm --dir apps/api exec tsx --test src/modules/line-ai/line-delivery-plan.pg.spec.ts src/modules/line-ai/line-ledger-delivery.pg.spec.ts src/modules/line-ai/line-delivery-access.pg.spec.ts
pnpm --dir apps/api typecheck
```

PG tests require the existing explicitly isolated `BILLING_TEST_DATABASE_URL` fixture and its existing localhost/database allowlist. Missing URL means skipped, **not passed**; do not point these tests at UAT/Production. Apply the new migration to that isolated fixture with the repository's existing migration procedure before the PG run. Integration must also retain current handoff and capture/reimbursement/substitute owner tests for any touched contracts. No live/cloud/provider test was performed while writing this appendix.

Implementation order is fixed: strict logical/wire types and bounds → additive table/transaction tests → source-proof adapters → planner/card/confirm fixes → webhook + recovery → ledger → capture notifier → compatibility/rollback checks → actual-channel acceptance and quality/speed evaluation. Enabling multipart before its durable state, current authorization and all reverse callers pass is prohibited. This appendix freezes the delivery design; it does not assert that financial capabilities, semantic understanding or readiness have already been implemented.

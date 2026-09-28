# LINE AI durable v2 rich presentation

Status: approved implementation supplement
Date: 2026-09-27
Parent contract: [Mangmee AI durable delivery contract v2.4](mangmee-ai-reliability-delivery-contract-2026-09-27.md)

## Problem

The API renders a trusted `answer_cards` response as a LINE Flex message, including a validated company-scoped web button. The durable v2 webhook path then projects every ordinary Flex message to `canonicalText` and freezes text-only wire. Synthetic provider capture therefore receives neither the card nor its button even though the gateway and renderer produced both.

This is delivery projection loss. `responsePreferences.presentation` controls prose, bullets, tables, or steps inside the answer; it does not request a text-only LINE transport. The dedicated pure-general lane remains intentionally text. Current saleable package acceptance for this repair is limited to permission-checked expense answers and existing expense/reimbursement confirmation controls; it does not activate report or sales entitlements.

## Required behavior

1. Canonical logical text remains authoritative. It includes the complete `replyText`, every additional logical answer-card title/badge/body, caveats, source labels, and only company-scoped links accepted by the existing tenant-link validator.
2. A Flex primary is optional. It may be frozen only when the existing trusted business-answer renderer proves that the card contains the complete authoritative reply and all source/link information without applying any renderer slice or count cap. The proof is ephemeral and never enters the provider payload or persisted plan; an arbitrary caller-supplied `canonicalText` is not proof of visible Flex completeness.
3. If a card cannot prove completeness, or if its canonical text requires more than one 4,800-unit text slot, delivery uses the existing grapheme-safe text splitter from the start. It must not send duplicate Flex-plus-text output.
4. A retained Flex uses the exact already-rendered provider payload. Its fallback is the same canonical text in the same message slot, with the existing safe quick reply. `canonicalText` remains internal and is removed before wire hashing and provider send.
5. Unsafe, absolute cross-origin, cross-tenant, protocol-relative, encoded traversal, or otherwise invalid card links appear in neither the Flex button nor the text fallback. A valid company route remains present in both forms.
6. Existing text callers remain text. Existing persisted text-only version-2 plans remain valid without migration or a plan-version change.
7. Draft-edit and reimbursement confirmation cards are excluded from ordinary presentation reuse. They remain the explicit terminal `controlMessage`, after all required item spans, with unchanged preview/action/revision/digest/expiry and current-authorization checks. No new action is synthesized.

## Durable invariants

- Primary and fallback representations have the same message count. When a fallback needs more slots than its Flex primary, text is primary.
- Item spans reconstruct canonical text exactly. A covered slot is either exact primary text or a primary Flex whose same-index fallback is exact text.
- At most five messages per batch, three batches, and fifteen messages per plan remain unchanged. The existing second-batch continuation postback is frozen into both variants.
- `wireHash` continues to cover the exact provider messages with channel and recipient binding. `pushRetryKey` continues to bind plan, batch, variant, and wire hash. `planHash` covers both frozen representations, logical items, authorization, and controls.
- Save, claim, authorization/source verification, UNKNOWN handling, retry, continuation, outbox ownership, and replay do not re-render from mutable sources.
- Only a definitive provider `FLEX_REJECTED` may select the pre-frozen fallback. UNKNOWN keeps the original representation and identity.

## Acceptance

- A short, permission-checked expense answer reaches frozen provider wire as Flex with its company-scoped URI button; its saved fallback contains complete reply text, caveat, source basis, and URL.
- A caveat present only in `replyText` forces complete text delivery rather than an incomplete card.
- A generic Flex whose visible body is truncated while its short-slot `canonicalText` is complete is delivered as lossless text, because it lacks the trusted renderer proof.
- Editing the proved Flex `altText`, `canonicalText`, or `contents` invalidates the ephemeral proof. Adding the existing safe completion quick reply preserves it.
- A status or qualifier carried only by a card badge remains in the exact text fallback selected after definitive Flex rejection.
- Long paragraphs, long unbroken text, 5,001 units, and more than twelve logical cards remain complete split text.
- Unsafe/cross-tenant links occur in neither Flex nor fallback.
- Plain-text input and old serialized text plans round-trip unchanged.
- Multi-batch continuation and explicit financial controls remain ordered and bound.
- UNKNOWN does not select fallback; definitive Flex rejection selects only the already-frozen fallback.

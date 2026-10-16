# LINE payment evidence plan

Spec: [LINE receipt and payment evidence](../specs/line-payment-evidence-pairing-spec.md).

1. Add one expenses use-case using existing attachment, draft/funding, permission and transaction guards; retain the retired slip for exact undo. Add pure two-hour/amount/day/uniqueness rules.
2. Call it after synchronous OCR persistence and from the file read-result path. Render an attached sentence with undo, or receipt-selection buttons plus a separate-item option.
3. Add an intake route for evidence association and handle it before text capture. Reuse existing postback transport and validate all source data again in the use-case.
4. Admit server-provided recent capture/draft ids to detail-tool grounding; keep API authorization unchanged.
5. Add focused cases in already registered spec files; build contracts, run API and gateway typecheck, and focused specs. Preserve the other lane's continuation regions and the value normalizer.

Status 2026-10-15: implemented and locally verified; exact commands, pass counts and integration evidence are in [task memory](../agent-memory/line-payment-evidence-pairing.md). No deployment.

# Plan: LINE AI durable v2 rich presentation

Status: implemented and verified; awaiting combined root freeze
Date: 2026-09-27
Spec: [LINE AI durable v2 rich presentation](../specs/line-ai-durable-v2-rich-presentation-spec-2026-09-27.md)

1. Make the trusted business-card renderer retain complete authoritative canonical text and fall back to text whenever its bounded Flex cannot prove full coverage or safe links.
2. Extend only the delivery-plan builder input with parallel preferred messages. Freeze only a Flex carrying the business renderer's ephemeral completeness proof as primary and exact text as its same-slot fallback; keep the proof out of JSON/hashes and keep the persisted v2 shape unchanged. Project every unproved generic Flex to complete text.
3. Pass original non-control webhook messages to the planner. Keep financial controls on the existing explicit terminal path.
4. Add focused renderer, planner, webhook-seam, and durable state-transition tests for links, caveats, long text, compatibility, controls, UNKNOWN, and definitive Flex rejection.
5. Run the focused Node test files, the isolated PostgreSQL test when its allowlisted test URL is present, and API typecheck. Record skips as skips, not passes.

Out of scope: package or entitlement activation, report/sales source changes, schema or dependency changes, new flags, legacy-delivery bypass, live LINE/provider sends, cloud operations, deployment, push, merge, or commit before root review.

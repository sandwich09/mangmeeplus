# W00 capability manifest

The [JSON artifact](./mangmee-ai-capability-manifest-2026-09-27.json) snapshots the 71 registered operations, API intake/routes, Nest provider and `ERP_READ_TOOL_REGISTRY` wiring, 18 sellable feature families, default rollout flags, and deferred voice capability. It is generated from runtime contracts and Nest metadata; TypeScript AST is used only to connect live controller parameters to imported provider source files.

The artifact records wiring and authorization boundaries, not database result correctness, customer entitlements, live provider behavior, or release readiness. Three registry entries are explicitly non-ready and hidden from callable catalogs: `crm.suggest_sales_followups`, the unhandled registry alias `accounting.capture_receipt_evidence` (receipt capture is a separate webhook intake), and `hr.get_leave_summary`. `line.explain_file_attempt` is wired through the controller and evidence replay registry. Voice remains deferred.

Run the focused parity check:

```sh
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
```

Regenerate and review the snapshot after intentional registry, route, provider, config, or feature-catalog changes:

```sh
UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
```

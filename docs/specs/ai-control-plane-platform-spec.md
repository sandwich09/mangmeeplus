# Feature: AI Control Plane Platform (Neutral, WatchDog-First)

## 1. Status

- Roadmap/checklist item: brainstorm → draft spec (not yet planned/implemented)
- Owner: thawtchai phuchana
- Date: 2026-07-22

## 2. Goal

A system-neutral platform to **control, monitor, and manage AI runtimes**. WatchDog-BMS
AI runtime (AI Gateway, LINE OA assistant, receipt OCR) is the first consumer, but the
platform must not couple to WatchDog domain models so future systems can onboard.

Hard constraints from product owner:

- **Neutral**: usable by any system, WatchDog is just tenant #1.
- **Cheap**: minimal infra and zero/near-zero license cost; single small VM class footprint.
- **Practical**: every phase must ship something used in real operations, no speculative build.

## 3. Source Docs

- Related specs: `ai-gateway-agents-spec.md`, `ai-runtime-production-integration-spec.md`,
  `typhoon-receipt-ocr-spec.md`, `line-ai-local-agent-orchestration-spec.md`
- Related product: `sme-business-os-overview.md`
- Known pains this addresses: prompt tuning requires deploys (see agent memory
  "prompt-iterate-locally"), no cost/latency visibility per AI feature, no kill switch
  without deploy, regression cases (false-CANCEL, OCR rubric, booking slots) not captured
  as reusable eval sets.

## 4. Core Principles

1. **Buy/borrow the Monitor pillar, build only a thin Control pillar.** Observability
   (tracing, cost dashboards, prompt registry, eval datasets) is commodity — use an
   open-source self-hosted product. The control plane (kill switch, budgets, per-system
   policy) is small and specific — build thin.
2. **Platform decides policy; each system enforces it.** Enforcement lives in the
   consuming system's own AI gateway via a thin client (poll + cache config, fail to
   last-known-good). The platform never sits inline on the request path — an outage of
   the platform must never take AI features down.
3. **Standards-based neutrality.** Telemetry via OpenTelemetry GenAI conventions (or the
   chosen backend's SDK behind a small internal wrapper). Control via plain REST + JSON.
   Tenancy = one project/API key per consuming system.
4. **No business data beyond traces.** PII masking hook at the SDK layer before emit;
   retention policy on traces (PDPA).

## 5. Non-goals (phase 1–3)

- No custom-built dashboards (use the chosen backend's UI).
- No model hosting/fine-tuning management.
- No SaaS multi-org billing; internal multi-system tenancy only.
- No inline proxy/gateway product (enforcement stays in each system).
- No realtime streaming UI beyond what the backend provides.

## 6. Architecture Sketch

```
+----------------------------- platform (separate deployable) ----------------------------+
|  Observability backend (self-hosted OSS: Langfuse preferred, Phoenix as lighter fallback)|
|   - traces, sessions, token/cost dashboards, prompt registry, eval datasets              |
|  Control API (thin service, single Postgres)                                             |
|   - feature flags / kill switch per system+feature+tenant                                |
|   - budget caps + quotas (tokens/THB per day)                                            |
|   - config change audit log                                                              |
+------------------------------------------------------------------------------------------+
        ^ traces (async, batched)                | config (poll, cached 30–60s,
        |                                        v  fail = last-known-good)
+---------------------- consuming system #1: WatchDog-BMS AI Gateway ----------------------+
|  thin SDK wrapper: emit trace spans, check flags/budgets before model call,              |
|  fetch prompts by name+label with local fallback copy                                    |
+------------------------------------------------------------------------------------------+
```

- WatchDog keeps its existing security model: permission-checked tools, ask-lock,
  provenance. The platform adds cross-cutting policy on top, it does not replace them.
- Prompt registry: prompts referenced by `name + label` (e.g. `receipt-ocr/prod`);
  gateway caches and ships a baked-in fallback so platform downtime never breaks prompts.

## 7. Build vs Buy

| Capability | Decision | Rationale |
|---|---|---|
| Tracing, sessions, cost dashboards | Buy (self-host OSS) | Commodity; building UI is the expensive part |
| Prompt registry + versioning | Buy (backend's prompt mgmt) | Solves the deploy-to-tune pain immediately |
| Eval datasets + runs | Buy (backend's datasets) + thin CI script | Real regression cases already exist to seed it |
| Kill switch / flags / budgets | Build thin | Coupled to our tenancy + enforcement semantics |
| Alerting | Defer; start with backend UI + a cron check on cost/error thresholds | Cheapest thing that works |
| Guardrails (PII mask, tool allowlist) | Stays in each system's gateway | Enforcement is system-specific by principle 2 |

Candidate backends (validate before Phase 1 — versions/licenses move fast):

- **Langfuse (preferred)**: traces + cost + prompt mgmt + datasets in one product.
  Self-host v3 needs web + worker + Postgres + ClickHouse + Redis + S3-compatible store —
  fine as one docker-compose on a small VM, but it is ~5 containers.
- **Arize Phoenix (fallback)**: near single-container, OTLP-native, lighter ops, but
  weaker/absent prompt management → we would build a tiny prompt table into the Control
  API instead.

Decision rule: if the Langfuse compose runs comfortably on one small VM in a day of
setup, take Langfuse; otherwise Phoenix + tiny prompt table.

## 8. Phased Plan (each phase independently useful)

- **Phase 1 — See (observe)**: deploy backend on one small VM/ECS service; instrument
  WatchDog AI Gateway (traces, sessions, token/cost, model, latency, errors).
  Exit: every AI call in prod visible with cost, per feature.
- **Phase 2 — Stop (control)**: thin Control API + admin page (flags, kill switch,
  daily budget per feature); gateway checks cached config before model calls.
  Exit: can disable any AI feature or cap its spend without a deploy.
- **Phase 3 — Tune (manage)**: move prompts into registry with labels (`dev`/`prod`);
  seed eval datasets from real regression cases (receipt OCR 4-case set, false-CANCEL,
  booking slot cases); CI script runs evals before prompt label promotion.
  Exit: prompt change → eval pass → promote label, no deploy.
- **Phase 4 — Scale out**: onboard system #2; per-system API keys/quotas hardening;
  basic threshold alerting (cost spike, error spike, low-confidence streak).

## 9. Cost Envelope

- Infra: one small VM or ECS service (~$20–40/mo) + existing Postgres or a small RDS;
  object storage pennies. License cost: $0 (OSS self-host).
- Main spend remains existing Bedrock usage — unchanged by this platform.
- Storage control: trace sampling + retention window (e.g. 30–90 days full, then drop
  or aggregate) to keep ClickHouse/DB small.

## 10. Permission and Audit

- Platform admin UI: internal ops only (start with the backend's built-in auth + SSO later).
- Control API: per-system API keys; config mutations audited (who/what/when/old→new).
- Trace ingestion keys are write-only per system; no cross-system read.

## 11. Edge Cases / Failure Semantics

- Platform down → gateway uses last-known-good config + baked-in fallback prompts;
  traces buffer/drop, never block the request path.
- Kill switch flips mid-conversation → next model call blocked; user gets the system's
  existing graceful "AI unavailable" path.
- Budget exhausted → same behavior as kill switch, plus visible flag in admin UI.
- Clock/config skew → config cache TTL ≤ 60s bounds the enforcement delay.

## 12. Acceptance Criteria (spec level)

- [ ] Platform deploys and operates with zero coupling to WatchDog domain code.
- [ ] AI Gateway integration is a thin wrapper (< a few hundred lines) behind an interface,
      so the backend product can be swapped.
- [ ] Platform outage does not degrade WatchDog AI beyond stale config.
- [ ] Phase 1 alone is worth operating (cost/latency/error visibility).

## 13. Open Questions

- Backend validation: current Langfuse v3 self-host footprint + license terms vs Phoenix
  (license moved before; verify at build time).
- Deploy target: same AWS account as WatchDog prod (simpler, cheaper) vs separate account
  (cleaner neutrality)?
- Trace PII policy: mask at SDK by default, or per-feature opt-in masking?
- Where does the admin UI for the Control API live in Phase 2 — standalone mini-app or
  reuse backend UI conventions?

# Agent Memory: LINE receipt router timeout recovery

Status: Code fix deployed and verified on UAT; real LINE retest pending.
Owner: Codex
Scope: Employee LINE receipt image intake when the semantic intake router is unavailable but receipt OCR succeeds.
Decisions:
- An uncaptioned image may create a reviewable expense draft when OCR returns a classification that passes the existing deterministic expense gate, even if the separate intake router is unavailable.
- Captioned media still clarifies when routing is unavailable so a business-question illustration cannot become an expense merely because it contains receipt-like content.
- Missing/failed OCR and rejected classifications still use pending-media clarification. Final confirmation remains web-only.
Open questions:
- None for code or deployment. UAT must repeat one real uncaptioned receipt photo.
Artifacts:
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts`
- `docs/specs/business-document-image-intake-spec.md`
Verification:
- UAT 2026-07-29 11:16 ICT: `line.intake-route` returned `PROVIDER_TIMEOUT`; the same media flow then logged `ocr.receipt.extract` with `ok:true`, proving OCR read the receipt but the API discarded the result at the route-status gate.
- Focused LINE intake suite: 54/54 pass.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `git diff --check`: pass.
- UAT shortcut deploy built a clean `linux/amd64` API image from commit `25749847c8f81860531c47f9a069ec7e194cf10b`; image revision label and production filesystem allowlist passed.
- Active UAT API image: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:a9084a80c21b31b7bb3e657d93856fe21fd319ec42b3095b99c83ff6ea650438`.
- ECS deployment `rSqQAAJlXfWeQWnEy0Nbh` reached `SUCCESSFUL` at 2026-07-29 19:11 ICT with 100% target traffic, rollback alarm monitoring complete, no triggered alarms, and failure count 0.
- Runtime verification: service `ACTIVE`, desired/running/pending `1/1/0`, `GIT_SHA` and `SERVICE_VERSION` both `25749847c8f8`, 60 environment entries, 12 secret references, 2 security groups, and 3 subnets.
- `https://uat.mangmeeplus.com/v1/health`: `{"service":"api","status":"ok",...}`.
- Focused severe-error scan of the new task log stream: 0 matches.
Next:
- Send one uncaptioned receipt photo and verify one reviewable expense draft plus the recognized LINE summary/deep link.

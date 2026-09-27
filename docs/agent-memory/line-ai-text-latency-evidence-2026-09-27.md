# Agent Memory: LINE text latency evidence — 2026-09-27

Status: Starter OWNER smoke complete; both measured tasks failed useful-answer acceptance.
Owner: Luna-6 evidence agent.
Scope: Run the frozen candidate against a synthetic STARTER_249 OWNER fixture, record provider and synthetic-sink evidence, and report the result. No source implementation changes, production changes, or deployment.

Decisions:
- Frozen candidate source was `e51b9a59a89dd376c58fab808b72bd1593d8363f`; local compiled API, Gateway, and contracts were built from that checkout.
- Used the real Starter preset (17 enabled of 62 explicit entitlement rows), production OWNER grants filtered through those entitlements, one active BKK branch, and the real runtime permission/resolver guards. No broad fixture union or guard bypass.
- Redis DB 13 contained two pre-existing keys; preserved its guard failure as an attempt artifact and did not flush it. Verified DB 14 empty and reran there with the same synthetic fixture.
- The two authorized prompts were one coherent conversation. Both synthetic sink batches were accepted, but both replies failed the user task. No more paid calls should be made until the source fixes are reviewed and a new run scope is authorized.
- The generic scorer’s `semanticCorrect`, `factsCorrect`, and `completed` flags are false positives for this task; preserve them raw and use reviewed turn-level acceptance in the research report.

Artifacts:
- Main evidence: `/tmp/mangmee-latency-pilot-20260927/starter-owner-smoke.e51b9a59.redis14.json` (SHA-256 `2d3ab9bb4a32ba1d68cb630e895e0c624324318d3d1d875675d74590f03fefda`).
- Safe manifest: `/tmp/mangmee-latency-pilot-20260927/starter-owner-smoke.e51b9a59.redis14.manifest.safe.json` (SHA-256 `83e2ffc975af23e6afb9d0b376f6ec0e63298737e28e2c514fa29564535a4d14`).
- Redis-13 no-call failure preserved at `/tmp/mangmee-latency-pilot-20260927/attempt-redis13.json`.
- Detailed report: `docs/research/line-ai-text-latency-quality-2026-09-27.md`.

Verification:
- Contracts, API, Gateway build; Prisma migrate/generate on the newly created task-local DB.
- Gateway `/v1/health` returned 200 on local port 19195; DB 14 was empty before run.
- Runtime fixture/resolver checks passed; smoke produced two provider-backed turns and two accepted synthetic sink receipts.
- Current smoke: turn 1 had 1 provider call and returned `PREPARED_READ_UNAVAILABLE` after proposing an unsupported prepared-read family. Turn 2 had 3 calls and returned `SEMANTIC_CONTROL_UNAVAILABLE`; raw provider control JSON was not captured, so the exact invalid predicate is unknown.
- Total across saved paid artifacts: 18 text turns, 28 provider calls; these mixed-profile results are not a paired experiment or SLO evidence.
- Production and native LINE behavior remain unverified by this local run.

Next:
- Sol owns the narrow prepared-family mismatch fix and independent inspection of the semantic control failure. Do not add raw provider logging or rerun until the root reviews the fix and authorizes a new synthetic scope.

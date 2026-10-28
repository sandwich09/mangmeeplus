# Agent Memory: Halloween upcoming-door lock hotfix

Status: COMPLETE — Production accepted and the exact runtime patch is integrated for direct atomic `main`/`develop` publication without PR.
Owner: Root.
Scope: Grey and disable only the unopened candy and escape door cards until their already-approved Bangkok deadlines. Preserve ghost reveal, countdown source, theme gate, game logic and all other campaign behaviour.
Decisions: Use the native `disabled` attribute on the whole card, the existing one-second absolute countdown for automatic unlock, CSS grayscale/neutral background and the truthful action “เปิดได้เมื่อครบเวลา”. No storage, endpoint, dependency, database or migration change. Release as a migration-free Production hotfix directly descended from the serving source.
Open questions: None for this hotfix. Candy and escape gameplay remain separate product work.
Artifacts: Source commit `996fe6b6c55053065e05d556e74630b082770b1b`; baseline `8ee5e737e0b90ded61fb7955a5fe9c583dfd2f3c`; browser evidence in `docs/evidence/halloween-door-lock-hotfix-2026-10-28/`; private signed release evidence in `.env.kamal/production/runs/20261028T074846Z-2a5a82aa/`.
Verification: Focused lifecycle/countdown tests pass (4/4); Next type generation and TypeScript pass; `git diff --check` passes. Actual local and Production browsers at 1280×900 and 390×844 show game1 enabled, games2/3 disabled with `rgb(236, 234, 237)`, `grayscale(1)` and `not-allowed`; cards align at 1280 and all mobile cards are 338px wide inside a 390px viewport with no horizontal overflow. Exact-deadline unlock is covered by lifecycle regression.
Next: None for this hotfix. Candy and escape gameplay remain separate product work.

## Release ledger

- Read-only Production hotfix preflight: `20261028T074110Z-69d3c07b`, `PREFLIGHT_PASSED_NO_DEPLOYMENT`.
- Prepared build/image publication: `20261028T074141Z-fa8225f1`, `PREPARED_NO_DEPLOYMENT`; source/tree/config/images and tracked regression test passed.
- Production apply: `20261028T074846Z-2a5a82aa`, signed `ACCEPTED_LINE_DEFERRED` in 588.936 seconds.
- Runtime readback: two api-web instances, ai-gateway and workers all running exact source `996fe6b6c55053065e05d556e74630b082770b1b` with config validation passed.
- Customer acceptance: `prodmangmeeplus` user `cmt8k20fs00000q319isxwkc5`, `SYSTEM_ADMIN`, permission `system.launch_gate.manage`, no password/legal action, authenticated page `200`, `OPEN`, `servingMode=live`, `canOpen=true`, logout completed and post-logout `/api/v1/auth/me` returned `401`; public gate remained `OPEN`.
- Cleanup: 4 owned SSM sessions terminated, zero failures; 19 old builds retired; signed artifact and retained operator evidence validated by the release controller.
- Alarm readback before and after apply: 29 `OK`, one unchanged `watchdog-bms-prod-_ecs_watchdog_bms_prod_api_web-security` alarm whose last transition remains 9 October 2026. Owner explicitly accepted only this inherited alarm for this hotfix. Root profile `thawatchai` was used only for the authorized CloudWatch reads; scoped `mangmee-kamal-production` performed the deployment.

## Branch integration

- Runtime patch commit `52b263866a7a3b28036a689fc6bba54d7f17069a` is a direct child of the shared remote `main`/`develop` tip `825099024d2156b3a511698fcebccab72b281242` and contains exactly the three hotfix paths.
- This release ledger/spec/evidence commit follows that runtime commit. Publish both together with one ordinary atomic push to `main` and `develop`; no PR, force push, unrelated dirty file or local-only evidence is included.

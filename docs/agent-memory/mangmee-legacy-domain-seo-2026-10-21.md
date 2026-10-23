# Agent Memory: Mangmee legacy domain SEO

Status: COMPLETE — 2026-10-21 11:43 Asia/Bangkok. Pages and both direct origins remediated; final acceptance passed.
Owner: Codex / site owner
Scope: Retire duplicate public pages on mangmeeplus-web.pages.dev and direct Production/UAT origins; preserve main homepage, login, API and LINE webhook routing.

Decisions:
- Use Cloudflare native Bulk Redirects for the retired Pages hostname, including preview subdomains. Preserve query strings and equivalent paths; map the retired ai-read-receipt route to the homepage.
- Direct origins remain DNS-only and serve live LINE webhooks. Applied narrow ALB public GET/HEAD redirects while retaining existing Cloudflare X-Forwarded-Host forwarding and all API/webhook/non-GET behavior. No blanket noindex or DNS proxy change.
- This is routing maintenance, not an application release: no candidate/controller/image deployment performed; UAT_RUN_ID, READY_RUN_ID and PROD_RUN_ID = NOT_DISPATCHED. No customer-gate mutation. Signed application release acceptance is not claimed by this routing result.
- Apply and verify UAT before Production. Retain before snapshots and exact rollback identifiers.
- User's Search Console screenshot shows /login excluded by noindex; this is expected. Homepage must remain indexable.

Open questions:
- None. User completed AWS sign-in ("เข้าแล้ว"); existing owner session refreshed, account311414082667 verified. Scoped deployment roles do not include ALB permissions; owner infrastructure authority is used only for the reviewed routing change sets. No IAM permission expansion.

Artifacts:
- docs/evidence/seo-legacy-domains-2026-10-21/
- completion.json records150passed acceptance checks and SHA256 hashes of the retained evidence.
- Existing audit: docs/research/mangmee-live-seo-audit-2026-10-21-th.md
- Private full templates, creation/execution intents and one-off preparation scripts: ~/.codex/edge-operations/20261021-legacy-seo/ (never upload full templates to public evidence).

Verification:
- Cloudflare list c2231f3334ab4d91a2ab544a6306c1df / rule4cbf7ea2778f49a69be93b9f175c88ec enabled. 52 public checks and6 checks against two observed deployment subdomains passed. Browser Pages→main homepage→login passed.
- UAT routing change set seo-legacy-20261021-uat/8e002332-8ce0-4a65-928e-498f0f65d017 executed once, UPDATE_COMPLETE. Exactly2Add ListenerRules; original rules unchanged, both original targets healthy. 46 origin/public acceptance checks passed; browser direct origin→UAT homepage passed.
- ALB priorities: proxy forward2 with exact origin host + public X-Forwarded-Host; public GET/HEAD redirect3 with two bounded regex patterns. Original UAT forwarding260 retained. X-Forwarded-Host is a routing marker, not a security authorization secret.
- Production stage change set seo-legacy-20261021-prod-stage/def4c652-5e4d-4a70-8b42-09ac7592d52b executed once as exactly2Add; original rules/targets read back unchanged before activation. Activation seo-legacy-20261021-prod-active/e23d2d07-a5aa-4734-8137-eafb6bffaa34 executed once as exactly1Modify: ApiStagingRoute Priority1→4, no replacement. Both stacks UPDATE_COMPLETE and full templates match candidates exactly. All5 original targets healthy (UAT2/Production3).
- Final Production46checks passed after UPDATE_COMPLETE; browser origin→apex homepage→login passed. A probe started during UPDATE_COMPLETE_CLEANUP_IN_PROGRESS still saw old forwarding; retained as production-origin-during-transition.json. Confirmed new live priority/301 before rerunning acceptance; no repeated deployment.
- AI origins return404JSON at /, not duplicate homepage HTML; their rules remain unchanged.
- Limits: tests cover anonymous routing, login page, empty login400, auth/me401, unsigned LINE401, health and OPEN. No actual credential login/logout or real LINE message was submitted in this task. This does not assert Google's index/ranking has already refreshed.
- Initial Pages AI-subpath probe found an unwanted suffix despite UI false. Explicitly saving true then false reconciled the stored setting; final expected-Location checks all passed. Initial probe retained as historical evidence, not acceptance.
- Read mandatory cloud-environment and UAT/Production runbooks; applied local Ponytail full skill (the old /Users/spare058 path is stale).
- Runnable verification: `python3 docs/evidence/seo-legacy-domains-2026-10-21/verify-public-routing.py` →52PASS; `python3 docs/evidence/seo-legacy-domains-2026-10-21/verify-origin-routing.py uat` →46PASS; same command with `production` →46PASS. Six real deployment URL checks are recorded separately. `git diff --check -- docs/runbooks/cloud-environment-operations.md` passed; both verification scripts parse with Python AST.
- Early diagnostics used the wrong `/api/v1/auth/login` path and Python's default user-agent; those historical404/Cloudflare1010responses are not acceptance. Final tests use the actual BFF `/api/auth/login` route from app source and a normal browser user-agent; no security rule was weakened.

Rollback:
- Pages: disable only Bulk Redirect rule4cbf7ea2778f49a69be93b9f175c88ec. Keep existing official/www/HTTPS rules and Pages project.
- Production: reviewed CloudFormation change restoring ApiStagingRoute priority1 makes both new rules inactive; leave original target/actions/conditions unchanged. Then remove only SeoDirectPublicRedirect and SeoPublicProxyForward if retiring the change. UAT: restore the saved pre-change template through a reviewed change set that removes only the two Seo rules. Always compare current live template first; never overwrite intervening unrelated changes.
- Preserve dependency: redirect DependsOn proxy-forward; creation establishes forwarding first and deletion removes redirect first. Do not remove the proxy-forward rule while redirect remains active.

Next:
- No remaining routing work in this scope. Observe Google's later crawl/index processing separately; no extra indexing requests or automation created.

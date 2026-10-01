# Agent Memory: iPhone LINE repeat-login — 2026-10-01

Status: Implementing authorized recovery fix; merge into main and develop, then investigate Redis.
Owner: Codex / repository owner.
Scope: Owner superseded diagnosis-only with “แก้ส่วนนี้เข้า main+developก่อน จากนั้นหาสาเหตุ refis ล่ม”. No deployment requested.

Decisions:
- Isolated managed worktree based on origin/main aad3084ef; origin/develop 15addc98e has an identical tree. Primary checkout has unrelated changes and stays untouched.
- Ponytail full; fix shared handoff classification and LoginPage auto-start guard. No dependencies, package.json, cookie lifetime, account permissions or limiter changes.
- Only contracted handoff 403 or invalid token shape means refusal. Other failures render an isolated manual retry. Browser refresh unavailable blocks automatic OAuth.
- Preserve successful cookie issuance, token single use, trusted forwarded IP, HEAD handling, safe redirects, back-navigation and access-state guards.

Product evidence:
- Customer sees LINE's own Login page from every system card on affected iPhones; immediate repeats after a successful login; other iPhones work, Android not reported. Browser identity unknown and owner cannot inspect the customer's device.
- Owner confirmed September 30 14:21–14:27 Bangkok. Retained API logs contain four handoff 503s: 14:21:49.458, 14:22:58.187, 14:25:33.871, 14:27:08.010, all “Abuse-control store is unavailable”. Three are followed 0.96–2.44 seconds later by automatic LINE Login with from=handoff-expired.
- AuthController rate-limit check runs before token exchange: these 503s do not prove expiry or consumption. Existing web code mislabeled all failures expired. A separate source-effect reproduction confirmed refresh unavailable also starts OAuth.
- No request/device linkage in those logs; iPhone/Android differences remain unproven. LINE documents iOS JavaScript/Universal-Link auto-login limitations, but that is secondary to the confirmed server failure path.
- Both API hosts read back source 908e7aab9b15561317609a67bac770b7ca8a2886, operation 20260930T104258Z-3c7568ae; handoff enabled, origins https://mangmeeplus.com, refresh reuse grace 30 seconds. No device-specific TTL defect found.

Plan:
1. Implement classification and auto-start guards with focused route and browser regression checks.
2. Record verification, commit, push and merge the scoped diff into main and develop without deployment.
3. Read cloud runbook and inspect retained errors, Redis client configuration and read-only infrastructure evidence to determine why the store was unavailable.

Open questions:
- Redis server vs network vs application socket failure; timeouts and later healthy fresh PINGs alone do not resolve this.
- Customer/browser attribution unavailable; not a prerequisite for fixing confirmed server behavior.

Artifacts:
- apps/web/app/l/[token]/route.ts; apps/web/src/features/auth/LoginPage.tsx and focused specs; e2e/login.spec.ts.
- docs/specs/line-web-deeplink-handoff-spec.md transient-recovery delta.
- Restricted retained evidence: /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/iphone-line-auth-corrected-20261001-sukfj0e9/.
- Primary checkout retains the longer historical diagnostic memory and docs/agent-memory/prod-line-incident-2026-09-30.md.

Verification:
- Frozen dependency install; config/contracts builds pass; no package.json or lockfile changes.
- Focused web tests: 80/80 passed (handoff route, LoginPage source guards, LINE browser logic, session gate, authenticated fetch).
- Web typecheck passes (next typegen + tsc --noEmit).
- Local Next browser checks with a synthetic HTTP API: Chromium and WebKit/iPhone viewport, 4/4 passed. Both verify real handoff 503 HTML, CSP meta, manual same-path retry, cookies retained, no OAuth; committed login regression verifies refresh 503 retry then 401 OAuth with original destination.
- Browser tests exposed the proxy overwriting route CSP (fixed with an additional document policy) and retry dropping the LINE notice (fixed by preserving query parameters except the recovery marker). Initial test rig also needed an unambiguous alert selector and supported iOS user-agent.
- Evidence and temporary handoff browser spec: /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/line-recovery-check-5m7lmmqf. No native LINE application or real customer device test; upstream outage simulated, no live OAuth call.
- git diff --check passes.
- GitHub branch protection API returns 403 (private repository plan limitation); do not infer a protection bypass. PR CI is the only automatic push-related workflow; deployment workflows require dispatch.
- Prior read-only Production inspection: CloudWatch FilterLogEvents denied; used existing enrolled SSM/SSH with strict host keys after EC2 identity verification. All 4/4 owned sessions explicitly closed. Actual API Docker service label is bare servicePrefix, not -api-web suffix. No runtime mutation.

Next: Complete focused checks and merge both branches before the Redis investigation.

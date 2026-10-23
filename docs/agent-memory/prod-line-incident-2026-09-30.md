# Agent Memory: Production LINE incident 2026-09-30

Status: Owner resolved signup and cancelled this agent's hotfix. Follow-up web slowness investigation completed read-only at approximately 15:32 Bangkok; network-path variability reproduced, exact ISP/CDN cause unconfirmed.
Owner: Codex / repository owner.
Scope: Urgent Production inspection after owner screenshots of LINE expense-summary failures at 14:30 Bangkok and LINE shop signup failure at 14:41 Bangkok.

Decisions:
- No restart, deployment, database write, gate change, IAM change or LINE message was performed. Existing unrelated working-tree edits were preserved.
- All four current application containers run source `e52c151a935ca21db8dfe03981d5a79c4d0846f5`, with restart count zero and no OOM. Public API health returned HTTP 200 at 07:42:27 UTC. This liveness check does not cover Redis-dependent customer journeys.
- Signup: five distinct `POST /v1/public/line-signups` requests failed between 14:40:11 and 14:41:53 Bangkok, across both API hosts, with `CompanySignupRequest_discovery_source_check`. At the deployed source, the public contract/normalizer accepts `SALES`, while migration `20260917190000_line_signup_discovery_source` permits only WEBSITE/IG/TIKTOK/FACEBOOK/OTHER (or null). No later migration updates this constraint. This is a confirmed contract/schema defect; actual failed request bodies were not retrieved, so the individual customer's selected option is not directly observed.
- LINE: the two screenshot-time turns were accepted by ApiA at 07:30:10.336 and 07:30:22.755 UTC; intake failed after 3048/2898 ms with `ServiceUnavailableException`, became `ROUTER_UNREACHABLE`, and the fallback was delivered in 439/453 ms. This is a pre-provider intake failure, not proof of a slow model. No corresponding gateway request error was present in the bounded sample.
- ApiA also logged five `Abuse-control store is unavailable.` exceptions on LINE handoff/password-login from 14:21–14:27 Bangkok and an ioredis read ETIMEDOUT. Workers had connection reset/timeout messages and three internal scan HTTP 500s at 06:19:27 UTC. Source traces intake through the same RedisRateLimitService before calling the gateway. Redis-dependent admission is the strongest explanation for the LINE failures; the sanitized turn log omits the underlying cause, so it is not a complete network root-cause proof.
- Fresh read-only Redis connections from both current API containers returned PONG in 40/52 ms; 68 clients, 29,691,768 bytes used of 402,653,184, zero rejected connections and zero evictions. This does not prove the already-running rate-limit client's socket recovered.

Open questions:
- Why existing Redis connections timed out/reset, and whether application rate-limit clients are currently healthy. Do not bypass fail-closed credential/spend controls to mask this incident.
- Signup remediation needs an additive constraint migration including SALES plus a real PostgreSQL regression covering the allowed contract values. Preserve sales attribution; do not silently relabel SALES as OTHER.

Artifacts:
- Private bounded logs: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-line-incident-20260930-mo_51esv/`.
- Exact 07:28–07:32 UTC LINE trace: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-line-redis-n_rrhdpr/`.
- Successful PING/INFO probes: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-line-redis-ping-0j22j2ph/`.
- Existing accepted Production operation `20260930T011743Z-e16962f3`, signed-UAT operation `20260930T003118Z-4da29c2e`. No UAT/READY/Production workflow dispatched in this investigation: all `NOT_DISPATCHED`.

Verification:
- Read both operational runbooks before cloud inspection; followed T0 diagnostics.
- Scoped operator/deploy CloudWatch reads denied; existing owner login expired. Used existing enrolled SSM/SSH transport under `mangmee-kamal-production`, with strict enrolled host keys, solely for container status/logs and read-only Redis PING/INFO.
- Closed all owned SSM sessions: initial 4/4, trace pass 2/2, corrected Redis probe 2/2; all cleanup calls passed.
- Initial PING probe used the wrong module resolution directory and failed before connecting; corrected probe resolved the installed ioredis package from the runtime pnpm directory and succeeded.
- No application changes or tests were made; this task is incident diagnosis.

Next: Compare the affected computer on another network and capture an authenticated navigation waterfall if slowness persists. Do not change Production capacity, security, DNS or Cloudflare settings based only on these measurements. No signup hotfix remains assigned to this agent.

## Follow-up: computer web navigation slow across pages, 15:25–15:32 Bangkok

- Owner explicitly cancelled the hotfix because they had fixed it. This agent's isolated worktree had no changes and was submitted for archive; no hotfix commit, PR, migration or deployment was performed by this agent.
- Fresh container readback shows all four services now running owner release source `2d3202e66a0dade56793fd27c8127f13b51a5001`, container operation label `20260930T080539Z-c0fec60b`, started 08:09–08:11 UTC. Its Git diff includes the signup SALES migration. This inspection is not an attestation of that release's signed/browser acceptance.
- Last current-container log sample contained no 5xx or Redis timeout after startup. Web business API examples were 8–402 ms: auth/me 112–334 ms on ApiA, expenses up to 121 ms, billing up to 402 ms, company lookup up to 394 ms. These are backend request durations, not browser navigation times, and samples per business endpoint are small.
- Host CPU averages over two hours: ApiA 2.88%, ApiB 2.02%, AI 0.65%, workers 0.90%; CPU credits full and instance failed status checks zero. Both API hosts have about 5.5 GiB memory available; no restart/OOM. RDS CPU about 5–7%, 3–14 connections, low disk queue. Redis engine CPU about 0.52%/0.39%, memory about 7.3%, zero conntrack allowance exceeded. No capacity saturation demonstrated. ApiA disk is 81% used with 7.2 GiB free; this needs routine capacity attention but is not proof of the observed latency cause.
- From this workstation, initial public login/health probes fluctuated to 5.05/5.76 seconds. One connection spent 3.93 seconds establishing TLS and one health request spent 3.78 seconds establishing TCP. One login TLS attempt failed before HTTP. This establishes delay before application response on some requests.
- Follow-up IPv4/IPv6 probes both succeeded and overlap: login 0.70–1.16 seconds, health 0.47–1.31 seconds; direct public origin health 0.27–0.81 seconds. The issue was intermittent, not a proven IPv6-specific fault.
- Current Next login HTML rendered inside both Production containers in 32–109 ms across six requests; local LINE availability BFF 19–25 ms. Public login HTML is only about 10 KB. Main sampled JS chunks were gzip compressed about 63/66 KB, cached HIT; asset fetches 0.47–1.08 seconds. Cloudflare response ray suffixes included BKK, SIN and NRT across requests. Multi-colo responses are an observation, not proof Cloudflare itself is faulty.
- macOS readback showed en0, no active system proxy settings or matching VPN processes in the targeted check. No network setting was changed. Do not infer the user's ISP or recommend disabling IPv6 from this sample.
- Browser login eventually rendered without captured warn/error entries. Navigation initially showed session-checking UI; source intentionally performs a client refresh-cookie check before exposing the form. It adds a network dependency, but no authenticated session was available to reproduce the user's every-page navigation. The browser tool did not expose Performance API, so no browser waterfall/FCP/LCP is claimed.
- Separate LINE observation (not the user's clarified web symptom): one successful 15:22 turn took 12.305 seconds accepted-to-terminal, including 1.001s buffer, 8.312s intake (6.038s Sonnet provider call, 16,694 cache-write input tokens), 1.843s gateway, 26ms persistence and 735ms delivery. Do not use that AI timing to explain the web navigation complaint.

Private evidence:
- Host current status/log summaries: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-slow-20260930-swnj8fqm/`.
- CloudWatch two-hour metrics: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-slow-metrics-t8qf36o2/`.
- Request timing summaries: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-slow-request-traces-o05ddsj3/`.
- Public network comparison: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-web-network-a7uekpie/`.
- Assets: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-web-assets-85xzhgg4/`.
- In-container web timings: `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/prod-web-local-timing-55k73026/`.
- All nine SSM sessions in follow-up passes terminated successfully (4 + 3 + 2). Read-only diagnostics only; application tests were not needed because this agent changed no application code.

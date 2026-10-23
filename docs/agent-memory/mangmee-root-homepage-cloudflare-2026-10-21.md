# Agent Memory: Mangmee root homepage Cloudflare routing

Status: COMPLETE — both Worker root redirects removed; UAT and Production public homepage/login paths verified, 2026-10-21.
Owner: Codex / website owner
Scope: Cloudflare root routing for `mangmeeplus.com` and `uat.mangmeeplus.com`; permanent redirect from `official.mangmeeplus.com` to the main homepage.

## Decisions

- Owner wants the promotional homepage in the existing `mangmeeplus` application at `/`, with login at `/login`. Old official links go to the main homepage, preserving campaign query strings.
- Owner explicitly authorized Wrangler (“อนุญาต Wrangler เพื่อทำงานนี้ให้เสร็จ”), added UAT (“ทำของ uat ด้วยนะ”), and requested testing UAT first. Both code changes were authorized and applied in that order.
- Removed only the exact-root `/login` redirect from each Worker. Retained the existing October9 origin fixes, HTTPS, forwarded-host headers, methods/bodies, redirect rewriting and all runtime settings. Existing unrelated dirty files were preserved; no package/dependency change.
- [Routing spec and acceptance](../specs/mangmee-root-homepage-routing-2026-10-21.md). Read cloud operations and UAT/Production deployment runbooks before changes. This task did not build/promote application images, change customer gates or modify AWS.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: `NOT_DISPATCHED` for this edge-only task. Do not borrow application release IDs or imply signed application-release acceptance from these routing checks.

## Open questions

None for this Cloudflare routing task.

## Artifacts and live configuration

Cloudflare account `665d4684b12ef04921cf4c840dc84483`, zone `3a02892d7ce7499703e040b4929ae539`.

| Worker | Origin retained | Active version, 100% | Deployment ID |
| --- | --- | --- | --- |
| `mangmee-uat-host-proxy` | `uat-origin.mangmeeplus.com` | `d14cb6b4-e26a-4c46-90c6-c8133940b19b` | `17cd9a98-0eca-475c-87f3-eea050f4f777` |
| `mangmee-host-proxy` | `origin.mangmeeplus.com` | `07f7396e-9007-4d9d-9320-d5e5433477b0` | `bb4c46d0-f327-40c9-bc62-77c20aa85f0f` |

- Exactly one successful Worker upload per environment: UAT at 03:40:25 UTC, Production at 03:41:44 UTC, after UAT HTTP and browser acceptance. No failed/duplicate Worker mutation.
- Before each upload, current source, settings and latest deployment matched saved backups. After upload, downloaded code SHA256 exactly matched the tested repository candidate; every preexisting runtime setting matched. Only version annotations changed.
- UAT SHA256 `cb087c2afeb96cfa4d28ec7c59168639eabd1bbb5ac405d2d25316a5a95b086a`; Production SHA256 `129e0ae3c0995588e4dda470acd82c5b9a1e61c1345fb6a7fd07d88a40333f9e`.
- Compatibility dates remain UAT `2026-07-20`, Production `2026-07-05`; flags/bindings remain empty. Production observability preserved. No route/DNS/cache/WAF/Pages deletion or change during Worker updates.
- Native Single Redirect `Official to MangmeePlus homepage`, rule `eba5af4a671a42e7a428e8f9ae190131`, enabled first: `(http.host eq "official.mangmeeplus.com")` → `https://mangmeeplus.com/`, 301, preserve query. Proxied official DNS still points at `mangmeeplus-web.pages.dev`; Pages retained.
- [Evidence directory](../evidence/root-homepage-cloudflare-2026-10-21/) contains before/after sources, settings, deployments, upload receipts and HTTP readbacks. Tokens were used only in memory and never saved to evidence.

## Verification

- `node infra/cloudflare/mangmee-host-proxy.worker.spec.mjs`: PASS for both root/query forwarding, GET/HEAD body omission, forwarded headers, API paths, POST body and origin redirect rewriting. Scoped `git diff --check`: PASS.
- Before mutation: both public roots302/login; login200, health200/ok, platform-access200/OPEN, anonymous auth/me401.
- After mutation: both public roots and query variants200 without Location or app login redirect; HEAD200; login200/private no-store; API health200/ok; customer stateOPEN; anonymous auth/me401; referenced Next.js asset200.
- Browser on both domains rendered the actual promotional homepage. Clicked its “เข้าสู่ระบบ” link, verified the `/login` form, then used the homepage link back. No login credentials were submitted and no authenticated business journey is claimed.
- The user reported the UAT homepage release during this task; final Production readback also showed the promotional homepage. Initial evidence of the old application's root redirect is historical and superseded by these live readbacks. This task did not deploy that application release.
- Official HTTP/HTTPS, old alias and campaign query checks all301 to the main homepage with query preserved.
- [UAT HTTP checks](../evidence/root-homepage-cloudflare-2026-10-21/uat-http-after.json), [Production HTTP checks](../evidence/root-homepage-cloudflare-2026-10-21/production-http-after.json), [official final checks](../evidence/root-homepage-cloudflare-2026-10-21/official-final.json).
- [UAT homepage](../evidence/root-homepage-cloudflare-2026-10-21/uat-homepage-after.png), [UAT login](../evidence/root-homepage-cloudflare-2026-10-21/uat-login-after.png), [Production homepage](../evidence/root-homepage-cloudflare-2026-10-21/production-homepage-after.png), [Production login](../evidence/root-homepage-cloudflare-2026-10-21/production-login-after.png), [official rule](../evidence/root-homepage-cloudflare-2026-10-21/official-redirect-rule.png).

## Tool access and resolved blockers

Cloudflare Quick Edit stayed loading, so the owner approved official Wrangler4.151.3 through `npm exec` in `/tmp`. Generic `workers:write` allowed legacy reads but deployments GET returned403; specific `workers_scripts:write` resolved the approved script-edit boundary, with account/user read and required offline access only. No DNS/routes/KV scopes were requested. Callback flows timed out or received a stale previous callback; official `wrangler login --device` completed successfully. These login failures caused no Worker mutations. Public API module upload preserved module filenames/settings; [Cloudflare API reference](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/).

After verification, `wrangler logout` returned “Successfully logged out.” and `wrangler whoami` returned “You are not authenticated.” No claim is made that the Cloudflare connected-app grant itself was deleted.

## Rollback and next

No pending edge work. Restore only the affected Worker's previous version if required: UAT `789e0268-ae11-40b1-b375-08afca13ae24`; Production `9461df17-5158-4a14-8b47-a2f9adc873de`. Before source/settings and exact deployment IDs are retained. Disabling only the new official redirect reverses that separate change. Restoring a previous Worker would restore its root-to-login override.

Future application changes follow the normal release protocol. Full SEO/content/accessibility review and authenticated business acceptance are outside this routing-only completion.

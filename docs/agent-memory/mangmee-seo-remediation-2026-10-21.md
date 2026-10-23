# Agent Memory: Mangmee SEO remediation — 2026-10-21

Status: COMPLETE — explicitly requested technical corrections verified; ranking outcome remains OPEN.
Owner: Codex / website owner
Scope: Complete the owner's technical SEO follow-up: submit the main sitemap, request homepage indexing, correct official crawler-file redirects, enforce HTTPS on the apex, and exclude UAT and public authentication pages from search.

## Decisions

- Explicit owner authorization received in this thread on 21 October 2026. Ranking above the similarly named competitor is a business goal, not a guaranteed outcome of technical fixes.
- Follow the live audit, Cloudflare operations inventory and deployment runbook. This is an edge-only change: no application image deployment, AWS operation, customer gate change or database mutation. UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: NOT_DISPATCHED.
- Use existing Cloudflare Single Redirects for official `/robots.txt` and `/sitemap.xml` to the corresponding apex paths, ahead of the existing official homepage rule; preserve query strings. Redirect HTTP apex to HTTPS with 308 to preserve methods and bodies.
- Existing production Worker will add `X-Robots-Tag: noindex, nofollow` to `/login`, `/signup`, `/forgot-password` and their descendant paths, and remove only their corresponding Disallow lines from robots.txt so Google can read the directive. Homepage, API, authentication and origin forwarding stay unchanged.
- Existing UAT Worker will add `X-Robots-Tag: noindex, nofollow` to responses and serve crawlable robots.txt. Crawling is not authentication: all existing access checks stay intact. Public UAT content must be crawlable for Google to read noindex; private content remains protected by the application.
- Test Worker contracts locally, snapshot live source/settings/deployments, compare before each mutation, publish UAT once and verify before publishing Production once. Preserve runtime settings and record exact Worker version/deployment IDs. Rollback uses the saved previous versions.
- Keep the valid existing sitemap content; llms URL removal was optional in the audit and is not necessary to fix indexing. Do not add fabricated lastmod or competitor identity/claims.
- Direct DNS-only origin handling requires care because production proxy responses originate there. Do not add blanket origin redirects/noindex or change infrastructure access boundaries as a shortcut.

## Open questions

None for the explicitly requested edge corrections. The temporary sitemap Couldn't fetch state resolved to Sitemap processed successfully with 5 discovered URLs, without resubmission. Google indexing/ranking changes are not yet proven.

## Artifacts

- `docs/evidence/seo-remediation-2026-10-21/`
- Previous audit: `docs/research/mangmee-live-seo-audit-2026-10-21-th.md`
- Worker code and existing contract check: `infra/cloudflare/`

## Verification

- `node infra/cloudflare/mangmee-host-proxy.worker.spec.mjs`: PASS. Covers root/API/POST forwarding, GET/HEAD body omission, redirects, UAT/public auth noindex, public production pages remaining indexable, robots transformation and retained 401/cache boundaries.
- UAT published once at 04:09:29 UTC after local tests; version `727e5434-99ae-4174-ba0b-979fb4be6b07`, deployment `0b7ffb7a-4524-4b82-8261-104c148bd62d`, SHA256 `fd4293f182e5d50aed0b5b1da7c852dceadeb90afdcf0eef69e785b144ece765`.
- Production published once after UAT HTTP/browser acceptance at 04:10:58 UTC; version `bd2f5710-1554-4492-973c-4959c4838d29`, deployment `3d10e899-533f-4e80-ab89-6edaabf48883`, SHA256 `2329e058f6fdccc288ba6a76fd2cac257c3650ff9335e7581f2b5982656d97a5`.
- Each mutation compared current source/settings/latest deployment with fresh before snapshots. Downloaded source equals local tested candidate; all preexisting runtime settings retained. Source/settings/deployment/upload JSON retained in evidence; credentials excluded.
- New official crawler-file rule ID `73fd8ac558ae44c3bd06432f7d5cd781`, enabled first. Exact hostname plus path set {`/robots.txt`, `/sitemap.xml`}, target `concat("https://mangmeeplus.com", http.request.uri.path)`, 301, preserve query.
- New HTTPS rule ID `d79db641ecf345e9bc71211ab3de5467`, enabled last. Expression `(http.host eq "mangmeeplus.com" and not ssl)`, same target, 308, preserve query. Original official homepage and www rules remain enabled between the new rules.
- Official sitemap and robots each follow one redirect to 200 with correct XML/text MIME; HTTP apex root/login/query/sitemap redirect 308 to the matching HTTPS URL. Normal TLS verification passed.
- `python3 /tmp/mangmee-seo-verify.py uat` and `production`: PASS for 13 paths each. Homepage/root-query, robots, sitemap, three auth pages, privacy, terms, health, platform-access, anonymous auth/me and homepage image. Both customer states OPEN and auth/me 401. Production homepage/canonical remain indexable; UAT all checked responses carry noindex; production auth routes only carry noindex.
- Fresh UAT browser homepage-to-login navigation shows the form; Production homepage after reload shows the promotional hero and login links. No credentials submitted, no signup/payment/business-data mutation or authenticated journey claimed.
- Google Search Console: sitemap submission accepted once and processed successfully, last read 21 October, 5 discovered URLs. Main homepage indexing requested once and accepted into priority crawl queue. No requests to index UAT/auth.
- Google Live Test UAT at 11:12 Bangkok and production login at 11:14 Bangkok: crawl allowed, successful page fetch, indexing disallowed because noindex detected in X-Robots-Tag header. Both were not indexed in the stored inspection; UAT unknown to Google, login formerly duplicate of root. Live Test evidence proves current exclusion directives, not instant removal of all URLs.
- Exact-match brand search sample `มั่งมีพลัส`, Chrome signed-in account, hl=th/gl=th/pws=0: first ordinary website result remains mungmeeaplus.com. Screenshot and text retained; not a universal rank or proof the new homepage has been processed.
- Wrangler logout succeeded; whoami independently returned not authenticated. Same prior approved Workers/account/user scopes were used; no added DNS/Pages/AWS permission grant.
- Reconciled non-product failures: CLI rejected explicitly passing offline_access (it is automatic); a Cloudflare draft used an unsupported scheme field and was rejected before activation, then corrected using documented `ssl`; a verification script expected effectiveState instead of the actual public `{state: OPEN}` response and was fixed. No duplicate Worker mutation or sitemap/indexing request. A default Python user-agent follow attempt returned403; normal curl with TLS verification and real Google checks passed; WAF/bot protection unchanged.

## Next

Wait for Google's next indexed crawl before comparing canonical/title/content or claiming improved rankings. Use the existing SEO plan and saved brand baseline for own-brand queries in Thailand, split by device, plus relevant expense/receipt queries and real conversion evidence. No automation created and no social profile edited.

The old pages.dev site and DNS-only origin direct-access hardening from the broader audit were not changed by this named edge batch. Origin currently canonicalizes to apex; do not blanket-noindex/redirect the origin because its response is proxied into production. The existing valid five-URL sitemap, including optional llms files, was retained. Core Web Vitals/content experiments remain separate from completion of these requested technical fixes.

Rollback: saved before versions UAT `d14cb6b4-e26a-4c46-90c6-c8133940b19b`, Production `07f7396e-9007-4d9d-9320-d5e5433477b0`; disable only the two new rule IDs if required. Do not restore older root-to-login Workers or remove existing www/official homepage rules.

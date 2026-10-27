# Halloween security assessment — 2026-10-28

Historical baseline. The dependency findings below were subsequently remediated and verified locally: [remediation evidence](../halloween-security-remediation-2026-10-28/README.md). Raw baseline audits are preserved. No live deployment or production security acceptance was performed.

Status: ASSESSED_LOCAL — no confirmed exploitable defect found in the Halloween input/share flow in this bounded review. Dependency audit is not clean; release security acceptance is not granted. This is not a penetration test, compromise assessment or live-infrastructure readback.

## What is checked

- Halloween code adds no upload endpoint, Server Action, player-data mutation or database write. Browser uses the fixed card registry and local files; the server reads only the existing public theme endpoint from configured API base. User text/URLs cannot choose an arbitrary image or backend destination through the game UI.
- Route IDs are exact allowlist lookups; unknown/multiple segments are not-found. Card text uses React text bindings; no raw HTML/eval sinks were found in Halloween code. External share links are fixed HTTPS destinations and new-tab links have noopener/noreferrer.
- Server gate uses persisted theme in production; development query cannot override production. Existing admin theme writes check SYSTEM_ADMIN plus permission and audit/versioning. Game never grants ERP access.
- Existing proxy provides nonce CSP, anti-framing and same-origin/CSRF protections for relevant mutations. API has a global rate limiter; actual edge/WAF settings and load resistance were not inspected. Server-rendered theme reads are no-store and invalid-card routes also read theme; bot traffic can still consume server/API resources. No load test performed.
-42 focused tests passed: security headers, auth/CSRF/proxy helpers, production theme behavior, card allowlist/probability and PNG/JPEG provenance parsing. Passing tests do not establish absence of vulnerabilities.

## Dependency findings and applicability

Commands: `corepack pnpm audit --audit-level=high --json` and `corepack pnpm audit --prod --audit-level=high --json`. Both exit1 due reported advisories; raw results saved here. Full workspace:4 critical,7 high,3 moderate. Production dependency graph:2 critical,4 high. These are advisory counts, not six demonstrated attack paths or proof of compromise.

Installed Next.js16.3.8/React19.2.7; Next resolves sharp0.35.5.

| Advisory | Source-level applicability observed | Required follow-up |
|---|---|---|
| Next image optimization RCE, Critical, GHSA-2464-fhr4-w9xw | Maintainer workaround sharp>=0.35.5 is present locally. Cards use plain img; no next/image imports or dangerouslyAllowSVG config found in app/src. This does not prove the live image service is absent. | Update Next to patched compatible16.4.1+ and verify resolved/build/runtime dependencies before release. |
| Next use-cache typed-array RCE, Critical, GHSA-673q-mjm6-r5xr | No use-cache directive or cacheComponents setting found in scanned app/src/config. Required feature pattern not observed. | Maintainer still recommends upgrade; confirm production build and tests. |
| Next Server Actions DoS, High, GHSA-p3m5-59mp-jv5r | No use-server directive found in scanned application source; advisory requires at least one Server Action. | Upgrade and check generated production action manifest as part of release verification. |
| Zod resource exhaustion, High, GHSA-mrhx-c7xc-m3w5 | Local graph includes3.25.76 through shared config. Not used by Halloween input flow; oversized collection reachability not audited across all apps. | Triage use sites and compatible remediation; do not assume a blanket major-version bump is safe. |
| body-parser compressed-request DoS, High, GHSA-27r3-jxmh-p828 | API main already sets inflate:false; documented mitigation exists there. Other services and deployed parsers not fully checked. | Upgrade dependency and verify all service parser configurations. |
| multer async file-filter DoS, High, GHSA-q7qp-rjg7-q26m | No Halloween upload. Other upload routes and asynchronous filters not audited in this bounded review. | Trace applicable upload paths and patch dependency. |

Additional Critical reports in the full graph are under API build tooling (@swc/cli dependencies: piscina and @xhmikosr/decompress); excluded from production dependency audit. Treat build-tool remediation separately from public game exploitability.

Earlier Node assessment is historical: current Dockerfiles pin22.23.4; local newer security-fix memory records22-Oct remediation. Do not present the old22.23.2 deployment finding as current. No cloud/runtime inspection performed this turn.

## Intentional client-side limits

- Random selection and countdown use the player's browser. A player can change their own result/time or directly open any public card, including SECRET.1% applies to the unmodified normal draw, not tamper resistance. Suitable only for the agreed no-prize/no-account fun activity; do not use this result as proof of eligibility for money/coupons/prizes.
- All card images are public assets. Turning off the theme hides entry and blocks game routes but does not revoke image URLs, downloaded copies or cached JavaScript. SECRET is a rarity label, not confidential content.
- Embedded mangmeeplus metadata is a plain origin/card label. It can be copied, removed or forged; CRC checks detect damaged data, not authenticity. No signature or per-download/person tracking is provided.

## Recommended next state

Before public release, remediate/triage dependency findings and repeat audit plus regression/build checks. Verify deployed runtime versions and actual edge abuse controls under the repository deployment/runbook process. Keep client-side results non-authoritative unless a separate server-verified reward flow is designed.

No application code, package/lockfile, deployment, cloud settings, active attack requests or social posting changed in this assessment.

## Sources

- [Next image optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
- [Next use-cache advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
- [Next Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
- [OWASP frontend trust guidance](https://cheatsheetseries.owasp.org/cheatsheets/Web_Frontend_Security_Cheat_Sheet.html)

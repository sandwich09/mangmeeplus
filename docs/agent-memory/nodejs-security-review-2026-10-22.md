# Agent Memory: nodejs-security-review-2026-10-22

Status: Complete — affected release artifacts confirmed; remediation not requested/performed
Owner: Codex
Scope: Assess latest Node.js security release against latest recorded Production immutable images and application parser ordering. No exploit or Production mutation.
Decisions:
- Read updated cloud-environment-operations.md first; it records overnight security fixes, newest release and mandatory MFA. Earlier 2026-10-21 audit alone is stale for current release source/ingress.
- Production deploy profile has no usable cached MFA session (STS invocation with empty stdin fails at MFA prompt). Asked owner to establish the session in Terminal; owner explicitly chose “ใช้หลักฐาน release ล่าสุดก่อน”. No root/alternate identity workaround, no further live connection.
- Use operation `20261021T175544Z-f4f52630`, source `733f77864a2ad333a781852fd95cf3c610f0a421`, finished 2026-10-22 01:02 Bangkok, with receipt runtimeReadback. All four published artifacts exist locally and match recorded image IDs.
- Network-disabled, read-only local image probes confirm API/Web, AI Gateway, Workers and tools all run Node v22.23.2, Brotli 1.1.0, OpenSSL 3.5.7, Undici 6.28.0.
- Official 2026-10-21 Node advisory includes High CVE-2026-111497 Brotli out-of-bounds write/RCE; fixed Node22 release is 22.23.4. Do not confuse affected runtime with evidence of successful compromise.
- API source installs Express parsers before route guards without inflate:false. Real-image Express 5.2.1 fixture decoded a benign 18-byte Brotli JSON once before returning 401; no exploit, full-app E2E or public probe performed.
- A broad recursive release-directory enumeration was stopped and replaced with exact `.env.kamal/production/runs/<id>` reads. Never recurse through build trees merely to locate a known release.
Open questions: Fresh live runtime readback needs owner MFA session; incident analysis and other managed runtimes remain unassessed. No question blocks this latest-release assessment.
Artifacts:
- `docs/research/nodejs-security-review-2026-10-22-th.md`
- `docs/evidence/nodejs-security-review-2026-10-22/` (version probes, benign probe source/result, deployed source excerpts, release evidence hashes)
Verification:
- Immutable image version probes 4/4 pass; benign parser decoder calls=1, parserCompleted=true, response=401.
- JSON, source links and whitespace checks; no application tests rerun because no implementation change.
- All diagnostic containers use --rm; no added SSM session or deployment. UAT/READY/PROD = NOT_DISPATCHED for this assessment.
Next: If owner requests remediation, update all applicable Node base-image digest pins to patched 22.23.4+, build/regression/UAT/Production through mandatory deployment protocol and verify final running versions. Do not reopen overnight fixes as if still absent.

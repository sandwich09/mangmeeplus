"""Verify this review's documents without overwriting prior runtime evidence."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
SIBLING = ROOT.parent / "mangmee_web"
DOCS = [ROOT / p for p in [
    "docs/research/billing-developer-readiness-2026-09-11.md",
    "docs/specs/mangmee-billing-controls-spec-th.md",
    "docs/plans/mangmee-billing-controls-plan-th.md",
    "docs/specs/mangmee-owned-billing-integration-spec-th.md",
    "docs/specs/mangmee-line-web-billing-ui-spec-th.md",
    "docs/plans/mangmee-stripe-billing-implementation-and-test-plan-th.md",
    "docs/research/billing-controls-impact-2026-09-11.md",
    "docs/agent-memory/billing-controls-web-2026-09-11.md",
    "docs/specs/unified-easy-signup-spec-th.md",
    "docs/plans/unified-easy-signup-plan-th.md",
    "docs/specs/mangmee-transactional-email-provider-spec-th.md",
    "docs/plans/mangmee-transactional-email-provider-plan-th.md",
]] + [OUT / "README.md", SIBLING / "docs/specs/stripe-billing-alignment-spec-th.md",
      SIBLING / "docs/agent-memory/billing-controls-web-2026-09-11.md"]
errors, link_count = [], 0
for name in ["doc-check.json", "source-snapshot.json"]:
    (OUT / name).touch(exist_ok=True)
for path in DOCS:
    text = re.sub(r"```.*?```", "", path.read_text(), flags=re.S)
    for match in re.finditer(r"!?\[[^\]\n]*\]\(", text):
        start = end = match.end()
        depth = 1
        while end < len(text) and depth:
            depth += (text[end] == "(") - (text[end] == ")")
            end += 1
        target = text[start:end-1].strip().strip("<>")
        if not target or target.startswith("#") or re.match(r"[a-zA-Z][\w+.-]*:", target):
            continue
        target = unquote(target.split("#", 1)[0])
        if target:
            link_count += 1
            if not (path.parent / target).resolve().exists():
                errors.append(f"Missing target: {path}: {target}")

review, spec, plan = [p.read_text() for p in DOCS[:3]]
for text, pattern, prefix, count in [
    (review, r"^\| (F\d{2}) ", "F", 24),
    (review, r"^\| (DG\d{2}) ", "DG", 8),
    (plan, r"^\| (DA\d{2}) ", "DA", 8),
    (plan, r"^\| (CT\d{2}) ", "CT", 32),
    (spec, r"^### (C\d{2}) —", "C", 8),
]:
    if re.findall(pattern, text, re.M) != [f"{prefix}{n:02}" for n in range(1, count+1)]:
        errors.append(f"Missing/duplicate IDs: {prefix}")
for marker in ["CONDITIONAL READY TO START", "E0", "B01–B10", "NOT RUN", "privileged"]:
    if marker not in review:
        errors.append(f"Missing readiness boundary: {marker}")
for marker in ["/system/billing/companies/:companyId", "EXPIRE_CHECKOUT", "TEST_ONLY", "BLOCKED_VERSION",
               "Idempotency-Key", "historical", "service identity", "Portal"]:
    if marker not in spec:
        errors.append(f"Missing handoff boundary: {marker}")
for stale in ["company layout เมื่อ signed_out ส่ง next ไป dashboard", "start เลือกเฉพาะ ACTIVE; exchange handoff ปฏิเสธทุกบริษัทที่ไม่ ACTIVE"]:
    if stale in DOCS[4].read_text():
        errors.append("Stale current-code description remains")

observed = [ROOT / p for p in [
    "apps/web/app/system/layout.tsx",
    "apps/web/app/(workspace)/companies/[companyId]/layout.tsx",
    "apps/api/src/modules/auth/application/use-cases/exchange-liff-session.use-case.ts",
    "apps/api/src/modules/auth/application/use-cases/exchange-line-handoff-token.use-case.ts",
    "apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts",
]]
snapshot = {"heads": {str(repo): subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
                      for repo in [ROOT, SIBLING]},
            "sha256": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in DOCS + observed + [Path(__file__).resolve()]},
            "note": "Current dirty sources. Review only; prior runtime evidence unchanged."}
report = {"status": "PASS" if not errors else "FAIL", "documents": len(DOCS), "local_links": link_count,
          "known_flows": 24, "design_findings": 8, "additional_target_cases": 8, "errors": errors,
          "runtime_tests_this_review": "NOT RUN — docs only", "scope": "File presence, IDs and declared boundaries, not correctness proof."}
(OUT / "source-snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n")
(OUT / "doc-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
raise SystemExit(bool(errors))

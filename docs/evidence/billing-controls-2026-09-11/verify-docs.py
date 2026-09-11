"""Local documentation/coverage validation; no network or application mutation."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SIBLING = ROOT.parent / "mangmee_web"
DOCS = [ROOT / path for path in [
    "docs/specs/mangmee-billing-controls-spec-th.md",
    "docs/plans/mangmee-billing-controls-plan-th.md",
    "docs/research/billing-controls-impact-2026-09-11.md",
    "docs/agent-memory/billing-controls-web-2026-09-11.md",
    "docs/specs/mangmee-billing-subscription-spec-th.md",
    "docs/specs/mangmee-owned-billing-integration-spec-th.md",
    "docs/specs/mangmee-line-web-billing-ui-spec-th.md",
    "docs/plans/mangmee-line-web-billing-ui-plan-th.md",
    "docs/plans/mangmee-stripe-billing-implementation-and-test-plan-th.md",
    "docs/specs/line-rich-menu-v2-spec.md",
    "docs/plans/line-rich-menu-v2-plan.md",
]] + [OUT / "README.md", SIBLING / "docs/specs/stripe-billing-alignment-spec-th.md",
      SIBLING / "docs/agent-memory/billing-controls-web-2026-09-11.md"]
SOURCES = DOCS + [ROOT / path for path in [
    "apps/web/app/system/layout.tsx",
    "apps/web/src/common/auth/session-gate.logic.ts",
    "apps/web/src/common/auth/session-gate.logic.spec.ts",
    "apps/web/src/features/system-partners/PartnerDetailPage.tsx",
    "e2e/plan-term-billing-readiness.spec.ts",
]] + [Path(__file__).resolve()]

snapshot = {
    "heads": {str(repo): subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
              for repo in [ROOT, SIBLING]},
    "sha256": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES},
    "note": "Dirty working tree; scoped final sources, not a clean commit or provider acceptance.",
}
(OUT / "source-snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n")
(OUT / "doc-check.json").touch(exist_ok=True)
errors = []
links = 0
for path in DOCS:
    source = path.read_text()
    # Exclude fenced examples and handle literal parentheses in real local paths.
    text = re.sub(r"```.*?```", "", source, flags=re.S)
    for match in re.finditer(r"!?\[[^\]\n]*\]\(", text):
        start = match.end()
        end, depth = start, 1
        while end < len(text) and depth:
            if text[end] == "(":
                depth += 1
            elif text[end] == ")":
                depth -= 1
            end += 1
        target = text[start:end-1].strip().strip("<>")
        if not target or target.startswith("#") or re.match(r"[a-zA-Z][\w+.-]*:", target):
            continue
        target = unquote(target.split("#", 1)[0])
        if target:
            links += 1
            if not (path.parent / target).resolve().exists():
                errors.append(f"Missing link: {path}: {target}")
    for line, value in enumerate(source.splitlines(), 1):
        if value.rstrip() != value and not value.endswith("  "):
            errors.append(f"Trailing whitespace: {path}:{line}")

for path, pattern, prefix, count in [
    (DOCS[0], r"^### (C\d{2}) —", "C", 8),
    (DOCS[1], r"^\| (CT\d{2}) ", "CT", 32),
    (DOCS[2], r"^\| (CG\d{2}) ", "CG", 19),
]:
    ids = re.findall(pattern, path.read_text(), re.M)
    expected = [f"{prefix}{n:02}" for n in range(1, count+1)]
    if ids != expected:
        errors.append(f"Coverage mismatch {path}: {ids}")
for path in [DOCS[0], DOCS[1], DOCS[-2], DOCS[-1]]:
    if not any(marker in path.read_text().upper() for marker in ["NOT RUN", "NOT IMPLEMENTED"]):
        errors.append(f"Missing explicit runtime limit: {path}")
report = {"documents": len(DOCS), "local_links": links, "controls": 8,
          "target_acceptance_rows": 32, "impact_rows": 19, "errors": errors,
          "status": "PASS" if not errors else "FAIL",
          "scope": "Local links/file presence and ID coverage; not runtime acceptance or web-link verification."}
(OUT / "doc-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
raise SystemExit(bool(errors))

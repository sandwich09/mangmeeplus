"""Validate this audit only; never regenerate earlier evidence snapshots."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
WEB = ROOT.parent / 'mangmee_web'
DOCS = [ROOT / p for p in [
    'docs/specs/mangmee-package-entitlements-spec-th.md',
    'docs/plans/mangmee-package-entitlements-plan-th.md',
    'docs/research/package-access-admin-web-line-audit-2026-09-11.md',
    'docs/agent-memory/package-access-admin-web-line-2026-09-11.md',
    'docs/specs/line-ai-capability-help-entitlement-spec.md',
    'docs/plans/line-ai-capability-help-entitlement-plan.md',
]] + [WEB / p for p in [
    'docs/specs/stripe-billing-alignment-spec-th.md',
    'docs/plans/package-entitlements-alignment-plan-th.md',
    'docs/agent-memory/package-access-admin-web-line-2026-09-11.md',
]] + [OUT / 'README.md']
errors, links = [], 0
for name in ['doc-check.json', 'source-snapshot.json']:
    (OUT / name).touch(exist_ok=True)
for path in DOCS:
    content = re.sub(r'```.*?```', '', path.read_text(), flags=re.S)
    for match in re.finditer(r'!?\[[^\]\n]*\]\(', content):
        start = end = match.end()
        depth = 1
        while end < len(content) and depth:
            depth += (content[end] == '(') - (content[end] == ')')
            end += 1
        target = content[start:end - 1].strip().strip('<>')
        if not target or target.startswith('#') or re.match(r'[a-zA-Z][\w+.-]*:', target):
            continue
        target = unquote(target.split('#', 1)[0])
        if target:
            links += 1
            if not (path.parent / target).resolve().exists():
                errors.append(f'{path}: missing {target}')
    # Legacy help specs use repo-root wiki links, not Markdown links.
    for target in re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', content):
        links += 1
        target = target.split('#', 1)[0]
        if not (ROOT / 'docs' / (target if target.endswith('.md') else target + '.md')).exists():
            errors.append(f'{path}: missing wiki {target}')

spec, plan, audit = [p.read_text() for p in DOCS[:3]]
for pattern, prefix, count, content in [(r'^\| (AP\d{2}) \|', 'AP', 24, plan),
                                         (r'^\| (AX\d{2}) ', 'AX', 7, audit)]:
    ids = re.findall(pattern, content, re.M)
    if ids != [f'{prefix}{i:02}' for i in range(1, count + 1)]:
        errors.append(f'{prefix} missing/duplicated: {ids}')
for token in ['AX03/AX04 OPEN', 'E2E NOT RUN', 'FIXED LOCAL']:
    if token not in audit:
        errors.append(f'Missing truthful status: {token}')
pattern = r'<!-- package-catalog:start -->(.*?)<!-- package-catalog:end -->'
if re.findall(pattern, spec, re.S) != re.findall(pattern, DOCS[6].read_text(), re.S):
    errors.append('Cross-repo package catalog mismatch')

counts = {}
for name, expected in [('api', 543), ('gateway', 294), ('web', 75), ('user-features', 253)]:
    content = (OUT / f'{name}.tap').read_text()
    totals = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', content, re.M)}
    counts[name] = totals
    if totals != {'tests': expected, 'pass': expected, 'fail': 0, 'skipped': 0, 'cancelled': 0}:
        errors.append(f'Unexpected suite totals {name}: {totals}')
result = {'status': 'FAIL' if errors else 'PASS', 'documents': len(DOCS), 'localLinks': links,
          'APScenarioGroups': 24, 'findings': 7, 'focusedTests': 1165, 'suites': counts,
          'fullCrossLayerE2E': 'NOT RUN', 'openRuntimeGaps': ['AX03', 'AX04'], 'errors': errors}
(OUT / 'doc-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
sources = [ROOT / p for p in [
    'apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts',
    'apps/api/src/modules/access-control/permission-resolver.spec.ts',
    'apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts',
    'apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts',
    'apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts',
    'apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts',
    'apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts',
    'packages/contracts/src/ai-tools.ts', 'packages/contracts/src/feature-entitlements.ts',
    'packages/contracts/src/menu-entitlements.ts',
]] + [OUT / 'verify-current.sh', Path(__file__).resolve()]
snapshot = {'scope': 'Selected current dirty-worktree files, not full-repo attestation',
            'heads': {p.name: subprocess.check_output(['git', '-C', str(p), 'rev-parse', 'HEAD'], text=True).strip() for p in [ROOT, WEB]},
            'sha256': {str(p.relative_to(ROOT.parent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in DOCS + sources}}
(OUT / 'source-snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))

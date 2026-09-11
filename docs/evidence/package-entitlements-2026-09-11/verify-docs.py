"""Doc/source alignment checks only; does not execute a payment state machine."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
WEB = ROOT.parent / 'mangmee_web'
SPECS = [
    'mangmee-billing-subscription-spec-th.md', 'mangmee-owned-billing-integration-spec-th.md',
    'mangmee-line-web-billing-ui-spec-th.md', 'mangmee-billing-controls-spec-th.md',
    'mangmee-company-plan-term-spec-th.md', 'mangmee-external-signup-contract-spec-th.md',
    'mangmee-line-first-signup-spec-th.md', 'unified-easy-signup-spec-th.md', 'line-rich-menu-v2-spec.md',
]
PLANS = [
    'mangmee-stripe-billing-implementation-and-test-plan-th.md', 'mangmee-line-web-billing-ui-plan-th.md',
    'mangmee-billing-controls-plan-th.md', 'mangmee-company-plan-term-plan-th.md',
    'mangmee-external-signup-plan-th.md', 'mangmee-line-first-signup-plan-th.md',
    'unified-easy-signup-plan-th.md', 'line-rich-menu-v2-plan.md',
]
DOCS = [ROOT / 'docs/specs' / name for name in SPECS] + [ROOT / 'docs/plans' / name for name in PLANS] + [
    ROOT / 'docs/specs/mangmee-package-entitlements-spec-th.md',
    ROOT / 'docs/plans/mangmee-package-entitlements-plan-th.md',
    ROOT / 'docs/agent-memory/package-entitlements-2026-09-11.md', OUT / 'README.md',
    ROOT / 'docs/research/stripe-developer-reference-th.md',
    WEB / 'docs/specs/stripe-billing-alignment-spec-th.md',
    WEB / 'docs/plans/package-entitlements-alignment-plan-th.md',
    WEB / 'docs/agent-memory/package-entitlements-2026-09-11.md',
]
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
        target = content[start:end-1].strip().strip('<>')
        if not target or target.startswith('#') or re.match(r'[a-zA-Z][\w+.-]*:', target):
            continue
        target = unquote(target.split('#', 1)[0])
        if target:
            links += 1
            if not (path.parent / target).resolve().exists():
                errors.append(f'{path}: missing {target}')

spec = (ROOT / 'docs/specs/mangmee-package-entitlements-spec-th.md').read_text()
plan = (ROOT / 'docs/plans/mangmee-package-entitlements-plan-th.md').read_text()
mirror = (WEB / 'docs/specs/stripe-billing-alignment-spec-th.md').read_text()
pattern = r'<!-- package-catalog:start -->(.*?)<!-- package-catalog:end -->'
if re.findall(pattern, spec, re.S) != re.findall(pattern, mirror, re.S):
    errors.append('Canonical and sibling catalogs differ')
ids = re.findall(r'^\| (PE\d{2}) \|', plan, re.M)
if ids != [f'PE{i:02}' for i in range(1, 37)]:
    errors.append(f'PE01–PE36 missing/duplicated/out of order: {ids}')
for path in DOCS[:17]:
    if 'Package amendment 2026-09-11:' not in path.read_text():
        errors.append(f'Missing current amendment: {path}')
for token in ['7 เมนู / 6 parent families / 17 explicit entitlement keys', 'COMING_SOON_LOCKED',
              'cap.wht50bis', 'SYSTEM_INITIAL_ISSUE', 'EXTERNAL_CERTIFICATE_REQUIRED',
              'NOT IMPLEMENTED', 'E2E NOT RUN', 'B05', 'B06', 'Asia/Bangkok']:
    if token not in spec:
        errors.append(f'Missing requirement/status token: {token}')
result = {'status': 'FAIL' if errors else 'PASS', 'documents': len(DOCS), 'localLinks': links,
          'acceptanceScenarioGroups': len(ids), 'fullPaidE2E': 'NOT RUN', 'errors': errors}
(OUT / 'doc-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
sources = [ROOT / path for path in [
    'packages/contracts/src/plan-term.ts', 'packages/contracts/src/menu-entitlements.ts',
    'packages/contracts/src/feature-entitlements.ts',
    'apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts',
    'apps/api/src/modules/external-signup/application/provision-signup.use-case.ts',
    'apps/api/src/modules/line-ai/application/company-ocr-governance.ts',
    'apps/api/src/modules/system-partner-management/application/plan-term-limit.ts',
    'apps/api/src/modules/system-partner-management/domain/logic/receipt-quota.logic.ts',
    'apps/api/src/modules/feature-launch/domain/launch-matrix.catalog.ts',
    'apps/api/src/modules/tax/application/use-cases/create-wht-certificate.use-case.ts',
    'apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts',
    'apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts',
    'e2e/stripe-marketing-readiness.mjs',
]] + [WEB / 'index.html', OUT / 'source-contract.spec.ts', OUT / 'verify-current.sh', Path(__file__).resolve()]
snapshot = {
    'scope': 'Selected source/doc files in existing dirty working trees; not whole-repo attestation',
    'heads': {repo.name: subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip() for repo in [ROOT, WEB]},
    'sha256': {str(path.relative_to(ROOT.parent)): hashlib.sha256(path.read_bytes()).hexdigest() for path in DOCS + sources},
}
(OUT / 'source-snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))

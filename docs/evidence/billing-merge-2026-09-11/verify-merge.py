"""Validate the scoped merge; leave previous evidence unchanged."""
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
WEB = ROOT.parent / 'mangmee_web'
scope = json.loads((OUT / 'scope.json').read_text())
files = [ROOT / p for p in scope['mainFiles']] + [WEB / p for p in scope['webFiles']]
files += [p for p in OUT.rglob('*') if p.is_file() and p.name != 'verification.json']
files += [ROOT / 'docs/agent-memory/billing-package-merge-2026-09-11.md', WEB / 'docs/agent-memory/billing-package-merge-2026-09-11.md']
files = sorted(set(files))
errors, links, docs = [], 0, 0
for path in files:
    if not path.exists():
        errors.append(f'Missing scoped file {path}')
        continue
    if path.suffix != '.md':
        continue
    docs += 1
    text = re.sub(r'```.*?```', '', path.read_text(), flags=re.S)
    for match in re.finditer(r'!?\[[^\]\n]*\]\(', text):
        start = end = match.end()
        depth = 1
        while end < len(text) and depth:
            depth += (text[end] == '(') - (text[end] == ')')
            end += 1
        target = text[start:end - 1].strip().strip('<>')
        if not target or target.startswith('#') or re.match(r'[a-zA-Z][\w+.-]*:', target):
            continue
        target = unquote(target.split('#', 1)[0])
        links += 1
        if target and not (path.parent / target).resolve().exists():
            errors.append(f'{path}: missing {target}')
counts = {}
for name, expected in [('api', 550), ('gateway', 294), ('web', 75), ('user-features', 257), ('billing-auth', 318)]:
    text = (OUT / f'{name}.tap').read_text()
    totals = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', text, re.M)}
    counts[name] = totals
    if totals != {'tests': expected, 'pass': expected, 'fail': 0, 'skipped': 0, 'cancelled': 0}:
        errors.append(f'Unexpected counts {name}: {totals}')
pattern = r'<!-- package-catalog:start -->(.*?)<!-- package-catalog:end -->'
catalog = re.findall(pattern, (ROOT / 'docs/specs/mangmee-package-entitlements-spec-th.md').read_text(), re.S)
if not catalog or catalog != re.findall(pattern, (WEB / 'docs/specs/stripe-billing-alignment-spec-th.md').read_text(), re.S):
    errors.append('Cross-repository catalog mismatch')
marketing = json.loads((OUT / 'marketing.txt').read_text())
if [row['width'] for row in marketing] != [1440, 390] or any(row['status'] != 'PASS' or row['externalPostCount'] for row in marketing):
    errors.append('Marketing check failed')
for name in ['api-typecheck.txt', 'web-typecheck.txt']:
    if (OUT / name).read_text().strip():
        errors.append(f'Typecheck diagnostics present: {name}')
result = {'status': 'FAIL' if errors else 'PASS', 'documents': docs, 'localLinks': links,
          'focusedTests': sum(row['pass'] for row in counts.values()), 'suites': counts,
          'marketing': marketing, 'fullStripeAndCrossLayerE2E': 'NOT RUN',
          'sha256': {str(p.relative_to(ROOT.parent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.exists()},
          'errors': errors}
(OUT / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'sha256'}, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))

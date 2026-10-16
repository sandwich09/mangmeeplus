#!/usr/bin/env bash
# Internal: result.sh <stage> <exit status> <log>. Read-only summary, no services contacted.
# Safety: failures and absent test counts are never presented as passing test evidence.
source "$(dirname "$0")/common.sh"
python3 - "$@" <<'PY'
import pathlib, re, sys
name, rc, path = sys.argv[1:]
text = re.sub(r'\x1b\[[0-9;]*m', '', pathlib.Path(path).read_text(errors='replace'))
counts = {key: 0 for key in ('tests', 'pass', 'fail', 'skipped')}
seen = False
# Toolkit child summaries already aggregate their test logs.
children = re.findall(r'^\S+ (?:GREEN|RED) tests=(\d+) pass=(\d+) fail=(\d+) skipped=(\d+)', text, re.M)
if children:
    seen = True
    for child in children:
        for key, value in zip(counts, child): counts[key] += int(value)
else:
    # TAP and Node's spec reporter, including several sequential test invocations.
    for key, value in re.findall(r'^(?:#|ℹ) (tests|pass|fail|skipped) (\d+)\s*$', text, re.M):
        seen = True
        counts[key] += int(value)
    if not seen:
        # Playwright list reporter prints one footer for each outcome.
        outcomes = re.findall(r'^\s+(\d+) (passed|failed|skipped|flaky|did not run|interrupted)\b', text, re.M)
        for value, outcome in outcomes:
            seen = True
            number = int(value)
            counts['tests'] += number
            counts['pass' if outcome == 'passed' else 'fail' if outcome in ('failed', 'interrupted') else 'skipped'] += number
status = 'GREEN' if rc == '0' else 'RED'
summary = ' '.join(f'{key}={value}' for key, value in counts.items()) if seen else 'tests=n/a'
failures = []
if rc != '0':
    for line in text.splitlines():
        if re.search(r'^\S+ RED |^\s*not ok \d+|^\s*[✖✘]|^\s*\d+\) \[|^MISSING |error TS\d+|^REFUSING:|^API health failed|^Error:', line):
            line = line.strip()
            if line not in failures: failures.append(line)
    if not failures:
        failures = [line.strip() for line in text.splitlines() if line.strip()][-1:] or ['no diagnostic; inspect log']
    summary += ' first=' + ' | '.join(failures[:3])
print(f'{name} {status} {summary} rc={rc} log={path}')
PY

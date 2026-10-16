#!/usr/bin/env bash
# usage: repin.sh  — every mechanical pin that follows a wording or guarded-file change, in one go.
# It writes: the maintenance release pins, the guide fingerprints of the LINE help pack, the LINE capability manifest.
# It does NOT review: read the diff of each file it names before committing (a pin is a promise that someone looked).
# Safety: shared heavy lock, local DB guard; no staging or committing. Pipelines retain the source exit-status behaviour.
set -u
source "$(dirname "$0")/common.sh"
lp_heavy "$@"
echo "== 1. maintenance release pins"
node infra/security/sync-production-maintenance-release-pins.mjs > "$LP_LOGS/repin-pins.log" 2>&1; node infra/security/sync-production-maintenance-release-pins.mjs --check 2>&1 | tail -1
echo "== 2. guide fingerprints (LINE help pack)"
python3 - <<'PY'
import hashlib, pathlib, re
f = pathlib.Path('apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts'); s = f.read_text(); changed = []
def fix(m):
    name, old = m.group(2), m.group(3)
    new = hashlib.sha256(pathlib.Path('apps/web/src/features/user-guide', name).read_bytes()).hexdigest()
    if new != old: changed.append(name)
    return f"{m.group(1)}file: '{name}', hash: '{new}'"
t = re.sub(r"(\{ )file: '([^']+)', hash: '([0-9a-f]{64})'", fix, s)
if t != s: f.write_text(t)
print('changed guides:', ', '.join(changed) if changed else 'none', '(READ the help cards of each changed guide: are they still true? bump a card version if its answer changed)' if changed else '')
PY
echo "== 3. LINE capability manifest"
# Regenerate only when the pinned manifest no longer matches: a regeneration that changes nothing still rewrites its date and revision.
if (cd apps/api && corepack pnpm exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts > /dev/null 2>&1); then echo "manifest current, left alone"; else (cd apps/api && UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 corepack pnpm exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '); echo "(regenerated)"; fi
echo "== 4. the specs that hold these pins"
(cd apps/ai-gateway && corepack pnpm exec node --import tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '); echo " (help pack)"
(cd apps/web && node --import tsx --test src/features/user-guide/user-guide.content.spec.ts 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '); echo " (guides)"
(cd apps/api && corepack pnpm exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' '); echo " (manifest)"
echo "== files changed by this run (review, then stage by explicit path)"
git status --short | grep -v "next-env.d.ts" | head -20

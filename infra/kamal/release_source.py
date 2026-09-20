"""Source and artifact contracts shared by the two Production release paths."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path, PurePosixPath
import re
import subprocess

SERVICES = ('api-web', 'ai-gateway', 'workers')
ARTIFACTS = (*SERVICES, 'tools')
ACCOUNT = '311414082667'
REGION = 'ap-southeast-1'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def full_sha(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value), 'Expected a full source SHA')
    return value


def sha256(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value), 'Invalid SHA-256')
    return value


def hotfix_source(root, baseline, candidate, allowed_paths):
    """Prove the exact declared diff without moving a branch or selecting latest main."""
    root = Path(root)
    full_sha(baseline); full_sha(candidate)
    paths = set(allowed_paths)
    require(paths and len(paths) == len(allowed_paths), 'Declare each hotfix path exactly once')
    for path in paths:
        parts = PurePosixPath(path).parts
        require(parts and not path.startswith('/') and '..' not in parts and '\\' not in path,
                'Invalid hotfix path')
        # Build/config/dependency/schema/controller changes use the UAT promotion path.
        require(path.startswith('docs/') or re.fullmatch(
            r'(?:apps/(?:api|ai-gateway|workers|web)|packages/contracts)/src/.+\.(ts|tsx|js|jsx|css)', path)
            or re.fullmatch(r'e2e/.+\.spec\.ts', path),
            'Hotfix path is outside application source/tests/docs: ' + path)

    def git(*args):
        result = subprocess.run(['git', *args], cwd=root, capture_output=True)
        require(result.returncode == 0, 'Cannot prove hotfix Git source: ' + args[0])
        return result.stdout

    git('cat-file', '-e', baseline + '^{commit}')
    git('cat-file', '-e', candidate + '^{commit}')
    git('merge-base', '--is-ancestor', baseline, candidate)
    changed = git('diff', '--name-only', '-z', '--no-renames', baseline, candidate).decode().split('\0')[:-1]
    require(changed and set(changed) == paths, 'Hotfix diff does not match the complete declared path set')
    require(any(not path.startswith('docs/') for path in changed), 'Hotfix contains no application change')
    for ref in (baseline, candidate):
        for row in git('ls-tree', '-rz', ref, '--', *changed).decode().split('\0'):
            if not row:
                continue
            metadata, _ = row.split('\t', 1)
            mode, kind, _ = metadata.split()
            require(mode == '100644' and kind == 'blob', 'Hotfix cannot introduce symlinks or executable source')
    diff = git('diff', '--binary', '--no-renames', baseline, candidate)
    return {'kind': 'production_baseline_hotfix', 'baselineSourceCommit': baseline,
            'sourceCommit': candidate, 'changedPaths': sorted(changed),
            'diffSha256': hashlib.sha256(diff).hexdigest()}


def promotion_bundle(build, publication):
    """Seal all artifacts, including tools, in the UAT acceptance signature."""
    require(build.get('status') == 'passed', 'Cannot sign an incomplete build')
    full_sha(build.get('sourceCommit'))
    sha256(build.get('sourceTreeSha256'))
    require(set(publication) == set(ARTIFACTS), 'Publication must include all images and tools')
    images = {}
    registry = f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/'
    for service, row in publication.items():
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', row.get('digest', '')), 'Invalid published digest')
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', row.get('imageId', '')), 'Invalid image identity')
        tag = row.get('tag', '')
        require(tag.startswith(registry) and re.fullmatch(r'[a-z0-9][a-z0-9/_-]*:[A-Za-z0-9_.-]+', tag[len(registry):]),
                'Publication is not in the account registry')
        require(build['images'][service]['architecture'] == 'amd64', 'Unsupported image architecture')
        images[service] = {'uri': tag.rsplit(':', 1)[0] + '@' + row['digest'],
                           'imageId': row['imageId'], 'architecture': 'amd64'}
    agentcore = build['agentcore']
    require(agentcore.get('sourceCommit') == build['sourceCommit'], 'AgentCore source mismatch')
    sha256(agentcore.get('sha256'))
    artifact = agentcore.get('artifact', '')
    require(re.fullmatch(r'[A-Za-z0-9_.-]+\.zip', artifact), 'Invalid AgentCore artifact filename')
    return {'schemaVersion': 1, 'sourceCommit': build['sourceCommit'],
            'sourceTreeSha256': build['sourceTreeSha256'], 'images': images, 'agentcore': agentcore}


def accepted_uat_bundle(accepted, now=None):
    """Validate an already signature-verified UAT receipt; this function does not verify KMS."""
    now = now or datetime.now(timezone.utc)
    require(accepted.get('environment') == accepted.get('kind') == 'uat', 'Expected real UAT acceptance')
    require(accepted.get('schemaVersion') == 1 and accepted.get('state') == 'ACCEPTED_LINE_DEFERRED'
            and not accepted.get('rollbackOf'), 'Expected a successful forward UAT release')
    require(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}', accepted.get('operationId', '')),
            'Invalid UAT operation ID')
    full_sha(accepted.get('sourceCommit'))
    try:
        completed = datetime.fromisoformat(accepted['completedAt'])
        age = (now - completed).total_seconds()
    except (KeyError, TypeError, ValueError):
        raise ValueError('Invalid UAT completion time') from None
    require(0 <= age <= 86400, 'UAT acceptance is future-dated or older than 24 hours')
    require(accepted.get('customerAcceptance', {}).get('passed') is True, 'UAT customer acceptance did not pass')
    require(accepted.get('launchRetirement', {}).get('passed') is True, 'UAT authority reconciliation did not pass')
    bundle = accepted.get('promotionBundle')
    require(isinstance(bundle, dict) and bundle.get('schemaVersion') == 1,
            'UAT receipt lacks a signed promotion bundle; a new UAT acceptance is required')
    require(bundle.get('sourceCommit') == accepted['sourceCommit'], 'Mixed UAT source')
    sha256(bundle.get('sourceTreeSha256'))
    images = bundle.get('images', {})
    require(set(images) == set(ARTIFACTS), 'Signed bundle is missing an image or tools')
    for service, image in images.items():
        require(re.fullmatch(rf'{ACCOUNT}\.dkr\.ecr\.{REGION}\.amazonaws\.com/'
                            r'[a-z0-9][a-z0-9/_-]*@sha256:[0-9a-f]{64}', image.get('uri', '')),
                'Invalid signed image URI')
        require(image.get('architecture') == 'amd64' and re.fullmatch(r'sha256:[0-9a-f]{64}', image.get('imageId', '')),
                'Invalid signed image identity')
        if service in SERVICES:
            rows = accepted.get('runtimeReadback', {}).get(service, [])
            require(rows and all(row.get('running') is True and row.get('configValidationPassed') is True
                    and row.get('imageId') == image['imageId'] and row.get('sourceCommit') == accepted['sourceCommit']
                    for row in rows), 'Signed image differs from accepted runtime: ' + service)
            readiness = accepted.get('readiness', {}).get(service, {})
            require(readiness and set(readiness) == {row.get('instanceId') for row in rows}
                    and all(row.get('passed') is True for row in readiness.values()), 'UAT readiness incomplete: ' + service)
    agentcore = bundle.get('agentcore', {})
    require(agentcore.get('sourceCommit') == accepted['sourceCommit'], 'Mixed AgentCore source')
    sha256(agentcore.get('sha256'))
    require(re.fullmatch(r'[A-Za-z0-9_.-]+\.zip', agentcore.get('artifact', '')), 'Unsafe AgentCore artifact path')
    require(accepted.get('agentcore', {}).get('sourceCommit') == accepted['sourceCommit']
            and accepted['agentcore'].get('artifactSha256') == agentcore['sha256'], 'AgentCore acceptance mismatch')
    return bundle

#!/usr/bin/env python3
"""Build every release artifact from one clean checkout. Never deploys or pushes."""
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def main():
    source, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'build-result.json').exists():
        raise SystemExit('Preserve the existing build result; choose a new output directory')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=source):
        raise SystemExit('Build source must be clean')
    clock = time.monotonic()
    result = {'sourceCommit': sha, 'startedAt': datetime.now(timezone.utc).isoformat(),
              'status': 'building', 'scope': 'Build and TypeScript only; no deployment', 'phases': {}}
    def run(name, args, env=None):
        started = time.monotonic()
        with (output / (name + '.log')).open('w') as log:
            completed = subprocess.run(args, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
        row = {'elapsedSeconds': round(time.monotonic() - started, 3), 'exitCode': completed.returncode}
        result['phases'][name] = row
        print(json.dumps({'phase': name, **row}), flush=True)
        if completed.returncode:
            raise RuntimeError(name + ' failed; inspect its bounded build log')
    def image(service, dockerfile):
        tag = 'mangmee-complete-' + service + ':' + sha
        run('build-' + service, ['docker', 'build', '--platform', 'linux/amd64', '--progress=plain',
            '--label', 'org.opencontainers.image.revision=' + sha,
            '--label', 'service=mangmee-kamal-dev' + ('' if service == 'api-web' else '-' + service),
            '-f', dockerfile, '-t', tag, '.'])
        return tag
    def checks():
        env = dict(os.environ, NODE_OPTIONS='--max-old-space-size=4096', NEXT_TELEMETRY_DISABLED='1')
        for name, command in [
            ('install', ['pnpm', 'install', '--frozen-lockfile']),
            ('contracts', ['pnpm', '--filter', '@watchdog-bms/contracts', 'build']),
            ('prisma', ['pnpm', '--filter', '@watchdog-bms/api', 'exec', 'prisma', 'generate', '--schema', 'prisma/schema.prisma']),
            ('typescript', ['pnpm', 'typecheck']),
            ('di', ['node', 'apps/api/scripts/check-di-metadata.mjs']),
            ('agentcore', ['bash', 'infra/ai-gateway/build-agentcore-artifact.sh', str(output / 'agentcore'), sha])]:
            run(name, command, env)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            ts = pool.submit(checks)
            app = pool.submit(image, 'api-web', 'infra/api-web/Dockerfile.api-web')
            concurrent.futures.wait([ts, app])
            ts.result()
            images = {'api-web': app.result()}
        # Avoid concurrent heavy image compilers exhausting the runner's memory.
        for service in ['ai-gateway', 'workers']:
            images[service] = image(service, 'apps/' + service + '/Dockerfile')
        stage = 'mangmee-complete-build:' + sha
        run('export-tools-base', ['docker', 'build', '--platform', 'linux/amd64', '--target', 'build',
            '-f', 'infra/api-web/Dockerfile.api-web', '-t', stage, '.'])
        images['tools'] = 'mangmee-complete-tools:' + sha
        run('build-tools', ['docker', 'build', '--platform', 'linux/amd64',
            '-f', str(ROOT / 'infra/dev-kamal/Dockerfile.tools'), '--build-arg', 'DEV_BUILD_IMAGE=' + stage,
            '--label', 'org.opencontainers.image.revision=' + sha, '-t', images['tools'], '.'])
        result['images'] = {}
        for service, tag in images.items():
            info = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag], text=True))[0]
            if info['Config']['Labels'].get('org.opencontainers.image.revision') != sha:
                raise RuntimeError('Image source mismatch: ' + service)
            result['images'][service] = {'tag': tag, 'imageId': info['Id'], 'architecture': info['Architecture']}
        tree = subprocess.check_output(['git', 'ls-tree', '-rz', '--full-tree', sha], cwd=source)
        (output / 'source-tree.bin').write_bytes(tree)
        result['sourceTreeSha256'] = hashlib.sha256(tree).hexdigest()
        result['agentcore'] = json.loads((output / 'agentcore/agentcore-artifact.json').read_text())
        result['status'] = 'passed'
    except Exception as error:
        result.update(status='failed', error=str(error))
    finally:
        result['elapsedSeconds'] = round(time.monotonic() - clock, 3)
        result['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (output / 'build-result.json').write_text(json.dumps(result, indent=2) + '\n')
    if result['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()

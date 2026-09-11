#!/usr/bin/env python3
"""Read full ECS configuration into private files; publish only keys and version metadata."""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ACCOUNT = '311414082667'
REGION = 'ap-southeast-1'


def private_json(path, value):
    data = json.dumps(value, indent=2) + '\n'
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        f.write(data)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--environment', choices=['uat', 'production'], required=True)
    p.add_argument('--private-output', type=Path, required=True)
    p.add_argument('--evidence', type=Path, required=True)
    p.add_argument('--resolve-secrets', action='store_true')
    p.add_argument('--profile', default='watchdog-bedrock')
    args = p.parse_args()
    args.private_output.mkdir(mode=0o700, parents=True, exist_ok=False)
    aws = ['aws', '--region', REGION]
    if args.profile:
        aws += ['--profile', args.profile]
    def call(command):
        r = subprocess.run(aws + command, capture_output=True, text=True)
        if r.returncode:
            # Never print raw AWS errors or response objects containing configuration values.
            kind = 'AccessDenied' if 'AccessDenied' in r.stderr or 'Unauthorized' in r.stderr else 'AWS read failed'
            raise RuntimeError(command[0] + ':' + command[1] + ': ' + kind)
        return json.loads(r.stdout)
    principal = call(['sts', 'get-caller-identity'])
    if principal['Account'] != ACCOUNT or principal['Arn'].endswith(':root'):
        raise SystemExit('Expected the account-scoped non-root reader')
    env = args.environment
    names = ({'api-web': 'watchdog-bms-uat-api-web', 'ai-gateway': 'watchdog-bms-uat-ai-gateway', 'workers': 'watchdog-bms-uat-workers'}
             if env == 'uat' else {'api-web': 'watchdog-bms-api-web-pub', 'ai-gateway': 'watchdog-bms-ai-gateway-v2', 'workers': 'watchdog-bms-workers'})
    cluster = 'watchdog-bms-' + ('uat' if env == 'uat' else 'prod')
    evidence = {'readAt': datetime.now(timezone.utc).isoformat(), 'environment': env,
                'principal': principal['Arn'], 'services': {}, 'secretValuesPublished': False, 'errors': []}
    captured = {}
    def read_service(item):
        service, name = item
        arn = f'arn:aws:ecs:{REGION}:{ACCOUNT}:service/{cluster}/{name}'
        data = call(['ecs', 'describe-express-gateway-service', '--service-arn', arn])['service']
        configs = data['activeConfigurations']
        if len(configs) != 1:
            raise RuntimeError(service + ': expected one active configuration')
        return service, configs[0]
    # Collect every outcome; never lose a successful read because another service failed.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for future in [pool.submit(read_service, item) for item in names.items()]:
            try:
                service, config = future.result()
                captured[service] = config
            except Exception as error:
                evidence['errors'].append(str(error))
    secret_refs = set()
    for service, config in captured.items():
        container = config['primaryContainer']
        values = {row['name']: row['value'] for row in container.get('environment', [])}
        secrets = {row['name']: row['valueFrom'] for row in container.get('secrets', [])}
        if len(values) != len(container.get('environment', [])) or set(values) & set(secrets):
            raise SystemExit(service + ': duplicate/conflicting config key')
        if values.get('APP_ENV') != 'production' or values.get('DEPLOY_ENVIRONMENT') != env:
            raise SystemExit(service + ': wrong environment identity')
        for ref in secrets.values():
            if not re.fullmatch(f'arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:watchdog-bms/{env}/[A-Za-z0-9/_-]+', ref):
                raise SystemExit(service + ': foreign or unsupported secret reference')
        secret_refs.update(secrets.values())
        private_json(args.private_output / (service + '.configuration.json'), config)
        evidence['services'][service] = {'sourceCommit': values.get('GIT_SHA'), 'image': container['image'],
            'environmentNames': sorted(values), 'secretNames': sorted(secrets),
            'configurationSha256': hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
            'scalingTarget': config['scalingTarget']}
    resolved = {}
    def read_secret(ref):
        data = call(['secretsmanager', 'get-secret-value', '--secret-id', ref, '--version-stage', 'AWSCURRENT']
                    if args.resolve_secrets else ['secretsmanager', 'describe-secret', '--secret-id', ref])
        if args.resolve_secrets:
            if data['ARN'] != ref or 'AWSCURRENT' not in data['VersionStages'] or 'SecretString' not in data:
                raise RuntimeError('Secret identity/version/format mismatch')
            return ref, {'versionId': data['VersionId'], 'value': data['SecretString']}
        current = [key for key, stages in data['VersionIdsToStages'].items() if 'AWSCURRENT' in stages]
        if len(current) != 1 or data.get('DeletedDate'):
            raise RuntimeError('Secret has no unique current active version')
        return ref, {'versionId': current[0]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for future in [pool.submit(read_secret, ref) for ref in sorted(secret_refs)]:
            try:
                ref, data = future.result()
                resolved[ref] = data
            except Exception as error:
                evidence['errors'].append(str(error))
    private_json(args.private_output / 'secret-versions.json', resolved)
    evidence['secretVersions'] = {ref: data['versionId'] for ref, data in resolved.items()}
    if args.resolve_secrets and not evidence['errors']:
        for service, config in captured.items():
            c = config['primaryContainer']
            values = {row['name']: row['value'] for row in c.get('environment', [])}
            values.update({row['name']: resolved[row['valueFrom']]['value'] for row in c.get('secrets', [])})
            private_json(args.private_output / (service + '.resolved.json'), values)
    evidence['status'] = 'passed' if len(captured) == 3 and not evidence['errors'] else 'blocked'
    args.evidence.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'status': evidence['status'], 'services': sorted(captured), 'secretCount': len(resolved), 'errors': evidence['errors']}))
    if evidence['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Bind complete source/artifacts/config, and reject stale or partial runtime readbacks."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

SERVICES = ('api-web', 'ai-gateway', 'workers')
ARTIFACTS = (*SERVICES, 'tools')
HERE = Path(__file__).resolve().parent
AI_JWT_SECRET_KEYS = ('WATCHDOG_JWT_SECRET_ARN', 'WATCHDOG_JWT_SECRET_SOURCE_ARN')


def without_ai_jwt_secrets(service, values):
    return {k: v for k, v in values.items() if service != 'ai-gateway' or k not in AI_JWT_SECRET_KEYS}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def private(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(value, f, indent=2)
        f.write('\n')


def source_inventory(source, sha):
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() == sha,
            'Checkout source mismatch')
    require(not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=source),
            'Checkout is dirty')
    raw = subprocess.check_output(['git', 'ls-tree', '-rz', '--full-tree', sha], cwd=source)
    files = {}
    for row in raw.decode().split('\0'):
        if not row:
            continue
        meta, name = row.split('\t', 1)
        mode, kind, blob = meta.split(' ')
        require(kind == 'blob', 'Unsupported source entry: ' + name)
        files[name] = {'mode': mode, 'gitBlob': blob}
    return files, hashlib.sha256(raw).hexdigest()


def audit_bindings(manifest, environments, endpoint, runtime, target):
    """Check actual provider readbacks and all cross-service links before any app replacement."""
    errors = []
    def check(condition, message):
        if not condition:
            errors.append(message)
    check(digest({k: v for k, v in manifest.items() if k != 'releaseId'}) == manifest['releaseId'],
          'Release inventory changed')
    check(set(environments) == set(SERVICES), 'Incomplete environment set')
    for service in SERVICES:
        env = environments.get(service, {})
        check(digest(env) == manifest['services'][service]['environmentSha256'], service + ': environment changed')
        check(env.get('GIT_SHA') == env.get('SERVICE_VERSION') == manifest['sourceCommit'], service + ': stale source/version')
    api, ai, workers = (environments.get(service, {}) for service in SERVICES)
    for service, env, key, expected in [
        ('api-web', api, 'AI_GATEWAY_INTERNAL_URL', target['aiGatewayInternalUrl']),
        ('api-web', api, 'INTERNAL_API_URL', target['webInternalApiUrl']),
        ('api-web', api, 'PUBLIC_BASE_URL', target['publicBaseUrl']),
        ('ai-gateway', ai, 'ERP_CORE_INTERNAL_URL', target['apiInternalUrl']),
        ('workers', workers, 'INTERNAL_API_URL', target['apiInternalUrl']),
    ]:
        check(env.get(key) == expected, service + ': wrong target ' + key)
    for key, expected in [('AGENTCORE_EXPECTED_SOURCE_COMMIT', manifest['sourceCommit']),
                          ('AGENTCORE_EXPECTED_ARTIFACT_SHA256', manifest['agentcore']['sha256']),
                          ('AGENTCORE_EXPECTED_CONTRACT_VERSION', '1')]:
        check(ai.get(key) == expected, 'ai-gateway: stale ' + key)
    check(ai.get('LINE_AI_AGENT_RUNTIME') == 'agentcore', 'AgentCore integration is not enabled')
    check(endpoint.get('status') == runtime.get('status') == 'READY', 'AgentCore provider is not READY')
    check(endpoint.get('name') == ai.get('AGENTCORE_RUNTIME_QUALIFIER') and endpoint.get('name') != 'DEFAULT',
          'AgentCore endpoint is not the pinned configured qualifier')
    arn = ai.get('AGENTCORE_RUNTIME_ARN')
    check(bool(arn) and endpoint.get('agentRuntimeArn') == runtime.get('agentRuntimeArn') == arn,
          'AgentCore runtime identity mismatch')
    check(endpoint.get('agentRuntimeEndpointArn') == str(arn) + '/runtime-endpoint/' + str(endpoint.get('name')),
          'AgentCore endpoint identity mismatch')
    check(bool(runtime.get('agentRuntimeVersion')) and endpoint.get('liveVersion') == runtime.get('agentRuntimeVersion')
          and endpoint.get('targetVersion') in (None, runtime.get('agentRuntimeVersion')), 'AgentCore version not stable')
    env = runtime.get('environmentVariables', {})
    for key, expected in [('GIT_SHA', manifest['sourceCommit']), ('AGENTCORE_ARTIFACT_SHA256', manifest['agentcore']['sha256']),
                          ('DEPLOY_ENVIRONMENT', manifest['targetEnvironment']), ('ERP_CORE_INTERNAL_URL', target['agentcoreApiUrl'])]:
        check(env.get(key) == expected, 'AgentCore: wrong ' + key)
    return {'releaseId': manifest['releaseId'], 'kind': 'config_and_provider_readback_not_live_acceptance',
            'passed': not errors, 'errors': errors}


def verify_runtime(manifest, observed):
    signed_fields = {key: value for key, value in manifest.items() if key != 'releaseId'}
    require(digest(signed_fields) == manifest['releaseId'], 'Release inventory changed after preparation')
    require(manifest['schemaVersion'] == 1 and manifest['artifactValidationPassed'], 'Unvalidated release inventory')
    require(observed['releaseId'] == manifest['releaseId'], 'Wrong release receipt')
    require(set(observed['services']) == set(SERVICES), 'Missing or extra runtime service')
    for service in SERVICES:
        expected, actual = manifest['services'][service], observed['services'][service]
        require(actual.get('running') is True, service + ': not running')
        require(actual.get('imageId') == manifest['artifacts'][service]['imageId'], service + ': stale image')
        require(actual.get('sourceCommit') == manifest['sourceCommit'], service + ': stale source')
        require(actual.get('environmentSha256') == expected['environmentSha256'], service + ': config mismatch')
        require(actual.get('configValidationPassed') is True, service + ': config not validated')
    require(observed.get('migrationCatalogSha256') == manifest['migrationCatalogSha256'], 'Migration catalog mismatch')
    require(observed.get('syncCatalogSha256') == manifest['syncCatalogSha256'], 'Sync catalog mismatch')
    for field in ['sourceCommit', 'sha256']:
        require(observed.get('agentcore', {}).get(field) == manifest['agentcore'][field], 'Stale AgentCore ' + field)
    require(observed.get('agentcore', {}).get('runtimeReadbackPassed') is True, 'AgentCore binding not proven')
    required = {'database', 'storage', 'queue', 'ai', 'webLogin', 'businessWriteReload', 'logout', 'runtimePermissions',
                'lineLogin', 'lineWebhook', 'receiptOcr', 'browserStorageCors'}
    require(set(observed.get('acceptance', {})) == required, 'Incomplete acceptance set')
    require(all(value is True for value in observed['acceptance'].values()), 'Acceptance failed')
    return {'releaseId': manifest['releaseId'], 'status': 'accepted', 'sourceCommit': manifest['sourceCommit']}


def inspect_container(manifest, service, environment, info, base_image_env):
    """Compare every effective Docker environment key, including unexpected leftover keys."""
    require(service in SERVICES, 'Unknown service')
    expected = dict(base_image_env)
    expected.update(environment)
    actual_rows = info['Config']['Env']
    actual = dict(row.split('=', 1) for row in actual_rows)
    require(len(actual) == len(actual_rows), service + ': duplicate environment key')
    changed = sorted(k for k in set(actual) | set(expected) if actual.get(k) != expected.get(k))
    require(not changed, service + ': mismatched environment keys: ' + ', '.join(changed))
    require(info['Image'] == manifest['artifacts'][service]['imageId'], service + ': stale image')
    require(info['State']['Running'] is True, service + ': not running')
    require(actual.get('GIT_SHA') == manifest['sourceCommit'], service + ': stale source')
    return {'running': True, 'imageId': info['Image'], 'sourceCommit': actual['GIT_SHA'],
            'environmentSha256': digest(environment), 'configValidationPassed': True}


def prepare(args):
    build = json.loads(args.build.read_text())
    sha = build['sourceCommit']
    require(build['status'] == 'passed' and set(build['images']) == set(ARTIFACTS), 'Build artifacts incomplete')
    files, tree_hash = source_inventory(args.source, sha)
    require(tree_hash == build['sourceTreeSha256'], 'Build source inventory mismatch')
    require(build['agentcore']['sourceCommit'] == sha, 'AgentCore source mismatch')
    zip_path = args.build.parent / 'agentcore' / build['agentcore']['artifact']
    require(hashlib.sha256(zip_path.read_bytes()).hexdigest() == build['agentcore']['sha256'], 'AgentCore artifact mismatch')
    overrides = json.loads(args.overrides.read_text()) if args.overrides else {}
    require(set(overrides) <= set(SERVICES), 'Unknown config override service')
    args.private_output.mkdir(parents=True, mode=0o700, exist_ok=False)
    manifest = {'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'sourceCommit': sha,
                'sourceTreeSha256': tree_hash, 'trackedFileCount': len(files), 'targetEnvironment': args.environment,
                'artifacts': {}, 'services': {}, 'agentcore': build['agentcore'], 'artifactValidationPassed': False,
                'status': 'prepared_only_not_deployed'}
    versions = json.loads((args.capture / 'secret-versions.json').read_text())
    manifest['secretVersions'] = {ref: data['versionId'] for ref, data in versions.items()}
    require(all('/' + args.environment + '/' in ref for ref in versions), 'Foreign secret version')
    schemas = []
    for service in ARTIFACTS:
        artifact = build['images'][service]
        image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', artifact['tag']], text=True))[0]
        require(image['Id'] == artifact['imageId'], service + ': retagged build image')
        require(image['Architecture'] == 'amd64', service + ': unsupported architecture')
        require(image['Config']['Labels'].get('org.opencontainers.image.revision') == sha, service + ': image source mismatch')
        manifest['artifacts'][service] = artifact
        if service == 'tools':
            continue
        config = json.loads((args.capture / (service + '.resolved.json')).read_text())
        require(config.get('DEPLOY_ENVIRONMENT') == args.environment, service + ': foreign target config')
        config.update(GIT_SHA=sha, SERVICE_VERSION=sha)
        for key, value in overrides.get(service, {}).items():
            require(re.fullmatch('[A-Z][A-Z0-9_]*', key) and (value is None or isinstance(value, str)), 'Invalid override')
            if value is None:
                require(key in config, 'Deleting unknown config key: ' + key)
                del config[key]
            else:
                config[key] = value
        config = without_ai_jwt_secrets(service, config)
        require(config.get('APP_ENV') == 'production' and config.get('DEPLOY_ENVIRONMENT') == args.environment,
                service + ': runtime mode mismatch')
        require(config.get('GIT_SHA') == sha, service + ': override changed source')
        probe = (HERE / 'verify-config.mjs').read_text()
        result = subprocess.run(['docker', 'run', '--rm', '-i', '--platform', 'linux/amd64', '--network', 'none',
            '--entrypoint', 'node', artifact['tag'], '--input-type=module', '-e', probe],
            input=json.dumps({'service': service, 'sourceCommit': sha, 'environment': config}),
            capture_output=True, text=True)
        try:
            validation = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise ValueError(service + ': validator execution failed; raw output suppressed')
        # The validator emits keys and fixed messages only; verify that it cannot leak secrets.
        sensitive = [v for k, v in config.items() if len(v) >= 16 and any(t in k for t in ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'DATABASE_URL', 'REDIS_URL'])]
        require(not any(v in result.stdout for v in sensitive), 'Validator output contains a secret')
        (args.build.parent / (service + '-config-validation.json')).write_text(json.dumps(validation, indent=2) + '\n')
        require(result.returncode == 0 and validation['passed'], service + ': ' + '; '.join(validation['errors']))
        schemas.append(validation['configModuleSha256'])
        base_env = dict(v.split('=', 1) for v in image['Config'].get('Env', []))
        private(args.private_output / (service + '.environment.json'), config)
        private(args.private_output / (service + '.base-image-env.json'), base_env)
        manifest['services'][service] = {'environmentSha256': digest(config), 'configuredKeys': sorted(config),
            'defaultedKeys': validation['defaultedKeys'], 'absentOptionalKeys': validation['absentOptionalKeys'],
            'configModuleSha256': validation['configModuleSha256'], 'overrideKeys': sorted(overrides.get(service, {}))}
    require(len(set(schemas)) == 1, 'Runtime services contain different shared config modules')
    # Read real files inside the built tools image, not merely their checkout counterparts.
    probe = "const fs=require('fs'),c=require('crypto'),p=require('path');let o={};function walk(d){for(const n of fs.readdirSync(d)){const f=p.join(d,n);if(fs.statSync(f).isDirectory())walk(f);else o[f.slice('/app/'.length)]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}}walk('/app/apps/api/prisma');console.log(JSON.stringify(o));"
    catalog = json.loads(subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node',
        build['images']['tools']['tag'], '-e', probe], text=True))
    prisma_files = [name for name in files if name.startswith('apps/api/prisma/')]
    # The existing Docker ignore deliberately removes test sources from deployable images.
    excluded_tests = [name for name in prisma_files if '.spec.' in Path(name).name]
    expected = {name: hashlib.sha256((args.source / name).read_bytes()).hexdigest()
                for name in prisma_files if name not in excluded_tests}
    require(catalog == expected, 'Tools image migration/seed/catalog files differ from pinned source')
    migrations = {name: value for name, value in catalog.items() if '/migrations/' in name}
    syncs = {name: value for name, value in catalog.items() if '/migrations/' not in name}
    manifest.update(migrationCatalogSha256=digest(migrations), syncCatalogSha256=digest(syncs),
                    migrationFileCount=len(migrations), syncFileCount=len(syncs),
                    excludedPrismaTestSources=excluded_tests, artifactValidationPassed=True)
    (args.build.parent / 'migration-source-catalog.json').write_text(json.dumps(migrations, indent=2) + '\n')
    (args.build.parent / 'sync-source-catalog.json').write_text(json.dumps(syncs, indent=2) + '\n')
    manifest['releaseId'] = digest(manifest)
    args.output.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'releaseId': manifest['releaseId'], 'sourceCommit': sha, 'status': manifest['status'],
                      'services': list(SERVICES), 'migrationFiles': len(migrations), 'syncFiles': len(syncs)}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest='command', required=True)
    make = commands.add_parser('prepare')
    for name in ['source', 'build', 'capture', 'private-output', 'output']:
        make.add_argument('--' + name, type=Path, required=True)
    make.add_argument('--environment', choices=['uat', 'production'], required=True)
    make.add_argument('--overrides', type=Path)
    check = commands.add_parser('verify')
    check.add_argument('manifest', type=Path)
    check.add_argument('observed', type=Path)
    bindings = commands.add_parser('preflight')
    for name in ['manifest', 'environments', 'endpoint', 'runtime', 'target', 'output']:
        bindings.add_argument('--' + name, type=Path, required=True)
    args = p.parse_args()
    try:
        if args.command == 'prepare':
            prepare(args)
        elif args.command == 'preflight':
            require(not args.output.exists(), 'Preserve the original preflight receipt')
            environments = {service: json.loads((args.environments / (service + '.environment.json')).read_text())
                            for service in SERVICES}
            result = audit_bindings(json.loads(args.manifest.read_text()), environments,
                json.loads(args.endpoint.read_text()), json.loads(args.runtime.read_text()), json.loads(args.target.read_text()))
            args.output.write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))
            if not result['passed']:
                raise SystemExit(1)
        else:
            print(json.dumps(verify_runtime(json.loads(args.manifest.read_text()), json.loads(args.observed.read_text()))))
    except (ValueError, KeyError) as error:
        raise SystemExit('RELEASE BLOCKED: ' + str(error))


if __name__ == '__main__':
    main()

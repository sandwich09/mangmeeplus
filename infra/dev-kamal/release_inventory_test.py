#!/usr/bin/env python3
"""Offline fault injection against the actual prepared release; no cloud effects."""
import copy
import json
from pathlib import Path
import sys
from release_inventory import SERVICES, audit_bindings, digest, inspect_container, verify_runtime


def main():
    if len(sys.argv) > 1:
        manifest = json.loads(Path(sys.argv[1]).read_text())
    else:
        # Standalone CI uses an explicit synthetic inventory, never a release receipt.
        manifest = {'schemaVersion':1, 'sourceCommit':'a'*40, 'targetEnvironment':'uat',
                    'artifactValidationPassed':True, 'migrationCatalogSha256':'b'*64,
                    'syncCatalogSha256':'c'*64, 'agentcore':{'sourceCommit':'a'*40,'sha256':'d'*64},
                    'artifacts':{s:{'imageId':'sha256:'+str(i)*64} for i,s in enumerate(SERVICES,1)},
                    'services':{s:{'environmentSha256':'e'*64} for s in SERVICES}}
        manifest['releaseId'] = digest(manifest)
    # This is deliberately a synthetic receipt used to test rejection logic, not deployment proof.
    observation = {'releaseId': manifest['releaseId'], 'services': {},
        'migrationCatalogSha256': manifest['migrationCatalogSha256'], 'syncCatalogSha256': manifest['syncCatalogSha256'],
        'agentcore': {**manifest['agentcore'], 'runtimeReadbackPassed': True},
        'acceptance': {key: True for key in ['database', 'storage', 'queue', 'ai', 'webLogin', 'businessWriteReload', 'logout', 'runtimePermissions',
                                           'lineLogin', 'lineWebhook', 'receiptOcr', 'browserStorageCors']}}
    for service in SERVICES:
        observation['services'][service] = {'running': True, 'sourceCommit': manifest['sourceCommit'],
            'imageId': manifest['artifacts'][service]['imageId'], 'environmentSha256': manifest['services'][service]['environmentSha256'],
            'configValidationPassed': True}
    assert verify_runtime(manifest, observation)['status'] == 'accepted'
    results = []
    def reject(name, mutate):
        candidate = copy.deepcopy(observation)
        mutate(candidate)
        try:
            verify_runtime(manifest, candidate)
        except ValueError as error:
            results.append({'case': name, 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError('Accepted bad receipt: ' + name)
    reject('missing workers', lambda d: d['services'].pop('workers'))
    reject('extra service', lambda d: d['services'].update(extra={}))
    reject('old image', lambda d: d['services']['api-web'].update(imageId='sha256:' + '0' * 64))
    reject('old source', lambda d: d['services']['ai-gateway'].update(sourceCommit='0' * 40))
    reject('stale config', lambda d: d['services']['workers'].update(environmentSha256='0' * 64))
    reject('stopped service', lambda d: d['services']['api-web'].update(running=False))
    reject('unvalidated config', lambda d: d['services']['api-web'].update(configValidationPassed=False))
    reject('missing migration', lambda d: d.update(migrationCatalogSha256=None))
    reject('old permissions/sync', lambda d: d.update(syncCatalogSha256='0' * 64))
    reject('old AgentCore source', lambda d: d['agentcore'].update(sourceCommit='0' * 40))
    reject('old AgentCore artifact', lambda d: d['agentcore'].update(sha256='0' * 64))
    reject('unverified AgentCore runtime', lambda d: d['agentcore'].update(runtimeReadbackPassed=False))
    reject('missing acceptance', lambda d: d['acceptance'].pop('queue'))
    reject('failed business acceptance', lambda d: d['acceptance'].update(businessWriteReload=False))
    reject('unregistered LINE callback', lambda d: d['acceptance'].update(lineLogin=False))
    reject('browser upload CORS rejected', lambda d: d['acceptance'].update(browserStorageCors=False))
    env = {'GIT_SHA': manifest['sourceCommit'], 'EXAMPLE_CONFIG': 'new', 'EXAMPLE_SECRET': 'synthetic-value'}
    base = {'PATH': '/usr/bin'}
    container = {'Image': manifest['artifacts']['api-web']['imageId'], 'State': {'Running': True},
                 'Config': {'Env': [key + '=' + value for key, value in {**base, **env}.items()]}}
    assert inspect_container(manifest, 'api-web', env, container, base)['environmentSha256'] == digest(env)
    for name, mutate in [
        ('omitted env key', lambda d: d['Config']['Env'].pop()),
        ('extra stale env key', lambda d: d['Config']['Env'].append('DEV_AUTH_ENABLED=true')),
        ('wrong env value', lambda d: d['Config']['Env'].append('EXAMPLE_CONFIG=old')),
    ]:
        candidate = copy.deepcopy(container)
        mutate(candidate)
        try:
            inspect_container(manifest, 'api-web', env, candidate, base)
        except ValueError as error:
            results.append({'case': name, 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError(name)
    altered = copy.deepcopy(manifest)
    altered['services']['api-web']['environmentSha256'] = '0' * 64
    try:
        verify_runtime(altered, observation)
    except ValueError as error:
        results.append({'case': 'tampered release inventory', 'rejected': True, 'reason': str(error)})
    else:
        raise AssertionError('Tampered inventory accepted')
    # Synthetic endpoints exercise the pre-deploy guard independently of any cloud credentials.
    target = dict(apiInternalUrl='http://api:3000/v1', webInternalApiUrl='http://127.0.0.1:3001/v1',
                  aiGatewayInternalUrl='http://ai:3002/v1', publicBaseUrl='https://test.invalid',
                  agentcoreApiUrl='https://test.invalid/v1')
    arn, qualifier = 'arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/test', 'candidate_test'
    configs = {s: dict(GIT_SHA=manifest['sourceCommit'], SERVICE_VERSION=manifest['sourceCommit']) for s in SERVICES}
    configs['api-web'].update(AI_GATEWAY_INTERNAL_URL=target['aiGatewayInternalUrl'],
        INTERNAL_API_URL=target['webInternalApiUrl'], PUBLIC_BASE_URL=target['publicBaseUrl'])
    configs['ai-gateway'].update(ERP_CORE_INTERNAL_URL=target['apiInternalUrl'], LINE_AI_AGENT_RUNTIME='agentcore',
        AGENTCORE_RUNTIME_ARN=arn, AGENTCORE_RUNTIME_QUALIFIER=qualifier,
        AGENTCORE_EXPECTED_SOURCE_COMMIT=manifest['sourceCommit'], AGENTCORE_EXPECTED_ARTIFACT_SHA256=manifest['agentcore']['sha256'],
        AGENTCORE_EXPECTED_CONTRACT_VERSION='1')
    configs['workers']['INTERNAL_API_URL'] = target['apiInternalUrl']
    bound = copy.deepcopy(manifest)
    for service in SERVICES:
        bound['services'][service]['environmentSha256'] = digest(configs[service])
    bound['releaseId'] = digest({k:v for k,v in bound.items() if k != 'releaseId'})
    endpoint = dict(status='READY', name=qualifier, agentRuntimeArn=arn,
        agentRuntimeEndpointArn=arn+'/runtime-endpoint/'+qualifier, liveVersion='99', targetVersion=None)
    runtime = dict(status='READY', agentRuntimeArn=arn, agentRuntimeVersion='99', environmentVariables={
        'GIT_SHA':manifest['sourceCommit'], 'AGENTCORE_ARTIFACT_SHA256':manifest['agentcore']['sha256'],
        'DEPLOY_ENVIRONMENT':manifest['targetEnvironment'], 'ERP_CORE_INTERNAL_URL':target['agentcoreApiUrl']})
    assert audit_bindings(bound, configs, endpoint, runtime, target)['passed']
    for name, mutate in [
        ('preflight old source expectation', lambda c,e,r: c['ai-gateway'].update(AGENTCORE_EXPECTED_SOURCE_COMMIT='0'*40)),
        ('preflight old provider code', lambda c,e,r: r['environmentVariables'].update(GIT_SHA='0'*40)),
        ('preflight wrong API link', lambda c,e,r: c['workers'].update(INTERNAL_API_URL='https://old.invalid/v1')),
        ('preflight wrong provider callback', lambda c,e,r: r['environmentVariables'].update(ERP_CORE_INTERNAL_URL='https://old.invalid/v1')),
        ('preflight moving endpoint', lambda c,e,r: e.update(targetVersion='100')),
        ('preflight wrong endpoint identity', lambda c,e,r: e.update(agentRuntimeEndpointArn='wrong')),
        ('preflight unready provider', lambda c,e,r: r.update(status='UPDATING')),
        ('preflight missing provider evidence', lambda c,e,r: r.clear()),
    ]:
        c,e,r = copy.deepcopy((configs, endpoint, runtime))
        mutate(c,e,r)
        result = audit_bindings(bound, c, e, r, target)
        assert not result['passed'], name
        results.append({'case':name, 'rejected':True, 'reasons':result['errors']})
    print(json.dumps({'kind': 'offline_fault_injection_not_live_acceptance', 'positiveControls': 3,
                      'negativeCasesPassed': len(results), 'results': results}, indent=2))


if __name__ == '__main__':
    main()

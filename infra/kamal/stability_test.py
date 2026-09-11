#!/usr/bin/env python3
"""Exercise fixed bootstrap and real rollback controller without cloud mutations."""
import argparse
import base64
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('contracts', HERE / 'release_test.py')
contracts = importlib.util.module_from_spec(spec); spec.loader.exec_module(contracts)
m = contracts.m
spec = importlib.util.spec_from_file_location('bootstrap', HERE / 'prepare-bootstrap-update.py')
bootstrap = importlib.util.module_from_spec(spec); spec.loader.exec_module(bootstrap)


class Stability(unittest.TestCase):
    def test_bootstrap_only_userdata_changes_and_refuses_foreign_target(self):
        resource = {'Type': 'AWS::EC2::Instance', 'Properties': {
            'Tags': [{'Key': 'Environment', 'Value': 'uat'}], 'BlockDeviceMappings': [{'Ebs': {'VolumeSize': 40}}],
            'UserData': base64.b64encode(b'#cloud-config\nssh_authorized_keys:\n  - ssh-ed25519 AAAAFake\n').decode(),
            'NetworkInterfaces': [{'PrivateIpAddress': '10.92.0.10'}]}}
        original = {'Resources': {'ApiServer': resource, 'AiServer': copy.deepcopy(resource), 'Unrelated': {'keep': True}}}
        result, changes = bootstrap.patch_template(original)
        self.assertEqual(set(changes), {'ApiServer', 'AiServer'})
        for name in changes:
            user = base64.b64decode(result['Resources'][name]['Properties']['UserData']).decode()
            self.assertIn('ssh-ed25519 AAAAFake', user)
            self.assertIn('chown ubuntu:ubuntu /home/ubuntu', user)
            self.assertIn('basecamp/kamal-proxy@sha256:', user)
            self.assertNotIn('v0.8.0', user)
            self.assertNotIn('path: /home/ubuntu', user)
            result['Resources'][name]['Properties']['UserData'] = original['Resources'][name]['Properties']['UserData']
        self.assertEqual(result, original)
        original['Resources']['ApiServer']['Properties']['Tags'][0]['Value'] = 'production'
        with self.assertRaisesRegex(AssertionError, 'UAT only'): bootstrap.patch_template(original)

    def test_rollback_restores_real_names_and_browser_rechecks_old_images(self):
        for failure in (None, 'image-after-browser', 'incomplete-browser'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                r, calls = contracts.Contracts().runner(tmp)
                r.target = contracts.target('uat'); r.target['browserAcceptanceUserId'] = 'uat-owner'
                r.args = argparse.Namespace(environment='uat', apply=True, mode='hotfix', rollback='20260911T010000Z-12345678')
                r.manual_browser = True; r.aws_prefix = ['aws']
                del r.acceptance
                r.build = {}; previous = {}; infos = {}; after_browser = False
                old_source = 'a' * 40
                for i, service in enumerate(m.SERVICES, 1):
                    version = old_source + '-20260911T000000Z-11223344-' + service
                    name = r.target['servicePrefix'] + ('' if service == 'api-web' else '-'+service) + '-web-' + version
                    env = {'GIT_SHA':old_source, 'SERVICE_VERSION':old_source, 'WORKER_INTERNAL_TOKEN':'synthetic-token',
                           'AGENTCORE_EXPECTED_ARTIFACT_SHA256':'b'*64, 'AGENTCORE_RUNTIME_QUALIFIER':'old_slot',
                           'KAMAL_CONTAINER_NAME':name, 'KAMAL_VERSION':version, 'KAMAL_HOST':r.target['hosts'][service][0]['address']}
                    previous[service] = [{'host':r.target['hosts'][service][0], 'version':version, 'sourceCommit':old_source,
                                          'imageId':'sha256:'+str(i)*64, 'containerName':name, 'environment':env}]
                    infos[name] = {'Id':str(i)*64, 'Image':previous[service][0]['imageId'], 'State':{'Running':True},
                                   'Config':{'Env':[k+'='+v for k,v in env.items()]}}
                old = r.state / 'runs' / r.args.rollback
                m.write(old/'result.json', {'environment':'uat','kind':'uat','mode':'hotfix','status':'ACCEPTED_LINE_DEFERRED'})
                m.write(old/'previous.private.json', previous)
                m.write(old/'inventory.json', {})
                m.write(old/'publication.json', {'tools':{'tag':'synthetic-tools'}})
                r.command = lambda *a, **k: 'synthetic-ecr-token'
                def remote(host, cmd, **kw):
                    if cmd[:2] == ['docker','inspect']:
                        self.assertIn(cmd[2], infos, 'readback must use preserved container names')
                        info = copy.deepcopy(infos[cmd[2]])
                        if after_browser and failure == 'image-after-browser': info['Image'] = 'sha256:'+'f'*64
                        return json.dumps([info])
                    if cmd[:4] == ['docker','exec','kamal-proxy','kamal-proxy']:
                        return '\n'.join(r.target['servicePrefix']+('' if s=='api-web' else '-'+s)+'-web * / '+
                                         infos[previous[s][0]['containerName']]['Id'][:12]+':'+('3000' if s=='api-web' else '3002')+' running no'
                                         for s in ('api-web','ai-gateway'))
                    if cmd[:2] == ['docker','exec']:
                        self.assertIn(cmd[3], infos)
                        return '{"passed":true}'
                    raise AssertionError(cmd)
                r.remote = remote
                def kamal(service, cmd, version=None, **kw):
                    if cmd[0] == 'rollback':
                        self.assertEqual(version, previous[service][0]['version'])
                        calls.append('restored-'+service)
                    return ''
                r.kamal = kamal
                def provider(read_only=False):
                    self.assertTrue(read_only)
                    self.assertEqual(r.build['sourceCommit'], old_source)
                    r.bind_qualifier('old_slot')
                    r.receipt['agentcore'] = {'status':'REUSED_EXACT'}
                r.agentcore = provider
                r.tool = lambda *a, **kw: json.dumps({'passed':True,'retiredCount':0})
                def sign(state):
                    self.assertEqual(state,'ROLLED_BACK_LINE_DEFERRED')
                    self.assertTrue(r.receipt['customerAcceptance']['passed'])
                    self.assertTrue(all(row['configValidationPassed'] for rows in r.receipt['runtimeReadback'].values() for row in rows))
                    calls.append('signed-rollback')
                r.sign = sign
                class Response:
                    status = 200
                    def __init__(self, body): self.body = body
                    def __enter__(self): return self
                    def __exit__(self, *args): pass
                    def read(self): return self.body
                class Opener:
                    def open(self, request, timeout):
                        assert request.get_header('User-agent') == 'Mangmee-Kamal-Release/1.0'
                        return Response(b'<main data-platform-access="open">' if request.full_url.endswith('/login') else b'{"state":"OPEN"}')
                def submit(_):
                    nonlocal after_browser
                    proof = m.read(r.work/'browser-acceptance-request.json')
                    self.assertEqual(proof['rollbackOf'], r.args.rollback)
                    self.assertEqual(proof['sourceCommit'], old_source)
                    proof['checks'] = {k:True for k in proof['checks']}
                    if failure == 'incomplete-browser': proof['checks']['logout'] = False
                    evidence = r.work/'observed.txt'; evidence.write_text('Synthetic unit-test observation, not live proof.')
                    proof.update(observer='unit test', evidenceFiles=[str(evidence)])
                    m.write(r.work/'browser-acceptance.json', proof)
                    after_browser = True
                with patch.object(m.urllib.request, 'build_opener', return_value=Opener()), patch.object(m.time, 'sleep', side_effect=submit):
                    if failure:
                        with self.assertRaises(ValueError): m.Release.rollback(r, r.state/'active.json')
                        self.assertNotIn('signed-rollback', calls)
                        self.assertTrue((r.state/'active.json').exists())
                    else:
                        m.Release.rollback(r, r.state/'active.json')
                        self.assertEqual(r.receipt['status'], 'ROLLED_BACK_LINE_DEFERRED')
                        self.assertFalse((r.state/'active.json').exists())
                        self.assertEqual([c for c in calls if c.startswith('restored-')], ['restored-'+s for s in m.ORDER])
                        self.assertIn('signed-rollback', calls)


if __name__ == '__main__': unittest.main(verbosity=2)

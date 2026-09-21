#!/usr/bin/env python3
"""Exercise fixed bootstrap and real rollback controller without cloud mutations."""
import argparse
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
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
spec = importlib.util.spec_from_file_location('ssm_transport', HERE / 'prepare-uat-ssm-transport.py')
ssm_transport = importlib.util.module_from_spec(spec); spec.loader.exec_module(ssm_transport)


class Stability(unittest.TestCase):
    def test_actual_process_keeps_host_path_and_maps_every_application_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, _ = contracts.Contracts().runner(tmp)
            del r.render
            r.build={'sourceCommit':'a'*40}; r.token='synthetic-registry-token'
            r.envs={s:{'PATH':'/application/bin','HOME':'/application','TOKEN':'synthetic-token'} for s in m.SERVICES}
            key=Path(tmp)/'id_ed25519'; key.write_text('synthetic-key'); key.chmod(0o600)
            r.target['sshKey']=str(key); (r.work/'known_hosts').write_text('synthetic-host-key')
            binary=Path(tmp)/'docker'
            binary.write_text('#!'+sys.executable+'\nimport json,os,sys\nprint(json.dumps({"path":os.environ["PATH"],"home":os.environ.get("HOME"),"app":{k:os.environ[k] for k in ("KAMAL_APP_PATH","KAMAL_APP_HOME","KAMAL_APP_TOKEN")},"argv":sys.argv[1:]}))\n')
            binary.chmod(0o700)
            host_path=tmp+':'+os.environ['PATH']
            with patch.dict(os.environ,PATH=host_path):
                r.render()
                for service in m.SERVICES:
                    secrets=(r.work/'native'/service/'.kamal/secrets').read_text()
                    self.assertIn('PATH=$KAMAL_APP_PATH\n',secrets)
                    for fake in (True,False):
                        result=json.loads(r.kamal(service,['config'],fake=fake))
                        self.assertEqual(result['path'],host_path)
                        self.assertEqual(result['home'],os.environ.get('HOME'))
                        for key,value in r.envs[service].items():
                            self.assertEqual(result['app']['KAMAL_APP_'+key],'synthetic-'+key if fake else value)
                        self.assertNotIn('PATH',result['argv'])

    def test_uat_smoke_requires_all_service_config_health_and_open_without_login(self):
        for failure in (None,'config','health','closed'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                r,_=contracts.Contracts().runner(tmp); del r.acceptance
                r.target=contracts.target('uat'); r.smoke_acceptance=True; r.manual_browser=False
                r.validate_acceptance_target()
                observed=[]; healthy=[]
                def inspect(service):
                    if failure=='config' and service=='workers': raise ValueError('config mismatch')
                    observed.append(service);return [{'configValidationPassed':True}]
                def health(service):
                    if failure=='health' and service=='workers': raise ValueError('workers not ready')
                    healthy.append(service)
                r.inspect_service=inspect;r.deep_health=health
                class Response:
                    status=200
                    def __init__(self,body):self.body=body
                    def __enter__(self):return self
                    def __exit__(self,*args):pass
                    def read(self):return self.body
                class Opener:
                    def open(self,request,timeout):
                        assert request.method=='GET' and not request.full_url.endswith('/logout')
                        return Response(b'<main data-platform-access="open">' if request.full_url.endswith('/login')
                            else (b'{"state":"CLOSED"}' if failure=='closed' else b'{"state":"OPEN"}'))
                with patch.object(m.urllib.request,'build_opener',return_value=Opener()):
                    if failure:
                        with self.assertRaises(ValueError):r.acceptance()
                        self.assertNotIn('customerAcceptance',r.receipt)
                    else:
                        r.acceptance()
                        self.assertEqual(observed,list(m.SERVICES));self.assertEqual(healthy,list(m.SERVICES))
                        self.assertEqual(r.receipt['customerAcceptance']['loginLogout'],'NOT_REQUIRED_BY_OWNER')
                for kind in ('dev','production'):
                    r.target=contracts.target(kind);r.args.environment=r.target['environment']
                    with self.assertRaises(ValueError):r.validate_acceptance_target()

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

    def test_uat_ssm_patch_removes_only_ssh_and_adds_scoped_session_permissions(self):
        tags=[{'Key':'Environment','Value':'uat'}]
        role=lambda name:{'Type':'AWS::IAM::Role','Properties':{'RoleName':name,'Tags':tags,
            'Policies':[{'PolicyDocument':{'Statement':[]}}]}}
        group=lambda:{'Type':'AWS::EC2::SecurityGroup','Properties':{'SecurityGroupIngress':[
            {'IpProtocol':'tcp','FromPort':22,'ToPort':22,'CidrIp':'192.0.2.1/32'}]}}
        original={'Resources':{'ApiRole':role('api'),'AiRole':role('ai'),'ApiSg':group(),'AiSg':group(),
            'DeployRole':role('deploy'),'ApiServer':{'keep':'api'},'AiServer':{'keep':'ai'},'Unrelated':{'keep':True}}}
        result=ssm_transport.patch_template(original)
        self.assertEqual(original['Resources']['ApiSg']['Properties']['SecurityGroupIngress'][0]['FromPort'],22)
        for name in ('ApiRole','AiRole'):
            self.assertEqual(result['Resources'][name]['Properties']['ManagedPolicyArns'],[ssm_transport.SSM_CORE])
        for name in ('ApiSg','AiSg'):
            self.assertEqual(result['Resources'][name]['Properties']['SecurityGroupIngress'],[])
        permissions=result['Resources']['DeployRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        self.assertEqual({p['Sid'] for p in permissions},{'UatSsmInventory','UatSsmSshTransport','UatSsmOwnSession'})
        self.assertEqual(result['Resources']['Unrelated'],original['Resources']['Unrelated'])

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
                           'KAMAL_CONTAINER_NAME':name, 'KAMAL_VERSION':version, 'KAMAL_HOST':'10.91.0.99'}
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

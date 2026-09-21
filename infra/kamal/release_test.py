#!/usr/bin/env python3
"""Focused executable failure contracts; no AWS or deployment effects."""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('kamal_release',Path(__file__).with_name('release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def target(kind='dev'):
    env='production' if kind=='production' else 'uat'
    h=lambda n,az='':dict(instanceId='i-'+str(n)*17,address='10.92.0.'+str(n),hostKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake',stack='mangmee-kamal-'+kind,vpcId='vpc-123')
    return dict(schemaVersion=1,environment=env,kind=kind,account=m.ACCOUNT,region=m.REGION,
        hosts={'api-web':[h(1),h(2)] if kind=='production' else [h(1)],'ai-gateway':[h(3)],'workers':[h(4)]},
        publicUrl='https://app.example.com',apiInternalUrl='https://api.example.com/v1',aiInternalUrl='https://ai.example.com/v1',
        repository='mangmee-kamal-'+kind+'/releases',servicePrefix='mangmee-kamal-'+kind,
        cutoverComplete=True,signingKeyArn=f'arn:aws:kms:{m.REGION}:{m.ACCOUNT}:key/123',sshKey='/private/key',
        acceptanceCredentials='/private/acceptance.json',agentcoreQualifier='candidate_current',
        agentcoreRuntimeArn=f'arn:aws:bedrock-agentcore:{m.REGION}:{m.ACCOUNT}:runtime/example_'+env)


class Contracts(unittest.TestCase):
    def test_postmark_overrides_legacy_config_with_current_secrets_and_native_evidence(self):
        for stage in ('uat', 'production'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as tmp:
                r=m.Release.__new__(m.Release);r.source=m.ROOT;r.secrets=set()
                r.args=argparse.Namespace(environment=stage)
                origin='https://uat.mangmeeplus.com' if stage=='uat' else 'https://mangmeeplus.com'
                r.target={'kind':stage,'publicUrl':origin}
                settings=m.read(m.ROOT/'infra/postmark/config.json')[stage]
                capture=Path(tmp);m.write(capture/'secret-versions.json',{'existing':{'versionId':'existing-v1'}})
                calls=[];resolved={}
                for key,ref in settings['secrets'].items():
                    value='ab'*32 if key=='EMAIL_OTP_HMAC_KEY' else 'tester@example.test' if key=='POSTMARK_UAT_ALLOWED_RECIPIENTS' else 'SYNTHETIC_'+key
                    arn=ref if ref.startswith('arn:') else f'arn:aws:secretsmanager:{m.REGION}:{m.ACCOUNT}:secret:{ref}-abcdef'
                    resolved[ref]={'ARN':arn,'Name':ref,'SecretString':value,'VersionId':'v1','VersionStages':['AWSCURRENT']}
                def aws(args):
                    calls.append(args)
                    return resolved[args[3]]
                r.aws=aws
                server=int(settings['environment']['POSTMARK_SERVER_ID'])
                stream=settings['environment']['POSTMARK_MESSAGE_STREAM']
                facts=[{'ID':server,'DeliveryType':'Live'},
                    {'ServerID':server,'ID':stream,'MessageStreamType':'Transactional','ArchivedAt':None}]
                responses=[]
                for fact in facts:
                    response=io.BytesIO(json.dumps(fact).encode());response.status=200;responses.append(response)
                with patch.object(m.urllib.request,'build_opener') as opener:
                    opener.return_value.open.side_effect=responses
                    overrides=r.postmark_configuration(capture)
                    requests=opener.return_value.open.call_args_list
                legacy={'EMAIL_PROVIDER':'ses','POSTMARK_FROM_ADDRESS':'old@example.test'}
                legacy.update(overrides)
                self.assertEqual(legacy['EMAIL_PROVIDER'],'postmark')
                self.assertEqual(legacy['POSTMARK_FROM_ADDRESS'],settings['environment']['POSTMARK_FROM_ADDRESS'])
                self.assertEqual(legacy['WEB_BASE_URL'],origin)
                self.assertEqual(legacy['EMAIL_OTP_HMAC_KEY'],'ab'*32)
                self.assertEqual(calls,[['secretsmanager','get-secret-value','--secret-id',ref,'--version-stage','AWSCURRENT'] for ref in resolved])
                self.assertEqual([call.args[0].full_url for call in requests],
                    ['https://api.postmarkapp.com/server','https://api.postmarkapp.com/message-streams/'+stream])
                versions=m.read(capture/'secret-versions.json')
                self.assertEqual(versions['existing'],{'versionId':'existing-v1'})
                self.assertEqual({key:value for key,value in versions.items() if key!='existing'},
                    {value['ARN']:{'versionId':'v1','value':value['SecretString']} for value in resolved.values()})
                self.assertEqual(r.secrets,{value['SecretString'] for value in resolved.values()})
                readiness=m.read(capture/'postmark-readiness.json')
                self.assertEqual(readiness,{'serverId':server,'stream':stream,'mode':'Live',
                    'sender':settings['environment']['POSTMARK_FROM_ADDRESS'],
                    'otpKeyVersion':settings['environment']['EMAIL_OTP_HMAC_KEY_VERSION'],'outbound':'native-identity-checked'})
                r.target['publicUrl']='https://foreign.example.test';calls.clear()
                with patch.object(m.urllib.request,'build_opener') as opener:
                    with self.assertRaisesRegex(ValueError,'origin'):r.postmark_configuration(capture)
                    opener.assert_not_called()
                self.assertEqual(calls,[])

    def test_postmark_read_only_preflight_retries_only_transient_transport_failures(self):
        mail_path=m.ROOT/'infra/postmark/config.py'
        spec=importlib.util.spec_from_file_location('postmark_retry_contract',mail_path)
        mail=importlib.util.module_from_spec(spec);spec.loader.exec_module(mail)
        settings=mail.deployment_config(m.read(mail_path.with_name('config.json')),'uat')
        values={'POSTMARK_SERVER_TOKEN':'synthetic-live-token','POSTMARK_UAT_ALLOWED_RECIPIENTS':'qa@example.test'}
        server=int(settings['environment']['POSTMARK_SERVER_ID']);stream=settings['environment']['POSTMARK_MESSAGE_STREAM']
        class Response:
            status=200
            def __init__(self,value):self.value=value
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps(self.value).encode()
        responses=[m.urllib.error.URLError('temporary'),Response({'ID':server,'DeliveryType':'Live'}),
            Response({'ServerID':server,'ID':stream,'MessageStreamType':'Transactional','ArchivedAt':None})]
        class Opener:
            def open(self,*args,**kwargs):
                value=responses.pop(0)
                if isinstance(value,Exception):raise value
                return value
        with patch.object(mail.urllib.request,'build_opener',return_value=Opener()),patch.object(mail.time,'sleep') as sleep:
            evidence=mail.native_preflight(settings,values)
        self.assertEqual(evidence['outbound'],'native-identity-checked');sleep.assert_called_once_with(1)
        denied=m.urllib.error.HTTPError('https://api.postmarkapp.com/server',401,'denied',None,None)
        with patch.object(mail.urllib.request,'build_opener') as opener,patch.object(mail.time,'sleep') as sleep:
            opener.return_value.open.side_effect=denied
            with self.assertRaisesRegex(ValueError,'unavailable'):mail.native_preflight(settings,values)
            self.assertEqual(opener.return_value.open.call_count,1);sleep.assert_not_called()
        denied.close()

    def test_targets_and_wrong_environment_rejected(self):
        for kind in ['dev','uat','production']:
            t=target(kind);m.validate_target(t,t['environment'])
        mutations=[lambda t:t.update(kind='dev'),lambda t:t.update(environment='uat'),lambda t:t.update(account='000000000000'),
            lambda t:t.update(repository='mangmee-kamal-dev/api-web'),lambda t:t.update(publicUrl='https://test.trycloudflare.com'),
            lambda t:t.update(apiInternalUrl='https://uat.example.com/v1'),lambda t:t.update(cutoverComplete=False),
            lambda t:t.update(signingKeyArn=''),lambda t:t['hosts'].update(workers=[]),
            lambda t:t['hosts']['api-web'][0].update(instanceId='i-0883f1ff88440ca07'),
            lambda t:t['hosts']['api-web'][0].update(stack='mangmee-kamal-uat'),
            lambda t:t['hosts'].update(workers=t['hosts']['api-web']),lambda t:t.update(overrides={'api-web':{'DEV_AUTH_ENABLED':'true'}})]
        for mutate in mutations:
            with self.subTest(mutation=mutations.index(mutate)):
                t=target('production');mutate(t)
                with self.assertRaises(ValueError):m.validate_target(t,'production')
        for field in ('stack','repository','servicePrefix'):
            t=target('uat')
            if field=='stack':t['hosts']['api-web'][0]['stack']='mangmee-kamal-production'
            else:t[field]='mangmee-kamal-production'
            with self.assertRaises(ValueError):m.validate_target(t,'uat')

    def test_real_uat_controller_and_ingress_boundaries(self):
        self.assertTrue(m.local_uat_controller(target('uat'),'a'*64,'a'*64))
        for kind in ('production','dev'):
            with self.assertRaisesRegex(ValueError,'UAT-only'):m.local_uat_controller(target(kind),'a'*64,'a'*64)
        with self.assertRaisesRegex(ValueError,'hash mismatch'):m.local_uat_controller(target('uat'),'b'*64,'a'*64)
        t=target('uat');t['hosts']['workers']=t['hosts']['api-web']
        with self.assertRaisesRegex(ValueError,'separate'):m.validate_target(t,'uat')
        c=m.native_config(target('uat'),'ai-gateway',{},'a'*40,Path('/tmp'))
        self.assertNotIn('host',c['proxy'])
        r=m.Release.__new__(m.Release);r.target=target('uat')
        self.assertEqual(r.provider_callback(),r.target['apiInternalUrl'])

    def test_ssm_transport_owns_host_specific_proxy(self):
        t=target('uat');t['sshTransport']='ssm'
        self.assertIs(m.validate_target(t,'uat'),t)
        r=m.Release.__new__(m.Release);r.target=t
        r.ssm_sessions={h['instanceId']:{'port':41000+i} for i,h in enumerate(
            {h['instanceId']:h for rows in t['hosts'].values() for h in rows}.values())}
        host=t['hosts']['api-web'][0]
        self.assertEqual(r.ssh_proxy(host),'nc 127.0.0.1 41000')
        self.assertEqual(r.ssh_proxy(host,container=True),'nc host.docker.internal 41000')
        t['sshProxyCommand']='foreign proxy'
        with self.assertRaisesRegex(ValueError,'owns ProxyCommand'):m.validate_target(t,'uat')

    def test_ssm_transport_explicitly_terminates_its_cloud_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'ssm.private.log';path.write_text('Starting session with SessionId: owned-session\nWaiting for connections...\n')
            log=path.open('a')
            class Process:
                def poll(self):return None
                def terminate(self):pass
                def wait(self,timeout):return 0
            r=m.Release.__new__(m.Release);r.aws_prefix=['aws','--profile','uat'];r.receipt={}
            r.ssm_sessions={'i-1':{'port':41000,'process':Process(),'log':log,'path':path}}
            completed=subprocess.CompletedProcess([],0,'{}','')
            with patch.object(m.subprocess,'run',return_value=completed) as run:self.assertTrue(r.close_transport())
            self.assertEqual(run.call_args.args[0],
                ['aws','--profile','uat','ssm','terminate-session','--session-id','owned-session'])
            self.assertEqual(r.receipt['ssmSessionCleanup'],{'passed':True,'terminatedCount':1,'failedCount':0})
            self.assertEqual(r.ssm_sessions,{})
        for failure in ('missing-id','timeout'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'ssm.private.log'
                path.write_text('Waiting for connections...\n' if failure=='missing-id' else 'Starting session with SessionId: owned-session\n')
                log=path.open('a')
                r=m.Release.__new__(m.Release);r.aws_prefix=['aws'];r.receipt={}
                r.ssm_sessions={'i-1':{'port':41000,'process':Process(),'log':log,'path':path}}
                side_effect=subprocess.TimeoutExpired('aws',30) if failure=='timeout' else None
                with patch.object(m.subprocess,'run',side_effect=side_effect) as run:
                    self.assertFalse(r.close_transport())
                    if failure=='missing-id':run.assert_not_called()
                self.assertEqual(r.receipt['ssmSessionCleanup'],{'passed':False,'terminatedCount':0,'failedCount':1})
                self.assertEqual(r.ssm_sessions,{})

    def test_exact_main_can_reuse_a_validated_prepared_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);prepared=root/'prepared'/'build';prepared.mkdir(parents=True)
            r=m.Release.__new__(m.Release);r.work=root/'work';r.work.mkdir();r.pinned_sha='a'*40
            r.release_path='main';r.receipt={};r.args=argparse.Namespace(prepared_build=prepared,environment='uat',apply=True)
            loaded=[]
            def load(directory):
                loaded.append(directory);r.build_dir.mkdir();m.write(r.build_dir/'build-result.json',{'status':'passed'})
            r.load_prepared_build=load
            r.command=lambda *args,**kwargs:self.fail('prepared main must not rebuild or check out another source')
            r.source_and_build()
            self.assertEqual(loaded,[prepared.resolve()])
            self.assertEqual(r.source,prepared.resolve().parent/'source')
            self.assertEqual(r.build,{'status':'passed'})

    def test_prepared_build_revalidates_every_identity_and_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);prepared=root/'prepared'/'build';source=prepared.parent/'source';prepared.mkdir(parents=True);source.mkdir()
            sha='a'*40;tree='synthetic-tree';phases={'install','contracts','prisma','typescript','di','agentcore',
                'build-api-web','build-ai-gateway','build-workers','export-tools-base','build-tools'}
            images={service:{'tag':'local/'+service,'imageId':'sha256:'+str(index)*64,'architecture':'amd64'}
                for index,service in enumerate((*m.SERVICES,'tools'),1)}
            archive=b'synthetic-agentcore'
            build={'status':'passed','sourceCommit':sha,'sourceTreeSha256':hashlib.sha256(tree.encode()).hexdigest(),
                'elapsedSeconds':120,'phases':{phase:{'exitCode':0} for phase in phases},'images':images,
                'agentcore':{'sourceCommit':sha,'sha256':hashlib.sha256(archive).hexdigest()}}
            m.write(prepared/'build-result.json',build);(prepared/'source-tree.bin').write_bytes(tree.encode())
            for phase in phases:(prepared/(phase+'.log')).write_text('passed')
            (prepared/'agentcore').mkdir();(prepared/'agentcore/agentcore.zip').write_bytes(archive)
            r=m.Release.__new__(m.Release);r.pinned_sha=sha;r.source=source;r.build_dir=root/'copied';r.receipt={}
            def command(args,**kwargs):
                if args[:3]==['git','rev-parse','HEAD']:return sha+'\n'
                if args[:3]==['git','status','--porcelain']:return ''
                if args[:3]==['git','ls-tree','-rz']:return tree
                if args[:3]==['docker','image','inspect']:
                    row=next(value for value in images.values() if value['tag']==args[3])
                    return json.dumps([{'Id':row['imageId'],'Architecture':'amd64',
                        'Config':{'Labels':{'org.opencontainers.image.revision':sha}}}])
                raise AssertionError(args)
            r.command=command;r.load_prepared_build(prepared)
            self.assertTrue(r.receipt['preparedBuild']['identitiesRevalidated'])
            (prepared/'source-tree.bin').write_bytes(b'tampered')
            r.build_dir=root/'rejected'
            with self.assertRaisesRegex(ValueError,'source tree mismatch'):r.load_prepared_build(prepared)

    def test_exact_candidate_storage_capacity_fails_before_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp);del r.storage_capacity
            r.target=target('uat');r.target['hosts']['workers']=r.target['hosts']['ai-gateway']
            r.hosts={host['instanceId']:host for rows in r.target['hosts'].values() for host in rows}
            gib=1024**3
            r.manifest={'artifacts':{service:{'tag':'local/'+service,'imageId':'sha256:'+str(index)*64}
                for index,service in enumerate((*m.SERVICES,'tools'),1)}}
            def command(args,**kwargs):
                service=args[-1].rsplit('/',1)[-1];row=r.manifest['artifacts'][service]
                return json.dumps([{'Id':row['imageId'],'Size':gib}])
            available={iid:10*gib for iid in r.hosts}
            def remote(host,args,**kwargs):
                if args[:2]==['docker','info']:return '/var/lib/docker\n'
                if args[:2]==['df','-Pk']:return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 1 1 '+str(available[host['instanceId']]//1024)+' 1% /\n'
                raise AssertionError(args)
            r.command=command;r.remote=remote;r.storage_capacity()
            api=r.target['hosts']['api-web'][0]['instanceId'];ai=r.target['hosts']['ai-gateway'][0]['instanceId']
            self.assertEqual(r.receipt['hostStorageCapacity'][api]['services'],['api-web','tools'])
            self.assertEqual(r.receipt['hostStorageCapacity'][ai]['services'],['ai-gateway','workers'])
            available[ai]=5*gib
            with self.assertRaisesRegex(ValueError,'Insufficient Docker filesystem'):r.storage_capacity()

    def test_uat_duration_boundaries_stop_before_mutation_and_record_ten_minutes(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp)
            r.clock=100
            with patch.object(m.time,'monotonic',return_value=100+m.UAT_PRE_MUTATION_SECONDS):r.uat_pre_mutation_budget()
            self.assertEqual(r.receipt['durationBudget']['preMutationElapsedSeconds'],m.UAT_PRE_MUTATION_SECONDS)
            with patch.object(m.time,'monotonic',return_value=100+m.UAT_PRE_MUTATION_SECONDS+0.001), \
                    self.assertRaisesRegex(ValueError,'pre-mutation budget exceeded'):
                r.uat_pre_mutation_budget()
        for elapsed,met in ((m.UAT_DEPLOY_TARGET_SECONDS,True),(m.UAT_DEPLOY_TARGET_SECONDS+0.001,False)):
            with self.subTest(elapsed=elapsed),tempfile.TemporaryDirectory() as tmp:
                r=m.Release.__new__(m.Release);r.work=Path(tmp);r.clock=100;r.id='simulation';r.args=argparse.Namespace(environment='uat')
                r.target=target('dev');r.build={'sourceCommit':'a'*40};r.manifest={'releaseId':'b'*64};r.receipt={
                    'runtimeReadback':{},'agentcore':{},'launchRetirement':{},'customerAcceptance':{'passed':True}}
                r.manual_browser=False
                with patch.object(m.time,'monotonic',return_value=100+elapsed):r.sign()
                self.assertIs(m.read(r.work/'accepted.json')['durationTargetMet'],met)

    def test_complete_config_replacement_and_stable_internal_routes(self):
        settings={s:{} for s in m.SERVICES};settings['api-web']['NEW_RUNTIME_SETTING']='new'
        t=target();t['overrides']={'api-web':{'DATABASE_URL':'synthetic-dev-database'}}
        out=m.make_overrides(t,'a'*40,'b'*64,settings)
        self.assertEqual(out['api-web']['NEW_RUNTIME_SETTING'],'new')
        self.assertEqual(out['workers']['INTERNAL_API_URL'],'http://kamal-proxy/v1')
        self.assertEqual(out['api-web']['AI_GATEWAY_INTERNAL_URL'],'http://kamal-proxy/__kamal_ai/v1')
        self.assertEqual(out['ai-gateway']['AGENTCORE_EXPECTED_SOURCE_COMMIT'],'a'*40)
        self.assertNotIn('DATABASE_URL',settings['api-web'])

    def test_native_routing_no_fixed_application_port(self):
        for kind in ('dev','production'):
            for service in m.SERVICES:
                c=m.native_config(target(kind),service,{'NEW_KEY':'new','SECRET':'synthetic'},'a'*40,Path('/tmp'))
                self.assertEqual(c['env']['secret'],['NEW_KEY','SECRET'])
                self.assertNotIn('publish',c['servers']['web'].get('options',{}))
                self.assertEqual(c['stop_timeout'],180)
                if service=='ai-gateway':
                    self.assertEqual(c['proxy']['app_port'],3002)
                    self.assertIs(c['servers']['web']['options']['init'],True)
                if service=='workers':self.assertIs(c['servers']['web']['proxy'],False)

    def runner(self,tmp,fail=None):
        r=m.Release.__new__(m.Release);r.state=Path(tmp);r.work=Path(tmp)/'run';r.work.mkdir()
        r.id='20260911T000000Z-abcdef01';r.clock=time.monotonic();r.secrets=set();r.changed=[];r.remote_lock_owned=False
        r.target=target();r.args=argparse.Namespace(apply=True,environment='uat',rollback=None);r.receipt={'status':'RUNNING','phases':[]};r.manual_browser=False
        calls=[]
        for name in ('preflight','source_and_build','configuration','render','storage_capacity','publish','config_freshness','agentcore','migrations','deploy','acceptance','retire','sign','acquire_remote_lock','release_remote_lock'):
            def invoke(n=name):
                calls.append(n)
                if n==fail:raise RuntimeError('injected '+n)
                if n=='deploy':r.changed.append('api-web-rollout-started')
            setattr(r,name,invoke)
        return r,calls

    def test_full_pipeline_success_and_failed_acceptance_never_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.runner(tmp);r.run();r.save()
            self.assertEqual(r.receipt['status'],'ACCEPTED_LINE_DEFERRED')
            self.assertLess(calls.index('configuration'),calls.index('publish'))
            self.assertLess(calls.index('migrations'),calls.index('deploy'))
            self.assertLess(calls.index('acceptance'),calls.index('retire'))
            self.assertFalse((r.state/'active.json').exists())
            self.assertGreaterEqual(r.receipt['elapsedSeconds'],sum(x['elapsedSeconds'] for x in r.receipt['phases'])-0.02)
        for fail in ('source_and_build','configuration','storage_capacity','publish','config_freshness','agentcore','migrations','deploy','acceptance','retire','sign'):
            with self.subTest(fail=fail),tempfile.TemporaryDirectory() as tmp:
                r,calls=self.runner(tmp,fail)
                with self.assertRaises(RuntimeError):r.run()
                self.assertNotEqual(r.receipt['status'],'ACCEPTED_LINE_DEFERRED')
                self.assertEqual(r.receipt['phases'][-1]['status'],'FAILED')
                if fail!='sign':self.assertNotIn('sign',calls)
                if fail in ('migrations','deploy','acceptance','retire','sign'):
                    self.assertTrue((r.state/'active.json').exists())
                    self.assertNotIn('release_remote_lock',calls)

    def test_previous_unknown_operation_blocks_even_before_preflight(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.runner(tmp);m.write(r.state/'active.json',{'operationId':'older'})
            with self.assertRaisesRegex(ValueError,'reconciliation'):r.run()
            self.assertEqual(calls,[])

    def test_manual_acceptance_scope_and_no_password_requirement(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp);r.manual_browser=True;r.target=target('uat')
            r.target.pop('acceptanceCredentials');r.target['browserAcceptanceUserId']='uat-owner'
            r.validate_acceptance_target()
            r.manual_browser=False
            with self.assertRaisesRegex(ValueError,'credentials'):r.validate_acceptance_target()
            r.manual_browser=True
            for kind,rollback in [('production',None),('dev',None)]:
                r.target=target(kind);r.target['browserAcceptanceUserId']='uat-owner'
                r.args.environment=r.target['environment'];r.args.rollback=rollback
                with self.assertRaisesRegex(ValueError,'real UAT'):r.validate_acceptance_target()

    def test_browser_wait_retains_operation_and_rejects_incomplete_or_stale_proof(self):
        for failure in (None,'origin','incomplete','evidence','runtime','closed'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                r,calls=self.runner(tmp);r.target=target('uat');r.manual_browser=True
                r.target.pop('acceptanceCredentials');r.target['browserAcceptanceUserId']='uat-owner'
                r.build={'sourceCommit':'a'*40};r.manifest={'releaseId':'b'*64};del r.acceptance
                urls=[]
                class Response:
                    status=200
                    def __init__(self,body):self.body=body
                    def __enter__(self):return self
                    def __exit__(self,*args):pass
                    def read(self):return self.body
                class Opener:
                    def open(self,request,timeout):
                        assert request.get_header('User-agent') == 'Mangmee-Kamal-Release/1.0'
                        urls.append(request.full_url)
                        if request.full_url.endswith('/login'):return Response(b'<main data-platform-access="open">')
                        state='CLOSED' if failure=='closed' and len(urls)>2 else 'OPEN'
                        return Response(json.dumps({'effectiveState':state}).encode())
                def inspect(service):
                    calls.append('inspect-'+service)
                    if failure=='runtime':raise RuntimeError('candidate changed during login wait')
                    return [{'sourceCommit':'a'*40}]
                r.inspect_service=inspect;r.deep_health=lambda s:calls.append('health-'+s)
                def submit(_):
                    self.assertEqual(r.receipt['status'],'AWAITING_BROWSER_ACCEPTANCE')
                    self.assertTrue((r.state/'active.json').exists())
                    self.assertNotIn('retire',calls);self.assertNotIn('sign',calls)
                    self.assertNotIn('customerAcceptance',r.receipt)
                    proof=m.read(r.work/'browser-acceptance-request.json')
                    self.assertTrue(all(value is False for value in proof['checks'].values()))
                    proof['checks']={key:True for key in proof['checks']};proof['observer']='synthetic test observer'
                    evidence=r.work/'observations.txt';evidence.write_text('Synthetic unit-test observations; no live browser was used.')
                    proof['evidenceFiles']=[str(evidence)]
                    if failure=='origin':proof['origin']='https://wrong.example.com'
                    if failure=='incomplete':proof['checks']['logout']=False
                    if failure=='evidence':proof['evidenceFiles']=[]
                    m.write(r.work/'browser-acceptance.json',proof)
                with patch.object(m.time,'sleep',side_effect=submit),patch.object(m.urllib.request,'build_opener',return_value=Opener()):
                    if failure:
                        with self.assertRaises((ValueError,RuntimeError)):r.run()
                        self.assertEqual(r.receipt['status'],'FAILED_RECONCILIATION_REQUIRED')
                        self.assertNotIn('sign',calls);self.assertTrue((r.state/'active.json').exists())
                    else:
                        r.run();r.save()
                        self.assertEqual(r.receipt['status'],'ACCEPTED_LINE_DEFERRED')
                        self.assertEqual(r.receipt['customerAcceptance']['browser']['kind'],'operator_browser_attestation')
                        self.assertFalse((r.state/'active.json').exists())
                        self.assertLessEqual(r.receipt['secondsToWebsiteReady'],r.receipt['elapsedSeconds'])
                        self.assertGreaterEqual(r.receipt['browserAcceptanceStageSeconds'],0)
                        self.assertLess(calls.index('inspect-api-web'),calls.index('retire'))
                    self.assertEqual(calls.count('deploy'),1)
                    self.assertFalse(any('/api/auth/login' in url for url in urls))

    def test_no_apply_is_only_preflight(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.runner(tmp);r.args.apply=False;r.run()
            self.assertEqual(calls,['preflight']);self.assertEqual(r.receipt['status'],'PREFLIGHT_PASSED_NO_DEPLOYMENT')

    def test_prepare_runs_all_local_validation_without_cloud_writes(self):
        expected=['preflight','source_and_build','configuration','render','storage_capacity','config_freshness']
        for environment in ('production','uat'):
            with self.subTest(environment=environment),tempfile.TemporaryDirectory() as tmp:
                r,calls=self.runner(tmp);r.args.apply=False;r.args.prepare=True;r.args.environment=environment
                r.target=target(environment);r.run();r.save()
                self.assertEqual(calls,expected)
                self.assertEqual(r.receipt['status'],'PREPARED_NO_DEPLOYMENT')
                self.assertEqual(r.changed,[])
                self.assertFalse((r.state/'active.json').exists())
                self.assertFalse((r.work/'accepted.json').exists())
        for fail in expected:
            with self.subTest(fail=fail),tempfile.TemporaryDirectory() as tmp:
                r,calls=self.runner(tmp,fail);r.args.apply=False;r.args.prepare=True
                with self.assertRaisesRegex(RuntimeError,'injected'):r.run()
                self.assertEqual(calls,expected[:expected.index(fail)+1])
                self.assertEqual(r.receipt['phases'][-1]['status'],'FAILED')
                self.assertNotEqual(r.receipt['status'],'PREPARED_NO_DEPLOYMENT')
                self.assertEqual(r.changed,[])
                self.assertFalse((r.state/'active.json').exists())
                # Exiting a failed preparation releases the local flock.
                with (r.state/'deployment.lock').open('a+') as lock:
                    m.fcntl.flock(lock,m.fcntl.LOCK_EX|m.fcntl.LOCK_NB)

    def test_prepare_preserves_unreconciled_operation(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.runner(tmp);r.args.apply=False;r.args.prepare=True
            m.write(r.state/'active.json',{'operationId':'unreconciled'})
            with self.assertRaisesRegex(ValueError,'reconciliation'):r.run()
            self.assertEqual(calls,[])
            self.assertEqual(m.read(r.state/'active.json'),{'operationId':'unreconciled'})

    def test_prepare_rejects_concurrent_local_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.runner(tmp);r.args.apply=False;r.args.prepare=True
            with (r.state/'deployment.lock').open('a+') as lock:
                m.fcntl.flock(lock,m.fcntl.LOCK_EX|m.fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError,'already active'):r.run()
            self.assertEqual(calls,[])

    def test_production_example_cannot_be_used_as_enrollment(self):
        example=m.read(Path(__file__).with_name('production-target.example.json'))
        self.assertIs(example['cutoverComplete'],False)
        with self.assertRaises(ValueError):m.validate_target(example,'production')

    def test_production_prepare_cannot_select_uat_acceptance(self):
        for browser in (True,False):
            with self.subTest(browser=browser),tempfile.TemporaryDirectory() as tmp:
                r,_=self.runner(tmp);r.target=target('production');r.args.environment='production'
                r.args.prepare=True;r.args.apply=False;r.manual_browser=browser;r.smoke_acceptance=not browser
                with self.assertRaises(ValueError):r.validate_acceptance_target()

    def test_prepare_cli_rejects_apply_and_rollback_before_target_access(self):
        for extra in (['--apply'],['--rollback','20260911T000000Z-abcdef01']):
            with self.subTest(extra=extra),patch.object(sys,'argv',['release.py','--environment','production','--prepare',*extra]), \
                    patch.object(sys,'stderr',io.StringIO()),patch.object(m,'Release') as constructor:
                with self.assertRaises(SystemExit) as result:m.main()
                self.assertEqual(result.exception.code,2)
                constructor.assert_not_called()

    def test_prepare_failure_receipt_is_terminal_and_redacted(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.runner(tmp,'configuration');r.args.apply=False;r.args.prepare=True;r.secrets={'configuration'}
            with patch.object(sys,'argv',['release.py','--environment','production','--prepare']), \
                    patch.object(m,'Release',return_value=r),patch.object(sys,'stderr',io.StringIO()):
                self.assertEqual(m.main(),1)
            saved=m.read(r.work/'result.json')
            self.assertEqual(saved['status'],'FAILED')
            self.assertIn('finishedAt',saved)
            self.assertEqual(saved['error'],'injected [REDACTED]')

    def test_main_returns_failure_when_transport_cleanup_is_not_proven(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp);r.run=lambda:r.receipt.update(status='ACCEPTED_LINE_DEFERRED')
            r.close_transport=lambda:False
            with patch.object(sys,'argv',['release.py','--environment','uat']),patch.object(m,'Release',return_value=r):
                self.assertEqual(m.main(),1)
            self.assertTrue(r.receipt['transportCleanupRequired'])
            self.assertEqual(r.receipt['status'],'FAILED_TRANSPORT_CLEANUP_REQUIRED')
            self.assertEqual(r.receipt['statusBeforeTransportCleanup'],'ACCEPTED_LINE_DEFERRED')
            self.assertIn('session cleanup failed',r.receipt['error'])

    def test_main_cleans_transport_after_remote_lock_on_success_and_after_failure(self):
        for failure in (None,'configuration'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                r,calls=self.runner(tmp,failure);r.close_transport=lambda:calls.append('close_transport') or True
                with patch.object(sys,'argv',['release.py','--environment','uat']),patch.object(m,'Release',return_value=r):
                    self.assertEqual(m.main(),0 if failure is None else 1)
                self.assertEqual(calls.count('close_transport'),1)
                if failure is None:self.assertLess(calls.index('release_remote_lock'),calls.index('close_transport'))
                else:self.assertEqual(r.receipt['status'],'FAILED')

    def test_production_preflight_pins_main_for_prepare_and_still_checks_apply_controller(self):
        for prepare in (True,False):
            with self.subTest(prepare=prepare),tempfile.TemporaryDirectory() as tmp:
                r,_=self.runner(tmp);del r.preflight
                r.target=target('production');r.target['agentcoreCandidateQualifier']='candidate_spare'
                r.args.environment='production';r.args.apply=not prepare;r.args.prepare=prepare
                key=Path(tmp)/'key';key.write_text('synthetic');key.chmod(0o600);r.target['sshKey']=str(key)
                r.hosts={h['instanceId']:h for rows in r.target['hosts'].values() for h in rows}
                infos=[{'InstanceId':h['instanceId'],'State':{'Name':'running'},'VpcId':h['vpcId'],'PrivateIpAddress':h['address'],
                    'Tags':[{'Key':'aws:cloudformation:stack-name','Value':h['stack']}],'IamInstanceProfile':{'Arn':'synthetic'},
                    'MetadataOptions':{'HttpTokens':'required','HttpPutResponseHopLimit':2},
                    'Placement':{'AvailabilityZone':'ap-southeast-1'+str(i)}} for i,h in enumerate(r.hosts.values())]
                reads=[]
                def aws(args,**kwargs):
                    reads.append(args[:2])
                    return {('sts','get-caller-identity'):{'Account':m.ACCOUNT,'Arn':'arn:aws:iam::'+m.ACCOUNT+':user/production-reader'},
                        ('ec2','describe-instances'):{'Reservations':[{'Instances':infos}]},
                        ('kms','describe-key'):{'KeyMetadata':{'KeyUsage':'SIGN_VERIFY','KeyState':'Enabled'}},
                        ('ecr','describe-repositories'):{},('bedrock-agentcore-control','get-agent-runtime-endpoint'):{'status':'READY','liveVersion':'1'},
                        ('bedrock-agentcore-control','get-agent-runtime'):{'environmentVariables':{}}}[tuple(args[:2])]
                commands=[]
                def command(args,**kwargs):
                    commands.append(args)
                    return 'a'*40 if args[1]=='rev-parse' else 'local controller differs'
                r.aws=aws;r.command=command;r.local_uat_test=False;r.validate_acceptance_target=lambda:None
                r.remote=lambda *args,**kwargs:json.dumps([{'State':{'Running':True},'Config':{'Image':'kamal-proxy:v0.9.2'}}])
                if prepare:
                    r.preflight()
                    self.assertEqual(r.pinned_sha,'a'*40)
                    self.assertEqual(commands,[['git','fetch','origin','main'],['git','rev-parse','origin/main']])
                    self.assertTrue(r.receipt['targetVerified'])
                else:
                    with self.assertRaisesRegex(ValueError,'Controller differs from pinned main'):r.preflight()
                self.assertTrue(all(op.startswith(('get-','describe-')) for _,op in reads))

    def test_secret_safe_failure_log_and_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp);r.secrets={'private-test-secret'}
            fake=subprocess.CompletedProcess(['bad'],1,'private-test-secret','failure private-test-secret')
            with patch.object(m.subprocess,'run',return_value=fake),self.assertRaises(ValueError):r.command(['bad'],log='bad')
            self.assertNotIn('private-test-secret',(r.work/'bad.log').read_text())
            with patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('bad',1)),self.assertRaisesRegex(RuntimeError,'no automatic mutation retry'):
                r.command(['bad'])

    def test_wrappers_seal_environment(self):
        for script,env in [('deploy-prod','production'),('deploy-uat','uat')]:
            text=Path(__file__).with_name(script).read_text()
            self.assertTrue(text.rstrip().endswith('"$@" --environment '+env))
            with tempfile.TemporaryDirectory() as tmp:
                wrapper=Path(tmp)/script;wrapper.write_text(text)
                (Path(tmp)/'release.py').write_text('import json,sys,probe\nprint(json.dumps([sys.dont_write_bytecode,sys.argv[1:]]))\n')
                (Path(tmp)/'probe.py').write_text('VALUE=1\n')
                clean_env={key:value for key,value in os.environ.items() if key!='PYTHONDONTWRITEBYTECODE'}
                result=subprocess.check_output(['sh',str(wrapper),'--mode','hotfix'],text=True,env=clean_env)
                default_mode='hotfix' if env=='production' else 'normal'
                self.assertEqual(json.loads(result),[True,['--mode',default_mode,'--mode','hotfix','--environment',env]])
                self.assertFalse((Path(tmp)/'__pycache__').exists())

    def provider_runner(self,tmp,*,changed=False,spare=False,bad_bytes=False):
        r,_=self.runner(tmp)
        # Exercise the real provider preparation method against AWS-shaped responses.
        del r.agentcore
        r.build={'sourceCommit':'a'*40,'agentcore':{'sha256':hashlib.sha256(b'artifact').hexdigest()}}
        r.build_dir=Path(tmp)/'build';(r.build_dir/'agentcore').mkdir(parents=True)
        (r.build_dir/'agentcore/agentcore.zip').write_bytes(b'artifact')
        r.envdir=Path(tmp)/'environments';r.envdir.mkdir()
        arn=f'arn:aws:bedrock-agentcore:{m.REGION}:{m.ACCOUNT}:runtime/dev-runtime'
        r.target['agentcoreRuntimeArn']=arn
        if spare:r.target['agentcoreCandidateQualifier']='candidate_spare'
        r.envs={'ai-gateway':{'AGENTCORE_RUNTIME_ARN':arn,'AGENTCORE_RUNTIME_QUALIFIER':'candidate_current'}}
        r.manifest={'services':{'ai-gateway':{}}}
        actual={'GIT_SHA':('b' if changed else 'a')*40,'SERVICE_VERSION':('b' if changed else 'a')*40,'AGENTCORE_ARTIFACT_SHA256':r.build['agentcore']['sha256'],
            'DEPLOY_ENVIRONMENT':'uat','ERP_CORE_INTERNAL_URL':'https://app.example.com/v1','KEEP_PROVIDER_CONFIG':'original'}
        runtime={'status':'READY','environmentVariables':actual,'roleArn':'arn:aws:iam::311414082667:role/dev',
            'networkConfiguration':{'networkMode':'PUBLIC'},'protocolConfiguration':{'serverProtocol':'HTTP'},
            'metadataConfiguration':{'requireMMDSV2':True},'authorizerConfiguration':None,
            'agentRuntimeArtifact':{'codeConfiguration':{'runtime':'PYTHON_3_12','entryPoint':['main.py'],
                'code':{'s3':{'bucket':'synthetic','prefix':'pinned.zip','versionId':'v1'}}}}}
        calls=[];updated={};switched=False
        def remote(host,args,**kw):
            return 'abc123' if args[1]=='ps' else json.dumps([{'Config':{'Env':[
                'AGENTCORE_RUNTIME_ARN='+arn,'AGENTCORE_RUNTIME_QUALIFIER=candidate_current']}}])
        def aws(args,**kw):
            nonlocal switched
            calls.append(args)
            op=args[1]
            if op=='get-agent-runtime-endpoint':
                return {'status':'READY','liveVersion':'68' if switched and args[-1]=='candidate_spare' else '67'}
            if op=='get-agent-runtime':
                return {**runtime,**updated} if args[-1]=='68' else copy.deepcopy(runtime)
            if op=='put-object':return {'VersionId':'v2'}
            if op=='get-object':Path(args[-1]).write_bytes(b'wrong' if bad_bytes else b'artifact');return {}
            if op=='update-agent-runtime':
                request=m.read(Path(args[-1].removeprefix('file://')))
                self.assertEqual(request['environmentVariables']['KEEP_PROVIDER_CONFIG'],'original')
                self.assertEqual(request['environmentVariables']['SERVICE_VERSION'],r.build['sourceCommit'])
                self.assertEqual(request['roleArn'],runtime['roleArn'])
                self.assertEqual(request['metadataConfiguration'],runtime['metadataConfiguration'])
                self.assertNotIn('authorizerConfiguration',request)
                updated.update(agentRuntimeArtifact=request['agentRuntimeArtifact'],environmentVariables=request['environmentVariables'])
                return {'agentRuntimeVersion':'68'}
            if op=='update-agent-runtime-endpoint':
                self.assertEqual(args[args.index('--endpoint-name')+1],'candidate_spare');switched=True;return {}
            raise AssertionError(args)
        r.aws=aws;r.remote=remote
        return r,calls

    def test_provider_exact_bytes_and_full_update_preserves_active_endpoint(self):
        for changed,spare in ((False,False),(True,True)):
            with tempfile.TemporaryDirectory() as tmp:
                r,calls=self.provider_runner(tmp,changed=changed,spare=spare);r.agentcore()
                self.assertEqual(r.receipt['agentcore']['status'],'UPDATED_PINNED' if changed else 'REUSED_EXACT')
                writes=[c for c in calls if c[1].startswith(('put-','update-'))]
                self.assertEqual(len(writes),3 if changed else 0)
                self.assertEqual(r.manifest['services']['ai-gateway']['environmentSha256'],m.digest(r.envs['ai-gateway']))
        for settings,pattern in (({'bad_bytes':True},'bytes mismatch'),({'changed':True},'separately enrolled')):
            with tempfile.TemporaryDirectory() as tmp:
                r,calls=self.provider_runner(tmp,**settings)
                with self.assertRaisesRegex(ValueError,pattern):r.agentcore()
                self.assertFalse(any(c[1].startswith(('put-','update-')) for c in calls))
        with tempfile.TemporaryDirectory() as tmp:
            r,calls=self.provider_runner(tmp,changed=True,spare=True)
            with self.assertRaisesRegex(ValueError,'rollback endpoint'):r.agentcore(read_only=True)
            self.assertFalse(any(c[1].startswith(('put-','update-')) for c in calls))

    def test_proxy_readback_rejects_healthy_wrong_container(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp)
            r.remote=lambda *a,**k:'Service Host Path Target State TLS\n\x1b[32mmangmee-kamal-dev-web * / abcdef123456:3000 running no\x1b[0m'
            r.verify_proxy('api-web',{}, {'Id':'abcdef123456'+'0'*52})
            with self.assertRaisesRegex(ValueError,'different container'):
                r.verify_proxy('api-web',{}, {'Id':'0'*64})

    def test_config_rotations_stop_before_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            r,_=self.runner(tmp);del r.config_freshness;r.args.profile=''
            before={'services':{'api-web':{'configurationSha256':'old'}},'secretVersions':{'secret':'v1'},'readAt':'now'}
            r.manifest={'secretVersions':dict(before['secretVersions'])}
            m.write(r.work/'capture-evidence.json',before)
            after=copy.deepcopy(before)
            r.command=lambda *a,**k:m.write(r.work/'recapture-evidence.json',after)
            r.config_freshness()
            after['secretVersions']['secret']='v2'
            with self.assertRaisesRegex(ValueError,'Secrets rotated'):r.config_freshness()
            after['secretVersions']['secret']='v1';after['services']['api-web']['configurationSha256']='new'
            with self.assertRaisesRegex(ValueError,'Configuration changed'):r.config_freshness()
            after['services']['api-web']['configurationSha256']='old'
            ref=f'arn:aws:secretsmanager:{m.REGION}:{m.ACCOUNT}:secret:watchdog-bms/uat/postmark/token-abcdef'
            r.manifest={'secretVersions':{ref:'v1'}}
            r.aws=lambda args:{'ARN':ref,'VersionIdsToStages':{'v1':['AWSCURRENT']}}
            r.config_freshness()
            r.aws=lambda args:{'ARN':ref,'VersionIdsToStages':{'v2':['AWSCURRENT']}}
            with self.assertRaisesRegex(ValueError,'Postmark secret rotated'):r.config_freshness()

    def test_rollback_rejects_migrations_wrong_hosts_and_mixed_old_sources(self):
        for failure in ('normal','environment','hosts','sources'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                r,calls=self.runner(tmp);r.args.rollback='20260911T000000Z-01234567'
                old=r.state/'runs'/r.args.rollback
                result={'environment':'uat','kind':'dev','mode':'hotfix','status':'ACCEPTED_LINE_DEFERRED'}
                previous={s:[{'host':r.target['hosts'][s][0],'sourceCommit':'a'*40}] for s in m.SERVICES}
                if failure=='normal':result['mode']='normal'
                if failure=='environment':result['environment']='production'
                if failure=='hosts':previous['workers'][0]['host']={'instanceId':'i-999'}
                if failure=='sources':previous['workers'][0]['sourceCommit']='b'*40
                m.write(old/'result.json',result);m.write(old/'previous.private.json',previous)
                with self.assertRaises(ValueError):r.rollback(r.state/'active.json')
                self.assertEqual(calls,[])


if __name__=='__main__':unittest.main(verbosity=2)

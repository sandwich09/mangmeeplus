#!/usr/bin/env python3
"""Rehearse shared build/config/DB/Kamal phases on the enrolled disposable Dev host.

This is NOT deploy-prod, a Production target enrollment, or external-provider acceptance.
Production configuration is captured, but every credential and external data route is isolated.
The existing host is powered off in finally; the operator removes temporary AWS ingress separately.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile
import time

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target', type=Path, required=True)
    p.add_argument('--profile', required=True)
    p.add_argument('--baseline-ref', required=True)
    p.add_argument('--bootstrap-tools-image', required=True, help='Existing host image, used only for initial baseline schema')
    p.add_argument('--postgres-image', required=True)
    p.add_argument('--redis-image', required=True)
    a = p.parse_args()
    t = m.validate_target(m.read(a.target), 'uat')
    m.require(t['kind'] == 'dev' and t['servicePrefix'] == 'mangmee-kamal-dev', 'Only the existing disposable Dev service is allowed')
    m.require({h['instanceId'] for hs in t['hosts'].values() for h in hs} == {'i-0883f1ff88440ca07'}, 'Unexpected rehearsal host')
    m.require(a.bootstrap_tools_image.startswith('311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/mangmee-kamal-dev/api-web:'), 'Foreign bootstrap image')
    for image, name in [(a.postgres_image, 'postgres'), (a.redis_image, 'redis')]:
        m.require(image.startswith(name+'@sha256:') and len(image.rsplit(':',1)[1]) == 64, 'Pin official dependency digests')
    args = argparse.Namespace(target=a.target, profile=a.profile, environment='uat', mode='normal', apply=False,
        prepare=False, rollback=None, uat_controller_sha256=None, uat_browser_acceptance=False, uat_smoke_acceptance=False)
    r = m.Release(args)
    command_clock = r.clock
    r.receipt.update(scope=__doc__, providerAcceptance='NOT_EXERCISED', productionTargetAcceptance='NOT_EXERCISED',
                     credentials='Synthetic; no Production credential values are sent to Dev')
    r.receipt['rehearsalScriptSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    host = next(iter(r.hosts.values()))
    base_remote = r.remote
    remote_dir = '/home/ubuntu/kamal-rehearsal/'+r.id
    db_name = 'kamal-rehearsal-db-'+r.id[-8:]
    redis_name = 'kamal-rehearsal-redis-'+r.id[-8:]
    tls_path = '/etc/ssl/certs/aws-rds-global-bundle.pem'
    db_password, redis_password = secrets.token_hex(32), secrets.token_hex(32)
    db_url = f'postgresql://proof:{db_password}@{db_name}:5432/kamal_dev_proof?schema=public&sslmode=verify-full&sslrootcert={tls_path}&connection_limit=10'
    redis_url = f'rediss://:{redis_password}@{redis_name}:6379/1'
    r.secrets.update([db_password, redis_password, db_url, redis_url])
    deploy_clock = None
    try:
        with r.phase('setup-target-preflight'):
            r.preflight()
            r.acquire_remote_lock()
            m.require(len(r.hosts) == 1, 'Rehearsal must have exactly one isolated host')
        with r.phase('setup-isolated-tls-dependencies'):
            d = r.work/'dependencies'; tls = d/'tls'; tls.mkdir(parents=True, mode=0o700)
            r.command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Disposable rehearsal CA',
                '-keyout',str(tls/'ca.key'),'-out',str(tls/'ca.pem')], log='setup-ca')
            r.command(['openssl','req','-newkey','rsa:2048','-nodes','-subj','/CN='+db_name,
                '-keyout',str(tls/'server.key'),'-out',str(tls/'server.csr')], log='setup-csr')
            (tls/'extensions').write_text('subjectAltName=DNS:'+db_name+',DNS:'+redis_name+'\nextendedKeyUsage=serverAuth\n')
            r.command(['openssl','x509','-req','-in',str(tls/'server.csr'),'-CA',str(tls/'ca.pem'),'-CAkey',str(tls/'ca.key'),
                '-CAcreateserial','-days','1','-extfile',str(tls/'extensions'),'-out',str(tls/'server.crt')], log='setup-cert')
            for key in ['server.key','ca.key']: (tls/key).chmod(0o600)
            (tls/'pg_hba.conf').write_text('local all all trust\nhostnossl all all all reject\nhostssl all all all scram-sha-256\n')
            (d/'redis.conf').write_text('bind 0.0.0.0\nport 0\ntls-port 6379\nrequirepass '+redis_password+
                '\ntls-cert-file /proof/tls/server.crt\ntls-key-file /proof/tls/server.key\ntls-ca-cert-file /proof/tls/ca.pem\ntls-auth-clients no\n')
            (d/'redis.conf').chmod(0o600)
            archive = subprocess.check_output(['git','archive',a.baseline_ref,'apps/api/prisma/migrations'],cwd=m.ROOT)
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar: tar.extractall(d/'baseline',filter='data')
            bundle = io.BytesIO()
            with tarfile.open(fileobj=bundle,mode='w:gz') as tar:
                for path in sorted(d.iterdir()): tar.add(path,arcname=path.name)
            upload = "import base64,io,pathlib,sys,tarfile;p=pathlib.Path(sys.argv[1]);p.mkdir(parents=True,mode=0o700);tarfile.open(fileobj=io.BytesIO(base64.b64decode(sys.stdin.read()))).extractall(p,filter='data');print('isolated fixture uploaded')"
            base_remote(host,['python3','-c',upload,remote_dir],stdin=base64.b64encode(bundle.getvalue()).decode())
            # These are previously parked Dev workloads, not UAT/Production services. Preserve their data/images.
            stopped = []
            for service in m.SERVICES:
                label=t['servicePrefix']+('' if service=='api-web' else '-'+service)
                stopped += base_remote(host,['docker','ps','--filter','label=service='+label,'--format','{{.ID}}']).split()
            if stopped: base_remote(host,['docker','stop',*stopped],timeout=240)
            r.receipt['setupParkedPreviousDevContainers'] = stopped
            for image in [a.postgres_image,a.redis_image]: base_remote(host,['docker','pull',image],timeout=180)
            base_remote(host,['docker','run','-d','--restart','unless-stopped','--name',db_name,'--network','kamal',
                '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=proof','--env','POSTGRES_DB=kamal_dev_proof',
                '-v',remote_dir+'/tls:/proof:ro',a.postgres_image,'sh','-c',
                'cp /proof/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && '
                'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/proof/server.crt '
                '-c ssl_key_file=/tmp/server.key -c hba_file=/proof/pg_hba.conf'],environment={'POSTGRES_PASSWORD':db_password})
            # Native Linux honors owner-only config permissions. The official entrypoint drops UID 0
            # to redis (999), so run as the fixture owner instead, with an equally private writable data dir.
            base_remote(host,['mkdir','-m','700',remote_dir+'/redis-data'])
            base_remote(host,['docker','run','-d','--restart','unless-stopped','--name',redis_name,'--network','kamal','--user','1000:1000',
                '-v',remote_dir+':/proof:ro','-v',remote_dir+'/redis-data:/data',a.redis_image,'redis-server','/proof/redis.conf'])
            base_remote(host,['sh','-c',f'for n in $(seq 1 30); do docker exec {db_name} pg_isready -U proof >/dev/null && exit 0; sleep 1; done; exit 1'])
            base_remote(host,['sh','-c',f'for n in $(seq 1 20); do docker exec -e REDISCLI_AUTH {redis_name} redis-cli --tls --cacert /proof/tls/ca.pem -h {redis_name} PING 2>/dev/null | grep -qx PONG && exit 0; sleep 1; done; exit 1'],
                environment={'REDISCLI_AUTH':redis_password})
            bootstrap = base_remote(host,['docker','run','--rm','--network','kamal','--env','DATABASE_URL',
                '-v',remote_dir+'/tls/ca.pem:'+tls_path+':ro',
                '-v',remote_dir+'/baseline/apps/api/prisma/migrations:/app/apps/api/prisma/migrations:ro',
                '--entrypoint','./node_modules/.bin/prisma',a.bootstrap_tools_image,'migrate','deploy','--schema','prisma/schema.prisma'],
                environment={'DATABASE_URL':db_url},timeout=180)
            (r.work/'setup-baseline.log').write_text(r.redact(bootstrap))
            catalog = base_remote(host,['docker','exec',db_name,'psql','-U','proof','-d','kamal_dev_proof','-Atc',
                "SELECT count(*)||':'||md5(string_agg(migration_name||':'||checksum,E'\\n' ORDER BY migration_name)) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"]).strip()
            m.require(catalog=='182:40a5a8ba0eca164cb736de7a17368c9a', 'Isolated baseline does not match the observed Production catalog')
            r.receipt['baselineCatalog']=catalog
            r.receipt['databaseVersion']=base_remote(host,['docker','exec',db_name,'psql','-U','proof','-d','kamal_dev_proof','-Atc','SHOW server_version']).strip()
            m.require(r.receipt['databaseVersion']=='18.3','Wrong database engine')
            r.receipt['redisVersion']=base_remote(host,['docker','exec',redis_name,'redis-server','--version']).strip()
        r.receipt['setupPhases'] = r.receipt.pop('phases'); r.receipt['phases'] = []
        r.receipt['setupElapsedSeconds'] = round(time.monotonic()-r.clock,3)
        deploy_clock = time.monotonic(); r.clock = deploy_clock
        r.receipt['deployStartedAt'] = datetime.now(timezone.utc).isoformat()
        with r.phase('fresh-main-typescript-all-artifacts'):
            r.command(['git','fetch','origin','main'],cwd=m.ROOT,log='fetch-main')
            r.pinned_sha=r.command(['git','rev-parse','origin/main'],cwd=m.ROOT).strip()
            r.source_and_build()
        with r.phase('fresh-production-config-isolation-validation'):
            # Capture references first so every secret, including future additions, gets a synthetic replacement.
            capture=r.work/'reference-capture'
            r.command(['python3',str(m.HELPERS/'capture-config.py'),'--environment','production','--profile',a.profile,
                '--private-output',str(capture),'--evidence',str(r.work/'reference-capture.json')],timeout=180)
            replacements={'DATABASE_URL':db_url,'REDIS_URL':redis_url}
            isolated={}; differences={}
            for service in m.SERVICES:
                pc=m.read(capture/(service+'.configuration.json'))['primaryContainer']
                values={x['name']:x['value'] for x in pc['environment']}
                secret_keys=[x['name'] for x in pc.get('secrets',[])]
                out={}
                for key in secret_keys:
                    replacements.setdefault(key,secrets.token_hex(32));out[key]=replacements[key]
                for key,value in values.items():
                    if value.startswith(('http://','https://')):out[key]='https://app.rehearsal.invalid'
                    elif value.startswith('arn:aws:'):out[key]=value.replace(m.ACCOUNT,'000000000000').replace('/production/','/rehearsal/')
                out.update(AWS_EC2_METADATA_DISABLED='true',NODE_EXTRA_CA_CERTS=tls_path)
                if 'S3_BUCKET' in values:out['S3_BUCKET']='mangmee-rehearsal-'+r.id.lower()
                if service=='api-web':out.update(CLAMAV_HOST='clamav.rehearsal.invalid',SES_FROM_ADDRESS='sender@rehearsal.invalid')
                isolated[service]=out;differences[service]={'syntheticSecretKeys':secret_keys,'changedPlainKeys':sorted(set(out)-set(secret_keys))}
            r.target['publicUrl']='https://app.rehearsal.invalid';r.target['overrides']=isolated
            r.args.environment='production'
            try:r.configuration()
            finally:r.args.environment='uat'
            for service in m.SERVICES:
                current=m.read(r.work/'capture'/(service+'.configuration.json'))['primaryContainer']
                for item in current.get('secrets',[]):
                    key=item['name'];m.require(key in replacements and r.envs[service][key]==replacements[key], 'A Production secret escaped isolation')
                m.require(not any(k.startswith('AWS_ACCESS_KEY') or k=='AWS_SECRET_ACCESS_KEY' for k in r.envs[service]),'No static AWS credentials permitted')
            r.receipt['configurationDifferences']=differences
            # Test-only CA mount; shared controller code and runtime image files remain unchanged.
            def remote(h, command, **kwargs):
                command=list(command)
                if command[:3]==['docker','run','--rm']:
                    command[3:3]=['-v',remote_dir+'/tls/ca.pem:'+tls_path+':ro']
                return base_remote(h,command,**kwargs)
            r.remote=remote
            r.render()
            for service in m.SERVICES:
                path=r.work/'native'/service/'config/deploy.yml';config=m.read(path)
                config['volumes']=[remote_dir+'/tls/ca.pem:'+tls_path+':ro'];m.write(path,config)
                r.kamal(service,['config'],fake=True)
        with r.phase('publish-four-images-and-pull-exact-artifacts'):r.publish()
        with r.phase('production-config-freshness-before-mutation'):
            m.require(hashlib.sha256(Path(__file__).read_bytes()).hexdigest()==r.receipt['rehearsalScriptSha256'],'Rehearsal controller changed')
            r.args.environment='production'
            try:r.config_freshness()
            finally:r.args.environment='uat'
        with r.phase('actual-normal-database-sync-and-authority'):r.migrations()
        with r.phase('native-kamal-rollout-and-complete-readback'):r.deploy()
        with r.phase('final-deep-health-frontend-and-error-scan'):
            r.receipt['finalRuntimeReadback']={s:r.inspect_service(s) for s in m.SERVICES}
            for service in m.SERVICES:
                r.deep_health(service)
                name=r.receipt['finalRuntimeReadback'][service][0]['containerName']
                raw=base_remote(host,['sh','-c','docker logs '+name+' 2>&1'])
                (r.work/(service+'-runtime.log')).write_text(r.redact(raw))
                errors=[]
                for line in raw.splitlines():
                    try:event=json.loads(line)
                    except ValueError:continue
                    level=event.get('level')
                    if level=='error' or isinstance(level,int) and level>=50:errors.append(event.get('event',event.get('msg','error')))
                r.receipt.setdefault('runtimeErrorEvents',{})[service]=errors
            m.require(not any(r.receipt['runtimeErrorEvents'].values()),'Runtime error events found; inspect retained logs')
            api=r.receipt['finalRuntimeReadback']['api-web'][0]['containerName']
            proof="fetch('http://kamal-proxy/login').then(async r=>{if(!r.ok||!(await r.text()).includes('__next'))throw Error('frontend');console.log('frontend available')}).catch(()=>process.exit(1))"
            r.receipt['frontendAvailable']=base_remote(host,['docker','exec',api,'node','-e',proof]).strip()=='frontend available'
            m.require(r.receipt['frontendAvailable'],'Frontend not available through native proxy')
            gate="fetch('http://kamal-proxy/api/v1/auth/platform-access').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(()=>process.exit(1))"
            r.receipt['observedSyntheticCustomerGate']=json.loads(base_remote(host,['docker','exec',api,'node','-e',gate]))
        r.receipt['status']='PASSED_ISOLATED_CLOUD_CORE_REHEARSAL_NOT_PRODUCTION_ACCEPTANCE'
    except BaseException as error:
        r.receipt['status']='FAILED_CLOUD_REHEARSAL';r.receipt['error']=r.redact(str(error))
        for name in [db_name,redis_name]:
            try:
                raw=base_remote(host,['sh','-c','docker inspect --format "{{json .State}}" '+name+'; docker logs --tail 80 '+name+' 2>&1'])
                (r.work/(name+'-failure.log')).write_text(r.redact(raw))
            except Exception:pass
    finally:
        if deploy_clock is not None:r.receipt['deployElapsedSeconds']=round(time.monotonic()-deploy_clock,3)
        r.receipt['deployFinishedAt']=datetime.now(timezone.utc).isoformat()
        cleanup_clock=time.monotonic()
        try:r.release_remote_lock()
        except Exception:r.receipt['remoteLockReleaseFailed']=True
        # Owner explicitly requires immediate shutdown after success or failure, not a later manual reminder.
        try:
            base_remote(host,['sudo','systemctl','poweroff','--no-block']);r.receipt['shutdownRequested']=True
        except Exception:r.receipt['shutdownRequested']='CONNECTION_ENDED_VERIFY_WITH_AWS'
        r.receipt['retainedState']='Private synthetic fixtures and release containers on the stopped existing Dev volume; no Production data'
        r.receipt['shutdownAndLockCleanupSeconds']=round(time.monotonic()-cleanup_clock,3)
        r.receipt['commandElapsedSecondsIncludingSetupAndShutdown']=round(time.monotonic()-command_clock,3)
        r.save()
        print(json.dumps({'status':r.receipt['status'],'deployElapsedSeconds':r.receipt.get('deployElapsedSeconds'),
            'setupElapsedSeconds':r.receipt.get('setupElapsedSeconds'),'result':str(r.work/'result.json')}),flush=True)
    return 0 if r.receipt['status'].startswith('PASSED_') else 1


if __name__=='__main__':raise SystemExit(main())

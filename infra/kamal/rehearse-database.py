#!/usr/bin/env python3
"""Exercise the real release DB sequence on isolated PostgreSQL, never a live database."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile
import time

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--baseline-ref', required=True, help='Exact deployed source SHA; not proof of its live DB ledger')
    parser.add_argument('--postgres-image', required=True, help='Official postgres image matching the observed engine')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runtime-baseline', type=Path, help='Optional capture-config directory; secret REFERENCES only, values are regenerated')
    parser.add_argument('--redis-image', help='Existing local Redis image for optional isolated runtime checks')
    parser.add_argument('--tls', action='store_true', help='Require verified database/cache TLS with a disposable rehearsal CA')
    args = parser.parse_args()
    release.require(not args.runtime_baseline or args.redis_image, 'Runtime checks require an explicit Redis image')
    release.require(re.fullmatch(r'[0-9a-f]{40}', args.baseline_ref), 'Baseline must be an exact source SHA')
    release.require(re.fullmatch(r'postgres:\d+\.\d+-alpine', args.postgres_image), 'Use an exact official PostgreSQL version')
    manifest = release.read(args.manifest)
    release.require(release.digest({k:v for k,v in manifest.items() if k != 'releaseId'}) == manifest['releaseId'], 'Manifest changed')
    artifact = manifest['artifacts']['tools']
    info = json.loads(subprocess.check_output(['docker','image','inspect',artifact['tag']], text=True))[0]
    release.require(info['Id'] == artifact['imageId'], 'Tools image changed')
    release.require(info['Config']['Labels']['org.opencontainers.image.revision'] == manifest['sourceCommit'], 'Wrong source image')
    args.output = args.output.resolve()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    name = 'kamal-prod-rehearsal-' + secrets.token_hex(6)
    password = secrets.token_hex(32)
    env = {'DATABASE_URL': f'postgresql://proof:{password}@{name}:5432/proof?schema=public',
           'APP_ENV':'production','DEPLOY_ENVIRONMENT':'production','GIT_SHA':manifest['sourceCommit'],
           'SERVICE_VERSION':manifest['sourceCommit'],'AWS_EC2_METADATA_DISABLED':'true','REQUIRE_NO_AWS_CREDENTIALS':'true'}
    if args.tls:
        env['DATABASE_URL'] += '&sslmode=verify-full&sslrootcert=/etc/ssl/certs/aws-rds-global-bundle.pem&connection_limit=10'
        env['NODE_EXTRA_CA_CERTS'] = '/etc/ssl/certs/aws-rds-global-bundle.pem'
    clock = time.monotonic()
    result = {'status':'RUNNING','scope':'Isolated local engine/catalog upgrade; no AWS, customer data, real Production DB or rollout',
              'baselineSource':args.baseline_ref,'candidateSource':manifest['sourceCommit'],
              'postgresImage':args.postgres_image,'toolsImageId':info['Id'],'phases':[],
              'baselineIsLiveDatabaseSnapshot':False,'cloudDeploymentExecuted':False}
    network_created = False
    containers = [name+'-tools',name]
    redacted_values = {password}
    calls = []

    def command(argv, *, environment=None, stdin='', timeout=300, label='command'):
        started = time.monotonic()
        run = subprocess.run(argv, env=dict(os.environ, **(environment or {})), input=stdin,
                             text=True, capture_output=True, timeout=timeout)
        log = run.stdout + run.stderr
        for value in redacted_values: log = log.replace(value,'[REDACTED]')
        (args.output/(str(len(calls))+'-'+label+'.log')).write_text(log)
        calls.append({'command':argv,'exitCode':run.returncode,'elapsedSeconds':round(time.monotonic()-started,3)})
        release.require(run.returncode == 0, label+' failed; inspect retained local log')
        return run.stdout

    def phase(name, fn, expected_rejection=False):
        started = time.monotonic(); first = len(calls)
        try:
            fn()
            release.require(not expected_rejection, 'Expected migration refusal did not occur')
            state = 'PASSED'
        except Exception as error:
            if expected_rejection and len(calls) == first+1 and calls[-1]['exitCode'] != 0:
                state = 'EXPECTED_REJECTION'
            else:
                result['phases'].append({'name':name,'status':'FAILED','error':str(error).replace(password,'[REDACTED]'),
                    'elapsedSeconds':round(time.monotonic()-started,3),'commands':calls[first:]})
                raise
        row = {'name':name,'status':state,'elapsedSeconds':round(time.monotonic()-started,3),'commands':calls[first:]}
        result['phases'].append(row); print(json.dumps({k:v for k,v in row.items() if k != 'commands'}),flush=True)

    try:
        tls_mount = []
        postgres_options = []
        if args.tls:
            tls = args.output/'tls.private'; tls.mkdir(mode=0o700)
            command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                '-subj','/CN=Disposable rehearsal CA','-keyout',str(tls/'ca.key'),'-out',str(tls/'ca.pem')],label='tls-ca')
            command(['openssl','req','-newkey','rsa:2048','-nodes','-subj','/CN='+name,
                '-keyout',str(tls/'server.key'),'-out',str(tls/'server.csr')],label='tls-csr')
            (tls/'extensions').write_text('subjectAltName=DNS:'+name+',DNS:'+name+'-redis\nextendedKeyUsage=serverAuth\n')
            command(['openssl','x509','-req','-in',str(tls/'server.csr'),'-CA',str(tls/'ca.pem'),
                '-CAkey',str(tls/'ca.key'),'-CAcreateserial','-days','1','-extfile',str(tls/'extensions'),
                '-out',str(tls/'server.crt')],label='tls-cert')
            (tls/'server.key').chmod(0o600); (tls/'ca.key').chmod(0o600)
            (tls/'pg_hba.conf').write_text('local all all trust\nhostnossl all all all reject\nhostssl all all all scram-sha-256\n')
            tls_mount = ['-v',str(tls/'ca.pem')+':/etc/ssl/certs/aws-rds-global-bundle.pem:ro']
            postgres_options = ['sh','-c','cp /proof/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && '
                'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/proof/server.crt '
                '-c ssl_key_file=/tmp/server.key -c hba_file=/proof/pg_hba.conf']
            result['tlsScope'] = 'Same verify-full DB URL options and rediss with trusted CA; disposable CA replaces AWS CA. This does not prove AWS networking, certificate chain or HA.'
        archive = subprocess.check_output(['git','archive',args.baseline_ref,'apps/api/prisma/migrations'], cwd=release.ROOT)
        baseline = args.output/'baseline'
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(baseline, filter='data')
        result['baselineMigrationArchiveSha256'] = hashlib.sha256(archive).hexdigest()
        subprocess.run(['docker','network','create','--internal',name], check=True, capture_output=True)
        network_created = True
        network = json.loads(subprocess.check_output(['docker','network','inspect',name], text=True))[0]
        release.require(network['Internal'] is True, 'Test network must have no external route')
        command(['docker','run','-d','--name',name,'--network',name,'--label','mangmee-rehearsal='+name,
                 '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=proof','--env','POSTGRES_DB=proof']+
                 (['-v',str(tls)+':/proof:ro'] if args.tls else [])+[args.postgres_image]+postgres_options,
                environment={'POSTGRES_PASSWORD':password}, label='postgres-start')
        for _ in range(60):
            if subprocess.run(['docker','exec',name,'pg_isready','-U','proof'], capture_output=True).returncode == 0: break
            time.sleep(0.5)
        else: raise RuntimeError('PostgreSQL did not become ready')
        result['databaseVersion'] = command(['docker','exec',name,'psql','-U','proof','-d','proof','-Atc','SHOW server_version'], label='engine').strip()
        result['setupSeconds'] = round(time.monotonic()-clock,3)
        tool_args = ['docker','run','--rm','--name',name+'-tools','--platform','linux/amd64','--network',name]+tls_mount
        for key in env: tool_args += ['--env',key]
        phase('bootstrap-deployed-source-schema', lambda:command(tool_args+['-v',str(baseline/'apps/api/prisma/migrations')+':/app/apps/api/prisma/migrations:ro',
            '--entrypoint','./node_modules/.bin/prisma',artifact['tag'],'migrate','deploy','--schema','prisma/schema.prisma'], environment=env, label='bootstrap'))
        r = release.Release.__new__(release.Release)
        r.args = argparse.Namespace(mode='hotfix'); r.envs = {'api-web':env}; r.images = {'tools':artifact}
        r.target = {'hosts':{'api-web':[{'instanceId':name}]}}; r.receipt = {}

        def local_remote(host, argv, *, environment, stdin, timeout):
            release.require(host['instanceId'] == name and argv[:3] == ['docker','run','--rm'], 'Unexpected transport')
            argv = list(argv); argv[argv.index('--network')+1] = name
            argv[2:2] = ['--name',name+'-tools','--platform','linux/amd64']+tls_mount
            return command(argv, environment=environment, stdin=stdin, timeout=timeout, label='release-db')

        r.remote = local_remote
        if args.tls:
            def verified_tls():
                query = "const {PrismaPg}=require('@prisma/adapter-pg');const {PrismaClient}=require('./src/generated/prisma/client');const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});(async()=>{try{const rows=await db.$queryRawUnsafe('SELECT ssl, version FROM pg_stat_ssl WHERE pid=pg_backend_pid()');if(rows.length!==1||!rows[0].ssl)throw Error('TLS absent');console.log(JSON.stringify(rows[0]));}finally{await db.$disconnect();}})().catch(()=>process.exit(1));"
                result['databaseTls'] = json.loads(r.tool(['./node_modules/.bin/tsx','--eval',query]))
            phase('actual-client-verified-database-tls', verified_tls)
        phase('hotfix-refuses-pending-source-migrations', r.migrations, expected_rejection=True)
        r.args.mode = 'normal'
        phase('actual-normal-release-database-and-authority', r.migrations)
        r.args.mode = 'hotfix'
        phase('actual-hotfix-after-normal-upgrade', r.migrations)
        if args.runtime_baseline:
            def runtimes():
                redis_name = name+'-redis'; containers.append(redis_name)
                redis_password = secrets.token_hex(32); redacted_values.add(redis_password)
                redis_config = args.output/'redis.private.conf'
                redis_config.write_text('bind 0.0.0.0\nrequirepass '+redis_password+'\n'+(
                    'port 0\ntls-port 6379\ntls-cert-file /proof/tls/server.crt\ntls-key-file /proof/tls/server.key\n'
                    'tls-ca-cert-file /proof/tls/ca.pem\ntls-auth-clients no\n' if args.tls else '')); redis_config.chmod(0o600)
                command(['docker','run','-d','--name',redis_name,'--network',name,'--user','0',
                    '-v',str(redis_config)+':/proof/redis.conf:ro']+(['-v',str(tls)+':/proof/tls:ro'] if args.tls else [])+
                    [args.redis_image,'redis-server','/proof/redis.conf'], label='redis-start')
                result['redisVersion'] = command(['docker','exec',redis_name,'redis-server','--version'],label='redis-version').strip()
                result['runtimeScope'] = ('Real images and production validators; synthetic secrets, isolated empty data. '+
                    ('Database/cache TLS with disposable trusted CA. ' if args.tls else 'Plain database/cache transport. ')+
                    'AWS/provider, object storage, antivirus, external journeys, public HTTPS and HA are not exercised.')
                shared = {'DATABASE_URL':env['DATABASE_URL'], 'REDIS_URL':f'{"rediss" if args.tls else "redis"}://:{redis_password}@{redis_name}:6379'}
                expected = {}; overrides = release.read(release.ROOT/'infra/kamal/config.json')['production']
                api = name+'-api-web'; ai = name+'-ai-gateway'
                for service in release.SERVICES:
                    baseline = release.read(args.runtime_baseline/(service+'.configuration.json'))['primaryContainer']
                    values = {x['name']:x['value'] for x in baseline['environment']}
                    original = dict(values)
                    for ref in baseline.get('secrets',[]):
                        key = ref['name']; shared.setdefault(key,secrets.token_hex(32)); values[key] = shared[key]
                        redacted_values.add(shared[key])
                    for key,value in list(values.items()):
                        if value.startswith(('http://','https://')): values[key] = 'https://app.rehearsal.invalid'
                        elif value.startswith('arn:aws:'): values[key] = value.replace(release.ACCOUNT,'000000000000').replace('/production/','/rehearsal/')
                    for key,value in overrides.get(service,{}).items():
                        if value is None: values.pop(key,None)
                        else: values[key] = value
                    values.update(GIT_SHA=manifest['sourceCommit'], SERVICE_VERSION=manifest['sourceCommit'],
                                  AWS_EC2_METADATA_DISABLED='true',PUBLIC_BASE_URL='https://app.rehearsal.invalid')
                    if args.tls: values['NODE_EXTRA_CA_CERTS'] = env['NODE_EXTRA_CA_CERTS']
                    if 'S3_BUCKET' in values: values['S3_BUCKET'] = name
                    if service == 'api-web':
                        values.update(INTERNAL_API_URL='http://127.0.0.1:3001/v1', AI_GATEWAY_INTERNAL_URL=f'http://{ai}:3002/v1',
                                      CLAMAV_HOST='clamav.rehearsal.invalid',SES_FROM_ADDRESS='sender@rehearsal.invalid')
                    elif service == 'ai-gateway':
                        values.update(ERP_CORE_INTERNAL_URL=f'http://{api}:3000/v1',AGENTCORE_EXPECTED_SOURCE_COMMIT=manifest['sourceCommit'],
                                      AGENTCORE_EXPECTED_ARTIFACT_SHA256=manifest['agentcore']['sha256'])
                    else: values['INTERNAL_API_URL'] = f'http://{api}:3000/v1'
                    expected[service] = values
                    result.setdefault('runtimeConfigDifferences',{})[service] = {
                        'regeneratedSecretKeys':[x['name'] for x in baseline.get('secrets',[])],
                        'changedPlainKeys':sorted(k for k in set(values)|set(original) if k not in shared and values.get(k)!=original.get(k))}
                    validation = json.loads(command(['docker','run','--rm','-i','--platform','linux/amd64','--network','none',
                        '-v',str(release.HELPERS/'verify-config.mjs')+':/proof/verify-config.mjs:ro','--entrypoint','node',
                        manifest['artifacts'][service]['tag'],'/proof/verify-config.mjs'],
                        stdin=json.dumps({'service':service,'sourceCommit':manifest['sourceCommit'],'environment':values}), label='config-'+service))
                    release.require(validation['passed'], 'Runtime config failed: '+service)
                r.envs = expected
                def runtime_remote(host, argv, *, stdin='', **kwargs):
                    release.require(host['instanceId']==name and argv[:2]==['docker','exec'] and argv[3] in containers,'Unexpected runtime probe')
                    return command(argv,stdin=stdin,label='readiness')
                r.remote = runtime_remote
                for service in release.ORDER:
                    container = name+'-'+service; containers.append(container)
                    limits = release.read(args.runtime_baseline/(service+'.configuration.json'))
                    argv = ['docker','run','-d','--init','--name',container,'--platform','linux/amd64','--network',name,
                            '--cpus',str(int(limits['cpu'])/1024),'--memory',str(limits['memory'])+'m']+tls_mount
                    for key in expected[service]: argv += ['--env',key]
                    command(argv+[manifest['artifacts'][service]['tag']], environment=expected[service],label='start-'+service)
                    # Match Release.deploy: each service passes deep readiness before the next starts.
                    port = 3002 if service=='ai-gateway' else int(expected[service].get('PORT','3000'))
                    url = f'http://127.0.0.1:{port}/v1/health'
                    for _ in range(60):
                        ready = subprocess.run(['docker','exec',container,'node','-e',
                            "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",url],capture_output=True)
                        if ready.returncode == 0: break
                        time.sleep(0.5)
                    r.deep_health(service,name=container,hosts=[{'instanceId':name}])
                health_errors = []
                for service in release.SERVICES:
                    container = name+'-'+service
                    try:
                        observed = json.loads(command(['docker','inspect',container],label='inspect-'+service))[0]
                        base_image = json.loads(subprocess.check_output(['docker','image','inspect',manifest['artifacts'][service]['tag']],text=True))[0]
                        base_env = dict(x.split('=',1) for x in base_image['Config'].get('Env',[]))
                        proof = release.inspect_container(manifest,service,expected[service],observed,base_env)
                        r.deep_health(service,name=container,hosts=[{'instanceId':name}])
                        result.setdefault('runtimeReadback',{})[service] = proof
                    except Exception as error: health_errors.append(service+': '+str(error))
                    finally:
                        log = subprocess.run(['docker','logs',container],text=True,capture_output=True)
                        text = log.stdout+log.stderr
                        for value in redacted_values: text = text.replace(value,'[REDACTED]')
                        (args.output/(service+'-runtime.log')).write_text(text)
                        errors = []
                        for line in text.splitlines():
                            try: event = json.loads(line)
                            except ValueError: continue
                            level = event.get('level')
                            if level=='error' or isinstance(level,int) and level>=50:
                                errors.append(event.get('event',event.get('msg','unclassified-error')))
                        result.setdefault('runtimeErrorEvents',{})[service] = errors
                        if errors: health_errors.append(service+': runtime emitted '+str(len(errors))+' errors')
                result['readiness'] = r.receipt.get('readiness',{})
                release.require(not health_errors, '; '.join(health_errors))
                frontend = command(['docker','exec',api,'node','-e',
                    "fetch('http://127.0.0.1:3000/login').then(async r=>{if(!r.ok||!(await r.text()).includes('__next'))throw Error('frontend');console.log('frontend available')}).catch(()=>process.exit(1))"],label='frontend')
                result['frontendAvailable'] = frontend.strip() == 'frontend available'
            phase('actual-images-production-config-and-runtime-readiness',runtimes)
        result['status'] = 'PASSED_LOCAL_DATABASE_REHEARSAL'
    except Exception as error:
        result.update(status='FAILED_LOCAL_DATABASE_REHEARSAL', error=str(error).replace(password,'[REDACTED]'))
    finally:
        if network_created:
            for container in reversed(containers): subprocess.run(['docker','rm','-fv',container], capture_output=True)
            result['cleanupPassed'] = subprocess.run(['docker','network','rm',name], capture_output=True).returncode == 0
        result['elapsedSecondsIncludingSetupAndCleanup'] = round(time.monotonic()-clock,3)
        release.write(args.output/'result.json', result)
        print(json.dumps({'status':result['status'],'result':str(args.output/'result.json')}),flush=True)
    return 0 if result['status'] == 'PASSED_LOCAL_DATABASE_REHEARSAL' and result.get('cleanupPassed') else 1


if __name__ == '__main__':
    raise SystemExit(main())

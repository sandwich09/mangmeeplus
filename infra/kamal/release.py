#!/usr/bin/env python3
"""Fresh main -> complete config/artifacts -> native Kamal -> verified customer access.

Default is read-only preflight. --apply is a deployment, never an infrastructure bootstrap.
A target must be enrolled under .env.kamal/<environment>/target.json before first use.
"""
import argparse
import concurrent.futures
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import http.cookiejar
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
HELPERS = ROOT / 'infra/dev-kamal'
sys.path.insert(0, str(HELPERS))
from release_inventory import SERVICES, digest, inspect_container, require

KAMAL = 'ghcr.io/basecamp/kamal:v2.12.0'
ORDER = ('ai-gateway', 'api-web', 'workers')
ACCOUNT = '311414082667'
REGION = 'ap-southeast-1'
CONTROLLER_FILES = tuple('infra/kamal/'+p for p in ('release.py','config.json','retire-builds.cjs','deploy-uat','deploy-prod')) + tuple('infra/dev-kamal/'+p for p in ('build-complete.py','capture-config.py','release_inventory.py','verify-config.mjs','Dockerfile.tools'))

def controller_manifest():
    return {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in CONTROLLER_FILES}

def local_uat_controller(target, requested, actual):
    if requested:
        require(target['kind']=='uat' and target['environment']=='uat', 'Local controller test is UAT-only')
        require(requested==actual, 'Local UAT controller hash mismatch')
        return True
    return False


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(path.suffix + '.tmp')
    with os.fdopen(os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')
    os.replace(temp, path)


def validate_target(t, environment):
    require(t.get('schemaVersion') == 1, 'Unsupported target schema')
    require(t.get('environment') == environment, 'Target environment mismatch')
    require(t.get('account') == ACCOUNT and t.get('region') == REGION, 'Wrong AWS account/region')
    require(t.get('kind') in ('production', 'uat', 'dev'), 'Invalid target kind')
    require(t['kind'] != 'production' or environment == 'production', 'Production target cannot use UAT configuration')
    require(environment != 'production' or t['kind'] == 'production', 'Production cannot target dev/UAT')
    require(set(t.get('hosts', {})) == set(SERVICES), 'Every service needs enrolled hosts')
    for service, hosts in t['hosts'].items():
        require(hosts, service + ': no enrolled hosts')
        require(len({h['instanceId'] for h in hosts}) == len(hosts), 'Duplicate host')
        for h in hosts:
            require(re.fullmatch(r'i-[0-9a-f]+', h['instanceId']), 'Invalid instance ID')
            ipaddress.ip_address(h['address'])
            require(re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+', h['hostKey']), 'Enrolled SSH host key missing')
            require(h.get('stack'), 'Expected stack missing')
            if environment == 'production':
                require(h['instanceId'] != 'i-0883f1ff88440ca07' and 'dev' not in h['stack'].lower()
                        and 'uat' not in h['stack'].lower(), 'Production host points at dev/UAT')
            else:
                require('prod' not in h['stack'].lower(), 'UAT/dev cannot target a Production stack')
    for key in ('publicUrl', 'apiInternalUrl', 'aiInternalUrl'):
        url = urllib.parse.urlsplit(t[key])
        require(url.scheme in ('https', 'http') and url.hostname and not url.username and not url.password,
                'Invalid target URL: ' + key)
        if t['kind'] != 'dev':
            require(url.scheme == 'https' and not any(x in url.hostname for x in ('localhost', 'trycloudflare.com', 'invalid')),
                    'Enrolled environments require permanent HTTPS endpoints: ' + key)
        if environment == 'production':
            require('uat' not in url.hostname.lower() and 'dev' not in url.hostname.lower(), 'Foreign Production URL')
    if environment == 'production':
        require(t.get('cutoverComplete') is True, 'Production Kamal traffic migration has not been enrolled as complete')
        require(len(t['hosts']['api-web']) >= 2, 'Production requires at least two API hosts')
    if t['kind'] != 'dev':
        api_ids = {h['instanceId'] for h in t['hosts']['api-web']}
        require(not api_ids & {h['instanceId'] for s in ('ai-gateway', 'workers') for h in t['hosts'][s]},
                'Service IAM boundaries require separate API and AI/worker hosts')
        require(t.get('signingKeyArn', '').startswith(f'arn:aws:kms:{REGION}:{ACCOUNT}:key/'), 'Receipt signing key is missing')
    repository = t.get('repository', '')
    require(re.fullmatch(r'[a-z0-9][a-z0-9/_-]+', repository), 'Invalid ECR repository')
    require(environment != 'production' or not any(x in repository for x in ('dev', 'uat')), 'Foreign Production registry')
    require(re.fullmatch(r'mangmee-[a-z0-9-]+', t.get('servicePrefix', '')), 'Invalid Kamal service prefix')
    if environment!='production':
        require('prod' not in repository and 'prod' not in t['servicePrefix'], 'UAT/dev cannot use a Production registry/service')
    if t['kind'] != 'dev':
        require(not t.get('overrides'), 'Use tracked config.json for environment changes; private overrides are dev-only')
    return t


def native_config(target, service, env, source, directory):
    role = {'hosts': [h['address'] for h in target['hosts'][service]]}
    if service=='ai-gateway':
        # Node as PID 1 otherwise ignores default SIGTERM and consumes the full stop timeout.
        role['options']={'init':True}
    if target['kind'] == 'dev':
        role.setdefault('options',{})['network-alias'] = ('api' if service == 'api-web' else 'ai' if service == 'ai-gateway' else 'workers') + '-' + source[:12]
    if service == 'workers':
        role['proxy'] = False
    name = target['servicePrefix'] + ('' if service == 'api-web' else '-' + service)
    config = {'service': name, 'image': target['repository'], 'servers': {'web': role},
        'ssh': {'user': 'ubuntu', 'keys': ['/workdir/id_ed25519'], 'keys_only': True,
                'config': '/workdir/ssh_config', 'forward_agent': False},
        'registry': {'server': f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com', 'username': 'AWS', 'password': ['KAMAL_REGISTRY_PASSWORD']},
        'builder': {'arch': 'amd64'}, 'deploy_timeout': 90, 'drain_timeout': 180, 'stop_timeout': 180,
        'retain_containers': 3, 'env': {'secret': sorted(env)}}
    if service == 'api-web':
        config.update(asset_path='/app/web-runtime/apps/web/.next/static',
            proxy={'app_port': 3000, 'response_timeout': 180, 'forward_headers': True,
                   'healthcheck': {'path': '/v1/health', 'interval': 1, 'timeout': 5}})
    elif service == 'ai-gateway':
        config['proxy'] = {'app_port': 3002, 'response_timeout': 180,
            'healthcheck': {'path': '/v1/health', 'interval': 1, 'timeout': 5}}
        if target['kind'] == 'dev':
            config['proxy']['path_prefix'] = '/__kamal_ai'
        # Dedicated real AI hosts also accept ALB health checks whose Host is the target IP.
    # No fixed host port on the app container: native proxy owns routing/draining.
    return config


def make_overrides(target, source, artifact, configured):
    overrides = {s: dict(configured[s]) for s in SERVICES}
    for s, values in target.get('overrides', {}).items():
        require(s in SERVICES, 'Unknown override service')
        overrides[s].update(values)
    base = target['publicUrl'].rstrip('/')
    api, ai = target['apiInternalUrl'], target['aiInternalUrl']
    if target['kind'] == 'dev':
        api, ai = 'http://kamal-proxy/v1', 'http://kamal-proxy/__kamal_ai/v1'
    for values in overrides.values():
        values.update(PUBLIC_BASE_URL=base)
    overrides['api-web'].update(INTERNAL_API_URL='http://127.0.0.1:3001/v1', AI_GATEWAY_INTERNAL_URL=ai)
    overrides['workers']['INTERNAL_API_URL'] = api
    overrides['ai-gateway'].update(ERP_CORE_INTERNAL_URL=api, AGENTCORE_EXPECTED_SOURCE_COMMIT=source,
        AGENTCORE_EXPECTED_ARTIFACT_SHA256=artifact, AGENTCORE_RUNTIME_QUALIFIER=target['agentcoreQualifier'],
        AGENTCORE_RUNTIME_ARN=target['agentcoreRuntimeArn'])
    if target['kind'] == 'dev':
        for s in ('api-web', 'ai-gateway'):
            overrides[s].update(CORS_ALLOWED_ORIGINS=base, WATCHDOG_JWT_ISSUER=base)
    return overrides


class Release:
    def __init__(self, args):
        self.args = args
        self.clock = time.monotonic()
        self.id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        self.state = ROOT / '.env.kamal' / args.environment
        target_path = args.target or self.state / 'target.json'
        require(target_path.exists(), 'Target is not enrolled: ' + str(target_path) + '; see infra/kamal/README.md')
        self.target = validate_target(read(target_path), args.environment)
        self.manual_browser = bool(args.uat_browser_acceptance)
        self.smoke_acceptance = bool(getattr(args, 'uat_smoke_acceptance', False))
        self.validate_acceptance_target()
        self.work = self.state / 'runs' / self.id
        self.work.mkdir(parents=True, mode=0o700)
        self.receipt = {'schemaVersion': 1, 'operationId': self.id, 'environment': args.environment,
            'kind': self.target['kind'], 'mode': args.mode, 'startedAt': datetime.now(timezone.utc).isoformat(),
            'status': 'RUNNING', 'phases': [], 'lineAcceptance': 'DEFERRED_BY_OWNER', 'productionMutated': False}
        self.receipt['controllerManifest'] = controller_manifest()
        self.receipt['controllerSha256'] = digest(self.receipt['controllerManifest'])
        self.local_uat_test = local_uat_controller(self.target, args.uat_controller_sha256, self.receipt['controllerSha256'])
        if self.local_uat_test: self.receipt['controllerScope'] = 'owner-requested local controller test on real UAT; application from main'
        self.secrets = set()
        self.aws_prefix = ['aws', '--region', REGION]
        if args.profile:
            self.aws_prefix += ['--profile', args.profile]
        self.hosts = {h['instanceId']: h for rows in self.target['hosts'].values() for h in rows}
        self.changed = []
        self.remote_lock_owned = False
        self.save()

    def save(self):
        self.receipt['elapsedSeconds'] = round(time.monotonic() - self.clock, 3)
        write(self.work / 'result.json', self.receipt)

    def redact(self, value):
        for secret in sorted(self.secrets, key=len, reverse=True):
            if len(secret) >= 8:
                value = value.replace(secret, '[REDACTED]')
        return value

    def command(self, args, *, input=None, env=None, timeout=120, cwd=None, log=None):
        try:
            r = subprocess.run(args, input=input, env=env, cwd=cwd, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Command timed out; outcome may be unknown; no automatic mutation retry: ' + str(args[0]))
        if log:
            (self.work / (log + '.log')).write_text(self.redact(r.stdout + r.stderr))
        require(r.returncode == 0, (log or str(args[0])) + ': command failed; raw output suppressed')
        return r.stdout

    def aws(self, args, **kwargs):
        try:
            return json.loads(self.command(self.aws_prefix + args + ['--output', 'json'], **kwargs))
        except (ValueError, RuntimeError) as error:
            raise RuntimeError('AWS '+':'.join(args[:2])+' failed; no automatic mutation retry') from error

    @contextmanager
    def phase(self, name):
        row = {'name': name, 'startedSeconds': round(time.monotonic() - self.clock, 3), 'status': 'RUNNING'}
        self.receipt['phases'].append(row)
        self.save()
        print(name, flush=True)
        start = time.monotonic()
        try:
            yield
            row['status'] = 'PASSED'
        except BaseException:
            row['status'] = 'FAILED'
            raise
        finally:
            row.update(elapsedSeconds=round(time.monotonic()-start, 3), endedSeconds=round(time.monotonic()-self.clock, 3))
            self.save()

    def remote(self, host, command, *, environment=None, stdin='', timeout=180):
        runner = "import json,os,subprocess,sys;p=json.load(sys.stdin);r=subprocess.run(p['command'],env=dict(os.environ,**p['environment']),input=p['stdin'],text=True,capture_output=True,timeout=p['timeout']);print(json.dumps({'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}))"
        ssh = ['ssh', '-i', str(Path(self.target['sshKey']).expanduser().resolve()), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'UserKnownHostsFile=' + str(self.work/'known_hosts'), '-o', 'ConnectTimeout=10']
        if self.target.get('sshProxyCommand'):
            ssh += ['-o', 'ProxyCommand=' + self.target['sshProxyCommand']]
        data = self.command(ssh + ['ubuntu@'+host['address'], 'python3 -c '+shlex.quote(runner)],
            input=json.dumps({'command':command,'environment':environment or {},'stdin':stdin,'timeout':timeout}), timeout=timeout+30)
        result = json.loads(data)
        if result['exitCode']:
            write(self.work/'remote-failure.private.json', {'instanceId':host['instanceId'], **result})
        require(result['exitCode'] == 0, 'Remote command failed on ' + host['instanceId'] + '; output suppressed')
        return result['stdout']

    def preflight(self):
        who = self.aws(['sts','get-caller-identity'])
        require(who['Account'] == ACCOUNT and not who['Arn'].endswith(':root'), 'Expected account-scoped non-root principal')
        self.receipt['principalArn'] = who['Arn']
        infos = self.aws(['ec2','describe-instances','--instance-ids',*self.hosts])
        actual = {h['InstanceId']:h for r in infos['Reservations'] for h in r['Instances']}
        require(set(actual) == set(self.hosts), 'Incomplete EC2 readback')
        for iid, h in self.hosts.items():
            info = actual[iid]
            tags = {t['Key']:t['Value'] for t in info.get('Tags',[])}
            require(info['State']['Name'] == 'running' and tags.get('aws:cloudformation:stack-name') == h['stack']
                    and info['VpcId'] == h['vpcId'] and h['address'] in (info.get('PublicIpAddress'),info.get('PrivateIpAddress')),
                    'Host identity/state changed: ' + iid)
            require(info.get('IamInstanceProfile') and info['MetadataOptions']['HttpTokens'] == 'required'
                    and info['MetadataOptions']['HttpPutResponseHopLimit'] >= 2, 'Runtime IAM/IMDS not ready: '+iid)
        if self.args.environment == 'production':
            require(len({actual[h['instanceId']]['Placement']['AvailabilityZone'] for h in self.target['hosts']['api-web']}) >= 2,
                    'Production API hosts must span at least two AZs')
        if self.target['kind'] != 'dev':
            key = self.aws(['kms','describe-key','--key-id',self.target['signingKeyArn']])['KeyMetadata']
            require(key['KeyUsage'] == 'SIGN_VERIFY' and key['KeyState'] == 'Enabled', 'Receipt signing key is not ready')
        key = Path(self.target['sshKey']).expanduser()
        require(key.is_file() and key.stat().st_mode & 0o077 == 0, 'SSH private key missing or permissions are too broad')
        (self.work/'known_hosts').write_text(''.join(h['address']+' '+h['hostKey']+'\n' for h in self.hosts.values()))
        for h in self.hosts.values():
            self.remote(h, ['sh','-c','test -w "$HOME" && test -w "$HOME/.kamal" && test -w "$HOME/.kamal/proxy" && { test ! -e "$HOME/.docker" || test -w "$HOME/.docker"; }'])
            self.remote(h, ['docker','info','--format','{{.ServerVersion}}'])
            self.remote(h, ['docker','network','inspect','kamal'])
            proxy = json.loads(self.remote(h, ['docker','inspect','kamal-proxy']))[0]
            version = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', proxy['Config']['Image'].rsplit(':', 1)[-1])
            require(proxy['State']['Running'] and version and tuple(map(int, version.groups())) >= (0, 9, 2),
                    'Kamal 2.12 requires a running proxy v0.9.2 or newer before build')
        self.aws(['ecr','describe-repositories','--repository-names',self.target['repository']])
        self.validate_acceptance_target()
        require(self.target.get('agentcoreQualifier') and self.target['agentcoreQualifier'] != 'DEFAULT', 'Use a pinned AgentCore qualifier')
        arn=self.target.get('agentcoreRuntimeArn','')
        require(arn.startswith(f'arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:runtime/'), 'Enrolled AgentCore runtime missing')
        if self.args.environment=='production':
            require('uat' not in arn and 'dev' not in arn, 'Foreign AgentCore runtime')
        ep=self.aws(['bedrock-agentcore-control','get-agent-runtime-endpoint','--agent-runtime-id',arn.rsplit('/',1)[1],
                     '--endpoint-name',self.target['agentcoreQualifier']])
        require(ep['status']=='READY','Enrolled AgentCore endpoint is not READY')
        runtime=self.aws(['bedrock-agentcore-control','get-agent-runtime','--agent-runtime-id',arn.rsplit('/',1)[1],
                  '--agent-runtime-version',ep['liveVersion']])
        if self.args.apply and not self.args.rollback:
            self.command(['git','fetch','origin','main'],cwd=ROOT,log='fetch-main')
            self.pinned_sha=self.command(['git','rev-parse','origin/main'],cwd=ROOT).strip()
            require(re.fullmatch(r'[0-9a-f]{40}',self.pinned_sha),'Invalid main source')
            if self.target['kind']!='dev' and not self.local_uat_test:
                for path in CONTROLLER_FILES:
                    committed=self.command(['git','show',self.pinned_sha+':'+path],cwd=ROOT)
                    require(committed==(ROOT/path).read_text(),'Controller differs from pinned main: '+path)
            expected={'GIT_SHA':self.pinned_sha,'ERP_CORE_INTERNAL_URL':self.provider_callback()}
            if any(runtime['environmentVariables'].get(k)!=v for k,v in expected.items()):
                require(self.target.get('agentcoreCandidateQualifier'), 'A new source requires an enrolled spare AgentCore endpoint before build')
        # No implicit authority to migrate existing ECS traffic. Production target enrollment is separate.
        self.receipt['targetVerified'] = True

    def source_and_build(self):
        sha = self.pinned_sha
        require(re.fullmatch(r'[0-9a-f]{40}',sha), 'Invalid main source')
        source = self.work/'source'
        self.command(['git','worktree','add','--detach',str(source),sha],cwd=ROOT,log='checkout-main')
        self.receipt['sourceCommit'] = sha
        self.source = source
        self.build_dir = self.work/'build'
        self.command([sys.executable,str(HELPERS/'build-complete.py'),str(source),str(self.build_dir)], timeout=1800,log='build')
        self.build = read(self.build_dir/'build-result.json')
        require(self.build['status']=='passed', 'Build/TypeScript failed')

    def configuration(self):
        capture = self.work/'capture'
        cmd=[sys.executable,str(HELPERS/'capture-config.py'),'--environment',self.args.environment,
             '--private-output',str(capture),'--evidence',str(self.work/'capture-evidence.json'),'--resolve-secrets']
        if self.args.profile: cmd += ['--profile',self.args.profile]
        else: cmd += ['--profile','']
        self.command(cmd,timeout=180,log='capture')
        for s in SERVICES:
            for k,v in read(capture/(s+'.resolved.json')).items():
                if isinstance(v,str) and any(n in k for n in ('SECRET','TOKEN','PASSWORD','KEY','DATABASE_URL','REDIS_URL')):
                    self.secrets.add(v)
        config_path = self.source/'infra/kamal/config.json'
        if (self.target['kind'] == 'dev' or self.local_uat_test) and not config_path.exists():
            config_path = ROOT/'infra/kamal/config.json'
            self.receipt['controllerConfigScope'] = 'unmerged controller rehearsal; application source remains exact main'
        require(config_path.exists(), 'Release command/config must be committed to main before an environment deployment')
        self.receipt['controllerConfigSha256'] = hashlib.sha256(config_path.read_bytes()).hexdigest()
        configured = read(config_path)[self.args.environment]
        overrides = make_overrides(self.target,self.build['sourceCommit'],self.build['agentcore']['sha256'],configured)
        self.secrets.update(v for values in overrides.values() for v in values.values() if isinstance(v,str) and len(v)>=8)
        write(self.work/'overrides.json',overrides)
        self.envdir = self.work/'environments'
        self.command([sys.executable,str(HELPERS/'release_inventory.py'),'prepare','--source',str(self.source),
            '--build',str(self.build_dir/'build-result.json'),'--capture',str(capture),'--environment',self.args.environment,
            '--overrides',str(self.work/'overrides.json'),'--private-output',str(self.envdir),'--output',str(self.work/'inventory.json')],
            timeout=180,log='config-validation')
        self.manifest=read(self.work/'inventory.json')
        self.envs={s:read(self.envdir/(s+'.environment.json')) for s in SERVICES}
        for env in self.envs.values():
            self.secrets.update(v for v in env.values() if len(v)>=16)
        # Secret URLs carry environment identity in their referenced secret IDs; dev substitutions are isolated additionally.
        require(self.envs['api-web']['DATABASE_URL']==self.envs['workers']['DATABASE_URL'], 'API/worker database mismatch')
        require(self.envs['api-web']['REDIS_URL']==self.envs['workers']['REDIS_URL'], 'API/worker Redis mismatch')
        if self.target['kind']=='dev':
            require(urllib.parse.urlsplit(self.envs['api-web']['DATABASE_URL']).path.startswith('/kamal_dev_'), 'Dev database is not isolated')
            require(urllib.parse.urlsplit(self.envs['api-web']['REDIS_URL']).path not in ('','/','/0'), 'Dev Redis is not isolated')
        self.receipt['releaseId']=self.manifest['releaseId']
        self.receipt['configSecretVersions']=self.manifest['secretVersions']

    def config_freshness(self):
        if 'controllerManifest' in self.receipt:
            require(controller_manifest()==self.receipt['controllerManifest'], 'Controller changed during release')
        cmd=[sys.executable,str(HELPERS/'capture-config.py'),'--environment',self.args.environment,
             '--private-output',str(self.work/'recapture'),'--evidence',str(self.work/'recapture-evidence.json'),
             '--profile',self.args.profile or '']
        self.command(cmd,timeout=180,log='config-freshness')
        before,after=read(self.work/'capture-evidence.json'),read(self.work/'recapture-evidence.json')
        require(before['secretVersions']==after['secretVersions'], 'Secrets rotated after capture; stop before runtime mutation')
        require({s:v['configurationSha256'] for s,v in before['services'].items()}==
                {s:v['configurationSha256'] for s,v in after['services'].items()}, 'Configuration changed after capture')
        self.receipt['configFreshnessVerifiedAt']=after['readAt']

    def render(self):
        for service in SERVICES:
            d=self.work/'native'/service
            d.mkdir(parents=True)
            shutil.copyfile(Path(self.target['sshKey']).expanduser(), d/'id_ed25519'); (d/'id_ed25519').chmod(0o600)
            shutil.copyfile(self.work/'known_hosts',d/'known_hosts')
            ssh='Host *\n  StrictHostKeyChecking yes\n  UserKnownHostsFile /workdir/known_hosts\n  IdentitiesOnly yes\n'
            if self.target.get('sshProxyCommand'): ssh+='  ProxyCommand '+self.target['sshProxyCommand']+'\n'
            (d/'ssh_config').write_text(ssh)
            write(d/'config/deploy.yml',native_config(self.target,service,self.envs[service],self.build['sourceCommit'],d))
            (d/'.kamal').mkdir()
            # Application PATH/HOME must never replace the controller or Kamal process environment.
            (d/'.kamal/secrets').write_text('KAMAL_REGISTRY_PASSWORD=$KAMAL_REGISTRY_PASSWORD\n'+
                '\n'.join(k+'=$KAMAL_APP_'+k for k in sorted(self.envs[service]))+'\n')
            self.kamal(service,['config'],fake=True)

    def kamal(self, service, command, version=None, fake=False):
        d=self.work/'native'/service
        env=dict(os.environ,KAMAL_REGISTRY_PASSWORD='synthetic' if fake else self.token)
        env.update({'KAMAL_APP_'+k:'synthetic-'+k if fake else v for k,v in self.envs[service].items()})
        args=['docker','run','--rm','-i','-v',str(d)+':/workdir']
        if fake: args+=['--network','none']
        else: args+=['-v','/var/run/docker.sock:/var/run/docker.sock']
        for k in ('KAMAL_REGISTRY_PASSWORD',*('KAMAL_APP_'+k for k in self.envs[service])): args+=['--env',k]
        args += [KAMAL,*command,'--version',version or self.version(service)]
        return self.command(args,env=env,timeout=420,log=None if fake else 'kamal-'+service+'-'+command[0])

    def version(self, service):
        if hasattr(self, 'restoring'):
            return self.restoring[service][0]['version']
        return self.build['sourceCommit']+'-'+self.id+'-'+service

    def publish(self):
        registry=f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com'
        self.token=self.command(self.aws_prefix+['ecr','get-login-password']).strip(); self.secrets.add(self.token)
        login_env=dict(os.environ,DOCKER_CONFIG=str(self.work/'registry-login'))
        self.command(['docker','login','--username','AWS','--password-stdin',registry],input=self.token,env=login_env)
        self.images={}
        try:
            for s,a in self.manifest['artifacts'].items():
                # Native service labels are target-specific; wrapper changes metadata only.
                tag=registry+'/'+self.target['repository']+':'+self.version(s)
                label=self.target['servicePrefix']+('' if s=='api-web' else '-'+s)
                self.command(['docker','build','--platform','linux/amd64','--build-arg','BASE='+a['tag'],
                    '--label','service='+label,'-t',tag,'-f','-','.'],input='ARG BASE\nFROM ${BASE}\n',cwd=self.source,timeout=180)
                info=json.loads(self.command(['docker','image','inspect',tag]))[0]
                original=json.loads(self.command(['docker','image','inspect',a['tag']]))[0]
                require(info['RootFS']==original['RootFS'], 'Publication wrapper changed runtime files')
                self.command(['docker','push',tag],env=login_env,timeout=240,log='publish-'+s)
                data=self.aws(['ecr','describe-images','--repository-name',self.target['repository'],'--image-ids','imageTag='+self.version(s)])['imageDetails']
                require(len(data)==1, 'Published digest missing')
                self.images[s]={'tag':tag,'imageId':info['Id'],'digest':data[0]['imageDigest']}
            write(self.work/'publication.json',self.images)
        finally:
            shutil.rmtree(self.work/'registry-login',ignore_errors=True)
        for h in self.hosts.values():
            self.remote(h,['docker','login','--username','AWS','--password-stdin',registry],stdin=self.token)
        for s in SERVICES:
            for h in self.target['hosts'][s]: self.remote(h,['docker','pull',self.images[s]['tag']],timeout=240)
        self.remote(self.target['hosts']['api-web'][0],['docker','pull',self.images['tools']['tag']],timeout=240)

    def tool(self, command, *, extra=None, timeout=240, stdin=''):
        env={**self.envs['api-web'],**(extra or {})}
        args=['docker','run','--rm','-i','--network','kamal']
        for k in env: args+=['--env',k]
        args+=['--entrypoint',command[0],self.images['tools']['tag'],*command[1:]]
        return self.remote(self.target['hosts']['api-web'][0],args,environment=env,stdin=stdin,timeout=timeout)

    def migrations(self):
        # The hotfix lane refuses schema deltas; the normal lane applies them explicitly.
        if self.args.mode=='hotfix':
            self.tool(['./node_modules/.bin/tsx','prisma/verify-applied-migration-catalog.ts'])
        else:
            self.tool(['./node_modules/.bin/tsx','prisma/verify-applied-migration-catalog.ts'],extra={'ALLOW_PENDING_MIGRATIONS':'true'})
            self.tool(['./node_modules/.bin/prisma','migrate','deploy','--schema','prisma/schema.prisma'])
            self.tool(['./node_modules/.bin/tsx','prisma/verify-applied-migration-catalog.ts'])
        for script, flags in [('sync-permissions.ts',[]),('sync-feature-launch-gates.ts',['--verify-specialist-closed']),
                ('sync-workflow-templates.ts',[]),('sync-thai-address-master.ts',[]),('normalize-entitlements.ts',['--dry-run','--allow-exceptions'])]:
            self.tool(['./node_modules/.bin/tsx','prisma/'+script,*flags])
        # Use the real app predicate: HUMAN approvals are never synthesized by this controller.
        self.tool(['./node_modules/.bin/tsx','prisma/verify-feature-launch-build-authority.ts'],extra={'AWS_EC2_METADATA_DISABLED':'true'})
        self.receipt['migrationAndAuthorityVerified']=True

    def run(self):
        lock=self.state/'deployment.lock'
        with lock.open('a+') as handle:
            try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError('An environment deployment is already active')
            # A failed/unknown previous mutation cannot be hidden by a fresh run directory.
            active=self.state/'active.json'
            if self.args.rollback:
                self.rollback(active)
                return
            require(not active.exists(), 'Previous deployment needs explicit reconciliation: '+str(active))
            with self.phase('target-preflight'): self.preflight()
            if not self.args.apply:
                self.receipt['status']='PREFLIGHT_PASSED_NO_DEPLOYMENT'; return
            self.acquire_remote_lock()
            write(active,{'operationId':self.id,'result':str(self.work/'result.json')})
            try:
                with self.phase('main-typescript-build'): self.source_and_build()
                with self.phase('fresh-config-and-image-validation'): self.configuration(); self.render()
                with self.phase('publish-and-pull'): self.publish()
                with self.phase('config-freshness-before-mutation'): self.config_freshness()
                with self.phase('provider-preparation'): self.agentcore()
                with self.phase('database-and-feature-authority'):
                    self.changed.append('database-sync-started')
                    self.migrations()
                with self.phase('native-rollout-and-readback'): self.deploy()
                with self.phase('customer-acceptance'): self.acceptance()
                with self.phase('retire-observed-builds'): self.retire()
                with self.phase('receipt-signature'): self.sign()
                self.receipt['status']='ACCEPTED_LINE_DEFERRED'
                self.release_remote_lock()
                active.unlink()
            except BaseException:
                self.receipt['status']='FAILED_RECONCILIATION_REQUIRED' if self.changed else 'FAILED'
                if not self.changed:
                    self.release_remote_lock()
                    active.unlink()
                raise

    def rollback(self, active):
        require(self.args.apply, 'Rollback requires --apply')
        require(re.fullmatch(r'[0-9TZ-]+-[0-9a-f]{8}', self.args.rollback), 'Invalid rollback operation ID')
        olddir=self.state/'runs'/self.args.rollback
        result=read(olddir/'result.json')
        require(result['environment']==self.args.environment and result['kind']==self.target['kind'], 'Rollback environment mismatch')
        require(result['mode']=='hotfix', 'Automatic code rollback is only supported for a migration-free hotfix; normal migrations need reviewed recovery')
        require(result['status'] in ('ACCEPTED_LINE_DEFERRED','FAILED_RECONCILIATION_REQUIRED'), 'Original run is not terminal')
        previous=read(olddir/'previous.private.json')
        require(set(previous)==set(SERVICES) and all(previous.values()), 'Previous complete deployment not captured')
        for s, rows in previous.items():
            require({r['host']['instanceId'] for r in rows}=={h['instanceId'] for h in self.target['hosts'][s]}, 'Rollback host set changed')
        sources={r['sourceCommit'] for rows in previous.values() for r in rows}
        require(len(sources)==1 and re.fullmatch(r'[0-9a-f]{40}',next(iter(sources))), 'Previous services had mixed/invalid source; explicit reconciliation required')
        with self.phase('rollback-preflight'): self.preflight()
        self.remote_lock='/home/ubuntu/.kamal/'+self.target['servicePrefix']+'-release-lock'
        if active.exists():
            require(read(active)['operationId']==self.args.rollback, 'Different operation owns deployment lock')
            script="import pathlib,sys;p=pathlib.Path(sys.argv[1]);assert (p/'owner').read_text()==sys.argv[2];(p/'owner').write_text(sys.argv[3])"
            self.remote(self.target['hosts']['api-web'][0],['python3','-c',script,self.remote_lock,self.args.rollback,self.id])
            self.remote_lock_owned=True
        else: self.acquire_remote_lock()
        write(active,{'operationId':self.id,'result':str(self.work/'result.json'),'rollbackOf':self.args.rollback})
        self.changed.append('rollback-started');self.receipt['rollbackOf']=self.args.rollback
        self.token=self.command(self.aws_prefix+['ecr','get-login-password']).strip();self.secrets.add(self.token)
        self.build={'sourceCommit':next(iter(sources))}
        self.manifest=read(olddir/'inventory.json');self.images=read(olddir/'publication.json')
        self.envs={s:{k:v for k,v in rows[0]['environment'].items() if k not in ('KAMAL_HOST','KAMAL_VERSION','KAMAL_CONTAINER_NAME')} for s,rows in previous.items()}
        for env in self.envs.values():self.secrets.update(v for v in env.values() if len(v)>=16)
        for s,rows in previous.items():
            require(all({k:v for k,v in row['environment'].items() if k not in ('KAMAL_HOST','KAMAL_VERSION','KAMAL_CONTAINER_NAME')}==self.envs[s] for row in rows), 'Previous per-host config diverged')
        self.receipt['sourceCommit']=self.build['sourceCommit']
        self.restoring=previous
        for service,rows in previous.items():
            require(len({row['version'] for row in rows})==1 and len({row['imageId'] for row in rows})==1,
                    'Previous per-host versions/images diverged')
            self.images[service]={'imageId':rows[0]['imageId']}
        self.envdir=self.work/'environments';self.envdir.mkdir()
        for service,env in self.envs.items():
            write(self.envdir/(service+'.environment.json'),env)
            write(self.envdir/(service+'.base-image-env.json'),{})
        self.manifest={'schemaVersion':1,'sourceCommit':self.build['sourceCommit'],'rollbackOf':self.args.rollback,
            'artifacts':{s:{'imageId':rows[0]['imageId']} for s,rows in previous.items()},
            'services':{s:{'environmentSha256':digest(env)} for s,env in self.envs.items()}}
        self.manifest['releaseId']=digest(self.manifest)
        self.receipt['releaseId']=self.manifest['releaseId']
        self.build['agentcore']={'sha256':self.envs['ai-gateway']['AGENTCORE_EXPECTED_ARTIFACT_SHA256']}
        self.render()
        with self.phase('rollback-provider-readback'):
            # Do not update a provider during rollback; its preserved slot must still match.
            self.agentcore(read_only=True)
        with self.phase('rollback-launch-authority'):
            self.tool(['./node_modules/.bin/tsx','prisma/attest-feature-launch-build.ts'])
            self.tool(['./node_modules/.bin/tsx','prisma/verify-feature-launch-build-authority.ts'])
        restored={}
        with self.phase('rollback-native-and-readback'):
            for s in ORDER:
                restored[s]=[]
                for row in previous[s]:
                    self.kamal(s,['rollback',row['version'],'--hosts',row['host']['address']],version=row['version'])
                    info=json.loads(self.remote(row['host'],['docker','inspect',row['containerName']]))[0]
                    actual=dict(v.split('=',1) for v in info['Config']['Env'])
                    require(info['State']['Running'] and info['Image']==row['imageId'] and actual==row['environment'], 'Rollback image/config readback mismatch')
                    self.verify_proxy(s,row['host'],info)
                    self.deep_health(s,name=row['containerName'],hosts=[row['host']])
                    restored[s].append({'running':True,'imageId':info['Image'],'sourceCommit':row['sourceCommit'],
                        'environmentSha256':digest(actual),'instanceId':row['host']['instanceId'],'containerId':info['Id'],'containerName':row['containerName']})
        self.receipt['runtimeReadback']=restored
        with self.phase('rollback-customer-acceptance'):self.acceptance()
        proof={'operationId':self.id,'environment':self.args.environment,'sourceCommit':self.build['sourceCommit'],'services':restored,'mode':'reconcile'}
        with self.phase('rollback-retirement'):
            retired=json.loads(self.tool(['./node_modules/.bin/tsx','--eval',(ROOT/'infra/kamal/retire-builds.cjs').read_text()],extra={'KAMAL_RETIRE_PROOF':json.dumps(proof)}))
            require(retired['passed'],'Rollback authority reconciliation failed')
            self.receipt['launchRetirement']=retired
        with self.phase('rollback-receipt-signature'):self.sign(state='ROLLED_BACK_LINE_DEFERRED')
        self.receipt['status']='ROLLED_BACK_LINE_DEFERRED'
        self.release_remote_lock();active.unlink()

    def acquire_remote_lock(self):
        self.remote_lock = '/home/ubuntu/.kamal/' + self.target['servicePrefix'] + '-release-lock'
        script = "import pathlib,sys;p=pathlib.Path(sys.argv[1]);p.parent.mkdir(exist_ok=True);p.mkdir();(p/'owner').write_text(sys.argv[2])"
        self.remote(self.target['hosts']['api-web'][0], ['python3','-c',script,self.remote_lock,self.id])
        self.remote_lock_owned = True

    def release_remote_lock(self):
        if not self.remote_lock_owned:
            return
        script = "import pathlib,sys;p=pathlib.Path(sys.argv[1]);assert (p/'owner').read_text()==sys.argv[2];(p/'owner').unlink();p.rmdir()"
        self.remote(self.target['hosts']['api-web'][0], ['python3','-c',script,self.remote_lock,self.id])
        self.remote_lock_owned = False

    def provider_callback(self):
        return self.target['publicUrl'].rstrip('/')+'/v1' if self.target['kind']=='dev' else self.target['apiInternalUrl']

    def agentcore(self, read_only=False):
        ai = self.envs['ai-gateway']
        arn = ai['AGENTCORE_RUNTIME_ARN']
        require(arn==self.target['agentcoreRuntimeArn'], 'Captured AgentCore runtime differs from enrollment')
        require(arn.startswith(f'arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:runtime/'), 'Foreign AgentCore runtime')
        if self.args.environment == 'production':
            require('uat' not in arn and 'dev' not in arn, 'Foreign Production AgentCore runtime')
        rid = arn.rsplit('/',1)[1]
        enrolled={self.target['agentcoreQualifier']}
        if self.target.get('agentcoreCandidateQualifier'):enrolled.add(self.target['agentcoreCandidateQualifier'])
        active_qualifiers=set()
        for h in self.target['hosts']['ai-gateway']:
            ids=self.remote(h,['docker','ps','--filter','label=service='+self.target['servicePrefix']+'-ai-gateway','--format','{{.ID}}']).split()
            if ids:
                rows=json.loads(self.remote(h,['docker','inspect',*ids]))
                for info in rows:
                    values=dict(row.split('=',1) for row in info['Config']['Env'])
                    require(values.get('AGENTCORE_RUNTIME_ARN')==arn,'Running AI uses a different AgentCore runtime')
                    active_qualifiers.add(values.get('AGENTCORE_RUNTIME_QUALIFIER'))
        require(len(active_qualifiers)<=1 and active_qualifiers<=enrolled,'AgentCore qualifier is mixed or not enrolled')
        qualifier=ai['AGENTCORE_RUNTIME_QUALIFIER'] if read_only else next(iter(active_qualifiers),self.target['agentcoreQualifier'])
        require(qualifier in enrolled,'Requested qualifier is not enrolled')
        endpoint = self.aws(['bedrock-agentcore-control','get-agent-runtime-endpoint','--agent-runtime-id',rid,'--endpoint-name',qualifier])
        require(endpoint['status']=='READY' and endpoint.get('targetVersion') in (None,endpoint['liveVersion']), 'AgentCore endpoint is moving')
        runtime = self.aws(['bedrock-agentcore-control','get-agent-runtime','--agent-runtime-id',rid,'--agent-runtime-version',endpoint['liveVersion']])
        expected = {'GIT_SHA':self.build['sourceCommit'],'SERVICE_VERSION':self.build['sourceCommit'],'AGENTCORE_ARTIFACT_SHA256':self.build['agentcore']['sha256'],
                    'DEPLOY_ENVIRONMENT':self.args.environment,'ERP_CORE_INTERNAL_URL':self.provider_callback()}
        actual_env = runtime['environmentVariables']
        if all(actual_env.get(k)==v for k,v in expected.items()):
            object_ref=runtime['agentRuntimeArtifact']['codeConfiguration']['code']['s3']
            require(object_ref.get('versionId') not in (None,'null'), 'Existing AgentCore artifact is not pinned')
            pinned=self.work/'reused-agentcore.zip'
            self.aws(['s3api','get-object','--bucket',object_ref['bucket'],'--key',object_ref['prefix'],
                      '--version-id',object_ref['versionId'],str(pinned)])
            require(hashlib.sha256(pinned.read_bytes()).hexdigest()==expected['AGENTCORE_ARTIFACT_SHA256'], 'Existing AgentCore artifact bytes mismatch')
            self.receipt['agentcore']={'status':'REUSED_EXACT','runtimeArn':arn,'qualifier':qualifier,
                'version':endpoint['liveVersion'],'sourceCommit':expected['GIT_SHA'],'artifactSha256':expected['AGENTCORE_ARTIFACT_SHA256']}
            self.bind_qualifier(qualifier)
            return
        require(not read_only,'Preserved AgentCore rollback endpoint no longer matches previous source/config')
        # Preserve the old pinned endpoint while its old AI gateway is still serving.
        # At least one spare endpoint must be enrolled. No quota changes/deletion during releases.
        slot = next(iter(enrolled-{qualifier}),None)
        require(slot and slot != qualifier and slot != 'DEFAULT', 'AgentCore needs a separately enrolled candidate endpoint; old endpoint stays pinned')
        candidate = self.aws(['bedrock-agentcore-control','get-agent-runtime-endpoint','--agent-runtime-id',rid,'--endpoint-name',slot])
        require(candidate['status']=='READY' and candidate.get('targetVersion') in (None,candidate['liveVersion']), 'Candidate endpoint not stable')
        # The enrolled spare must not appear in any currently running AI container.
        for h in self.target['hosts']['ai-gateway']:
            ids=self.remote(h,['docker','ps','--filter','label=service='+self.target['servicePrefix']+'-ai-gateway','--format','{{.ID}}']).split()
            if ids:
                rows=json.loads(self.remote(h,['docker','inspect',*ids]))
                require(all(('AGENTCORE_RUNTIME_QUALIFIER='+slot) not in i['Config']['Env'] for i in rows), 'Candidate AgentCore endpoint is in use')
        artifact = json.loads(json.dumps(runtime['agentRuntimeArtifact']))
        require('codeConfiguration' in artifact, 'Unsupported AgentCore artifact type')
        bucket = artifact['codeConfiguration']['code']['s3']['bucket']
        key = 'agentcore/kamal-'+self.target['kind']+'-'+self.build['sourceCommit']+'-'+self.build['agentcore']['sha256']+'-'+self.id+'.zip'
        self.changed.append('agentcore-artifact-publication-started')
        put=self.aws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',str(self.build_dir/'agentcore/agentcore.zip'),
                      '--if-none-match','*'],timeout=120)
        require(put.get('VersionId') not in (None,'null'), 'AgentCore object is not versioned')
        artifact['codeConfiguration']['code']['s3']={'bucket':bucket,'prefix':key,'versionId':put['VersionId']}
        pinned=self.work/'pinned-agentcore.zip'
        self.aws(['s3api','get-object','--bucket',bucket,'--key',key,'--version-id',put['VersionId'],str(pinned)])
        require(hashlib.sha256(pinned.read_bytes()).hexdigest()==self.build['agentcore']['sha256'], 'Published AgentCore bytes changed')
        updates={**actual_env,**expected,'SERVICE_VERSION':self.build['sourceCommit']}
        if self.target['kind']=='dev':
            updates.update(PUBLIC_BASE_URL=self.target['publicUrl'].rstrip('/'), WATCHDOG_JWT_ISSUER=self.target['publicUrl'].rstrip('/'))
        request={'agentRuntimeId':rid,'agentRuntimeArtifact':artifact,'environmentVariables':updates,
                 'clientToken':str(uuid.uuid5(uuid.NAMESPACE_URL,self.id+'/agentcore-runtime'))}
        for field in ('roleArn','networkConfiguration','protocolConfiguration','authorizerConfiguration',
                      'requestHeaderConfiguration','lifecycleConfiguration','metadataConfiguration','filesystemConfigurations','description'):
            if runtime.get(field) is not None: request[field]=runtime[field]
        write(self.work/'agentcore-update.private.json',request)
        self.changed.append('agentcore-runtime-update-started')
        updated=self.aws(['bedrock-agentcore-control','update-agent-runtime','--cli-input-json','file://'+str(self.work/'agentcore-update.private.json')])
        version=updated['agentRuntimeVersion']
        deadline=time.monotonic()+180
        while True:
            live=self.aws(['bedrock-agentcore-control','get-agent-runtime','--agent-runtime-id',rid,'--agent-runtime-version',version])
            if live['status']=='READY': break
            require(live['status'] in ('CREATING','UPDATING') and time.monotonic()<deadline, 'AgentCore runtime failed/timed out')
            time.sleep(3)
        require(live['agentRuntimeArtifact']==artifact and live['environmentVariables']==updates,
                'AgentCore runtime readback mismatch')
        self.aws(['bedrock-agentcore-control','update-agent-runtime-endpoint','--agent-runtime-id',rid,'--endpoint-name',slot,
                  '--agent-runtime-version',version,'--client-token',str(uuid.uuid5(uuid.NAMESPACE_URL,self.id+'/agentcore-endpoint'))])
        deadline=time.monotonic()+120
        while True:
            ep=self.aws(['bedrock-agentcore-control','get-agent-runtime-endpoint','--agent-runtime-id',rid,'--endpoint-name',slot])
            if ep['status']=='READY' and ep['liveVersion']==version and ep.get('targetVersion') in (None,version): break
            require(ep['status'] in ('CREATING','UPDATING','READY') and time.monotonic()<deadline,'AgentCore endpoint failed/timed out')
            time.sleep(3)
        self.bind_qualifier(slot)
        self.receipt['agentcore']={'status':'UPDATED_PINNED','runtimeArn':arn,'qualifier':slot,'version':version,
            'sourceCommit':expected['GIT_SHA'],'artifactSha256':expected['AGENTCORE_ARTIFACT_SHA256'],'previousQualifier':qualifier}

    def bind_qualifier(self, slot):
        self.envs['ai-gateway']['AGENTCORE_RUNTIME_QUALIFIER']=slot
        self.manifest['services']['ai-gateway']['environmentSha256']=digest(self.envs['ai-gateway'])
        self.manifest['releaseId']=digest({k:v for k,v in self.manifest.items() if k!='releaseId'})
        write(self.envdir/'ai-gateway.environment.json',self.envs['ai-gateway'])
        write(self.work/'inventory.json',self.manifest)
        self.receipt['releaseId']=self.manifest['releaseId']

    def inspect_service(self, service):
        rows=[]
        name=self.target['servicePrefix']+('' if service=='api-web' else '-'+service)+'-web-'+self.version(service)
        expected=json.loads(json.dumps(self.manifest))
        expected['artifacts'][service]['imageId']=self.images[service]['imageId']
        for h in self.target['hosts'][service]:
            infos=json.loads(self.remote(h,['docker','inspect',name]))
            require(len(infos)==1,'Missing candidate container')
            info=infos[0]
            base=read(self.envdir/(service+'.base-image-env.json'))
            native={'KAMAL_CONTAINER_NAME':name,'KAMAL_VERSION':self.version(service),'KAMAL_HOST':h['address']}
            if hasattr(self, 'restoring'):
                prior=next(row for row in self.restoring[service] if row['host']['instanceId']==h['instanceId'])
                native={key:prior['environment'][key] for key in native}
            observed=inspect_container(expected,service,self.envs[service],info,{**base,**native})
            self.verify_proxy(service,h,info)
            observed.update(instanceId=h['instanceId'],containerId=info['Id'],containerName=name)
            rows.append(observed)
        return rows

    def verify_proxy(self, service, host, info):
        if service=='workers':return
        table=re.sub(r'\x1b\[[0-9;]*m','',self.remote(host,['docker','exec','kamal-proxy','kamal-proxy','list']))
        route=self.target['servicePrefix']+('' if service=='api-web' else '-'+service)+'-web'
        matches=[line.split() for line in table.splitlines() if line.split() and line.split()[0]==route]
        require(len(matches)==1 and len(matches[0])>=5 and matches[0][4]=='running', 'Native proxy route is not running')
        endpoint=matches[0][3].rsplit(':',1)
        require(len(endpoint)==2 and info['Id'].startswith(endpoint[0]) and len(endpoint[0])>=12
                and endpoint[1]==('3000' if service=='api-web' else '3002'), 'Native proxy is serving a different container')

    def deep_health(self, service, name=None, hosts=None):
        port=3002 if service=='ai-gateway' else int(self.envs[service].get('PORT','3000'))
        path='/v1/internal/health/readiness' if service=='api-web' else '/v1/health'
        script="""const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));
async function check(url,headers,db){const r=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||d.status!=='ok'||(db&&d.db!=='ok'))throw Error('readiness');return d;}
(async()=>{const d=await check(p.url,p.headers,p.db);const proof={passed:true,status:d.status,db:d.db};
if(p.worker&&process.env.QUEUE_ENABLED!=='false'){
 const Redis=require(require.resolve('ioredis',{paths:[require.resolve('bullmq')]}));
 const redis=new Redis(process.env.REDIS_URL,{lazyConnect:true,connectTimeout:10000,maxRetriesPerRequest:0,retryStrategy:()=>null});redis.on('error',()=>{});
 try{await redis.connect();if(await redis.ping()!=='PONG')throw Error('redis');proof.redis='ok';}finally{redis.disconnect();}
 await check(process.env.INTERNAL_API_URL.replace(/\\/$/,'')+'/internal/health/readiness',{'x-worker-token':process.env.WORKER_INTERNAL_TOKEN},true);proof.internalApi='ok';
}console.log(JSON.stringify(proof));})().catch(()=>process.exit(1));"""
        token=self.envs['api-web']['WORKER_INTERNAL_TOKEN']
        name=name or self.target['servicePrefix']+('' if service=='api-web' else '-'+service)+'-web-'+self.version(service)
        for h in hosts or self.target['hosts'][service]:
            proof=json.loads(self.remote(h,['docker','exec','-i',name,'node','-e',script],stdin=json.dumps({
                'url':f'http://127.0.0.1:{port}'+path,'headers':{'x-worker-token':token} if service=='api-web' else {},
                'db':service=='api-web','worker':service=='workers'})))
            require(proof.get('passed') is True,'Service readiness did not pass')
            self.receipt.setdefault('readiness',{}).setdefault(service,{})[h['instanceId']]=proof

    def deploy(self):
        self.previous={}
        for service in SERVICES:
            label=self.target['servicePrefix']+('' if service=='api-web' else '-'+service)
            self.previous[service]=[]
            for h in self.target['hosts'][service]:
                ids=self.remote(h,['docker','ps','--filter','label=service='+label,'--format','{{.ID}}']).split()
                rows=json.loads(self.remote(h,['docker','inspect',*ids])) if ids else []
                require(len(rows)<=1,'Multiple old containers require reconciliation before rollout')
                for info in rows:
                    env=dict(v.split('=',1) for v in info['Config']['Env'])
                    require(env.get('KAMAL_VERSION'),'Previous native release version missing')
                    # Secrets are retained only in private run state for exact config rollback.
                    self.previous[service].append({'host':h,'version':env['KAMAL_VERSION'],'imageId':info['Image'],
                        'sourceCommit':env.get('GIT_SHA'),'environment':env,'containerName':info['Name'].lstrip('/')})
        write(self.work/'previous.private.json',self.previous)
        self.receipt['previousVersions']={s:[{'instanceId':r['host']['instanceId'],'version':r['version'],'sourceCommit':r['sourceCommit']} for r in rows] for s,rows in self.previous.items()}
        observed={}
        for service in ORDER:
            self.changed.append(service+'-rollout-started')
            if self.args.environment=='production': self.receipt['productionMutated']=True
            self.save()
            self.kamal(service,['deploy','--skip-push'])
            observed[service]=self.inspect_service(service)
            self.deep_health(service)
        self.receipt['runtimeReadback']=observed

    def retire(self):
        # Fresh observations after acceptance, not the earlier rollout snapshot.
        observed={s:self.inspect_service(s) for s in SERVICES}
        proof={'operationId':self.id,'environment':self.args.environment,'sourceCommit':self.build['sourceCommit'],'services':observed}
        script=(ROOT/'infra/kamal/retire-builds.cjs').read_text()
        result=json.loads(self.tool(['./node_modules/.bin/tsx','--eval',script],extra={'KAMAL_RETIRE_PROOF':json.dumps(proof)}))
        require(result['passed'],'Launch authority retirement did not pass')
        self.receipt['launchRetirement']=result

    def validate_acceptance_target(self):
        if getattr(self, 'smoke_acceptance', False):
            require(self.args.environment=='uat' and self.target['kind']=='uat' and not self.manual_browser,
                    'Smoke acceptance is an explicit real-UAT-only mode; cannot combine with browser acceptance')
            return
        if self.manual_browser:
            require(self.args.environment=='uat' and self.target['kind']=='uat',
                    'Browser acceptance is only supported for a real UAT deployment or rollback')
            require(self.target.get('browserAcceptanceUserId'), 'Enroll the expected UAT browser account userId')
        else:
            require(Path(self.target.get('acceptanceCredentials','')).expanduser().is_file(), 'Acceptance credentials file is missing')

    def browser_acceptance(self):
        # ponytail: keep this operation alive; a stopped process needs explicit reconciliation, not another deploy.
        binding={'schemaVersion':1,'operationId':self.id,'sourceCommit':self.build['sourceCommit'],
            'releaseId':self.manifest['releaseId'],'environment':'uat','origin':self.target['publicUrl'].rstrip('/'),
            'userId':self.target['browserAcceptanceUserId']}
        if self.args.rollback: binding['rollbackOf']=self.args.rollback
        required=('ownerLogin','systemAdminPermission','customerOpen','authenticatedRead','logout','sessionRejectedAfterLogout')
        write(self.work/'browser-acceptance-request.json',{**binding,'checks':{k:False for k in required},
            'observer':'','evidenceFiles':[]})
        self.receipt.update(status='AWAITING_BROWSER_ACCEPTANCE',websiteReadyAt=datetime.now(timezone.utc).isoformat(),
            secondsToWebsiteReady=round(time.monotonic()-self.clock,3))
        self.save()
        proof_path=self.work/'browser-acceptance.json'
        print('UAT website ready for owner login: '+binding['origin']+'/login\n'
              'Awaiting operator browser evidence for this operation: '+str(proof_path),flush=True)
        start=time.monotonic()
        try:
            while not proof_path.exists():
                time.sleep(2)
                self.save()
            proof_bytes=proof_path.read_bytes()
            proof=json.loads(proof_bytes)
            require(all(proof.get(k)==v for k,v in binding.items()), 'Browser acceptance operation/source/release/origin/account mismatch')
            require(all(proof.get('checks',{}).get(k) is True for k in required), 'Browser acceptance is incomplete or failed')
            require(isinstance(proof.get('observer'),str) and proof['observer'].strip(), 'Browser acceptance observer missing')
            paths=proof.get('evidenceFiles')
            require(isinstance(paths,list) and paths, 'Retained browser observation evidence is required')
            hashes={}
            for name in paths:
                path=Path(name)
                require(path.is_absolute() and path.is_file() and path.stat().st_size>0 and
                        path.resolve() not in (proof_path.resolve(),(self.work/'browser-acceptance-request.json').resolve()),
                        'Missing browser observation evidence')
                hashes[str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
            result={'kind':'operator_browser_attestation','binding':binding,'checks':proof['checks'],
                'observer':proof['observer'],'evidenceSha256':hashes,
                'attestationSha256':hashlib.sha256(proof_bytes).hexdigest()}
        finally:
            self.receipt['browserAcceptanceStageSeconds']=round(time.monotonic()-start,3)
            self.save()
        # Human wait can be long: inspect the same release again without redeploying it.
        observed={}
        for service in SERVICES:
            observed[service]=self.inspect_service(service)
            self.deep_health(service)
        self.receipt.update(status='RUNNING',runtimeReadback=observed)
        return result

    def acceptance(self):
        credentials={}
        base=self.target['publicUrl'].rstrip('/')
        jar=http.cookiejar.CookieJar(); opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        checks=[]
        def call(path,method='GET',body=None,expected=200,json_response=True):
            headers={'Content-Type':'application/json','User-Agent':'Mangmee-Kamal-Release/1.0'}
            for cookie in jar:
                if cookie.name=='watchdog_csrf': headers['x-csrf-token']=cookie.value
            req=urllib.request.Request(base+path,method=method,headers=headers,data=json.dumps(body).encode() if body is not None else None)
            try:
                with opener.open(req,timeout=30) as response: status,raw=response.status,response.read()
            except urllib.error.HTTPError as e: status,raw=e.code,e.read()
            checks.append({'path':path,'method':method,'status':status})
            require(status==expected,'Customer acceptance status mismatch: '+path)
            return json.loads(raw) if raw and json_response else raw
        logged_in=False
        try:
            public=call('/api/v1/auth/platform-access')
            require(public.get('effectiveState',public.get('state'))=='OPEN','Customer platform access is not OPEN')
            html=call('/login',json_response=False)
            require(b'data-platform-access="open"' in html,'Customer login is not open')
            if getattr(self, 'smoke_acceptance', False):
                observed={}
                for service in SERVICES:
                    observed[service]=self.inspect_service(service)
                    self.deep_health(service)
                self.receipt['runtimeReadback']=observed
                self.receipt['customerAcceptance']={'passed':True,'kind':'owner_authorized_uat_config_readiness_smoke',
                    'checks':checks,'allServiceConfigAndReadinessPassed':True,
                    'loginLogout':'NOT_REQUIRED_BY_OWNER','line':'DEFERRED_BY_OWNER'}
                return
            if self.manual_browser:
                browser=self.browser_acceptance()
                public=call('/api/v1/auth/platform-access')
                require(public.get('effectiveState',public.get('state'))=='OPEN','Customer platform access changed during browser acceptance')
                require(b'data-platform-access="open"' in call('/login',json_response=False),'Customer login is no longer open')
                self.receipt['customerAcceptance']={'passed':True,'checks':checks,'browser':browser,'line':'DEFERRED_BY_OWNER'}
                return
            credentials=read(Path(self.target['acceptanceCredentials']).expanduser())
            require(credentials.get('environment')==self.args.environment and credentials.get('kind')==self.target['kind'], 'Acceptance account environment mismatch')
            self.secrets.add(credentials['password'])
            session=call('/api/auth/login','POST',{'username':credentials['username'],'password':credentials['password'],'remember':False})
            logged_in=True
            require(not session.get('passwordChangeRequired') and not session.get('legalAcceptanceRequired'),'Acceptance account requires user action')
            me=call('/api/v1/auth/me'); require(me['userId']==credentials['userId'],'Wrong acceptance identity')
            if self.target['kind']!='dev':
                require('SYSTEM_ADMIN' in me['roles'] and 'system.launch_gate.manage' in me['permissions'],'System acceptance permission missing')
                access=call('/api/v1/system/platform-access')
                require(access['effectiveState']=='OPEN' and (self.args.environment!='production' or access['servingMode']=='live'),'Customer gate/serving mode mismatch')
                call('/system/platform-access',json_response=False)
            for path in credentials.get('readPaths',[]):
                require(path.startswith('/api/v1/') and not path.startswith('//'),'Invalid acceptance read path')
                call(path)
            call('/api/auth/logout','POST',{},expected=204);logged_in=False
            call('/api/v1/auth/me',expected=401)
            self.receipt['customerAcceptance']={'passed':True,'checks':checks,'line':'DEFERRED_BY_OWNER'}
        finally:
            if logged_in:
                try:call('/api/auth/logout','POST',{},expected=204)
                except Exception:self.receipt['acceptanceLogoutFailed']=True
            jar.clear();credentials['password']=''

    def sign(self, state='ACCEPTED_LINE_DEFERRED'):
        accepted={'schemaVersion':1,'operationId':self.id,'environment':self.args.environment,'kind':self.target['kind'],
            'sourceCommit':self.build['sourceCommit'],'releaseId':self.manifest['releaseId'],
            'state':state,'completedAt':datetime.now(timezone.utc).isoformat(),
            'controllerSha256':self.receipt.get('controllerSha256'),
            'controllerConfigSha256':self.receipt.get('controllerConfigSha256'),
            'rollbackOf':self.receipt.get('rollbackOf'),
            'runtimeReadback':self.receipt['runtimeReadback'],'readiness':self.receipt.get('readiness',{}),'agentcore':self.receipt['agentcore'],
            'launchRetirement':self.receipt['launchRetirement'],
            'customerAcceptance':self.receipt['customerAcceptance'],'elapsedThroughAcceptanceSeconds':round(time.monotonic()-self.clock,3)}
        if self.manual_browser:
            accepted.update(secondsToWebsiteReady=self.receipt['secondsToWebsiteReady'],
                browserAcceptanceStageSeconds=self.receipt['browserAcceptanceStageSeconds'])
        write(self.work/'accepted.json',accepted)
        if self.target['kind']!='dev':
            payload=hashlib.sha256((self.work/'accepted.json').read_bytes()).digest()
            (self.work/'accepted.sha256').write_bytes(payload)
            metadata=self.aws(['kms','describe-key','--key-id',self.target['signingKeyArn']])['KeyMetadata']
            supported=metadata.get('SigningAlgorithms',[])
            algorithm=next((a for a in ('RSASSA_PSS_SHA_256','ECDSA_SHA_256') if a in supported),None)
            require(algorithm,'Unsupported receipt signing algorithm')
            result=self.aws(['kms','sign','--key-id',self.target['signingKeyArn'],'--message-type','DIGEST',
                '--message','fileb://'+str(self.work/'accepted.sha256'),'--signing-algorithm',algorithm])
            import base64
            (self.work/'accepted.sig').write_bytes(base64.b64decode(result['Signature']))
            checked=self.aws(['kms','verify','--key-id',self.target['signingKeyArn'],'--message-type','DIGEST',
                '--message','fileb://'+str(self.work/'accepted.sha256'),'--signature','fileb://'+str(self.work/'accepted.sig'),'--signing-algorithm',algorithm])
            require(checked.get('SignatureValid') is True,'Receipt signature failed')
            self.receipt['signature']={'verified':True,'keyArn':result['KeyId'],'algorithm':algorithm}
        else:
            self.receipt['signature']={'kind':'unsigned_nonproduction_evidence','sha256':hashlib.sha256((self.work/'accepted.json').read_bytes()).hexdigest()}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--environment',choices=['uat','production'],required=True)
    p.add_argument('--target',type=Path)
    p.add_argument('--profile',default=os.environ.get('AWS_PROFILE',''))
    p.add_argument('--mode',choices=['hotfix','normal'],default='hotfix')
    p.add_argument('--apply',action='store_true',help='Deploy to the enrolled target; default only checks prerequisites')
    p.add_argument('--uat-controller-sha256', help='Explicit hash-bound test of the new local controller on real UAT only')
    p.add_argument('--uat-browser-acceptance', action='store_true', help='Wait for owner login and retained operator browser evidence on real UAT; no stored login password')
    p.add_argument('--uat-smoke-acceptance', action='store_true', help='Owner-authorized real UAT config/readiness and public OPEN smoke, without login/logout')
    p.add_argument('--rollback',help='Restore the complete previous deployment captured by this terminal hotfix operation ID')
    args=p.parse_args()
    release=None
    try:
        release=Release(args); release.run()
    except BaseException as error:
        if isinstance(error,KeyboardInterrupt): message='Interrupted; inspect the retained operation before retrying'
        else: message=str(error)
        if release:
            if release.receipt['status'] in ('RUNNING','AWAITING_BROWSER_ACCEPTANCE'):
                release.receipt['status']='FAILED_RECONCILIATION_REQUIRED' if release.changed else 'FAILED'
            release.receipt['error']=release.redact(message)
        print('Release stopped: '+(release.redact(message) if release else message),file=sys.stderr)
        return 1
    finally:
        if release:
            release.receipt['finishedAt']=datetime.now(timezone.utc).isoformat();release.save()
            print(json.dumps({'status':release.receipt['status'],'elapsedSeconds':release.receipt['elapsedSeconds'],'result':str(release.work/'result.json')}))
    return 0


if __name__=='__main__':
    sys.exit(main())

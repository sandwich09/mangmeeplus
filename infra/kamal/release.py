#!/usr/bin/env python3
"""Fresh main -> complete config/artifacts -> native Kamal -> verified customer access.

Default is read-only preflight. --prepare adds local build/config validation without deployment.
--apply is a deployment, never an infrastructure bootstrap.
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
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import shlex
import shutil
import socket
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
from release_inventory import AI_JWT_SECRET_KEYS, SERVICES, digest, inspect_container, require, without_ai_jwt_secrets
from release_source import full_sha, hotfix_source, promotion_bundle, accepted_uat_bundle
from first_migration import FirstMigration

KAMAL = 'ghcr.io/basecamp/kamal:v2.12.0'
ORDER = ('ai-gateway', 'api-web', 'workers')
ACCOUNT = '311414082667'
REGION = 'ap-southeast-1'
UAT_DEPLOY_TARGET_SECONDS = 600
UAT_PRE_MUTATION_SECONDS = 360
UAT_BUILD_SECONDS = 240
PREPARED_PUBLISH_SECONDS = 3600  # per image; runs outside the remote lock and the UAT pre-mutation budget
HOST_STORAGE_HEADROOM_BYTES = 2 * 1024 ** 3
HOST_STORAGE_MULTIPLIER = 2
AGENTCORE_AI_APPROVAL_KEYS = ('APPROVED_AI_MODEL_IDS', 'AI_GLOBAL_INFERENCE_PROFILE_APPROVED', 'AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF')
CONTROLLER_FILES = tuple('infra/kamal/'+p for p in ('release.py','config.json','retire-builds.cjs','deploy-uat','deploy-prod')) + tuple('infra/dev-kamal/'+p for p in ('build-complete.py','capture-config.py','release_inventory.py','verify-config.mjs','Dockerfile.tools'))
CONTROLLER_FILES += ('infra/postmark/config.py', 'infra/postmark/config.json')
CONTROLLER_FILES += ('infra/kamal/release_source.py', 'infra/kamal/deploy-prod-hotfix', 'infra/kamal/promote-prod')
CONTROLLER_FILES += ('infra/kamal/first_migration.py',)

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


def terminate_process_group(process):
    """Terminate a timed-out local command and every build child it started."""
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def validate_target(t, environment, first_migration=False):
    require(t.get('schemaVersion') == 1, 'Unsupported target schema')
    require(t.get('environment') == environment, 'Target environment mismatch')
    require(t.get('account') == ACCOUNT and t.get('region') == REGION, 'Wrong AWS account/region')
    require(t.get('kind') in ('production', 'uat', 'dev'), 'Invalid target kind')
    require(t.get('sshTransport', 'direct') in ('direct', 'ssm'), 'Unsupported SSH transport')
    require(t.get('sshTransport', 'direct') != 'ssm' or not t.get('sshProxyCommand'),
            'SSM transport owns ProxyCommand')
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
        if first_migration:
            require(t.get('cutoverComplete') is False and t.get('migration', {}).get('state') == 'INFRASTRUCTURE_STAGED_NO_APPLICATION',
                    'First migration requires the explicitly staged, incomplete target')
            require(t['migration'].get('stackArn', '').startswith(f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/mangmee-kamal-production/'),
                    'First migration stack is not enrolled')
            full_sha(t['migration'].get('baselineSourceCommit'))
        else:
            require(t.get('cutoverComplete') is True, 'Production Kamal traffic migration has not been enrolled as complete')
        require(len(t['hosts']['api-web']) >= 2, 'Production requires at least two API hosts')
    else:
        require(not first_migration, 'First migration is Production-only')
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


def enrolled_host_inventory_matches(host, info):
    tags = {t['Key']:t['Value'] for t in info.get('Tags', [])}
    return (info.get('State', {}).get('Name') == 'running'
            and tags.get('aws:cloudformation:stack-name') == host['stack']
            and info.get('VpcId') == host['vpcId'])


def enrolled_host_matches(target, host, info):
    address_matches = (host['address'] == info.get('PrivateIpAddress')
                       if target.get('sshTransport', 'direct') == 'ssm'
                       else host['address'] in (info.get('PublicIpAddress'), info.get('PrivateIpAddress')))
    return enrolled_host_inventory_matches(host, info) and address_matches


def native_config(target, service, env, source, directory):
    role = {'hosts': [h['address'] for h in target['hosts'][service]],
        'options': {'cap-drop': 'ALL', 'security-opt': 'no-new-privileges'}}
    if service=='ai-gateway':
        # Node as PID 1 otherwise ignores default SIGTERM and consumes the full stop timeout.
        role['options']['init']=True
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
    if target['kind'] == 'production':
        config['logging'] = {'driver':'awslogs','options':{'awslogs-region':REGION,
            'awslogs-group':'/ecs/'+target['servicePrefix']+'-'+service,'awslogs-create-group':'false'}}
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


def make_overrides(target, source, artifact, configured, captured=None):
    overrides = {s: dict(configured[s]) for s in SERVICES}
    for s, values in target.get('overrides', {}).items():
        require(s in SERVICES, 'Unknown override service')
        overrides[s].update(values)
    # Full releases share the existing Gateway approval decision with an older API baseline.
    # Explicit API restrictions (including false/empty) win; no approval is invented here.
    # Hotfix callers omit captured to preserve their exact serving configuration.
    if captured is not None:
        api = dict(captured['api-web'], **overrides['api-web'])
        gateway = dict(captured['ai-gateway'], **overrides['ai-gateway'])
        for key in ('APPROVED_AI_MODEL_IDS', 'AI_GLOBAL_INFERENCE_PROFILE_APPROVED', 'AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF'):
            if key not in api and key in gateway:
                overrides['api-web'][key] = gateway[key]
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
        self.release_path = getattr(args, 'release_path', 'main')
        self.first_migration = bool(getattr(args, 'first_migration', False))
        require(not self.first_migration or (args.environment == 'production' and self.release_path == 'hotfix'
                and getattr(args, 'production_browser_acceptance', False)),
                'First migration requires the explicit Production hotfix and administrator browser acceptance')
        require(self.release_path == 'main' or args.environment == 'production', 'Explicit Production paths cannot target UAT')
        if self.release_path == 'hotfix':
            require(args.mode == 'hotfix' and (not args.rollback or self.first_migration), 'Isolated hotfix requires migration-free forward mode')
            require(not args.uat_release, 'Hotfix cannot also select a UAT release')
            full_sha(args.source_sha); full_sha(args.production_baseline)
            require(args.hotfix_path and args.regression_test, 'Hotfix requires the complete path set and regression tests')
        elif self.release_path == 'uat':
            require(args.uat_release and not args.rollback, 'UAT promotion requires an accepted release directory')
            require(not args.source_sha and not args.production_baseline and not args.hotfix_path
                    and not args.regression_test, 'UAT promotion cannot also select an independent hotfix source')
        if args.environment == 'production' and args.apply and not args.rollback:
            require(self.release_path != 'main', 'Choose deploy-prod-hotfix or promote-prod; Production cannot implicitly deploy latest main')
        self.clock = time.monotonic()
        self.id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        self.state = ROOT / '.env.kamal' / args.environment
        self.target_path = args.target or self.state / 'target.json'
        require(self.target_path.exists(), 'Target is not enrolled: ' + str(self.target_path) + '; see infra/kamal/README.md')
        self.target = validate_target(read(self.target_path), args.environment, self.first_migration)
        if self.first_migration:
            require(self.target['migration']['baselineSourceCommit'] == args.production_baseline, 'Enrolled ECS baseline differs from the selected source')
        self.production_browser = bool(getattr(args, 'production_browser_acceptance', False))
        require(not (args.uat_browser_acceptance and self.production_browser), 'Choose one environment browser acceptance mode')
        self.manual_browser = bool(args.uat_browser_acceptance or self.production_browser)
        self.smoke_acceptance = bool(getattr(args, 'uat_smoke_acceptance', False))
        if not getattr(args, 'reconcile_host_identity', False): self.validate_acceptance_target()
        self.work = self.state / 'runs' / self.id
        self.work.mkdir(parents=True, mode=0o700)
        self.receipt = {'schemaVersion': 1, 'operationId': self.id, 'environment': args.environment,
            'kind': self.target['kind'], 'mode': args.mode, 'startedAt': datetime.now(timezone.utc).isoformat(),
            'status': 'RUNNING', 'phases': [], 'lineAcceptance': 'DEFERRED_BY_OWNER', 'productionMutated': False}
        self.receipt['controllerManifest'] = controller_manifest()
        self.receipt['controllerSha256'] = digest(self.receipt['controllerManifest'])
        self.receipt['releasePath'] = self.release_path
        if args.environment == 'production': self.receipt['lineAcceptance'] = 'NOT_EXERCISED'
        if getattr(args, 'prepare', False):
            self.receipt['controllerScope'] = 'local preparation only; application/config from pinned main; no deployment'
        self.local_uat_test = local_uat_controller(self.target, args.uat_controller_sha256, self.receipt['controllerSha256'])
        if self.local_uat_test: self.receipt['controllerScope'] = 'owner-requested local controller test on real UAT; application from main'
        self.secrets = set()
        self.aws_prefix = ['aws', '--region', REGION]
        if args.profile:
            self.aws_prefix += ['--profile', args.profile]
        self.hosts = {h['instanceId']: h for rows in self.target['hosts'].values() for h in rows}
        self.changed = []
        self.remote_lock_owned = False
        self.ssm_sessions = {}
        if self.first_migration:
            self.migration = FirstMigration(self)
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
        process = subprocess.Popen(args, env=env, cwd=cwd, text=True,
            stdin=subprocess.PIPE if input is not None else None, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, start_new_session=True)
        try:
            stdout, stderr = process.communicate(input=input, timeout=timeout)
        except subprocess.TimeoutExpired:
            terminate_process_group(process)
            stdout, stderr = process.communicate()
            if log:
                (self.work / (log + '.log')).write_text(self.redact((stdout or '') + (stderr or '')))
            raise RuntimeError('Command timed out; outcome may be unknown; no automatic mutation retry: ' + str(args[0]))
        if log:
            (self.work / (log + '.log')).write_text(self.redact((stdout or '') + (stderr or '')))
        require(process.returncode == 0, (log or str(args[0])) + ': command failed; raw output suppressed')
        return stdout

    def aws(self, args, **kwargs):
        try:
            output = self.command(self.aws_prefix + args + ['--output', 'json'], **kwargs)
            # ExecuteChangeSet succeeds without a response body; reads must still return JSON.
            if args[:2] == ['cloudformation', 'execute-change-set'] and not output.strip():
                return {}
            return json.loads(output)
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
        proxy = self.ssh_proxy(host)
        if proxy: ssh += ['-o', 'ProxyCommand=' + proxy]
        data = self.command(ssh + ['ubuntu@'+host['address'], 'python3 -c '+shlex.quote(runner)],
            input=json.dumps({'command':command,'environment':environment or {},'stdin':stdin,'timeout':timeout}), timeout=timeout+30)
        result = json.loads(data)
        if result['exitCode']:
            write(self.work/'remote-failure.private.json', {'instanceId':host['instanceId'], **result})
        require(result['exitCode'] == 0, 'Remote command failed on ' + host['instanceId'] + '; output suppressed')
        return result['stdout']

    def ssh_proxy(self, host, *, container=False):
        if self.target.get('sshTransport', 'direct') == 'ssm':
            port = self.ssm_sessions[host['instanceId']]['port']
            return 'nc ' + ('host.docker.internal' if container else '127.0.0.1') + ' ' + str(port)
        return self.target.get('sshProxyCommand')

    def ssm_session_environment(self):
        exported = subprocess.run(self.aws_prefix + ['configure', 'export-credentials', '--format', 'env-no-export'],
            text=True, capture_output=True, timeout=30)
        require(exported.returncode == 0, 'Unable to establish a stable AWS credential session for SSM transport')
        names = {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CREDENTIAL_EXPIRATION'}
        values = {}
        for line in exported.stdout.splitlines():
            key, separator, value = line.partition('=')
            require(separator and key in names and value, 'Invalid stable AWS credential export for SSM transport')
            values[key] = value
        required = {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'}
        require(required <= values.keys(), 'Incomplete stable AWS credential export for SSM transport')
        self.secrets.update(values[key] for key in required)
        return {**os.environ, **values}

    def start_ssm_transport(self):
        if self.target.get('sshTransport', 'direct') != 'ssm': return
        require(shutil.which('session-manager-plugin'), 'AWS Session Manager plugin is missing')
        rows = self.aws(['ssm','describe-instance-information','--filters',
            'Key=InstanceIds,Values='+','.join(sorted(self.hosts))])['InstanceInformationList']
        require({r['InstanceId'] for r in rows if r.get('PingStatus') == 'Online'} == set(self.hosts),
                'Every enrolled host must be Online in Systems Manager')
        try:
            session_environment = self.ssm_session_environment()
            for iid in sorted(self.hosts):
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
                log_path = self.work / ('ssm-' + iid + '.private.log')
                log = os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w')
                # Use the exported session credentials directly: --profile can refresh to a
                # different role session before cleanup, which cannot terminate this session.
                command = ['aws','--region',REGION,'ssm','start-session','--target',iid,
                    '--document-name','AWS-StartPortForwardingSession','--parameters',
                    json.dumps({'portNumber':['22'],'localPortNumber':[str(port)]})]
                process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, text=True, env=session_environment)
                self.ssm_sessions[iid] = {'port':port,'process':process,'log':log,'path':log_path,
                    'environment':session_environment}
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                require(all(s['process'].poll() is None for s in self.ssm_sessions.values()),
                        'Systems Manager port-forward session exited early')
                if all('Waiting for connections' in s['path'].read_text(errors='replace') for s in self.ssm_sessions.values()):
                    self.receipt['sshTransport'] = {'kind':'ssm','instances':sorted(self.hosts),'publicIngressRequired':False}
                    return
                time.sleep(0.2)
            raise RuntimeError('Systems Manager port-forward session did not become ready')
        except BaseException:
            self.close_transport(); raise

    def close_transport(self):
        sessions = getattr(self, 'ssm_sessions', {})
        if not sessions:
            return self.receipt.get('ssmSessionCleanup', {}).get('passed', True)
        terminated, failures = 0, 0
        for session in sessions.values():
            failed = False
            try:
                match = re.search(r'Starting session with SessionId:\s*(\S+)', session['path'].read_text(errors='replace'))
                if not match:
                    failed = True
                else:
                    result = subprocess.run(['aws','--region',REGION,'ssm','terminate-session','--session-id',match.group(1)],
                        text=True,capture_output=True,timeout=30,env=session.get('environment'))
                    if result.returncode == 0: terminated += 1
                    else: failed = True
            except Exception:
                failed = True
            try:
                process = session['process']
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait(timeout=5)
            except Exception:
                failed = True
            try:
                session['log'].close()
            except Exception:
                failed = True
            if failed: failures += 1
        self.receipt['ssmSessionCleanup'] = {'passed':failures == 0 and terminated == len(sessions),
            'terminatedCount':terminated,'failedCount':failures}
        self.ssm_sessions = {}
        return self.receipt['ssmSessionCleanup']['passed']

    def observed_ssm_host_key(self, instance_id):
        require(shutil.which('ssh-keyscan'), 'ssh-keyscan is required for host identity reconciliation')
        port = self.ssm_sessions[instance_id]['port']
        raw = self.command(['ssh-keyscan', '-T', '10', '-t', 'ed25519', '-p', str(port), '127.0.0.1'],
                           timeout=30, log='host-key-'+instance_id)
        rows = [line.split() for line in raw.splitlines() if line and not line.startswith('#')]
        require(len(rows) == 1 and len(rows[0]) == 3 and rows[0][1] == 'ssh-ed25519'
                and re.fullmatch(r'[A-Za-z0-9+/=]+', rows[0][2]), 'Unable to read one ed25519 host key: '+instance_id)
        return rows[0][1] + ' ' + rows[0][2]

    def reconcile_host_identity(self):
        require(self.target.get('sshTransport') == 'ssm', 'Host identity reconciliation requires sshTransport: ssm')
        who = self.aws(['sts','get-caller-identity'])
        require(who['Account'] == ACCOUNT and not who['Arn'].endswith(':root'), 'Expected account-scoped non-root principal')
        infos = self.aws(['ec2','describe-instances','--instance-ids',*self.hosts])
        actual = {row['InstanceId']:row for reservation in infos['Reservations'] for row in reservation['Instances']}
        require(set(actual) == set(self.hosts), 'Incomplete EC2 readback')
        for instance_id, host in self.hosts.items():
            info = actual[instance_id]
            require(enrolled_host_inventory_matches(host, info), 'Host identity/state changed: '+instance_id)
            require(info.get('IamInstanceProfile') and info.get('MetadataOptions', {}).get('HttpTokens') == 'required'
                    and info.get('MetadataOptions', {}).get('HttpPutResponseHopLimit', 0) >= 2,
                    'Runtime IAM/IMDS not ready: '+instance_id)
            require(info.get('PrivateIpAddress'), 'Enrolled host has no primary private address: '+instance_id)
        self.start_ssm_transport()
        observed = {instance_id:self.observed_ssm_host_key(instance_id) for instance_id in self.hosts}
        rotations = sorted(instance_id for instance_id, host in self.hosts.items()
                           if host['hostKey'] != observed[instance_id])
        reason = (getattr(self.args, 'host_key_rotation_reason', None) or '').strip()
        require(not rotations or (getattr(self.args, 'accept_host_key_rotation', False) and reason),
                'Host key changed; use --accept-host-key-rotation with --host-key-rotation-reason')
        updated = json.loads(json.dumps(self.target))
        for hosts in updated['hosts'].values():
            for host in hosts:
                host['address'] = actual[host['instanceId']]['PrivateIpAddress']
                host['hostKey'] = observed[host['instanceId']]
        validate_target(updated, self.args.environment, self.first_migration)
        require(self.close_transport(), 'Systems Manager session cleanup failed; target was not updated')
        write(self.target_path, updated)
        self.target = updated
        self.hosts = {host['instanceId']:host for hosts in updated['hosts'].values() for host in hosts}
        self.receipt['principalArn'] = who['Arn']
        self.receipt['hostIdentityReconciliation'] = {
            'updatedInstanceIds': sorted(observed),
            'hostKeyRotationInstanceIds': rotations,
            'hostKeyRotationReason': reason if rotations else None,
            'addressKind': 'primary_private_ipv4',
            'targetUpdated': True,
        }

    def preflight(self):
        require(not (self.target.get('ecsRollbackBaseline') and self.args.apply and not getattr(self,'first_migration',False)),
                'Preserved ECS rollback window is still enrolled; close it explicitly before an ordinary Kamal release')
        who = self.aws(['sts','get-caller-identity'])
        require(who['Account'] == ACCOUNT and not who['Arn'].endswith(':root'), 'Expected account-scoped non-root principal')
        self.receipt['principalArn'] = who['Arn']
        infos = self.aws(['ec2','describe-instances','--instance-ids',*self.hosts])
        actual = {h['InstanceId']:h for r in infos['Reservations'] for h in r['Instances']}
        require(set(actual) == set(self.hosts), 'Incomplete EC2 readback')
        for iid, h in self.hosts.items():
            info = actual[iid]
            require(enrolled_host_matches(self.target, h, info),
                    'Host identity/state changed: ' + iid)
            require(info.get('IamInstanceProfile') and info['MetadataOptions']['HttpTokens'] == 'required'
                    and info['MetadataOptions']['HttpPutResponseHopLimit'] >= 2, 'Runtime IAM/IMDS not ready: '+iid)
        self.start_ssm_transport()
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
        if (self.args.apply or getattr(self.args, 'prepare', False)) and (not self.args.rollback or getattr(self,'first_migration',False)):
            self.command(['git','fetch','origin','main'],cwd=ROOT,log='fetch-main')
            self.controller_sha=self.command(['git','rev-parse','origin/main'],cwd=ROOT).strip()
            self.pinned_sha=self.controller_sha
            require(re.fullmatch(r'[0-9a-f]{40}',self.pinned_sha),'Invalid main source')
            if self.args.apply and self.target['kind']!='dev' and not self.local_uat_test:
                for path in CONTROLLER_FILES:
                    committed=self.command(['git','show',self.controller_sha+':'+path],cwd=ROOT)
                    require(committed==(ROOT/path).read_text(),'Controller differs from pinned main: '+path)
            if getattr(self, 'release_path', 'main') == 'hotfix' and not self.args.rollback:
                self.receipt['sourceSelection'] = hotfix_source(ROOT, self.args.production_baseline,
                    self.args.source_sha, self.args.hotfix_path)
                self.pinned_sha = self.args.source_sha
                self.verify_hotfix_baseline()
            elif getattr(self, 'release_path', 'main') == 'uat':
                self.load_uat_release()
                self.pinned_sha = self.uat_bundle['sourceCommit']
                self.command(['git','merge-base','--is-ancestor',self.pinned_sha,self.controller_sha],cwd=ROOT)
            expected={'GIT_SHA':self.pinned_sha,'ERP_CORE_INTERNAL_URL':self.provider_callback()}
            if any(runtime['environmentVariables'].get(k)!=v for k,v in expected.items()):
                require(self.target.get('agentcoreCandidateQualifier'), 'A new source requires an enrolled spare AgentCore endpoint before build')
        # No implicit authority to migrate existing ECS traffic. Production target enrollment is separate.
        if getattr(self, 'first_migration', False) and not self.args.rollback:
            require(not (self.state/'target.json').exists(), 'A Production target already exists; reconcile its enrollment')
            expiry = datetime.fromisoformat(self.target['migration']['authorityExpiresAt'])
            require((expiry-datetime.now(timezone.utc)).total_seconds() > 1800, 'Migration authority has less than thirty minutes remaining')
            self.migration.observe_ecs()
            for service, hosts in self.target['hosts'].items():
                label = self.target['servicePrefix'] + ('' if service == 'api-web' else '-'+service)
                for host in hosts:
                    require(not self.remote(host,['docker','ps','--all','--filter','label=service='+label,'--format','{{.ID}}']).strip(),
                            'Staged hosts already run applications; reconcile before a first migration')
            self.migration.routes(public=False)
            self.migration.traffic_prerequisites()
            self.migration.old_routes()
            self.migration.verify_ecs_provider()
        self.receipt['targetVerified'] = True

    def verify_hotfix_baseline(self):
        if getattr(self, 'first_migration', False):
            self.migration.observe_ecs()
            return
        observed = set()
        configurations = {}
        for service in SERVICES:
            service_values = []
            label = self.target['servicePrefix'] + ('' if service == 'api-web' else '-' + service)
            for host in self.target['hosts'][service]:
                ids = self.remote(host, ['docker','ps','--filter','label=service='+label,'--format','{{.ID}}']).split()
                require(len(ids) == 1, 'Hotfix requires one serving container per enrolled service/host')
                rows = json.loads(self.remote(host, ['docker','inspect',ids[0]]))
                require(len(rows) == 1 and rows[0]['State']['Running'], 'Hotfix baseline container is not running')
                values = dict(row.split('=',1) for row in rows[0]['Config']['Env'])
                require(values.get('DEPLOY_ENVIRONMENT') == 'production', 'Foreign hotfix baseline environment')
                self.verify_proxy(service, host, rows[0])
                observed.add(values.get('GIT_SHA'))
                image = json.loads(self.remote(host, ['docker','image','inspect',rows[0]['Image']]))[0]
                require(image['Config']['Labels'].get('org.opencontainers.image.revision') == self.args.production_baseline,
                        'Serving image label differs from the hotfix baseline')
                values = {k:v for k,v in values.items() if k not in ('KAMAL_CONTAINER_NAME','KAMAL_VERSION','KAMAL_HOST')}
                service_values.append(values)
                self.secrets.update(v for k,v in values.items() if len(v)>=8 and any(
                    token in k for token in ('SECRET','TOKEN','PASSWORD','KEY','DATABASE_URL','REDIS_URL')))
            require(all(values == service_values[0] for values in service_values), 'Production host configurations differ: '+service)
            configurations[service] = service_values[0]
        require(observed == {self.args.production_baseline}, 'Production source changed or is mixed; stop this hotfix')
        if hasattr(self, 'hotfix_configurations'):
            require(configurations == self.hotfix_configurations, 'Serving Production configuration changed during this hotfix')
        else:
            self.hotfix_configurations = configurations
            self.receipt['hotfixBaselineConfigSha256'] = digest(configurations)

    def load_uat_release(self):
        directory = self.args.uat_release.resolve()
        key = self.target.get('trustedUatSigningKeyArn', '')
        require(re.fullmatch(rf'arn:aws:kms:{REGION}:{ACCOUNT}:key/[A-Za-z0-9-]+', key), 'Trusted UAT signer is not enrolled')
        raw = (directory/'accepted.json').read_bytes()
        require(len(raw) <= 10 * 1024 * 1024, 'UAT receipt is too large')
        signature = (directory/'accepted.sig').read_bytes()
        require(0 < len(signature) <= 16384, 'Invalid UAT signature size')
        (self.work/'uat-accepted.sha256').write_bytes(hashlib.sha256(raw).digest())
        (self.work/'uat-accepted.sig').write_bytes(signature)
        metadata = self.aws(['kms','describe-key','--key-id',key])['KeyMetadata']
        require(metadata.get('Arn') == key and metadata.get('KeyUsage') == 'SIGN_VERIFY'
                and metadata.get('KeyState') == 'Enabled', 'Trusted UAT signing key is not ready')
        algorithm = next((a for a in ('RSASSA_PSS_SHA_256','ECDSA_SHA_256') if a in metadata.get('SigningAlgorithms',[])), None)
        require(algorithm, 'Unsupported UAT signing algorithm')
        verified = self.aws(['kms','verify','--key-id',key,'--message-type','DIGEST',
            '--message','fileb://'+str(self.work/'uat-accepted.sha256'),
            '--signature','fileb://'+str(self.work/'uat-accepted.sig'),'--signing-algorithm',algorithm])
        require(verified.get('SignatureValid') is True, 'UAT signature did not verify')
        accepted = json.loads(raw)
        self.uat_bundle = accepted_uat_bundle(accepted)
        artifact = directory/'build'/'agentcore'/self.uat_bundle['agentcore']['artifact']
        require(hashlib.sha256(artifact.read_bytes()).hexdigest() == self.uat_bundle['agentcore']['sha256'], 'UAT AgentCore archive mismatch')
        self.uat_archive = artifact
        self.receipt['sourceSelection'] = {'kind':'signed_uat_promotion','sourceCommit':accepted['sourceCommit'],
            'uatOperationId':accepted['operationId'],'acceptedSha256':hashlib.sha256(raw).hexdigest(),
            'signingKeyArn':key,'signatureVerified':True}

    def source_and_build(self):
        sha = self.pinned_sha
        require(re.fullmatch(r'[0-9a-f]{40}',sha), 'Invalid main source')
        source = self.work/'source'
        self.receipt['sourceCommit'] = sha
        self.build_dir = self.work/'build'
        prepared = getattr(self.args, 'prepared_build', None) if hasattr(self, 'args') else None
        if prepared:
            require(self.release_path in ('main','hotfix'), 'Prepared local build cannot replace a signed UAT promotion')
            self.source = prepared.resolve().parent/'source'
            self.load_prepared_build(prepared.resolve())
        else:
            self.command(['git','worktree','add','--detach',str(source),sha],cwd=ROOT,log='checkout-main')
            self.source = source
        if getattr(self, 'release_path', 'main') == 'uat':
            self.load_promoted_images()
            return
        if not prepared:
            timeout = UAT_BUILD_SECONDS if self.args.environment == 'uat' and self.args.apply else 1800
            self.command([sys.executable,str(HELPERS/'build-complete.py'),str(source),str(self.build_dir)], timeout=timeout,log='build')
        self.build = read(self.build_dir/'build-result.json')
        require(self.build['status']=='passed', 'Build/TypeScript failed')
        if getattr(self, 'release_path', 'main') == 'hotfix':
            groups = {}
            for path in self.args.regression_test:
                match = re.fullmatch(r'((?:apps/(?:api|ai-gateway|workers|web)|packages/contracts))/(src/.+\.spec\.(?:ts|tsx))', path)
                require(match and (self.source/path).is_file(), 'Invalid hotfix regression test')
                groups.setdefault(match[1], []).append(match[2])
            changed_tests = {p for p in self.args.hotfix_path if not p.startswith('e2e/') and re.search(r'\.spec\.(?:ts|tsx)$', p)}
            require(changed_tests <= set(self.args.regression_test), 'Every changed regression test must run')
            for app, paths in groups.items():
                self.command(['pnpm','exec','tsx','--test',*paths],cwd=self.source/app,
                             timeout=1800,log='hotfix-regression-'+app.replace('/', '-'))
            self.receipt['hotfixValidation'] = {'typecheck':'PASSED','regressionTests':self.args.regression_test}

    def load_prepared_build(self, directory):
        build = read(directory/'build-result.json')
        require(build.get('status') == 'passed' and build.get('sourceCommit') == self.pinned_sha,
                'Prepared build is not the selected successful candidate')
        require(self.command(['git','rev-parse','HEAD'],cwd=self.source).strip() == self.pinned_sha
                and not self.command(['git','status','--porcelain','--untracked-files=normal'],cwd=self.source).strip(),
                'Prepared source changed after the build')
        tree = self.command(['git','ls-tree','-rz','--full-tree',self.pinned_sha],cwd=self.source).encode()
        require(tree == (directory/'source-tree.bin').read_bytes()
                and hashlib.sha256(tree).hexdigest() == build.get('sourceTreeSha256'), 'Prepared source tree mismatch')
        phases = {'install','contracts','prisma','typescript','di','agentcore','build-api-web',
                  'build-ai-gateway','build-workers','export-tools-base','build-tools'}
        require(set(build.get('phases',{})) == phases and all(build['phases'][p].get('exitCode') == 0
                and (directory/(p+'.log')).is_file() for p in phases), 'Prepared validation evidence is incomplete')
        require(set(build.get('images',{})) == {*SERVICES,'tools'}, 'Prepared image set is incomplete')
        for service, row in build['images'].items():
            info = json.loads(self.command(['docker','image','inspect',row['tag']]))[0]
            require(info['Id'] == row['imageId'] and info['Architecture'] == row['architecture'] == 'amd64'
                    and info['Config']['Labels'].get('org.opencontainers.image.revision') == self.pinned_sha,
                    'Prepared image identity changed: '+service)
        archive = directory/'agentcore/agentcore.zip'
        require(build['agentcore']['sourceCommit'] == self.pinned_sha and
                hashlib.sha256(archive.read_bytes()).hexdigest() == build['agentcore']['sha256'], 'Prepared AgentCore archive changed')
        shutil.copytree(directory,self.build_dir)
        self.receipt['preparedBuild'] = {'resultSha256':hashlib.sha256((directory/'build-result.json').read_bytes()).hexdigest(),
            'originalBuildSeconds':build['elapsedSeconds'],'identitiesRevalidated':True}

    def load_promoted_images(self):
        self.build_dir.mkdir()
        tree = self.command(['git','ls-tree','-rz','--full-tree',self.pinned_sha],cwd=self.source)
        require(hashlib.sha256(tree.encode()).hexdigest() == self.uat_bundle['sourceTreeSha256'], 'UAT source tree mismatch')
        images = {}
        with self.registry_login() as login_env:
            for service, artifact in self.uat_bundle['images'].items():
                self.command(['docker','pull','--platform','linux/amd64',artifact['uri']],env=login_env,timeout=240,log='pull-uat-'+service)
                info = json.loads(self.command(['docker','image','inspect',artifact['uri']]))[0]
                require(info['Id'] == artifact['imageId'] and info['Architecture'] == 'amd64'
                        and info['Config']['Labels'].get('org.opencontainers.image.revision') == self.pinned_sha,
                        'Promoted image/source identity mismatch: '+service)
                images[service] = {'tag':artifact['uri'],'imageId':info['Id'],'architecture':'amd64'}
        archive_dir = self.build_dir/'agentcore'; archive_dir.mkdir()
        shutil.copyfile(self.uat_archive, archive_dir/self.uat_bundle['agentcore']['artifact'])
        self.build = {'status':'passed','scope':'Verified signed UAT artifacts; no rebuild',
            'sourceCommit':self.pinned_sha,'sourceTreeSha256':self.uat_bundle['sourceTreeSha256'],
            'images':images,'agentcore':self.uat_bundle['agentcore']}
        write(self.build_dir/'build-result.json',self.build)

    def enrolled_baseline(self):
        # A rebuilt environment has no ECS services to read: its configuration bodies are enrolled under its own
        # .env.kamal directory (a rehearsal may read another environment than the one it deploys to).
        baseline = self.state.parent/self.args.environment/'config-baseline'
        return ['--baseline',str(baseline)] if baseline.is_dir() else []

    def configuration(self):
        capture = self.work/'capture'
        cmd=[sys.executable,str(HELPERS/'capture-config.py'),'--environment',self.args.environment,
             '--private-output',str(capture),'--evidence',str(self.work/'capture-evidence.json'),'--resolve-secrets']
        if self.args.profile: cmd += ['--profile',self.args.profile]
        else: cmd += ['--profile','']
        self.command(cmd+self.enrolled_baseline(),timeout=180,log='capture')
        for s in SERVICES:
            for k,v in read(capture/(s+'.resolved.json')).items():
                if isinstance(v,str) and any(n in k for n in ('SECRET','TOKEN','PASSWORD','KEY','DATABASE_URL','REDIS_URL')):
                    self.secrets.add(v)
        config_path = self.source/'infra/kamal/config.json'
        if (self.target['kind'] == 'dev' or self.local_uat_test) and not config_path.exists():
            config_path = ROOT/'infra/kamal/config.json'
            self.receipt['controllerConfigScope'] = 'unmerged controller rehearsal; application source remains exact main'
        if getattr(self, 'release_path', 'main') == 'hotfix':
            if getattr(self, 'first_migration', False):
                self.hotfix_configurations = {s:read(capture/(s+'.resolved.json')) for s in SERVICES}
                for service in SERVICES:
                    from first_migration import service_body
                    require(service_body(service, read(capture/(service+'.configuration.json'))) ==
                            self.migration.state['ecsBaseline'][service]['body'], 'Captured ECS config differs from the running baseline')
            for service, values in self.hotfix_configurations.items():
                captured = read(capture/(service+'.resolved.json'))
                references = without_ai_jwt_secrets(service, {row['name']:row['valueFrom'] for row in
                    read(capture/(service+'.configuration.json'))['primaryContainer'].get('secrets',[])})
                require(all(values.get(key) == captured.get(key) for key in references),
                        'Current secret differs from the serving hotfix baseline: '+service)
                write(capture/(service+'.resolved.json'),without_ai_jwt_secrets(service,values))
            configured = {s:{} for s in SERVICES}
            self.receipt['controllerConfigScope'] = 'preserve serving Production config; topology/build identity only'
            self.receipt['controllerConfigSha256'] = digest(configured)
        else:
            require(config_path.exists(), 'Release command/config must be committed to main before an environment deployment')
            self.receipt['controllerConfigSha256'] = hashlib.sha256(config_path.read_bytes()).hexdigest()
            configured = read(config_path)[self.args.environment]
        captured = None if getattr(self, 'release_path', 'main') == 'hotfix' else {
            s: read(capture/(s+'.resolved.json')) for s in SERVICES}
        overrides = make_overrides(self.target,self.build['sourceCommit'],self.build['agentcore']['sha256'],configured,captured)
        if getattr(self, 'release_path', 'main') != 'hotfix':
            overrides['api-web'].update(self.postmark_configuration(capture))
            overrides['api-web'].update(self.official_configuration(capture, configured['api-web']))
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

    def postmark_configuration(self, capture):
        if self.target['kind'] == 'dev':
            return {}
        # Canonical mail settings override the legacy ECS baseline on every Kamal release.
        mail_path = self.source/'infra/postmark/config.py'
        spec = importlib.util.spec_from_file_location('postmark_deployment', mail_path)
        mail = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mail)
        settings = mail.deployment_config(read(mail_path.with_name('config.json')), self.args.environment)
        origin = 'https://uat.mangmeeplus.com' if self.args.environment == 'uat' else 'https://mangmeeplus.com'
        if settings['provider'] == 'postmark':
            require(self.target['publicUrl'].rstrip('/') == origin, 'Postmark web origin does not match environment')
        values, versions = mail.resolve_secrets(settings, lambda ref: self.aws([
            'secretsmanager','get-secret-value','--secret-id',ref,'--version-stage','AWSCURRENT']))
        self.secrets.update(values.values())
        write(capture/'postmark-readiness.json', mail.native_preflight(settings, values))
        secret_versions = read(capture/'secret-versions.json')
        secret_versions.update(versions)
        write(capture/'secret-versions.json', secret_versions)
        return dict(settings['environment'], **values, EMAIL_PROVIDER=settings['provider'],
            WEB_BASE_URL=self.target['publicUrl'].rstrip('/'))

    def official_configuration(self, capture, configured):
        if configured.get('LINE_OFFICIAL_REPLY_ENABLED') != 'true':
            return {}
        require(self.args.environment == 'production' and self.target['publicUrl'].rstrip('/') == 'https://mangmeeplus.com',
                'Official OA credentials are scoped to Production')
        values, versions = {}, read(capture/'secret-versions.json')
        for key, suffix in (('LINE_OFFICIAL_CHANNEL_SECRET', 'channel-secret'),
                            ('LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN', 'channel-access-token')):
            name = 'watchdog-bms/production/line-official/'+suffix
            data = self.aws(['secretsmanager','get-secret-value','--secret-id',name,'--version-stage','AWSCURRENT'])
            value = data.get('SecretString')
            require(data.get('Name') == name and data.get('ARN', '').startswith(
                    f'arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:'+name+'-') and
                    'AWSCURRENT' in data.get('VersionStages', []) and data.get('VersionId') and
                    isinstance(value, str) and bool(value.strip()), 'Invalid current Official OA secret version')
            self.secrets.add(value)
            values[key] = value
            versions[data['ARN']] = {'versionId':data['VersionId'], 'value':value}
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        request = urllib.request.Request('https://api.line.me/v2/bot/info', headers={
            'Authorization':'Bearer '+values['LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN']})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                require(response.status == 200, 'Official OA bot preflight unavailable')
                bot = json.loads(response.read(65536))
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise ValueError('Official OA bot preflight unavailable') from None
        require(isinstance(bot, dict) and bot.get('basicId') == '@695ultfm', 'Official OA token belongs to a different bot')
        write(capture/'secret-versions.json', versions)
        write(capture/'official-oa-readiness.json', {'basicId':bot['basicId'], 'outbound':'native-identity-checked'})
        return values

    def config_freshness(self):
        if 'controllerManifest' in self.receipt:
            require(controller_manifest()==self.receipt['controllerManifest'], 'Controller changed during release')
        cmd=[sys.executable,str(HELPERS/'capture-config.py'),'--environment',self.args.environment,
             '--private-output',str(self.work/'recapture'),'--evidence',str(self.work/'recapture-evidence.json'),
             '--profile',self.args.profile or '']
        self.command(cmd+self.enrolled_baseline(),timeout=180,log='config-freshness')
        before,after=read(self.work/'capture-evidence.json'),read(self.work/'recapture-evidence.json')
        require(before['secretVersions']==after['secretVersions'], 'Secrets rotated after capture; stop before runtime mutation')
        for ref, version in self.manifest['secretVersions'].items():
            if '/postmark/' in ref or '/line-official/' in ref:
                provider = 'Postmark' if '/postmark/' in ref else 'Official OA'
                current = self.aws(['secretsmanager','describe-secret','--secret-id',ref])
                active = [key for key, stages in current.get('VersionIdsToStages', {}).items() if 'AWSCURRENT' in stages]
                require(current.get('ARN') == ref and not current.get('DeletedDate') and active == [version],
                    provider+' secret rotated after capture; stop before runtime mutation')
        require({s:v['configurationSha256'] for s,v in before['services'].items()}==
                {s:v['configurationSha256'] for s,v in after['services'].items()}, 'Configuration changed after capture')
        self.receipt['configFreshnessVerifiedAt']=after['readAt']
        if getattr(self, 'release_path', 'main') == 'hotfix':
            self.verify_hotfix_baseline()

    def render(self):
        for service in SERVICES:
            d=self.work/'native'/service
            d.mkdir(parents=True)
            shutil.copyfile(Path(self.target['sshKey']).expanduser(), d/'id_ed25519'); (d/'id_ed25519').chmod(0o600)
            shutil.copyfile(self.work/'known_hosts',d/'known_hosts')
            ssh='Host *\n  StrictHostKeyChecking yes\n  UserKnownHostsFile /workdir/known_hosts\n  IdentitiesOnly yes\n'
            for host in self.target['hosts'][service]:
                proxy = self.ssh_proxy(host, container=True)
                if proxy: ssh += 'Host '+host['address']+'\n  ProxyCommand '+proxy+'\n'
            (d/'ssh_config').write_text(ssh)
            write(d/'config/deploy.yml',native_config(self.target,service,self.envs[service],self.build['sourceCommit'],d))
            (d/'.kamal').mkdir()
            # Application PATH/HOME must never replace the controller or Kamal process environment.
            (d/'.kamal/secrets').write_text('KAMAL_REGISTRY_PASSWORD=$KAMAL_REGISTRY_PASSWORD\n'+
                '\n'.join(k+'=$KAMAL_APP_'+k for k in sorted(self.envs[service]))+'\n')
            self.kamal(service,['config'],fake=True)

    def storage_capacity(self):
        sizes = {}
        for service, artifact in self.manifest['artifacts'].items():
            info = json.loads(self.command(['docker','image','inspect',artifact['tag']]))[0]
            require(info['Id'] == artifact['imageId'] and isinstance(info.get('Size'), int) and info['Size'] > 0,
                    'Cannot size exact candidate image: '+service)
            sizes[service] = info['Size']
        assignments = {iid:set() for iid in self.hosts}
        for service, hosts in self.target['hosts'].items():
            for host in hosts: assignments[host['instanceId']].add(service)
        assignments[self.target['hosts']['api-web'][0]['instanceId']].add('tools')
        evidence = {}
        for iid, services in assignments.items():
            host = self.hosts[iid]
            root = self.remote(host, ['docker','info','--format','{{.DockerRootDir}}']).strip()
            require(root.startswith('/'), 'Docker root directory is invalid: '+iid)
            lines = self.remote(host, ['df','-Pk',root]).splitlines()
            fields = lines[-1].split() if lines else []
            require(len(fields) >= 6 and fields[3].isdigit(), 'Cannot read Docker filesystem capacity: '+iid)
            available = int(fields[3]) * 1024
            candidate = sum(sizes[service] for service in services)
            minimum = candidate * HOST_STORAGE_MULTIPLIER + HOST_STORAGE_HEADROOM_BYTES
            evidence[iid] = {'availableBytes':available,'minimumRequiredBytes':minimum,
                'candidateImageBytes':candidate,'services':sorted(services)}
            require(available >= minimum, 'Insufficient Docker filesystem capacity before publication: '+iid)
        self.receipt['hostStorageCapacity'] = evidence

    def uat_pre_mutation_budget(self):
        if self.args.environment != 'uat': return
        elapsed = round(time.monotonic() - self.clock, 3)
        self.receipt['durationBudget'] = {'targetSeconds':UAT_DEPLOY_TARGET_SECONDS,
            'preMutationMaximumSeconds':UAT_PRE_MUTATION_SECONDS,'preMutationElapsedSeconds':elapsed}
        require(elapsed <= UAT_PRE_MUTATION_SECONDS,
                'UAT pre-mutation budget exceeded; reuse the exact validated --prepared-build')

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

    @contextmanager
    def registry_login(self):
        registry=f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com'
        self.token=self.command(self.aws_prefix+['ecr','get-login-password']).strip(); self.secrets.add(self.token)
        login_env=dict(os.environ,DOCKER_CONFIG=str(self.work/'registry-login'))
        try:
            self.command(['docker','login','--username','AWS','--password-stdin',registry],input=self.token,env=login_env)
            yield login_env
        finally:
            shutil.rmtree(self.work/'registry-login',ignore_errors=True)

    def publish(self):
        registry=f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com'
        self.images={}
        with self.registry_login() as login_env:
            for s,a in self.manifest['artifacts'].items():
                # Native service labels are target-specific; wrapper changes metadata only.
                tag=registry+'/'+self.target['repository']+':'+self.version(s)
                label=self.target['servicePrefix']+('' if s=='api-web' else '-'+s)
                if getattr(self, 'release_path', 'main') == 'uat':
                    self.command(['docker','tag',a['tag'],tag])
                else:
                    self.command(['docker','build','--platform','linux/amd64','--build-arg','BASE='+a['tag'],
                        '--label','service='+label,'-t',tag,'-f','-','.'],input='ARG BASE\nFROM ${BASE}\n',cwd=self.source,timeout=180)
                info=json.loads(self.command(['docker','image','inspect',tag]))[0]
                original=json.loads(self.command(['docker','image','inspect',a['tag']]))[0]
                require(info['RootFS']==original['RootFS'], 'Publication wrapper changed runtime files')
                self.command(['docker','push',tag],env=login_env,timeout=240,log='publish-'+s)
                data=self.aws(['ecr','describe-images','--repository-name',self.target['repository'],'--image-ids','imageTag='+self.version(s)])['imageDetails']
                require(len(data)==1, 'Published digest missing')
                if getattr(self, 'release_path', 'main') == 'uat':
                    expected = self.uat_bundle['images'][s]
                    require(info['Id'] == expected['imageId'] and data[0]['imageDigest'] == expected['uri'].rsplit('@',1)[1],
                            'Promotion changed the signed UAT image digest: '+s)
                self.images[s]={'tag':tag,'imageId':info['Id'],'digest':data[0]['imageDigest']}
            write(self.work/'publication.json',self.images)
        for h in self.hosts.values():
            self.remote(h,['docker','login','--username','AWS','--password-stdin',registry],stdin=self.token)
        for s in SERVICES:
            for h in self.target['hosts'][s]: self.remote(h,['docker','pull',self.images[s]['tag']],timeout=240)
        self.remote(self.target['hosts']['api-web'][0],['docker','pull',self.images['tools']['tag']],timeout=240)

    def publish_prepared_images(self):
        # Registry writes only: an apply still pushes its own tags, and then finds every layer already uploaded.
        # The repository is tag-immutable, so each preparation uses its own `prepared-` tags.
        registry=f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com'
        rows=self.receipt['preparedImagePublication']=[]
        with self.registry_login() as login_env:
            for s,a in self.manifest['artifacts'].items():
                version='prepared-'+self.version(s); tag=registry+'/'+self.target['repository']+':'+version
                start=time.monotonic()
                self.command(['docker','tag',a['tag'],tag])
                self.command(['docker','push',tag],env=login_env,timeout=PREPARED_PUBLISH_SECONDS,log='publish-prepared-'+s)
                data=self.aws(['ecr','describe-images','--repository-name',self.target['repository'],'--image-ids','imageTag='+version])['imageDetails']
                require(len(data)==1, 'Published digest missing')
                rows.append({'service':s,'tag':tag,'digest':data[0]['imageDigest'],'seconds':round(time.monotonic()-start,3)})

    def tool(self, command, *, extra=None, timeout=240, stdin=''):
        env={**self.envs['api-web'],**(extra or {})}
        args=['docker','run','--rm','-i','--network','kamal']
        for k in env: args+=['--env',k]
        args+=['--entrypoint',command[0],self.images['tools']['tag'],*command[1:]]
        return self.remote(self.target['hosts']['api-web'][0],args,environment=env,stdin=stdin,timeout=timeout)

    def migrations(self):
        if getattr(self,'first_migration',False): self.assert_no_legacy_operation()
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

    def assert_no_legacy_operation(self):
        script="""const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=require('./src/generated/prisma/client');
const client=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
(async()=>{try{const count=await client.$transaction(async tx=>{
await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
return tx.remoteReleaseOperation.count({where:{targetEnvironment:'production',status:{in:['RUNNING','UNKNOWN']}}});
});if(count!==0)throw Error('legacy_release_active');console.log(JSON.stringify({passed:true}));}
finally{await client.$disconnect();}})().catch(()=>process.exit(1));"""
        result=json.loads(self.tool(['./node_modules/.bin/tsx','--eval',script]))
        require(result.get('passed') is True, 'Legacy durable release operation is not reconciled')

    def run(self):
        lock=self.state/'deployment.lock'
        with lock.open('a+') as handle:
            try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError('An environment deployment is already active')
            # A failed/unknown previous mutation cannot be hidden by a fresh run directory.
            active=self.state/'active.json'
            if self.args.rollback:
                if getattr(self, 'first_migration', False): self.rollback_first_migration(active)
                else: self.rollback(active)
                return
            require(not active.exists(), 'Previous deployment needs explicit reconciliation: '+str(active))
            if getattr(self.args, 'reconcile_host_identity', False):
                with self.phase('host-identity-reconciliation'): self.reconcile_host_identity()
                self.receipt['status']='HOST_IDENTITY_RECONCILED'; return
            with self.phase('target-preflight'): self.preflight()
            if getattr(self.args, 'prepare', False):
                with self.phase('main-typescript-build'): self.source_and_build()
                with self.phase('fresh-config-and-image-validation'): self.configuration(); self.render()
                with self.phase('host-storage-capacity'): self.storage_capacity()
                with self.phase('config-freshness-readback'): self.config_freshness()
                if getattr(self.args, 'publish_images', False):
                    with self.phase('publish-prepared-images'): self.publish_prepared_images()
                self.receipt['status']='PREPARED_NO_DEPLOYMENT'; return
            if not self.args.apply:
                self.receipt['status']='PREFLIGHT_PASSED_NO_DEPLOYMENT'; return
            self.acquire_remote_lock()
            write(active,{'operationId':self.id,'result':str(self.work/'result.json')})
            try:
                with self.phase('main-typescript-build'): self.source_and_build()
                with self.phase('fresh-config-and-image-validation'): self.configuration(); self.render()
                with self.phase('host-storage-capacity'): self.storage_capacity()
                if getattr(self, 'first_migration', False):
                    with self.phase('legacy-ecs-release-fence'): self.migration.workflow_fence(disable=True)
                with self.phase('publish-and-pull'): self.publish()
                with self.phase('config-freshness-before-mutation'): self.config_freshness()
                self.uat_pre_mutation_budget()
                with self.phase('provider-preparation'): self.agentcore()
                with self.phase('database-and-feature-authority'):
                    self.changed.append('database-sync-started')
                    self.migrations()
                with self.phase('native-rollout-and-readback'): self.deploy()
                with self.phase('customer-acceptance'): self.acceptance()
                with self.phase('retire-observed-builds'): self.retire()
                with self.phase('receipt-signature'): self.sign()
                if getattr(self, 'first_migration', False):
                    self.enroll_first_migration()
                self.receipt['status']='ACCEPTED_LINE_DEFERRED'
                self.release_remote_lock()
                active.unlink()
            except BaseException:
                self.receipt['status']='FAILED_RECONCILIATION_REQUIRED' if self.changed else 'FAILED'
                if not self.changed:
                    self.release_remote_lock()
                    active.unlink()
                raise

    def enroll_first_migration(self):
        require(self.receipt.get('signature',{}).get('verified') is True
                and self.receipt['customerAcceptance']['passed'] is True
                and self.migration.state.get('publicTraffic') is True, 'Migration acceptance is incomplete')
        target = json.loads(json.dumps(self.target))
        target.update(cutoverComplete=True, ecsRollbackBaseline=self.args.production_baseline)
        target['migration'].update(state='ACCEPTED_WITH_ECS_ROLLBACK', operationId=self.id,
            acceptedSha256=hashlib.sha256((self.work/'accepted.json').read_bytes()).hexdigest())
        require(not (self.state/'target.json').exists(), 'Production enrollment appeared during cutover')
        write(self.state/'target.json',target)
        self.receipt['enrollment'] = {'cutoverComplete':True,'ecsRollbackBaseline':self.args.production_baseline}

    def rollback_first_migration(self, active):
        require(self.args.apply and re.fullmatch(r'[0-9TZ-]+-[0-9a-f]{8}',self.args.rollback), 'Explicit migration rollback operation is required')
        old = self.state/'runs'/self.args.rollback
        result = read(old/'result.json')
        require(result.get('environment') == result.get('kind') == 'production'
                and result.get('sourceCommit') == self.args.source_sha
                and result.get('status') in ('ACCEPTED_LINE_DEFERRED','FAILED_RECONCILIATION_REQUIRED'), 'Wrong or nonterminal migration operation')
        self.migration.state = read(old/'migration.private.json')
        require(self.migration.state['baselineSourceCommit'] == self.args.production_baseline, 'Rollback baseline mismatch')
        database_started = self.load_migration_rollback(old, result)
        with self.phase('migration-rollback-preflight'): self.preflight()
        self.remote_lock='/home/ubuntu/.kamal/'+self.target['servicePrefix']+'-release-lock'
        if active.exists():
            require(read(active)['operationId'] == self.args.rollback, 'Another operation owns the migration lock')
            script="import pathlib,sys;p=pathlib.Path(sys.argv[1]);assert (p/'owner').read_text()==sys.argv[2];(p/'owner').write_text(sys.argv[3])"
            self.remote(self.target['hosts']['api-web'][0],['python3','-c',script,self.remote_lock,self.args.rollback,self.id])
            self.remote_lock_owned=True
        else: self.acquire_remote_lock()
        write(active,{'operationId':self.id,'result':str(self.work/'result.json'),'rollbackOf':self.args.rollback})
        self.changed.append('migration-rollback-started'); self.receipt['rollbackOf']=self.args.rollback
        with self.phase('restore-ecs-traffic-and-consumers'):
            self.migration.rollback()
            for service in ('api-web','ai-gateway'): self.stop_candidate_service(service)
            self.receipt['agentcore']=self.migration.verify_ecs_provider()
            if database_started: self.verify_ecs_build_authority()
        self.ecs_restored=True
        self.build={'sourceCommit':self.args.production_baseline}
        self.manifest={'schemaVersion':1,'sourceCommit':self.args.production_baseline,'rollbackOf':self.args.rollback,
            'ecsBaselineSha256':digest(self.migration.state['ecsBaseline'])}
        self.manifest['releaseId']=digest(self.manifest)
        self.receipt.update(sourceCommit=self.args.production_baseline,releaseId=self.manifest['releaseId'])
        self.receipt['runtimeReadback']=self.migration.runtime_summary()
        self.receipt['launchRetirement']={'passed':True,'mode':'PRESERVE_ECS_ROLLBACK','retiredCount':0,
            'retainedSourceCommit':self.args.production_baseline,
            'authorityCheck':'VERIFIED' if database_started else 'UNCHANGED_NO_DATABASE_PHASE'}
        with self.phase('ecs-rollback-customer-acceptance'): self.acceptance()
        with self.phase('restore-legacy-ecs-workflows'): self.migration.restore_workflows()
        with self.phase('ecs-rollback-signature'): self.sign(state='ROLLED_BACK_TO_ECS')
        enrollment=self.state/'target.json'
        if enrollment.exists():
            value=read(enrollment)
            require(value.get('migration',{}).get('operationId') == self.args.rollback, 'Enrollment belongs to another release')
            value['cutoverComplete']=False; value['migration']['state']='ROLLED_BACK_TO_ECS'
            write(enrollment,value)
        self.receipt['status']='ROLLED_BACK_TO_ECS'
        self.release_remote_lock(); active.unlink()

    def load_migration_rollback(self, old, result):
        # Publication may have failed after fencing workflows but before writing its manifest.
        # Load all required recovery inputs before taking ownership of the old remote lock.
        self.build=read(old/'build/build-result.json')
        require(self.build['sourceCommit'] == self.args.source_sha, 'Recovery build source mismatch')
        database_started=any(p['name']=='database-and-feature-authority' for p in result.get('phases',[]))
        self.images=read(old/'publication.json') if (old/'publication.json').exists() else {}
        require(not database_started or set(self.images) == set(SERVICES) | {'tools'},
                'Database phase requires the retained complete publication for recovery')
        self.envs={s:read(old/'environments'/(s+'.environment.json')) for s in SERVICES}
        for env in self.envs.values(): self.secrets.update(v for v in env.values() if len(v)>=8)
        return database_started

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
        # AgentCore re-checks every grant's model against its own approval list, so it carries the
        # gateway's released approval values; otherwise a model approved in config.json reaches the
        # API and gateway while AgentCore keeps the old list and refuses those turns.
        expected.update({k: ai[k] for k in AGENTCORE_AI_APPROVAL_KEYS if k in ai})
        actual_env = runtime['environmentVariables']
        if all(actual_env.get(k)==v for k,v in expected.items()) and not any(k in actual_env for k in AI_JWT_SECRET_KEYS):
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
        updates=without_ai_jwt_secrets('ai-gateway', {**actual_env,**expected,'SERVICE_VERSION':self.build['sourceCommit']})
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
        if getattr(self, 'first_migration', False):
            self.receipt['runtimeReadback'] = {}
            self.migration.handover()
            return
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
        self.receipt['runtimeReadback'] = {}
        for service in ORDER:
            self.deploy_service(service)

    def deploy_service(self, service):
        self.changed.append(service+'-rollout-started')
        if self.args.environment=='production': self.receipt['productionMutated']=True
        self.save()
        if getattr(self, 'release_path', 'main') == 'uat':
            # Native app boot preserves the signed image, including its existing service label.
            for host in self.target['hosts'][service]:
                info = json.loads(self.remote(host,['docker','image','inspect',self.images[service]['tag']]))[0]
                require(info['Id'] == self.images[service]['imageId'], 'Pulled promotion tag moved before boot')
            self.kamal(service,['app','boot'])
        else:
            self.kamal(service,['deploy','--skip-push'])
        self.receipt['runtimeReadback'][service] = self.inspect_service(service)
        self.deep_health(service)

    def candidate_services(self, service):
        rows = []
        label = self.target['servicePrefix']+('' if service == 'api-web' else '-'+service)
        for host in self.target['hosts'][service]:
            ids = self.remote(host, ['docker','ps','--all','--filter','label=service='+label,'--format','{{.ID}}']).split()
            for cid in ids:
                info = json.loads(self.remote(host, ['docker','inspect',cid]))[0]
                values = dict(v.split('=',1) for v in info['Config']['Env'])
                require(values.get('GIT_SHA') == self.build['sourceCommit'], 'Unexpected application source; do not stop another release')
                rows.append((host, info))
        return rows

    def assert_candidate_workers_stopped(self):
        self.assert_candidate_service_stopped('workers')

    def assert_candidate_service_stopped(self, service):
        for _, info in self.candidate_services(service):
            require(info['State']['Status'] in ('exited','created') and not info['State']['Running']
                    and info['HostConfig']['RestartPolicy']['Name'] in ('','no'),
                    'Candidate application must remain stopped with automatic restart disabled')

    def stop_candidate_workers(self):
        self.stop_candidate_service('workers')
        self.assert_candidate_workers_stopped()

    def stop_candidate_service(self, service):
        for host, info in self.candidate_services(service):
            self.migration.intent('stop-candidate-'+service+'-'+host['instanceId'], {'containerId':info['Id']})
            self.remote(host, ['docker','update','--restart=no',info['Id']])
            if info['State']['Running'] or info['State']['Status'] == 'restarting':
                self.remote(host, ['docker','stop','--time','180',info['Id']], timeout=240)
        self.assert_candidate_service_stopped(service)

    def verify_ecs_build_authority(self):
        self.tool(['./node_modules/.bin/tsx','prisma/verify-feature-launch-build-authority.ts'],
                  extra={'GIT_SHA':self.args.production_baseline, 'SERVICE_VERSION':self.args.production_baseline,
                         'AWS_EC2_METADATA_DISABLED':'true'})

    def retire(self):
        if getattr(self, 'first_migration', False):
            self.migration.observe_ecs(parked=True)
            self.verify_ecs_build_authority()
            self.receipt['launchRetirement'] = {'passed':True,'mode':'PRESERVE_ECS_ROLLBACK',
                'retiredCount':0,'retainedSourceCommit':self.args.production_baseline,
                'reason':'ECS rollback source must remain accepted until its rollback window is explicitly closed'}
            return
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
            if getattr(self, 'production_browser', False):
                require(self.args.environment == self.target['kind'] == 'production', 'Production browser acceptance cannot target UAT/dev')
                require(self.target.get('browserAcceptanceUserId') == 'cmt8k20fs00000q319isxwkc5',
                        'Production browser acceptance requires the current prodmangmeeplus administrator')
            else:
                require(self.args.environment=='uat' and self.target['kind']=='uat',
                        'Browser acceptance is only supported for a real UAT deployment or rollback; Production needs its explicit flag')
                require(self.target.get('browserAcceptanceUserId'), 'Enroll the expected UAT browser account userId')
        else:
            require(Path(self.target.get('acceptanceCredentials','')).expanduser().is_file(), 'Acceptance credentials file is missing')

    def browser_acceptance(self):
        # ponytail: keep this operation alive; a stopped process needs explicit reconciliation, not another deploy.
        binding={'schemaVersion':1,'operationId':self.id,'sourceCommit':self.build['sourceCommit'],
            'releaseId':self.manifest['releaseId'],'environment':self.args.environment,'origin':self.target['publicUrl'].rstrip('/'),
            'userId':self.target['browserAcceptanceUserId']}
        if self.args.rollback: binding['rollbackOf']=self.args.rollback
        required=('ownerLogin','systemAdminPermission','customerOpen','authenticatedRead','logout','sessionRejectedAfterLogout')
        if self.args.environment == 'production':
            required += ('identityVerified', 'noPasswordOrLegalAction', 'servingLive', 'canOpen')
        write(self.work/'browser-acceptance-request.json',{**binding,'checks':{k:False for k in required},
            'observer':'','evidenceFiles':[]})
        self.receipt.update(status='AWAITING_BROWSER_ACCEPTANCE',websiteReadyAt=datetime.now(timezone.utc).isoformat(),
            secondsToWebsiteReady=round(time.monotonic()-self.clock,3))
        self.save()
        proof_path=self.work/'browser-acceptance.json'
        print(self.args.environment+' website ready for owner login: '+binding['origin']+'/login\n'
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
        if getattr(self, 'ecs_restored', False):
            self.receipt.update(status='RUNNING',runtimeReadback=self.migration.runtime_summary())
            return result
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
                self.receipt['customerAcceptance']={'passed':True,'checks':checks,'browser':browser,
                    'line':'NOT_EXERCISED' if self.args.environment == 'production' else 'DEFERRED_BY_OWNER'}
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
        elapsed = round(time.monotonic()-self.clock,3)
        accepted={'schemaVersion':1,'operationId':self.id,'environment':self.args.environment,'kind':self.target['kind'],
            'sourceCommit':self.build['sourceCommit'],'releaseId':self.manifest['releaseId'],
            'state':state,'completedAt':datetime.now(timezone.utc).isoformat(),
            'controllerSha256':self.receipt.get('controllerSha256'),
            'controllerConfigSha256':self.receipt.get('controllerConfigSha256'),
            'rollbackOf':self.receipt.get('rollbackOf'),
            'runtimeReadback':self.receipt['runtimeReadback'],'readiness':self.receipt.get('readiness',{}),'agentcore':self.receipt['agentcore'],
            'launchRetirement':self.receipt['launchRetirement'],
            'customerAcceptance':self.receipt['customerAcceptance'],'elapsedThroughAcceptanceSeconds':elapsed}
        if self.args.environment == 'uat':
            accepted.update(durationTargetSeconds=UAT_DEPLOY_TARGET_SECONDS,
                durationTargetMet=elapsed <= UAT_DEPLOY_TARGET_SECONDS)
        if self.target['kind'] == 'uat' and state == 'ACCEPTED_LINE_DEFERRED' and not self.receipt.get('rollbackOf'):
            accepted['promotionBundle'] = promotion_bundle(self.build, self.images)
        if self.target['kind'] == 'production' and not self.receipt.get('rollbackOf'):
            accepted['artifactBundle'] = promotion_bundle(self.build, self.images)
        if self.receipt.get('sourceSelection'):
            accepted['sourceSelection'] = self.receipt['sourceSelection']
            accepted['hotfixValidation'] = self.receipt.get('hotfixValidation')
        if getattr(self, 'first_migration', False):
            snapshot=self.work/'migration-acceptance.private.json'; write(snapshot,self.migration.state)
            accepted['migration'] = {'stackArn':self.migration.stack,'baselineSourceCommit':self.args.production_baseline,
                'journalSha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                'publicTraffic':self.migration.state.get('publicTraffic',False),
                'ecsRestored':getattr(self,'ecs_restored',False)}
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
    p.add_argument('--release-path',choices=['main','hotfix','uat'],default='main')
    p.add_argument('--source-sha',help='Exact isolated hotfix candidate SHA')
    p.add_argument('--production-baseline',help='Exact currently serving Production source SHA')
    p.add_argument('--hotfix-path',action='append',default=[],help='Every changed path in the isolated hotfix; repeat this option')
    p.add_argument('--regression-test',action='append',default=[],help='Tracked application regression test path; repeat this option')
    p.add_argument('--uat-release',type=Path,help='Exact signed accepted UAT run directory')
    p.add_argument('--prepared-build',type=Path,help='Reuse one exact-SHA validated main/hotfix build after source/image/archive identity checks')
    p.add_argument('--first-migration',action='store_true',help='Explicit staged ECS-to-Kamal handover; never substitutes ordinary rollback')
    action=p.add_mutually_exclusive_group()
    action.add_argument('--apply',action='store_true',help='Deploy to the enrolled target; default only checks prerequisites')
    action.add_argument('--prepare',action='store_true',help='Build pinned main and validate complete config locally; only reads the enrolled cloud target, never deploys')
    action.add_argument('--reconcile-host-identity',action='store_true',help='Explicitly reconcile the enrolled SSM hosts\' private addresses and verified SSH host keys; never deploys')
    p.add_argument('--publish-images',action='store_true',help='With --prepare: after every check passes, upload the prepared images to the registry under prepared- tags so a later --apply finds their layers; registry writes only, never deploys')
    p.add_argument('--accept-host-key-rotation',action='store_true',help='Permit an observed SSM host-key rotation during explicit reconciliation only')
    p.add_argument('--host-key-rotation-reason',help='Non-empty audit reason required with --accept-host-key-rotation')
    p.add_argument('--uat-controller-sha256', help='Explicit hash-bound test of the new local controller on real UAT only')
    p.add_argument('--uat-browser-acceptance', action='store_true', help='Wait for owner login and retained operator browser evidence on real UAT; no stored login password')
    p.add_argument('--production-browser-acceptance', action='store_true', help='Retained current-administrator browser evidence with live/OPEN/logout checks; no stored password')
    p.add_argument('--uat-smoke-acceptance', action='store_true', help='Owner-authorized real UAT config/readiness and public OPEN smoke, without login/logout')
    p.add_argument('--rollback',help='Restore the complete previous deployment captured by this terminal hotfix operation ID')
    args=p.parse_args()
    if args.prepare and args.rollback:
        p.error('--prepare cannot be combined with --rollback')
    if args.publish_images and not args.prepare:
        p.error('--publish-images is only valid with --prepare')
    if args.reconcile_host_identity:
        if args.rollback or args.first_migration or args.uat_release or args.source_sha or args.production_baseline or args.hotfix_path or args.regression_test:
            p.error('Host identity reconciliation cannot select a release or rollback')
        if args.uat_browser_acceptance or args.production_browser_acceptance or args.uat_smoke_acceptance:
            p.error('Host identity reconciliation has no customer acceptance')
    if args.accept_host_key_rotation != bool(args.host_key_rotation_reason):
        p.error('Host-key rotation approval requires both --accept-host-key-rotation and --host-key-rotation-reason')
    if (args.accept_host_key_rotation or args.host_key_rotation_reason) and not args.reconcile_host_identity:
        p.error('Host-key rotation approval is only valid with --reconcile-host-identity')
    release=None
    exit_code=0
    try:
        release=Release(args); release.run()
    except BaseException as error:
        exit_code=1
        if isinstance(error,KeyboardInterrupt): message='Interrupted; inspect the retained operation before retrying'
        else: message=str(error)
        if release:
            if release.receipt['status'] in ('RUNNING','AWAITING_BROWSER_ACCEPTANCE'):
                release.receipt['status']='FAILED_RECONCILIATION_REQUIRED' if release.changed else 'FAILED'
            release.receipt['error']=release.redact(message)
        print('Release stopped: '+(release.redact(message) if release else message),file=sys.stderr)
    finally:
        if release:
            if not release.close_transport():
                exit_code=1
                release.receipt['transportCleanupRequired']=True
                release.receipt.setdefault('error','Systems Manager session cleanup failed; reconcile before retry')
                if not release.receipt['status'].startswith('FAILED'):
                    release.receipt['statusBeforeTransportCleanup']=release.receipt['status']
                    release.receipt['status']='FAILED_TRANSPORT_CLEANUP_REQUIRED'
            release.receipt['finishedAt']=datetime.now(timezone.utc).isoformat();release.save()
            print(json.dumps({'status':release.receipt['status'],'elapsedSeconds':release.receipt['elapsedSeconds'],'result':str(release.work/'result.json')}))
    return exit_code


if __name__=='__main__':
    sys.exit(main())

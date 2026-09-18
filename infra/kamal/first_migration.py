"""ECS rollback inventory and constrained CloudFormation traffic handover.

These operations are deliberately separate from ordinary native Kamal rollback.
The caller owns the release lock, app validation, worker handover and acceptance.
"""
import copy
import hashlib
import json
import time
from urllib.parse import urlsplit

from release_source import full_sha, require

ACCOUNT = '311414082667'
REGION = 'ap-southeast-1'
CLUSTER = 'watchdog-bms-prod'
SERVICES = {'api-web': 'watchdog-bms-api-web-pub', 'ai-gateway': 'watchdog-bms-ai-gateway-v2', 'workers': 'watchdog-bms-workers'}
SERVICE_FIELDS = ('executionRoleArn', 'healthCheckPath', 'primaryContainer', 'taskRoleArn',
                  'networkConfiguration', 'cpu', 'memory', 'scalingTarget')


def service_body(service, configuration):
    return {'serviceArn': f'arn:aws:ecs:{REGION}:{ACCOUNT}:service/{CLUSTER}/{SERVICES[service]}',
            **{key: copy.deepcopy(configuration[key]) for key in SERVICE_FIELDS}}


def worker_capacity(before, parked):
    """Round-trip the complete service; only the two capacity values may change."""
    require(before.get('serviceArn') == service_body('workers', before)['serviceArn'], 'Foreign worker service')
    require(before['scalingTarget']['minTaskCount'] == 1 and before['scalingTarget']['maxTaskCount'] == 2,
            'Expected the retained Production worker capacity')
    after = copy.deepcopy(before)
    if parked: after['scalingTarget'].update(minTaskCount=0, maxTaskCount=0)
    return after


def traffic_template(before, public, expected_hosts):
    """Change only the two owned rule conditions; never alter the old ECS rules."""
    after = copy.deepcopy(before)
    require(before.get('Description') == 'Production Kamal staged infrastructure; no customer cutover',
            'Unrecognized migration infrastructure template')
    require(set(expected_hosts) == {'ApiStagingRoute', 'AiStagingRoute'}, 'Incomplete traffic enrollment')
    operator = {'Field': 'source-ip', 'SourceIpConfig': {'Values': [{'Ref': 'OperatorCidr'}]}}
    for name, host in expected_hosts.items():
        rule = before['Resources'][name]
        require(rule['Type'] == 'AWS::ElasticLoadBalancingV2::ListenerRule', 'Unexpected route resource type')
        properties = rule['Properties']
        expected = [{'Field': 'host-header', 'Values': [host]}]
        require(properties['Conditions'] in (expected, expected + [operator]), 'Route conditions drifted')
        require(properties['Actions'] == [{'Type': 'forward', 'TargetGroupArn': {'Ref': name.replace('StagingRoute', 'Targets')}}],
                'Route target drifted')
        after['Resources'][name]['Properties']['Conditions'] = expected if public else expected + [operator]
    return after


def validate_traffic_changes(changes):
    rows = [entry['ResourceChange'] for entry in changes]
    require(len(rows) == 2 and {r['LogicalResourceId'] for r in rows} == {'ApiStagingRoute', 'AiStagingRoute'},
            'Traffic change set must contain exactly the two owned listener rules')
    require(all(r['Action'] == 'Modify' and r['ResourceType'] == 'AWS::ElasticLoadBalancingV2::ListenerRule'
                and r.get('Replacement') == 'False' and set(r.get('Scope', [])) == {'Properties'} for r in rows),
            'Traffic change set contains a replacement or unrelated change')
    for row in rows:
        require(row.get('Details') and all(d.get('Target', {}).get('Name') == 'Conditions' for d in row['Details']),
                'Traffic change set changes more than conditions')


def serving_target(action):
    require(action.get('Type') == 'forward', 'Expected a forward action')
    groups = action.get('ForwardConfig', {}).get('TargetGroups')
    if groups is None:
        require(action.get('TargetGroupArn'), 'Forward target is missing')
        return action['TargetGroupArn']
    live = [g['TargetGroupArn'] for g in groups if g.get('Weight', 1) > 0]
    require(len(live) == 1 and not action['ForwardConfig'].get('TargetGroupStickinessConfig', {}).get('Enabled'),
            'ECS traffic is split or sticky; reconcile before migration')
    require(action.get('TargetGroupArn', live[0]) == live[0], 'Forward target representations disagree')
    return live[0]


class FirstMigration:
    def __init__(self, release):
        self.release = release
        self.aws = release.aws
        self.baseline = full_sha(release.args.production_baseline)
        self.stack = release.target['migration']['stackArn']
        require(self.stack.startswith(f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/mangmee-kamal-production/'),
                'Foreign migration stack')
        self.journal = release.work / 'migration.private.json'
        self.state = {'baselineSourceCommit': self.baseline, 'steps': []}

    def save(self):
        # Import the existing private writer lazily to avoid a circular controller import.
        from release import write
        write(self.journal, self.state)

    def intent(self, name, data):
        require(not any(s['name'] == name for s in self.state['steps']), 'Reconcile the existing mutation before retrying')
        step = {'name': name, 'status': 'INTENT_RECORDED', **data}
        self.state['steps'].append(step); self.save()
        self.release.changed.append(name)
        return step

    def workflow_fence(self, disable=False):
        """Exclude the existing ECS deployers before starting the separate Kamal handover."""
        repo = 'MangmeeDev/mangmeeplus'
        for name in ('deploy-production.yml', 'deploy-production-v2.yml'):
            path = 'repos/' + repo + '/actions/workflows/' + name
            workflow = json.loads(self.release.command(['gh', 'api', path]))
            require(workflow['state'] in ('active', 'disabled_manually'), 'Unexpected legacy workflow state')
            # A queued or waiting deployment counts as active even when no runner has started.
            for status in ('queued','in_progress','requested','waiting','pending'):
                runs = json.loads(self.release.command(['gh','api',path+'/runs?per_page=1&status='+status]))
                require(runs['total_count'] == 0, 'Legacy workflow has an unfinished run: '+name)
            if disable and workflow['state'] == 'active':
                step = self.intent('disable-' + name, {'previousState': workflow['state']})
                self.release.command(['gh', 'api', '--method', 'PUT', path + '/disable'])
                workflow = json.loads(self.release.command(['gh', 'api', path]))
                require(workflow['state'] == 'disabled_manually', 'Legacy deploy fence did not persist')
                step['status'] = 'VERIFIED'; self.save()
            if not disable:
                require(workflow['state'] == 'disabled_manually', 'Legacy ECS workflow fence is not held')
        current = json.loads(self.release.command(['gh', 'api', 'repos/' + repo + '/git/ref/heads/main']))['object']['sha']
        require(current == self.release.controller_sha, 'Main changed during migration; controller freeze was lost')
        if disable: self.workflow_fence()

    def restore_workflows(self):
        for name in ('deploy-production.yml','deploy-production-v2.yml'):
            previous = next((s for s in self.state['steps'] if s['name']=='disable-'+name),None)
            if previous is None: continue
            path='repos/MangmeeDev/mangmeeplus/actions/workflows/'+name
            current=json.loads(self.release.command(['gh','api',path]))
            require(current['state']=='disabled_manually', 'Legacy workflow changed during rollback')
            step=self.intent('restore-'+name, {'previousState':current['state']})
            self.release.command(['gh','api','--method','PUT',path+'/enable'])
            require(json.loads(self.release.command(['gh','api',path]))['state']=='active','Legacy workflow restoration failed')
            step['status']='VERIFIED'; self.save()

    def target_health(self):
        resources = self.aws(['cloudformation', 'describe-stack-resources', '--stack-name', self.stack])['StackResources']
        by_name = {r['LogicalResourceId']: r['PhysicalResourceId'] for r in resources}
        instances = self.aws(['ec2', 'describe-instances', '--instance-ids', *self.release.hosts])
        ips = {i['InstanceId']: i['PrivateIpAddress'] for r in instances['Reservations'] for i in r['Instances']}
        for service, resource in [('api-web', 'ApiTargets'), ('ai-gateway', 'AiTargets')]:
            expected = {ips[h['instanceId']] for h in self.release.target['hosts'][service]}
            deadline = time.monotonic() + 180
            while True:
                rows = self.aws(['elbv2', 'describe-target-health', '--target-group-arn', by_name[resource]])['TargetHealthDescriptions']
                require({r['Target']['Id'] for r in rows} == expected, 'Staged target group membership changed')
                if all(r['Target']['Port'] == 80 and r['TargetHealth']['State'] == 'healthy' for r in rows): break
                require(time.monotonic() < deadline, 'Staged ALB target health did not pass')
                time.sleep(3)
        self.state['targetHealthVerified'] = True; self.save()

    def routes(self, public=False):
        resources = self.aws(['cloudformation','describe-stack-resources','--stack-name',self.stack])['StackResources']
        by_name = {r['LogicalResourceId']:r['PhysicalResourceId'] for r in resources}
        owned = {by_name[k] for k in ('ApiStagingRoute','AiStagingRoute')}
        rows = self.aws(['elbv2','describe-rules','--rule-arns',*sorted(owned)])['Rules']
        require(len(rows) == 2, 'Incomplete migration route readback')
        stack = self.aws(['cloudformation','describe-stacks','--stack-name',self.stack])['Stacks'][0]
        operator = next(p['ParameterValue'] for p in stack['Parameters'] if p['ParameterKey'] == 'OperatorCidr')
        for resource, target, url in [('ApiStagingRoute','ApiTargets','apiInternalUrl'), ('AiStagingRoute','AiTargets','aiInternalUrl')]:
            row = next(r for r in rows if r['RuleArn'] == by_name[resource])
            require(len(row['Actions']) == 1 and row['Actions'][0]['Type'] == 'forward'
                    and row['Actions'][0]['TargetGroupArn'] == by_name[target], 'Migration route target differs')
            conditions = {c['Field']:c for c in row['Conditions']}
            require(set(conditions) == ({'host-header'} if public else {'host-header','source-ip'}), 'Migration route scope differs')
            require(conditions['host-header']['Values'] == [urlsplit(self.release.target[url]).hostname], 'Migration route hostname differs')
            if not public:
                require(conditions['source-ip']['SourceIpConfig']['Values'] == [operator], 'Migration staging operator differs')
        if 'stagingRoutes' not in self.state:
            require(not public, 'Cannot capture staging routes after public cutover')
            self.state['stagingRoutes'] = rows; self.save()
        return rows

    def old_routes(self):
        template=self.aws(['cloudformation','get-template','--stack-name',self.stack])['TemplateBody']
        if isinstance(template,str): template=json.loads(template)
        listener=template['Resources']['ApiStagingRoute']['Properties']['ListenerArn']
        require(isinstance(listener,str) and listener.startswith(f'arn:aws:elasticloadbalancing:{REGION}:{ACCOUNT}:listener/'),
                'Foreign migration listener')
        all_rules=self.aws(['elbv2','describe-rules','--listener-arn',listener])['Rules']
        owned={r['RuleArn'] for r in self.state['stagingRoutes']}
        retained=[]
        for service,key in [('api-web','apiInternalUrl'),('ai-gateway','aiInternalUrl')]:
            host=urlsplit(self.release.target[key]).hostname
            rows=[r for r in all_rules if r['RuleArn'] not in owned and any(c['Field']=='host-header'
                and host in c.get('Values',[]) for c in r['Conditions'])]
            require(len(rows)==1 and len(rows[0]['Actions'])==1 and rows[0]['Actions'][0]['Type']=='forward',
                    'Original ECS route is absent or ambiguous')
            health=self.aws(['elbv2','describe-target-health','--target-group-arn',serving_target(rows[0]['Actions'][0])])['TargetHealthDescriptions']
            expected=set(self.state['ecsBaseline'][service]['taskIps'])
            require(expected and {r['Target']['Id'] for r in health if r['TargetHealth']['State']=='healthy'}==expected,
                    'Original ECS route does not serve the retained healthy tasks')
            retained.append(rows[0])
        if 'ecsRoutes' in self.state: require(retained==self.state['ecsRoutes'],'Original ECS listener rules changed')
        else: self.state['ecsRoutes']=retained; self.save()
        return retained

    def verify_ecs_provider(self):
        values = {v['name']:v['value'] for v in self.state['ecsBaseline']['ai-gateway']['body']['primaryContainer']['environment']}
        arn = values['AGENTCORE_RUNTIME_ARN']; qualifier = values['AGENTCORE_RUNTIME_QUALIFIER']
        endpoint = self.aws(['bedrock-agentcore-control','get-agent-runtime-endpoint','--agent-runtime-id',arn.rsplit('/',1)[1],
                             '--endpoint-name',qualifier])
        require(endpoint['status'] == 'READY' and endpoint.get('targetVersion') in (None,endpoint['liveVersion']),
                'ECS provider endpoint is moving')
        runtime = self.aws(['bedrock-agentcore-control','get-agent-runtime','--agent-runtime-id',arn.rsplit('/',1)[1],
                            '--agent-runtime-version',endpoint['liveVersion']])
        env = runtime['environmentVariables']
        require(runtime['status'] == 'READY' and env['GIT_SHA'] == self.baseline
                and env['DEPLOY_ENVIRONMENT'] == 'production' and env['ERP_CORE_INTERNAL_URL'] == values['ERP_CORE_INTERNAL_URL']
                and env['AGENTCORE_ARTIFACT_SHA256'] == values['AGENTCORE_EXPECTED_ARTIFACT_SHA256'], 'ECS provider baseline changed')
        return {'status':'PRESERVED_ECS_ROLLBACK','runtimeArn':arn,'qualifier':qualifier,'version':endpoint['liveVersion'],
                'sourceCommit':self.baseline,'artifactSha256':env['AGENTCORE_ARTIFACT_SHA256']}

    def handover(self):
        self.workflow_fence()
        self.routes(public=False)
        self.old_routes()
        self.verify_ecs_provider()
        self.release.assert_candidate_workers_stopped()
        for service in ('ai-gateway', 'api-web'):
            self.release.deploy_service(service)
        self.target_health()
        self.release.verify_ecs_build_authority()
        self.workflow_fence()
        self.release.assert_no_legacy_operation()
        self.old_routes()
        self.park_workers()
        self.release.deploy_service('workers')
        self.change_traffic(public=True)
        self.target_health()
        self.observe_ecs(parked=True)

    def observe_ecs(self, parked=False):
        observed = {}
        for service, name in SERVICES.items():
            arn = f'arn:aws:ecs:{REGION}:{ACCOUNT}:service/{CLUSTER}/{name}'
            data = self.aws(['ecs', 'describe-express-gateway-service', '--service', arn])['service']
            require(data['serviceArn'] == arn and len(data['activeConfigurations']) == 1
                    and data['status']['statusCode'] == 'ACTIVE', 'ECS rollback baseline is moving: ' + service)
            config = data['activeConfigurations'][0]; body = service_body(service, config)
            env = {v['name']: v['value'] for v in config['primaryContainer']['environment']}
            require(env.get('GIT_SHA') == self.baseline and env.get('DEPLOY_ENVIRONMENT') == 'production',
                    'ECS rollback source/environment changed')
            expected_capacity = (0, 0) if parked and service == 'workers' else (1, 2)
            require((config['scalingTarget']['minTaskCount'], config['scalingTarget']['maxTaskCount']) == expected_capacity,
                    'ECS capacity differs from the expected migration phase')
            image = config['primaryContainer']['image']
            require('@sha256:' in image, 'ECS rollback image is not immutable')
            arns = self.aws(['ecs', 'list-tasks', '--cluster', CLUSTER, '--service-name', name, '--desired-status', 'RUNNING'])['taskArns']
            require(bool(arns) == (expected_capacity[0] > 0), 'ECS running task set differs from expected capacity')
            tasks = self.aws(['ecs', 'describe-tasks', '--cluster', CLUSTER, '--tasks', *arns]) if arns else {'tasks': [], 'failures': []}
            require(not tasks.get('failures') and len(tasks['tasks']) == len(arns), 'Incomplete ECS task readback')
            for task in tasks['tasks']:
                require(task['group'] == 'service:' + name and task['lastStatus'] == 'RUNNING'
                        and any(c.get('imageDigest') == image.rsplit('@', 1)[1] and c.get('lastStatus') == 'RUNNING'
                                for c in task['containers']), 'ECS task digest/state differs from rollback configuration')
            ips=[n['privateIpv4Address'] for t in tasks['tasks'] for c in t['containers']
                 for n in c.get('networkInterfaces',[]) if n.get('privateIpv4Address')]
            require(not arns or ips, 'ECS task network identity is missing')
            observed[service] = {'body': body, 'taskArns': arns, 'taskIps':sorted(set(ips)), 'sourceCommit': self.baseline, 'image': image}
        if 'ecsBaseline' not in self.state:
            require(not parked, 'Cannot capture the original baseline after worker parking')
            self.state['ecsBaseline'] = observed; self.save()
        else:
            for service, row in observed.items():
                original = self.state['ecsBaseline'][service]['body']
                expected = worker_capacity(original, True) if parked and service == 'workers' else original
                require(row['body'] == expected, 'ECS rollback configuration drifted: ' + service)
        return observed

    def runtime_summary(self):
        # Never put raw ECS environment/configuration into a shareable signed result.
        return {service: {'sourceCommit': row['sourceCommit'], 'image': row['image'], 'taskArns':row['taskArns'],
                    'running':bool(row['taskArns']), 'configurationMatchesRetainedBaseline':True,
                    'configurationSha256':hashlib.sha256(json.dumps(row['body'],sort_keys=True).encode()).hexdigest()}
                for service,row in self.observe_ecs().items()}

    def park_workers(self):
        from release import write
        self.observe_ecs()
        original = self.state['ecsBaseline']['workers']
        request = worker_capacity(original['body'], True)
        path = self.release.work / 'park-workers.private.json'; write(path, request)
        step = self.intent('ecs-workers-park', {'taskArns': original['taskArns']})
        self.aws(['ecs', 'update-express-gateway-service', '--cli-input-json', 'file://' + str(path)])
        deadline = time.monotonic() + 600
        while True:
            # Include tasks created after the baseline and tasks whose desired state is STOPPED
            # but which are still draining. Empty desired=RUNNING alone is not a consumer fence.
            arns = set(original['taskArns'])
            for desired in ('RUNNING', 'STOPPED'):
                arns.update(self.aws(['ecs','list-tasks','--cluster',CLUSTER,'--service-name',SERVICES['workers'],
                                     '--desired-status',desired])['taskArns'])
            tasks = []
            arns = sorted(arns)
            for offset in range(0, len(arns), 100):
                batch = arns[offset:offset+100]
                rows = self.aws(['ecs', 'describe-tasks', '--cluster', CLUSTER, '--tasks', *batch])
                require(not rows.get('failures') and len(rows['tasks']) == len(batch), 'Cannot prove old workers stopped')
                tasks.extend(rows['tasks'])
            if tasks and all(t['lastStatus'] == 'STOPPED' for t in tasks):
                config = self.aws(['ecs', 'describe-express-gateway-service', '--service', request['serviceArn']])['service']['activeConfigurations']
                if len(config) == 1 and service_body('workers', config[0]) == request: break
            require(time.monotonic() < deadline, 'Worker drain timed out; inspect the retained operation')
            time.sleep(5)
        self.observe_ecs(parked=True)
        step.update(status='VERIFIED_STOPPED', stoppedTaskArns=arns); self.save()

    def restore_workers(self):
        """Only restore the retained service after the new consumers are proved stopped."""
        from release import write
        self.release.assert_candidate_workers_stopped()
        original = self.state['ecsBaseline']['workers']['body']
        data = self.aws(['ecs', 'describe-express-gateway-service', '--service', original['serviceArn']])['service']
        require(data['status']['statusCode'] == 'ACTIVE' and len(data['activeConfigurations']) == 1,
                'Worker update is still moving; reconcile before restoring')
        current = service_body('workers', data['activeConfigurations'][0])
        require(current in (original, worker_capacity(original, True)), 'Worker configuration drifted during migration')
        if current != original:
            path = self.release.work / 'restore-workers.private.json'; write(path, original)
            step = self.intent('ecs-workers-restore', {'bodySha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            self.aws(['ecs', 'update-express-gateway-service', '--cli-input-json', 'file://' + str(path)])
            deadline = time.monotonic() + 600
            while True:
                data = self.aws(['ecs', 'describe-express-gateway-service', '--service', original['serviceArn']])['service']
                if data['status']['statusCode'] == 'ACTIVE' and len(data['activeConfigurations']) == 1:
                    body = service_body('workers', data['activeConfigurations'][0])
                    tasks = self.aws(['ecs', 'list-tasks', '--cluster', CLUSTER,
                        '--service-name', SERVICES['workers'], '--desired-status', 'RUNNING'])['taskArns']
                    if body == original and tasks:
                        rows = self.aws(['ecs', 'describe-tasks', '--cluster', CLUSTER, '--tasks', *tasks])
                        require(not rows.get('failures'), 'Incomplete restored worker readback')
                        if len(rows['tasks']) == len(tasks) and all(t['lastStatus'] == 'RUNNING' for t in rows['tasks']): break
                require(time.monotonic() < deadline, 'Worker restoration timed out; retain the operation for reconciliation')
                time.sleep(5)
            step['status'] = 'VERIFIED_RUNNING'; self.save()
        # This also rejects a healthy-looking replacement with the wrong source/digest/config.
        return self.observe_ecs()

    def rollback(self):
        """Keep API rollback independent of worker recovery and never overlap consumers."""
        self.old_routes()
        self.release.stop_candidate_workers()
        self.release.assert_candidate_workers_stopped()
        if 'originalTemplate' in self.state:
            actual = self.aws(['cloudformation', 'get-template', '--stack-name', self.stack])['TemplateBody']
            if isinstance(actual, str): actual = json.loads(actual)
            if actual != self.state['originalTemplate']:
                self.change_traffic(public=False)
        self.restore_workers()
        self.state['rollback'] = 'ECS_CONFIG_AND_TASKS_RESTORED'
        self.save()

    def change_traffic(self, public):
        from release import write
        from urllib.parse import urlsplit
        before = self.aws(['cloudformation', 'get-template', '--stack-name', self.stack])['TemplateBody']
        if isinstance(before, str): before = json.loads(before)
        hosts = {'ApiStagingRoute': urlsplit(self.release.target['apiInternalUrl']).hostname,
                 'AiStagingRoute': urlsplit(self.release.target['aiInternalUrl']).hostname}
        after = traffic_template(before, public, hosts)
        require(before != after, 'Traffic already changed; reconcile instead of dispatching a duplicate')
        if public:
            require('originalTemplate' not in self.state, 'Original traffic inventory already exists')
            self.state['originalTemplate'] = before; self.save()
        else:
            require(after == self.state['originalTemplate'], 'Rollback template differs from the retained original')
        name = 'kamal-' + self.release.id + ('-public' if public else '-restore')
        template = self.release.work / (name + '.json')
        template.write_text(json.dumps(after, separators=(',', ':'))); template.chmod(0o600)
        stack = self.aws(['cloudformation', 'describe-stacks', '--stack-name', self.stack])['Stacks'][0]
        require(stack['StackStatus'] in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'), 'Migration stack is not stable')
        params = self.release.work / (name + '-parameters.json')
        write(params, [{'ParameterKey': p['ParameterKey'], 'UsePreviousValue': True} for p in stack['Parameters']])
        step = self.intent(name, {'templateSha256': hashlib.sha256(template.read_bytes()).hexdigest()})
        created = self.aws(['cloudformation', 'create-change-set', '--stack-name', self.stack, '--change-set-name', name,
            '--change-set-type', 'UPDATE', '--template-body', 'file://' + str(template), '--parameters', 'file://' + str(params),
            '--capabilities', 'CAPABILITY_NAMED_IAM', '--client-token', name])
        step['changeSetArn'] = created['Id']; self.save()
        deadline = time.monotonic() + 180
        while True:
            change = self.aws(['cloudformation', 'describe-change-set', '--change-set-name', created['Id']])
            if change['Status'] == 'CREATE_COMPLETE': break
            require(change['Status'] in ('CREATE_PENDING', 'CREATE_IN_PROGRESS') and time.monotonic() < deadline,
                    'Traffic change-set preparation failed; retained change set must be inspected')
            time.sleep(3)
        validate_traffic_changes(change['Changes'])
        step['status'] = 'EXECUTION_INTENT'; self.save()
        self.aws(['cloudformation', 'execute-change-set', '--change-set-name', created['Id'], '--client-request-token', name])
        deadline = time.monotonic() + 240
        while True:
            live = self.aws(['cloudformation', 'describe-stacks', '--stack-name', self.stack])['Stacks'][0]
            events = self.aws(['cloudformation', 'describe-stack-events', '--stack-name', self.stack])['StackEvents']
            completed = any(e.get('ClientRequestToken') == name and e.get('ResourceType') == 'AWS::CloudFormation::Stack'
                            and e.get('ResourceStatus') == 'UPDATE_COMPLETE' for e in events)
            if live['StackStatus'] == 'UPDATE_COMPLETE' and completed: break
            require(live['StackStatus'] in ('UPDATE_COMPLETE', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS') and time.monotonic() < deadline,
                    'Traffic update failed or timed out; reconcile before retry')
            time.sleep(3)
        actual = self.aws(['cloudformation', 'get-template', '--stack-name', self.stack])['TemplateBody']
        if isinstance(actual, str): actual = json.loads(actual)
        require(actual == after, 'Traffic template readback differs from the reviewed change set')
        self.routes(public=public)
        step['status'] = 'VERIFIED'; self.state['publicTraffic'] = public; self.save()

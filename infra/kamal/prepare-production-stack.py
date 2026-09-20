#!/usr/bin/env python3
"""Render the initial Production stack from retained live inventory; never call AWS.

The stack creates no customer-wide route and starts no application/queue consumer.
Operator-only routes permit ALB target health checks before the separate cutover.
"""
import argparse
import copy
import json
from pathlib import Path
from urllib.parse import urlsplit

ACCOUNT = '311414082667'
REGION = 'ap-southeast-1'
NAME = 'mangmee-kamal-production'


def prepare(inventory):
    def read(name):
        return json.loads((inventory / (name + '.json')).read_text())
    resources = {}
    outputs = {}
    tags = [{'Key': k, 'Value': v} for k, v in {
        'Environment': 'production', 'Name': NAME, 'ManagedBy': 'CloudFormation', 'Component': 'application-runtime'}.items()]
    def add(name, kind, props, **extra):
        resources[name] = {'Type': 'AWS::' + kind, 'Properties': props, **extra}
        return {'Ref': name}
    def att(name, key):
        return {'Fn::GetAtt': [name, key]}
    def allow(actions, scope, **extra):
        return {'Effect': 'Allow', 'Action': actions, 'Resource': scope, **extra}
    def role(name, principal, statements, condition=None):
        trust = {'Effect': 'Allow', 'Principal': principal, 'Action': 'sts:AssumeRole'}
        if condition: trust['Condition'] = condition
        return add(name, 'IAM::Role', {'RoleName': NAME + '-' + name.lower(), 'Tags': tags,
            'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [trust]},
            'Policies': [{'PolicyName': 'production-runtime-only', 'PolicyDocument': {
                'Version': '2012-10-17', 'Statement': statements}}]})
    def rule(name, kind, group, port, **peer):
        return add(name, 'EC2::SecurityGroup' + kind, {'GroupId': group, 'IpProtocol': 'tcp',
            'FromPort': port, 'ToPort': port, **peer})

    ecs = {s: read(s + '-ecs')['service'] for s in ('api-web', 'ai-gateway', 'workers')}
    for service in ecs.values():
        assert len(service['activeConfigurations']) == 1, 'Moving ECS baseline'
    configs = {s: v['activeConfigurations'][0] for s, v in ecs.items()}
    expected_services = {'api-web': 'watchdog-bms-api-web-pub', 'ai-gateway': 'watchdog-bms-ai-gateway-v2', 'workers': 'watchdog-bms-workers'}
    assert all(v['serviceArn'] == f'arn:aws:ecs:{REGION}:{ACCOUNT}:service/watchdog-bms-prod/{expected_services[s]}' for s, v in ecs.items())
    envs = {s: {e['name']: e['value'] for e in c['primaryContainer']['environment']} for s, c in configs.items()}
    sources = {e['GIT_SHA'] for e in envs.values()}
    assert len(sources) == 1 and all(e['DEPLOY_ENVIRONMENT'] == 'production' for e in envs.values())
    baseline = sources.pop()
    assert read('rds')['DBInstances'][0]['DBInstanceIdentifier'] == 'watchdog-bms-prod-db'
    assert read('redis-cluster')['CacheClusters'][0]['CacheClusterId'] == 'watchdog-bms-prod-redis-001'
    data_vpc = read('rds')['DBInstances'][0]['DBSubnetGroup']['VpcId']
    assert data_vpc == 'vpc-0da727984eee92f96'
    assert all(v['CidrBlock'] != '10.93.0.0/24' for v in read('vpcs')['Vpcs']), 'Production CIDR already exists'
    db_sg = read('rds')['DBInstances'][0]['VpcSecurityGroups'][0]['VpcSecurityGroupId']
    redis_sg = read('redis-cluster')['CacheClusters'][0]['SecurityGroups'][0]['SecurityGroupId']
    listener = read('listeners')['Listeners'][0]['ListenerArn']
    assert not {1, 16} & {int(r['Priority']) for r in read('listener-rules')['Rules'] if r['Priority'] != 'default'}
    for service, key in [('api-web', 'INTERNAL_API_URL'), ('ai-gateway', 'AI_GATEWAY_INTERNAL_URL')]:
        host = urlsplit(envs['api-web'][key]).hostname
        assert host.endswith('.ecs.ap-southeast-1.on.aws')
        matching = [r for r in read('listener-rules')['Rules'] if any(
            c.get('Field') == 'host-header' and host in c.get('Values', []) for c in r['Conditions'])]
        assert len(matching) == 1, 'Ambiguous current route for ' + service

    vpc = add('Vpc', 'EC2::VPC', {'CidrBlock': '10.93.0.0/24', 'EnableDnsSupport': True, 'EnableDnsHostnames': True, 'Tags': tags})
    igw = add('Igw', 'EC2::InternetGateway', {'Tags': tags})
    add('Gateway', 'EC2::VPCGatewayAttachment', {'VpcId': vpc, 'InternetGatewayId': igw})
    routes = add('Routes', 'EC2::RouteTable', {'VpcId': vpc, 'Tags': tags})
    add('InternetRoute', 'EC2::Route', {'RouteTableId': routes, 'DestinationCidrBlock': '0.0.0.0/0', 'GatewayId': igw}, DependsOn='Gateway')
    peering = add('Peering', 'EC2::VPCPeeringConnection', {'VpcId': vpc, 'PeerVpcId': data_vpc, 'Tags': tags})
    add('ToData', 'EC2::Route', {'RouteTableId': routes, 'DestinationCidrBlock': '172.31.0.0/16', 'VpcPeeringConnectionId': peering})
    for key, table in [('PrivateReturn', 'rtb-07f3ced2ad683cd23'), ('PublicReturn', 'rtb-0a3b3e9a0a4848fa4')]:
        add(key, 'EC2::Route', {'RouteTableId': table, 'DestinationCidrBlock': '10.93.0.0/24', 'VpcPeeringConnectionId': peering})
    images = add('Images', 'ECR::Repository', {'RepositoryName': NAME + '/releases', 'ImageTagMutability': 'IMMUTABLE',
        'ImageScanningConfiguration': {'ScanOnPush': True}, 'EncryptionConfiguration': {'EncryptionType': 'AES256'}, 'Tags': tags},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    bootstrap = Path(__file__).with_name('bootstrap-host.sh').read_text()
    startup = '#!/usr/bin/env bash\nset -euo pipefail\ninstall -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh\n'
    startup += "printf '%s\\n' '${OperatorPublicKey}' > /home/ubuntu/.ssh/authorized_keys\n"
    startup += 'chmod 600 /home/ubuntu/.ssh/authorized_keys\nchown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys\n'
    startup += bootstrap.split('\n', 1)[1]
    # Preserve the existing runtime permission boundaries; AI and workers have distinct instance roles.
    groups = {}
    for service, key in [('api-web', 'Api'), ('ai-gateway', 'Ai'), ('workers', 'Workers')]:
        statements = [copy.deepcopy(s) for p in read(service + '-runtime-policies').values() for s in p['Statement']]
        if service == 'ai-gateway':
            for statement in statements:
                if 'bedrock-agentcore:InvokeAgentRuntime' in statement['Action']:
                    statement['Resource'] = [f'arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:runtime/watchdog_orchestrator_production_kamal-*',
                        f'arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:runtime/watchdog_orchestrator_production_kamal-*/runtime-endpoint/kamal_production_*']
        logs = add(key + 'Logs', 'Logs::LogGroup', {'LogGroupName': '/ecs/' + NAME + '-' + service,
            'RetentionInDays': 14, 'Tags': tags}, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
        statements += [allow(['logs:CreateLogStream', 'logs:PutLogEvents'], att(key + 'Logs', 'Arn'))]
        r = role(key + 'Role', {'Service': 'ec2.amazonaws.com'}, statements)
        add(key + 'Profile', 'IAM::InstanceProfile', {'Roles': [r]})
        groups[key] = add(key + 'Sg', 'EC2::SecurityGroup', {'VpcId': vpc, 'GroupDescription': NAME + ' ' + key,
            'SecurityGroupIngress': [{'IpProtocol': 'tcp', 'FromPort': 22, 'ToPort': 22, 'CidrIp': {'Ref': 'OperatorCidr'}}],
            'SecurityGroupEgress': [{'IpProtocol': 'tcp', 'FromPort': p, 'ToPort': p, 'CidrIp': '0.0.0.0/0'} for p in (80, 443)], 'Tags': tags})
        if key != 'Ai':
            for dep, sg, port in [('Db', db_sg, 5432), ('Redis', redis_sg, 6379)]:
                rule(key + dep + 'Egress', 'Egress', groups[key], port, DestinationSecurityGroupId=sg)
                resources[key + dep + 'Egress']['DependsOn'] = 'Peering'
        if key != 'Workers':
            rule(key + 'Http', 'Ingress', groups[key], 80, SourceSecurityGroupId='sg-025627c14b2913c07')
            resources[key + 'Http']['DependsOn'] = 'Peering'
    nodes = [('ApiA', 'Api', 'ap-southeast-1a', 0, 't3.large'), ('ApiB', 'Api', 'ap-southeast-1b', 32, 't3.large'),
             ('Ai', 'Ai', 'ap-southeast-1c', 64, 't3.medium'), ('Workers', 'Workers', 'ap-southeast-1a', 96, 't3.small')]
    for key, role_key, az, block, size in nodes:
        ip = '10.93.0.' + str(block + 10)
        subnet = add(key + 'Subnet', 'EC2::Subnet', {'VpcId': vpc, 'CidrBlock': f'10.93.0.{block}/27',
            'AvailabilityZone': az, 'MapPublicIpOnLaunch': True, 'Tags': tags})
        add(key + 'RouteAssociation', 'EC2::SubnetRouteTableAssociation', {'SubnetId': subnet, 'RouteTableId': routes})
        instance = add(key + 'Server', 'EC2::Instance', {'ImageId': {'Ref': 'UbuntuAmi'}, 'InstanceType': size,
            'CreditSpecification': {'CPUCredits': 'standard'}, 'IamInstanceProfile': {'Ref': role_key + 'Profile'},
            'MetadataOptions': {'HttpTokens': 'required', 'HttpPutResponseHopLimit': 2},
            'InstanceInitiatedShutdownBehavior': 'stop', 'Monitoring': True,
            'NetworkInterfaces': [{'DeviceIndex': '0', 'AssociatePublicIpAddress': True, 'SubnetId': subnet,
                'PrivateIpAddress': ip, 'GroupSet': [groups[role_key]]}],
            'BlockDeviceMappings': [{'DeviceName': '/dev/sda1', 'Ebs': {'VolumeType': 'gp3', 'VolumeSize': 40,
                'Encrypted': True, 'DeleteOnTermination': True}}],
            'UserData': {'Fn::Base64': {'Fn::Sub': startup}}, 'Tags': tags, 'PropagateTagsToVolumeOnCreation': True},
            DependsOn=['InternetRoute', key + 'RouteAssociation'])
        outputs[key + 'Instance'] = {'Value': instance}
        outputs[key + 'PublicIp'] = {'Value': att(key + 'Server', 'PublicIp')}
        if role_key != 'Ai':
            for dep, sg, port in [('Db', db_sg, 5432), ('Redis', redis_sg, 6379)]:
                rule(key + dep + 'Ingress', 'Ingress', sg, port, CidrIp=ip + '/32', Description=NAME + ' ' + key)
        if role_key != 'Workers':
            rule(key + 'AlbEgress', 'Egress', 'sg-025627c14b2913c07', 80, CidrIp=ip + '/32', Description=NAME + ' ' + key)
        add(key + 'StatusAlarm', 'CloudWatch::Alarm', {'AlarmName': NAME + '-' + key + '-status',
            'Namespace': 'AWS/EC2', 'MetricName': 'StatusCheckFailed', 'Dimensions': [{'Name': 'InstanceId', 'Value': instance}],
            'Statistic': 'Maximum', 'Period': 60, 'EvaluationPeriods': 2, 'Threshold': 1,
            'ComparisonOperator': 'GreaterThanOrEqualToThreshold', 'TreatMissingData': 'notBreaching',
            'AlarmActions': [{'Ref': 'AlarmTopicArn'}]})
    for key, hosts, url_key, priority in [('Api', ['10.93.0.10', '10.93.0.42'], 'INTERNAL_API_URL', 1),
                                           ('Ai', ['10.93.0.74'], 'AI_GATEWAY_INTERNAL_URL', 16)]:
        targets = add(key + 'Targets', 'ElasticLoadBalancingV2::TargetGroup', {'Name': NAME + '-' + key.lower(),
            'VpcId': data_vpc, 'Protocol': 'HTTP', 'Port': 80, 'TargetType': 'ip',
            'Targets': [{'Id': ip, 'Port': 80, 'AvailabilityZone': 'all'} for ip in hosts],
            'HealthCheckPath': '/v1/health', 'HealthCheckIntervalSeconds': 5, 'HealthCheckTimeoutSeconds': 2,
            'HealthyThresholdCount': 2, 'UnhealthyThresholdCount': 3, 'Matcher': {'HttpCode': '200'},
            'TargetGroupAttributes': [{'Key': 'deregistration_delay.timeout_seconds', 'Value': '30'}], 'Tags': tags})
        add(key + 'StagingRoute', 'ElasticLoadBalancingV2::ListenerRule', {'ListenerArn': listener, 'Priority': priority,
            'Conditions': [{'Field': 'host-header', 'Values': [urlsplit(envs['api-web'][url_key]).hostname]},
                {'Field': 'source-ip', 'SourceIpConfig': {'Values': [{'Ref': 'OperatorCidr'}]}}],
            'Actions': [{'Type': 'forward', 'TargetGroupArn': targets}]})
        outputs[key + 'TargetGroup'] = {'Value': targets}

    runtime = read('agentcore-runtime')
    assert runtime['environmentVariables']['GIT_SHA'] == baseline and runtime['status'] == 'READY'
    obj = runtime['agentRuntimeArtifact']['codeConfiguration']['code']['s3']
    artifact_arn = 'arn:aws:s3:::' + obj['bucket'] + '/' + obj['prefix']
    future = 'arn:aws:s3:::' + obj['bucket'] + '/agentcore/kamal-production-*'
    agent_scope = f'arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT}:runtime/watchdog_orchestrator_production_kamal-*'
    agent_policies = [copy.deepcopy(s) for p in read('agentcore-runtime-policies').values() for s in p['Statement']]
    for s in agent_policies:
        if s.get('Sid') == 'BedrockAgentCoreReadArtifact': s['Resource'] = [artifact_arn, future]
        elif s.get('Sid') == 'BedrockAgentCoreListArtifactBucket':
            s['Condition']['StringLike']['s3:prefix'] = [obj['prefix'], 'agentcore/kamal-production-*']
        elif s.get('Sid') == 'CloudWatchLogs':
            s['Resource'] = [f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/bedrock-agentcore/runtimes/watchdog_orchestrator_production_kamal-*']
    role('AgentRole', {'Service': 'bedrock-agentcore.amazonaws.com'}, agent_policies,
        {'StringEquals': {'aws:SourceAccount': ACCOUNT}, 'ArnLike': {'aws:SourceArn': agent_scope}})
    agent = add('AgentRuntime', 'BedrockAgentCore::Runtime', {'AgentRuntimeName': 'watchdog_orchestrator_production_kamal',
        'AgentRuntimeArtifact': {'CodeConfiguration': {'Code': {'S3': {'Bucket': obj['bucket'], 'Prefix': obj['prefix'], 'VersionId': obj['versionId']}},
            'Runtime': 'NODE_22', 'EntryPoint': ['runtime.js']}}, 'RoleArn': att('AgentRole', 'Arn'),
        'NetworkConfiguration': {'NetworkMode': 'PUBLIC'}, 'ProtocolConfiguration': 'HTTP',
        'LifecycleConfiguration': {'IdleRuntimeSessionTimeout': 900, 'MaxLifetime': 28800},
        'EnvironmentVariables': runtime['environmentVariables'], 'Tags': {'Environment': 'production', 'ManagedBy': 'CloudFormation'}},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    for slot in ('A', 'B'):
        add('AgentEndpoint' + slot, 'BedrockAgentCore::RuntimeEndpoint', {
            'AgentRuntimeId': att('AgentRuntime', 'AgentRuntimeId'), 'Name': 'kamal_production_' + slot.lower(),
            'AgentRuntimeVersion': att('AgentRuntime', 'AgentRuntimeVersion')})
    add('SigningKey', 'KMS::Key', {'Description': 'Production Kamal release receipts', 'KeySpec': 'ECC_NIST_P256',
        'KeyUsage': 'SIGN_VERIFY', 'Tags': tags, 'KeyPolicy': {'Version': '2012-10-17', 'Statement': [
            {'Effect': 'Allow', 'Principal': {'AWS': f'arn:aws:iam::{ACCOUNT}:root'}, 'Action': 'kms:*', 'Resource': '*'}]}},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    deploy = [allow(['ec2:DescribeInstances', 'ec2:GetConsoleOutput'], '*', Condition={'StringEquals': {'aws:RequestedRegion': REGION}}),
        allow(['cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents', 'cloudformation:GetTemplate'],
            f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{NAME}/*'),
        allow(['ecs:DescribeExpressGatewayService'], [v['serviceArn'] for v in ecs.values()]),
        allow(['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'], f'arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:watchdog-bms/production/*'),
        allow(['ecr:DescribeRepositories', 'ecr:DescribeImages', 'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer',
               'ecr:BatchGetImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage'], att('Images', 'Arn')),
        allow(['ecr:GetAuthorizationToken'], '*'),
        allow(['bedrock-agentcore:GetAgentRuntime', 'bedrock-agentcore:UpdateAgentRuntime'], att('AgentRuntime', 'AgentRuntimeArn')),
        allow(['bedrock-agentcore:GetAgentRuntimeEndpoint', 'bedrock-agentcore:UpdateAgentRuntimeEndpoint'],
            [att('AgentRuntime', 'AgentRuntimeArn'), att('AgentEndpointA', 'AgentRuntimeEndpointArn'), att('AgentEndpointB', 'AgentRuntimeEndpointArn')]),
        allow(['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], future),
        allow(['s3:GetObject', 's3:GetObjectVersion'], artifact_arn),
        allow(['iam:PassRole'], att('AgentRole', 'Arn'), Condition={'StringEquals': {'iam:PassedToService': 'bedrock-agentcore.amazonaws.com'}}),
        allow(['kms:DescribeKey', 'kms:Sign', 'kms:Verify'], att('SigningKey', 'Arn'))]
    role('DeployRole', {'AWS': f'arn:aws:iam::{ACCOUNT}:user/watchdog-bedrock-dev'}, deploy)
    outputs.update({k: {'Value': v} for k, v in {'VpcId': vpc, 'RepositoryUri': att('Images', 'RepositoryUri'),
        'DeployRoleArn': att('DeployRole', 'Arn'), 'SigningKeyArn': att('SigningKey', 'Arn'),
        'AgentRuntimeArn': att('AgentRuntime', 'AgentRuntimeArn')}.items()})
    return {'AWSTemplateFormatVersion': '2010-09-09', 'Description': 'Production Kamal staged infrastructure; no customer cutover',
        'Metadata': {'BaselineSourceCommit': baseline, 'CustomerCutover': False, 'ApplicationContainersStarted': False},
        'Parameters': {'OperatorCidr': {'Type': 'String', 'AllowedPattern': r'(\d{1,3}\.){3}\d{1,3}/32'},
            'OperatorPublicKey': {'Type': 'String', 'AllowedPattern': r'ssh-ed25519 [A-Za-z0-9+/=]+'},
            'UbuntuAmi': {'Type': 'AWS::EC2::Image::Id'}, 'AlarmTopicArn': {'Type': 'String',
                'AllowedPattern': f'arn:aws:sns:{REGION}:{ACCOUNT}:[A-Za-z0-9_-]+'}},
        'Resources': resources, 'Outputs': outputs}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inventory', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = prepare(args.inventory)
    # Compact serialization stays within CloudFormation's 51,200-byte inline template limit.
    encoded = json.dumps(result, separators=(',', ':')) + '\n'
    assert len(encoded.encode()) <= 51200, 'Use a reviewed versioned template object if the stack exceeds the inline limit'
    args.output.write_text(encoded)
    print(json.dumps({'resources': len(result['Resources']), 'customerCutover': False, 'output': str(args.output)}))

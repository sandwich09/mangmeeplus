"""Initial stack boundary tests: no live route, consumer, or shared IAM replacement."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('production_stack', Path(__file__).with_name('prepare-production-stack.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def inventory():
    env = {'GIT_SHA': 'a' * 40, 'DEPLOY_ENVIRONMENT': 'production',
           'INTERNAL_API_URL': 'https://api.ecs.ap-southeast-1.on.aws/v1',
           'AI_GATEWAY_INTERNAL_URL': 'https://ai.ecs.ap-southeast-1.on.aws/v1'}
    services = {'api-web': 'watchdog-bms-api-web-pub', 'ai-gateway': 'watchdog-bms-ai-gateway-v2', 'workers': 'watchdog-bms-workers'}
    result = {s + '-ecs': {'service': {'serviceArn': f'arn:aws:ecs:{m.REGION}:{m.ACCOUNT}:service/watchdog-bms-prod/{name}',
        'activeConfigurations': [{'primaryContainer': {'environment': [{'name': k, 'value': v} for k, v in env.items()]}}]}}
        for s, name in services.items()}
    result.update({s + '-runtime-policies': {'runtime': {'Statement': []}} for s in services})
    result.update({'rds': {'DBInstances': [{'DBInstanceIdentifier': 'watchdog-bms-prod-db',
        'DBSubnetGroup': {'VpcId': 'vpc-0da727984eee92f96'}, 'VpcSecurityGroups': [{'VpcSecurityGroupId': 'sg-db'}]}]},
        'redis-cluster': {'CacheClusters': [{'CacheClusterId': 'watchdog-bms-prod-redis-001', 'SecurityGroups': [{'SecurityGroupId': 'sg-redis'}]}]},
        'listeners': {'Listeners': [{'ListenerArn': 'arn:listener'}]}, 'vpcs': {'Vpcs': [{'CidrBlock': '172.31.0.0/16'}]},
        'listener-rules': {'Rules': [{'Priority': str(i), 'Conditions': [{'Field': 'host-header', 'Values': [host]}]}
            for i, host in [(2, 'api.ecs.ap-southeast-1.on.aws'), (17, 'ai.ecs.ap-southeast-1.on.aws')]]},
        'agentcore-runtime': {'status': 'READY', 'environmentVariables': env,
            'agentRuntimeArtifact': {'codeConfiguration': {'code': {'s3': {'bucket': 'production-artifacts', 'prefix': 'baseline.zip', 'versionId': 'version1'}}}}},
        'agentcore-runtime-policies': {'runtime': {'Statement': []}}})
    return result


class ProductionStack(unittest.TestCase):
    def render(self, data):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for key, value in data.items(): (path / (key + '.json')).write_text(json.dumps(value))
            return m.prepare(path)

    def test_staging_cannot_switch_customer_traffic_or_start_apps(self):
        stack = self.render(inventory()); resources = stack['Resources']
        routes = [r['Properties'] for r in resources.values() if r['Type'].endswith('::ListenerRule')]
        self.assertEqual(len(routes), 2)
        for route in routes:
            self.assertIn({'Field': 'source-ip', 'SourceIpConfig': {'Values': [{'Ref': 'OperatorCidr'}]}}, route['Conditions'])
        self.assertNotIn('EnableProductionRoutes', stack['Parameters'])
        self.assertFalse(any(r['Type'].startswith('AWS::ECS::') for r in resources.values()))
        instances = [r['Properties'] for r in resources.values() if r['Type'] == 'AWS::EC2::Instance']
        self.assertEqual(len(instances), 4)
        api = [resources[key]['Properties'] for key in ('ApiASubnet', 'ApiBSubnet')]
        self.assertEqual(len({s['AvailabilityZone'] for s in api}), 2)
        self.assertEqual({r['IamInstanceProfile']['Ref'] for r in instances}, {'ApiProfile', 'AiProfile', 'WorkersProfile'})
        for node in instances:
            script = node['UserData']['Fn::Base64']['Fn::Sub']
            self.assertNotIn('docker run -d --name mangmee', script)
            self.assertIn('--name kamal-proxy', script)
            self.assertLess(script.index('authorized_keys'), script.index('apt-get'))
            subprocess.run(['bash', '-n'], input=script, text=True, check=True)
            self.assertEqual(node['MetadataOptions']['HttpTokens'], 'required')
            self.assertTrue(node['BlockDeviceMappings'][0]['Ebs']['Encrypted'])
        for r in resources.values():
            if r['Type'] == 'AWS::IAM::Role':
                self.assertTrue(r['Properties']['RoleName'].startswith('mangmee-kamal-production-'))
        deployment = resources['DeployRole']['Properties']
        principal = deployment['AssumeRolePolicyDocument']['Statement'][0]['Principal']['AWS']
        self.assertTrue(principal.endswith(':user/watchdog-bedrock-dev'))
        permissions = deployment['Policies'][0]['PolicyDocument']['Statement']
        self.assertFalse(any('ecs:UpdateExpressGatewayService' in p['Action'] or 'iam:CreateRole' in p['Action'] for p in permissions))
        self.assertLess(len(json.dumps(stack, separators=(',', ':')).encode()), 51200)

    def test_rejects_foreign_or_moving_baselines_and_occupied_network_routes(self):
        mutations = [
            lambda d: d['api-web-ecs']['service']['activeConfigurations'].append({}),
            lambda d: d['api-web-ecs']['service'].update(serviceArn='arn:foreign-uat'),
            lambda d: d['rds']['DBInstances'][0].update(DBInstanceIdentifier='watchdog-bms-uat-db'),
            lambda d: d['redis-cluster']['CacheClusters'][0].update(CacheClusterId='watchdog-bms-uat-redis'),
            lambda d: d['vpcs']['Vpcs'].append({'CidrBlock': '10.93.0.0/24'}),
            lambda d: d['listener-rules']['Rules'].append({'Priority': '1'}),
            lambda d: d['agentcore-runtime']['environmentVariables'].update(GIT_SHA='b' * 40),
        ]
        for index, mutate in enumerate(mutations):
            data = copy.deepcopy(inventory()); mutate(data)
            with self.subTest(index=index), self.assertRaises(AssertionError): self.render(data)


if __name__ == '__main__': unittest.main()

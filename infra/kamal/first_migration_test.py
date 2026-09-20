import copy
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from first_migration import FirstMigration, serving_target, traffic_template, validate_traffic_changes, worker_capacity


class MigrationBoundaries(unittest.TestCase):
    def test_express_blue_green_route_uses_only_its_active_target(self):
        action = {'Type':'forward', 'ForwardConfig':{'TargetGroups':[
            {'TargetGroupArn':'active','Weight':100}, {'TargetGroupArn':'idle','Weight':0}],
            'TargetGroupStickinessConfig':{'Enabled':False}}}
        self.assertEqual(serving_target(action), 'active')
        self.assertEqual(serving_target({'Type':'forward','TargetGroupArn':'active'}), 'active')
        action['ForwardConfig']['TargetGroups'][1]['Weight'] = 1
        with self.assertRaisesRegex(ValueError, 'split or sticky'): serving_target(action)
        action['ForwardConfig']['TargetGroups'][1]['Weight'] = 0
        action['ForwardConfig']['TargetGroupStickinessConfig']['Enabled'] = True
        with self.assertRaisesRegex(ValueError, 'split or sticky'): serving_target(action)

    def migration(self, tmp):
        release = Mock()
        release.work = Path(tmp)
        release.args = argparse.Namespace(production_baseline='a' * 40)
        release.target = {'migration': {'stackArn': 'arn:aws:cloudformation:ap-southeast-1:311414082667:stack/mangmee-kamal-production/stack'}}
        release.changed = []
        release.assert_candidate_workers_stopped = Mock()
        release.assert_no_legacy_operation = Mock()
        return FirstMigration(release), release

    def test_handover_never_starts_candidate_workers_before_old_workers_are_stopped(self):
        for failing in (None, 'stage', 'health', 'park'):
            with self.subTest(failing=failing), tempfile.TemporaryDirectory() as tmp:
                migration, release = self.migration(tmp); order = []
                def step(name):
                    order.append(name)
                    if name == failing: raise RuntimeError(name)
                migration.workflow_fence = lambda: step('fence')
                migration.routes = lambda public: step('staging-routes')
                migration.old_routes = lambda: step('ecs-routes')
                migration.verify_ecs_provider = lambda: step('preserved-provider')
                release.assert_candidate_workers_stopped = lambda: step('new-workers-stopped')
                release.deploy_service = lambda name: step('stage' if name != 'workers' else 'start-workers')
                migration.target_health = lambda: step('health')
                release.verify_ecs_build_authority = lambda: step('authority')
                migration.park_workers = lambda: step('park')
                migration.change_traffic = lambda public: step('public' if public else 'private')
                migration.observe_ecs = lambda parked: step('ecs-readback')
                if failing:
                    with self.assertRaises(RuntimeError): migration.handover()
                    self.assertNotIn('start-workers', order)
                    self.assertNotIn('public', order)
                else:
                    migration.handover()
                    self.assertLess(order.index('park'), order.index('start-workers'))
                    self.assertLess(order.index('start-workers'), order.index('public'))

    def test_duplicate_intent_and_worker_overlap_are_rejected_before_aws_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            migration, release = self.migration(tmp)
            migration.intent('ecs-workers-park', {'taskArns':['old-task']})
            with self.assertRaisesRegex(ValueError, 'Reconcile'): migration.intent('ecs-workers-park', {})
            self.assertEqual(len(json.loads(migration.journal.read_text())['steps']), 1)
            release.assert_candidate_workers_stopped.side_effect = ValueError('new workers still running')
            with self.assertRaisesRegex(ValueError, 'still running'): migration.restore_workers()
            release.aws.assert_not_called()

    def test_rollback_restores_routes_and_workers_only_after_consumer_stop_is_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            migration, release = self.migration(tmp); order = []
            migration.state['originalTemplate'] = {'original':'template'}
            migration.old_routes = lambda: None
            release.stop_candidate_workers = lambda: order.append('stop')
            release.assert_candidate_workers_stopped = lambda: order.append('verify-stop')
            release.aws.return_value = {'TemplateBody':{'changed':'template'}}
            migration.change_traffic = lambda public: order.append('restore-routes')
            migration.restore_workers = lambda: order.append('restore-workers')
            migration.rollback()
            self.assertEqual(order, ['stop','verify-stop','restore-routes','restore-workers'])

    def test_worker_parking_preserves_every_other_service_field(self):
        before = {'serviceArn': 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers',
            'executionRoleArn': 'execution-role', 'taskRoleArn': 'worker-role', 'healthCheckPath': '/v1/health',
            'primaryContainer': {'image': 'image@sha256:digest', 'environment': [{'name': 'GIT_SHA', 'value': 'source'}],
                                 'secrets': [{'name': 'DATABASE_URL', 'valueFrom': 'production-secret-ref'}]},
            'networkConfiguration': {'subnets': ['original-subnet']}, 'cpu': '512', 'memory': '1024',
            'scalingTarget': {'minTaskCount': 1, 'maxTaskCount': 2, 'autoScalingMetric': 'AVERAGE_CPU', 'autoScalingTargetValue': 70}}
        saved = copy.deepcopy(before)
        parked = worker_capacity(before, True)
        self.assertEqual(before, saved)
        self.assertEqual(parked['scalingTarget']['minTaskCount'], 0)
        self.assertEqual(parked['scalingTarget']['maxTaskCount'], 0)
        parked['scalingTarget'].update(minTaskCount=1, maxTaskCount=2)
        self.assertEqual(parked, before)
        self.assertEqual(worker_capacity(before, False), before)
        before['serviceArn'] = before['serviceArn'].replace('watchdog-bms-workers', 'watchdog-bms-api-web-pub')
        with self.assertRaisesRegex(ValueError, 'Foreign worker'): worker_capacity(before, True)

    def template(self):
        resources = {'UnrelatedRole': {'Type': 'AWS::IAM::Role', 'Properties': {'RoleName': 'unchanged'}}}
        hosts = {'ApiStagingRoute': 'api.example.com', 'AiStagingRoute': 'ai.example.com'}
        for name, host in hosts.items():
            resources[name] = {'Type': 'AWS::ElasticLoadBalancingV2::ListenerRule', 'Properties': {
                'Conditions': [{'Field': 'host-header', 'Values': [host]},
                    {'Field': 'source-ip', 'SourceIpConfig': {'Values': [{'Ref': 'OperatorCidr'}]}}],
                'Actions': [{'Type': 'forward', 'TargetGroupArn': {'Ref': name.replace('StagingRoute', 'Targets')}}]}}
        return {'Description': 'Production Kamal staged infrastructure; no customer cutover', 'Resources': resources}, hosts

    def test_traffic_switch_and_restore_only_touch_owned_conditions(self):
        before, hosts = self.template(); saved = copy.deepcopy(before)
        public = traffic_template(before, True, hosts)
        self.assertEqual(before, saved)
        self.assertEqual(public['Resources']['UnrelatedRole'], before['Resources']['UnrelatedRole'])
        self.assertEqual(traffic_template(public, False, hosts), before)
        self.assertEqual(len(public['Resources']['ApiStagingRoute']['Properties']['Conditions']), 1)
        public['Resources']['ApiStagingRoute']['Properties']['Actions'][0]['TargetGroupArn'] = 'foreign'
        with self.assertRaisesRegex(ValueError, 'target drifted'): traffic_template(public, False, hosts)

    def test_provider_changes_cannot_replace_routes_or_expand_into_iam(self):
        changes = [{'ResourceChange': {'LogicalResourceId': name, 'Action': 'Modify', 'Replacement': 'False',
            'ResourceType': 'AWS::ElasticLoadBalancingV2::ListenerRule', 'Scope': ['Properties'],
            'Details': [{'Target': {'Attribute': 'Properties', 'Name': 'Conditions'}}]}}
            for name in ['ApiStagingRoute', 'AiStagingRoute']]
        validate_traffic_changes(changes)
        for mutate in [lambda d: d.append({'ResourceChange': {'LogicalResourceId': 'DeployRole'}}),
                       lambda d: d[0]['ResourceChange'].update(Replacement='True'),
                       lambda d: d[0]['ResourceChange'].update(Scope=['Properties', 'Metadata']),
                       lambda d: d[0]['ResourceChange']['Details'][0]['Target'].update(Name='Actions')]:
            value = copy.deepcopy(changes); mutate(value)
            with self.assertRaises(ValueError): validate_traffic_changes(value)


if __name__ == '__main__': unittest.main()

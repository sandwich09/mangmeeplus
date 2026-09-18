"""Stateful, offline cutover-to-enrollment and rollback rehearsal.

The AWS/HTTP/browser observations below are synthetic, never live acceptance.
The provider model includes the actual empty ExecuteChangeSet response shape.
"""
import argparse
import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from first_migration import FirstMigration
import first_migration_test as migration_tests
from release_test import m, target


class Cloud:
    def __init__(self, release, status='CREATE_COMPLETE'):
        self.release = release
        self.template, _ = migration_tests.MigrationBoundaries().template()
        self.status = status
        self.calls = []
        self.changes = {}
        self.events = []
        self.signature = None

    def command(self, argv, **kwargs):
        service, operation, *args = argv
        self.calls.append((service, operation))
        value = lambda flag: args[args.index(flag) + 1]
        result = None
        if (service, operation) == ('cloudformation', 'get-template'):
            result = {'TemplateBody': copy.deepcopy(self.template)}
        elif (service, operation) == ('cloudformation', 'describe-stacks'):
            result = {'Stacks': [{'StackStatus': self.status,
                'Parameters': [{'ParameterKey': 'OperatorCidr', 'ParameterValue': '192.0.2.1/32'},
                    {'ParameterKey': 'UbuntuAmi', 'ParameterValue': 'ami-simulation'}]}]}
        elif (service, operation) == ('ec2', 'describe-images'):
            result = {'Images': [{'ImageId': 'ami-simulation', 'State': 'available'}]}
        elif (service, operation) == ('elbv2', 'describe-tags'):
            result = {'TagDescriptions': [{'ResourceArn': name, 'Tags': []}
                for name in ('ApiStagingRoute', 'AiStagingRoute')]}
        elif (service, operation) == ('cloudformation', 'create-change-set'):
            name = value('--change-set-name')
            self.changes[name] = json.loads(Path(value('--template-body')[7:]).read_text())
            result = {'Id': name}
        elif (service, operation) == ('cloudformation', 'describe-change-set'):
            result = {'Status': 'CREATE_COMPLETE', 'Changes': [{'ResourceChange': {
                'LogicalResourceId': name, 'Action': 'Modify', 'Replacement': 'False',
                'ResourceType': 'AWS::ElasticLoadBalancingV2::ListenerRule', 'Scope': ['Properties'],
                'Details': [{'Target': {'Attribute': 'Properties', 'Name': 'Conditions'}}]}}
                for name in ('ApiStagingRoute', 'AiStagingRoute')]}
        elif (service, operation) == ('cloudformation', 'execute-change-set'):
            self.template = self.changes[value('--change-set-name')]
            self.status = 'UPDATE_COMPLETE'
            self.events.append({'ClientRequestToken': value('--client-request-token'),
                'ResourceType': 'AWS::CloudFormation::Stack', 'ResourceStatus': 'UPDATE_COMPLETE'})
            # Actual AWS CLI --generate-cli-skeleton output proves this command has no JSON body.
            return ''
        elif (service, operation) == ('cloudformation', 'describe-stack-events'):
            result = {'StackEvents': self.events}
        elif (service, operation) == ('cloudformation', 'describe-stack-resources'):
            result = {'StackResources': [{'LogicalResourceId': name, 'PhysicalResourceId': name}
                for name in ('ApiStagingRoute', 'AiStagingRoute', 'ApiTargets', 'AiTargets')]}
        elif (service, operation) == ('elbv2', 'describe-rules'):
            rows = []
            for name in ('ApiStagingRoute', 'AiStagingRoute'):
                props = self.template['Resources'][name]['Properties']
                conditions = copy.deepcopy(props['Conditions'])
                for condition in conditions:
                    if condition['Field'] == 'source-ip':
                        condition['SourceIpConfig']['Values'] = ['192.0.2.1/32']
                rows.append({'RuleArn': name, 'Conditions': conditions, 'Actions': [{
                    'Type': 'forward', 'TargetGroupArn': name.replace('StagingRoute', 'Targets')}]})
            result = {'Rules': rows}
        elif (service, operation) == ('kms', 'describe-key'):
            result = {'KeyMetadata': {'SigningAlgorithms': ['ECDSA_SHA_256']}}
        elif (service, operation) == ('kms', 'sign'):
            # A deterministic fake KMS response, explicitly not a real KMS signature.
            self.signature = hashlib.sha256(Path(value('--message')[8:]).read_bytes()).digest()
            result = {'KeyId': 'SIMULATED_KMS_NOT_RELEASE_EVIDENCE',
                'Signature': base64.b64encode(self.signature).decode()}
        elif (service, operation) == ('kms', 'verify'):
            payload = Path(value('--message')[8:]).read_bytes()
            signature = Path(value('--signature')[8:]).read_bytes()
            result = {'SignatureValid': signature == hashlib.sha256(payload).digest()}
        else:
            raise AssertionError('Unmodeled command: ' + service + ':' + operation)
        return json.dumps(result)

def release(root):
    r = m.Release.__new__(m.Release)
    r.id = 'SIMULATION_ONLY'
    r.clock = time.monotonic()
    r.state = root / 'state'
    r.work = r.state / 'runs' / r.id
    r.work.mkdir(parents=True)
    r.args = argparse.Namespace(environment='production', production_baseline='b' * 40, rollback=None)
    r.target = target('production')
    r.target.update(cutoverComplete=False, browserAcceptanceUserId='cmt8k20fs00000q319isxwkc5',
        migration={'stackArn': 'arn:aws:cloudformation:ap-southeast-1:311414082667:stack/mangmee-kamal-production/simulation',
            'state': 'INFRASTRUCTURE_STAGED_NO_APPLICATION'})
    r.aws_prefix = []
    r.changed = []
    r.secrets = set()
    r.first_migration = r.manual_browser = r.production_browser = True
    r.build = {'status': 'passed', 'sourceCommit': 'a' * 40, 'sourceTreeSha256': 'c' * 64,
        'images': {s: {'architecture': 'amd64'} for s in (*m.SERVICES, 'tools')},
        'agentcore': {'sourceCommit': 'a' * 40, 'sha256': 'd' * 64, 'artifact': 'agentcore.zip'}}
    r.images = {s: {'tag': f'311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/mangmee-kamal-production/releases:simulation-{s}',
        'imageId': 'sha256:' + 'e' * 64, 'digest': 'sha256:' + 'f' * 64} for s in (*m.SERVICES, 'tools')}
    r.manifest = {'releaseId': 'c' * 64}
    r.receipt = {'status': 'RUNNING', 'phases': [], 'agentcore': {'simulation': True},
        'runtimeReadback': {}, 'readiness': {}, 'launchRetirement': {'passed': True, 'mode': 'SIMULATED'}}
    r.inspect_service = lambda s: [{'running': True, 'sourceCommit': 'a' * 40, 'simulation': True}]
    r.deep_health = lambda s: None
    cloud = Cloud(r)
    r.command = cloud.command
    r.migration = FirstMigration(r)
    return r, cloud


def browser_proof(r, failed_check=None):
    evidence = r.work / 'synthetic-browser-observation.txt'
    evidence.write_text('SIMULATED OBSERVATIONS ONLY. No real login, permission check or logout occurred.')
    checks = {k: True for k in ('ownerLogin', 'systemAdminPermission', 'customerOpen', 'authenticatedRead',
        'logout', 'sessionRejectedAfterLogout', 'identityVerified', 'noPasswordOrLegalAction', 'servingLive', 'canOpen')}
    if failed_check: checks[failed_check] = False
    proof = {'schemaVersion': 1, 'operationId': r.id,
        'sourceCommit': r.build['sourceCommit'], 'releaseId': r.manifest['releaseId'],
        'environment': 'production', 'origin': r.target['publicUrl'], 'userId': r.target['browserAcceptanceUserId'],
        'checks': checks, 'observer': 'OFFLINE_SIMULATION_NOT_AN_OPERATOR', 'evidenceFiles': [str(evidence)]}
    if r.args.rollback: proof['rollbackOf'] = r.args.rollback
    m.write(r.work / 'browser-acceptance.json', proof)


class CutoverRehearsal(unittest.TestCase):
    def test_actual_void_aws_response_is_not_a_failed_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, _ = release(Path(tmp))
            r.command = lambda *a, **kw: ''
            self.assertEqual(r.aws(['cloudformation', 'execute-change-set']), {})

    def test_empty_reads_malformed_json_and_command_errors_remain_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, _ = release(Path(tmp))
            for command, output in [(['cloudformation', 'describe-stacks'], ''),
                                    (['cloudformation', 'execute-change-set'], 'not-json')]:
                r.command = lambda *a, **kw: output
                with self.assertRaisesRegex(RuntimeError, 'no automatic mutation retry'): r.aws(command)
            with patch.object(r, 'command', side_effect=RuntimeError('AccessDenied')) as command:
                with self.assertRaisesRegex(RuntimeError, 'no automatic mutation retry'):
                    r.aws(['cloudformation', 'execute-change-set'])
                self.assertEqual(command.call_count, 1)

    def test_unchanged_rolled_back_stack_can_prepare_a_reviewed_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, cloud = release(Path(tmp))
            cloud.status = 'UPDATE_ROLLBACK_COMPLETE'
            r.migration.routes(public=False)
            r.migration.traffic_prerequisites()
            r.migration.change_traffic(public=True)
            self.assertTrue(r.migration.state['publicTraffic'])

    def test_cutover_browser_sign_enroll_and_route_rollback_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, cloud = release(Path(tmp))
            baseline = copy.deepcopy(cloud.template)
            r.migration.routes(public=False)
            r.migration.traffic_prerequisites()
            r.migration.change_traffic(public=True)
            browser_proof(r)
            def response(request, **kwargs):
                body = b'<main data-platform-access="open"></main>' if request.full_url.endswith('/login') else b'{"state":"OPEN"}'
                result = io.BytesIO(body); result.status = 200
                return result
            with patch.object(m.urllib.request, 'build_opener') as opener:
                opener.return_value.open.side_effect = response
                r.acceptance()
            authority_checks = []
            r.migration.observe_ecs = lambda parked: authority_checks.append(('observe', parked))
            r.tool = lambda command, **kw: authority_checks.append(('authority', kw['extra']['GIT_SHA']))
            r.retire()
            self.assertEqual(authority_checks, [('observe', True), ('authority', 'b' * 40)])
            r.sign()
            r.enroll_first_migration()
            forward_signature = (r.work / 'accepted.json').read_bytes()
            enrolled = m.read(r.state / 'target.json')
            self.assertTrue(enrolled['cutoverComplete'])
            self.assertEqual(enrolled['ecsRollbackBaseline'], 'b' * 40)
            self.assertTrue(r.receipt['signature']['verified'])
            order = []
            r.migration.old_routes = lambda: order.append('old-route-check')
            r.stop_candidate_workers = lambda: order.append('stop-candidate')
            r.assert_candidate_workers_stopped = lambda: order.append('verify-stopped')
            r.migration.restore_workers = lambda: order.append('restore-original-workers')
            r.migration.rollback()
            self.assertEqual(cloud.template, baseline)
            self.assertFalse(r.migration.state['publicTraffic'])
            self.assertLess(order.index('verify-stopped'), order.index('restore-original-workers'))
            self.assertEqual(len(cloud.changes), 2)
            self.assertEqual([x['status'] for x in r.migration.state['steps']], ['VERIFIED', 'VERIFIED'])
            self.assertEqual((r.work / 'accepted.json').read_bytes(), forward_signature)
            recovery, _ = release(Path(tmp) / 'recovery')
            recovery.args.rollback = r.id
            recovery.ecs_restored = True
            recovery.build = {'sourceCommit': 'b' * 40}
            recovery.receipt['rollbackOf'] = r.id
            recovery.migration.state = copy.deepcopy(r.migration.state)
            recovery.migration.runtime_summary = lambda: {'sourceCommit': 'b' * 40, 'simulation': True}
            recovery.command = cloud.command
            browser_proof(recovery)
            with patch.object(m.urllib.request, 'build_opener') as opener:
                opener.return_value.open.side_effect = response
                recovery.acceptance()
            recovery.sign(state='ROLLED_BACK_TO_ECS')
            restored = m.read(recovery.work / 'accepted.json')
            self.assertEqual(restored['state'], 'ROLLED_BACK_TO_ECS')
            self.assertEqual(restored['sourceCommit'], 'b' * 40)
            self.assertTrue(restored['migration']['ecsRestored'])
            self.assertFalse(restored['migration']['publicTraffic'])

    def test_each_missing_production_browser_check_prevents_enrollment(self):
        for check in ('identityVerified', 'systemAdminPermission', 'customerOpen', 'logout', 'sessionRejectedAfterLogout'):
            with self.subTest(check=check), tempfile.TemporaryDirectory() as tmp:
                r, _ = release(Path(tmp)); browser_proof(r, check)
                with self.assertRaisesRegex(ValueError, 'incomplete or failed'): r.browser_acceptance()
                self.assertFalse((r.state / 'target.json').exists())

    def test_signature_failure_cannot_become_completed_enrollment(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, cloud = release(Path(tmp))
            r.migration.state['publicTraffic'] = True
            r.receipt.update(customerAcceptance={'passed': True}, signature={'verified': False})
            with self.assertRaisesRegex(ValueError, 'incomplete'): r.enroll_first_migration()
            self.assertFalse((r.state / 'target.json').exists())

    def test_real_signing_boundary_rejects_invalid_kms_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, cloud = release(Path(tmp))
            r.receipt.update(customerAcceptance={'passed': True}, secondsToWebsiteReady=1,
                browserAcceptanceStageSeconds=1)
            def aws(args, **kwargs):
                if args[:2] == ['kms', 'verify']: return {'SignatureValid': False}
                return m.Release.aws(r, args, **kwargs)
            r.aws = aws
            with self.assertRaisesRegex(ValueError, 'signature failed'): r.sign()
            self.assertNotIn('signature', r.receipt)
            self.assertFalse((r.state / 'target.json').exists())

    def test_failed_change_set_is_retained_without_a_second_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, cloud = release(Path(tmp))
            def aws(args, **kwargs):
                result = r.aws(args, **kwargs)
                if args[:2] == ['cloudformation', 'execute-change-set']:
                    cloud.status = 'UPDATE_ROLLBACK_COMPLETE'
                return result
            r.migration.aws = aws
            r.migration.routes(public=False)
            with self.assertRaisesRegex(ValueError, 'reconcile before retry'):
                r.migration.change_traffic(public=True)
            self.assertEqual(cloud.calls.count(('cloudformation', 'execute-change-set')), 1)
            self.assertEqual(r.migration.state['steps'][-1]['status'], 'EXECUTION_INTENT')
            self.assertFalse(r.migration.state.get('publicTraffic', False))

    def test_customer_closed_never_produces_acceptance_or_signature(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, _ = release(Path(tmp)); browser_proof(r)
            response = io.BytesIO(b'{"state":"CLOSED"}'); response.status = 200
            with patch.object(m.urllib.request, 'build_opener') as opener:
                opener.return_value.open.return_value = response
                with self.assertRaisesRegex(ValueError, 'not OPEN'): r.acceptance()
            self.assertNotIn('customerAcceptance', r.receipt)
            self.assertFalse((r.work / 'accepted.sig').exists())

    def test_missing_provider_read_permission_fails_before_any_mutation(self):
        for denied in [('ec2', 'describe-images'), ('elbv2', 'describe-tags')]:
            with self.subTest(denied=denied), tempfile.TemporaryDirectory() as tmp:
                r, cloud = release(Path(tmp))
                r.migration.routes(public=False)
                def command(args, **kwargs):
                    if tuple(args[:2]) == denied: raise RuntimeError('AccessDenied')
                    return cloud.command(args, **kwargs)
                r.command = command
                with self.assertRaisesRegex(RuntimeError, 'no automatic mutation retry'):
                    r.migration.traffic_prerequisites()
                self.assertFalse(r.changed)
                self.assertFalse(cloud.changes)
                self.assertNotIn('trafficPrerequisites', r.migration.state)


if __name__ == '__main__': unittest.main()

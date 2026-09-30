"""Exercise the new orchestration boundaries without AWS or production mutations."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from release_test import m, target
from release_source_test import accepted


class ReleasePaths(unittest.TestCase):
    def test_exited_candidate_workers_with_restart_policy_still_block_ecs_restore(self):
        r = m.Release.__new__(m.Release)
        r.target = target('production'); r.build = {'sourceCommit':'a'*40}
        container = {'Id':'candidate','State':{'Running':False,'Status':'exited'},
            'HostConfig':{'RestartPolicy':{'Name':'always'}},'Config':{'Env':['GIT_SHA='+'a'*40]}}
        calls = []
        def remote(host, args, **kwargs):
            calls.append(args)
            if args[:2] == ['docker','ps']:
                self.assertIn('--all', args)
                return 'candidate'
            if args[:2] == ['docker','update']:
                container['HostConfig']['RestartPolicy']['Name'] = 'no'
                return ''
            self.assertEqual(args[:2], ['docker','inspect'])
            return json.dumps([container])
        r.remote = remote
        with self.assertRaisesRegex(ValueError, 'automatic restart disabled'):
            r.assert_candidate_workers_stopped()
        r.migration = type('Journal',(),{'intent':lambda *args:None})()
        r.stop_candidate_workers()
        r.assert_candidate_workers_stopped()
        self.assertTrue(any(c[:3] == ['docker','update','--restart=no'] for c in calls))

    def test_migration_can_recover_a_publication_failure_but_not_lose_database_recovery_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp)
            r = m.Release.__new__(m.Release)
            r.args = argparse.Namespace(source_sha='a'*40); r.secrets = set()
            m.write(old/'build/build-result.json', {'sourceCommit':'a'*40})
            for service in m.SERVICES:
                m.write(old/'environments'/(service+'.environment.json'), {'GIT_SHA':'a'*40})
            before_database = {'phases':[{'name':'publish-and-pull','status':'FAILED'}]}
            self.assertFalse(r.load_migration_rollback(old, before_database))
            self.assertEqual(r.images, {})
            during_database = {'phases':[{'name':'database-and-feature-authority','status':'FAILED'}]}
            with self.assertRaisesRegex(ValueError, 'retained complete publication'):
                r.load_migration_rollback(old, during_database)
            m.write(old/'publication.json', {s:{'tag':s} for s in (*m.SERVICES, 'tools')})
            self.assertTrue(r.load_migration_rollback(old, during_database))

    def test_first_migration_cannot_masquerade_as_completed_enrollment(self):
        value = target('production'); value['cutoverComplete'] = False
        value['migration'] = {'state':'INFRASTRUCTURE_STAGED_NO_APPLICATION','baselineSourceCommit':'a'*40,
            'stackArn':f'arn:aws:cloudformation:{m.REGION}:{m.ACCOUNT}:stack/mangmee-kamal-production/stack'}
        self.assertIs(m.validate_target(value,'production',first_migration=True), value)
        with self.assertRaisesRegex(ValueError,'not been enrolled'): m.validate_target(value,'production')
        value['cutoverComplete'] = True
        with self.assertRaisesRegex(ValueError,'incomplete target'): m.validate_target(value,'production',first_migration=True)

    def test_production_browser_requires_exact_current_admin_and_separate_flag(self):
        r = m.Release.__new__(m.Release); r.args = argparse.Namespace(environment='production')
        r.target = target('production'); r.manual_browser = True; r.production_browser = True
        r.target['browserAcceptanceUserId'] = 'cmt8k20fs00000q319isxwkc5'
        r.validate_acceptance_target()
        r.target['browserAcceptanceUserId'] = 'company-owner'
        with self.assertRaisesRegex(ValueError,'current prodmangmeeplus'): r.validate_acceptance_target()
        r.target['browserAcceptanceUserId'] = 'cmt8k20fs00000q319isxwkc5'; r.production_browser = False
        with self.assertRaisesRegex(ValueError,'real UAT'): r.validate_acceptance_target()

    def test_hotfix_preserves_full_serving_config_and_rejects_drift(self):
        r = m.Release.__new__(m.Release)
        r.target = target('production'); r.args = argparse.Namespace(production_baseline='a' * 40)
        r.secrets = set(); r.receipt = {}; proxy_calls = []; containers = {}
        for service, hosts in r.target['hosts'].items():
            for host in hosts:
                env = {'DEPLOY_ENVIRONMENT': 'production', 'APP_ENV': 'production', 'GIT_SHA': 'a' * 40,
                       'EMAIL_PROVIDER': 'disabled', 'KAMAL_HOST': host['address'],
                       'DATABASE_URL': 'synthetic-database-secret', 'PATH': '/usr/local/bin:/usr/bin'}
                containers[host['instanceId']] = {'State': {'Running': True}, 'Config': {
                    'Env': [k + '=' + v for k, v in env.items()]}, 'Image': 'sha256:baseline'}
        def remote(host, command):
            if command[:2] == ['docker', 'ps']: return 'container-id\n'
            if command[:3] == ['docker', 'image', 'inspect']:
                return json.dumps([{'Config': {'Labels': {'org.opencontainers.image.revision': 'a' * 40}}}])
            return json.dumps([containers[host['instanceId']]])
        r.remote = remote; r.verify_proxy = lambda *a: proxy_calls.append(a)
        r.verify_hotfix_baseline()
        self.assertEqual(len(proxy_calls), 4)
        self.assertEqual(r.hotfix_configurations['api-web']['APP_ENV'], 'production')
        self.assertEqual(r.hotfix_configurations['api-web']['EMAIL_PROVIDER'], 'disabled')
        self.assertNotIn('KAMAL_HOST', r.hotfix_configurations['api-web'])
        self.assertIn('synthetic-database-secret', r.secrets)
        containers[r.target['hosts']['workers'][0]['instanceId']]['Config']['Env'].append('NEW_SETTING=changed')
        with self.assertRaisesRegex(ValueError, 'configuration changed'): r.verify_hotfix_baseline()

    def test_wrong_baseline_never_becomes_a_new_default(self):
        r = m.Release.__new__(m.Release); r.target = target('production')
        r.args = argparse.Namespace(production_baseline='a' * 40); r.secrets = set(); r.receipt = {}
        r.verify_proxy = lambda *a: None
        def remote(host, command):
            if command[:2] == ['docker', 'ps']: return 'container-id'
            if command[:3] == ['docker', 'image', 'inspect']:
                return json.dumps([{'Config': {'Labels': {'org.opencontainers.image.revision': 'b' * 40}}}])
            return json.dumps([{'State': {'Running': True}, 'Config': {'Env': ['DEPLOY_ENVIRONMENT=production', 'GIT_SHA=' + 'b' * 40]}, 'Image': 'changed'}])
        r.remote = remote
        with self.assertRaisesRegex(ValueError, 'baseline'): r.verify_hotfix_baseline()
        self.assertFalse(hasattr(r, 'hotfix_configurations'))

    def test_signature_failure_wrong_key_and_archive_tampering_stop_before_artifact_use(self):
        for failure in (None, 'signature', 'key', 'archive'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); (root / 'work').mkdir(); directory = root / 'uat'; directory.mkdir()
                receipt = accepted(); receipt['completedAt'] = datetime.now(timezone.utc).isoformat()
                archive_hash = hashlib.sha256(b'archive').hexdigest()
                receipt['promotionBundle']['agentcore']['sha256'] = archive_hash
                receipt['agentcore']['artifactSha256'] = archive_hash
                m.write(directory / 'accepted.json', receipt); (directory / 'accepted.sig').write_bytes(b'signature')
                archive = directory / 'build/agentcore'; archive.mkdir(parents=True)
                (archive / 'agentcore.zip').write_bytes(b'tampered' if failure == 'archive' else b'archive')
                key = f'arn:aws:kms:{m.REGION}:{m.ACCOUNT}:key/trusted-key'
                r = m.Release.__new__(m.Release); r.args = argparse.Namespace(uat_release=directory)
                r.work = root / 'work'; r.target = {'trustedUatSigningKeyArn': key}; r.receipt = {}; calls = []
                def aws(args):
                    calls.append(args)
                    if args[:2] == ['kms', 'describe-key']:
                        return {'KeyMetadata': {'Arn': key + '-wrong' if failure == 'key' else key,
                            'KeyUsage': 'SIGN_VERIFY', 'KeyState': 'Enabled', 'SigningAlgorithms': ['ECDSA_SHA_256']}}
                    self.assertEqual(args[:2], ['kms', 'verify'])
                    return {'SignatureValid': failure != 'signature'}
                r.aws = aws
                if failure:
                    with self.assertRaises(ValueError): r.load_uat_release()
                    self.assertNotIn('sourceSelection', r.receipt)
                else:
                    r.load_uat_release()
                    self.assertTrue(r.receipt['sourceSelection']['signatureVerified'])
                    self.assertEqual(r.uat_bundle['sourceCommit'], receipt['sourceCommit'])
                self.assertEqual(len(calls), 1 if failure == 'key' else 2)

    def test_promotion_has_no_build_or_regression_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = m.Release.__new__(m.Release); r.work = Path(tmp); r.pinned_sha = 'a' * 40
            r.release_path = 'uat'; r.receipt = {}; calls = []; loaded = []
            r.command = lambda args, **kw: calls.append(args)
            r.load_promoted_images = lambda: loaded.append(True)
            r.source_and_build()
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][:3], ['git', 'worktree', 'add'])
            self.assertEqual(loaded, [True])
            r.load_promoted_images = lambda: (_ for _ in ()).throw(ValueError('invalid signed artifact'))
            with self.assertRaisesRegex(ValueError, 'invalid signed artifact'): r.source_and_build()
            self.assertFalse(any('build-complete.py' in ' '.join(c) for c in calls))

    def test_image_only_hotfix_rebuilds_every_image_and_runs_its_declared_regression(self):
        spec = 'apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts'
        with tempfile.TemporaryDirectory() as tmp:
            r = m.Release.__new__(m.Release); r.work = Path(tmp); r.pinned_sha = 'a' * 40
            r.release_path = 'hotfix'; r.receipt = {}; calls = []
            r.args = argparse.Namespace(environment='production', apply=True, prepared_build=None, regression_test=[spec],
                                        hotfix_path=['apps/web/public/assets/line/package-poster-20261001.png'])
            def command(args, cwd=None, **kw):
                calls.append((args, cwd))
                if args[:3] == ['git', 'worktree', 'add']:
                    (Path(args[4]) / spec).parent.mkdir(parents=True); (Path(args[4]) / spec).write_text('')
                elif args[1:2] == [str(m.HELPERS / 'build-complete.py')]:
                    m.write(Path(args[3]) / 'build-result.json', {'status': 'passed'})
            r.command = command
            r.source_and_build()
            # build-complete.py builds api-web (which copies apps/web/public), ai-gateway, workers and tools.
            self.assertEqual(calls[1][0][1:], [str(m.HELPERS / 'build-complete.py'), str(r.source), str(r.build_dir)])
            self.assertEqual(calls[2], (['pnpm', 'exec', 'tsx', '--test', spec.removeprefix('apps/api/')], r.source / 'apps/api'))
            self.assertEqual(len(calls), 3)
            self.assertEqual(r.receipt['hotfixValidation']['regressionTests'], [spec])


if __name__ == '__main__': unittest.main()

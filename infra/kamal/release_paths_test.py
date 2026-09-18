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


if __name__ == '__main__': unittest.main()

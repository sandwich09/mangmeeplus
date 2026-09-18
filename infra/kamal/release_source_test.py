#!/usr/bin/env python3
"""Exercise source isolation and the signed-artifact contract without cloud mutation."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from pathlib import Path
import subprocess
import tempfile
import unittest

from release_source import accepted_uat_bundle, hotfix_source, promotion_bundle


def accepted():
    source = 'a' * 40
    services = ('api-web', 'ai-gateway', 'workers', 'tools')
    build = {'status': 'passed', 'sourceCommit': source, 'sourceTreeSha256': 'b' * 64,
             'images': {s: {'architecture': 'amd64'} for s in services},
             'agentcore': {'sourceCommit': source, 'sha256': 'c' * 64, 'artifact': 'agentcore.zip'}}
    publication = {s: {'tag': f'311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/mangmee-kamal-uat/releases:v1-{s}',
                       'digest': 'sha256:' + 'd' * 64, 'imageId': 'sha256:' + 'e' * 64} for s in services}
    return {'schemaVersion': 1, 'environment': 'uat', 'kind': 'uat', 'sourceCommit': source,
            'operationId': '20260918T060000Z-1234abcd', 'state': 'ACCEPTED_LINE_DEFERRED',
            'completedAt': '2026-09-18T06:00:00+00:00', 'customerAcceptance': {'passed': True},
            'launchRetirement': {'passed': True}, 'promotionBundle': promotion_bundle(build, publication),
            'agentcore': {'sourceCommit': source, 'artifactSha256': 'c' * 64},
            'runtimeReadback': {s: [{'running': True, 'configValidationPassed': True, 'sourceCommit': source,
                                    'imageId': 'sha256:' + 'e' * 64, 'instanceId': 'i-123'}] for s in services[:-1]},
            'readiness': {s: {'i-123': {'passed': True}} for s in services[:-1]}}


class SourceContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Test')
        self.path = 'apps/api/src/answer.ts'
        self.put(self.path, 'old\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL, text=True).strip()

    def put(self, path, content):
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'candidate')
        return self.git('rev-parse', 'HEAD')

    def test_pins_the_selected_candidate_even_after_the_branch_advances(self):
        self.put(self.path, 'fixed\n')
        candidate = self.commit()
        self.put('apps/api/src/unrelated.ts', 'unrelated\n')
        self.commit()
        result = hotfix_source(self.root, self.base, candidate, [self.path])
        self.assertEqual(result['sourceCommit'], candidate)
        self.assertEqual(result['changedPaths'], [self.path])
        self.assertNotEqual(result['sourceCommit'], self.git('rev-parse', 'HEAD'))
        with self.assertRaisesRegex(ValueError, 'complete declared'):
            hotfix_source(self.root, self.base, self.git('rev-parse', 'HEAD'), [self.path])

    def test_rejects_schema_dependency_and_workflow_changes_even_if_declared(self):
        for path in ('apps/api/prisma/schema.prisma', 'apps/api/package.json', '.github/workflows/ci.yml'):
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, 'outside application'):
                    hotfix_source(self.root, self.base, self.base, [path])

    def test_declared_shared_contract_and_browser_regression_are_application_scope(self):
        paths = ['packages/contracts/src/expenses.ts', 'e2e/expenses.spec.ts']
        for path in paths: self.put(path, 'scoped fix\n')
        candidate = self.commit()
        self.assertEqual(hotfix_source(self.root, self.base, candidate, paths)['changedPaths'], sorted(paths))
        with self.assertRaisesRegex(ValueError, 'outside application'):
            hotfix_source(self.root, self.base, candidate, ['packages/contracts/package.json'])

    def test_rejects_symlinks_and_wrong_baseline(self):
        p = self.root / self.path
        p.unlink(); p.symlink_to('/etc/passwd')
        candidate = self.commit()
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            hotfix_source(self.root, self.base, candidate, [self.path])
        with self.assertRaisesRegex(ValueError, 'Git source'):
            hotfix_source(self.root, candidate, self.base, [self.path])


class PromotionContracts(unittest.TestCase):
    def test_complete_bundle_is_accepted_and_returned_without_rebuilding(self):
        receipt = accepted()
        result = accepted_uat_bundle(receipt, datetime(2026, 9, 18, 7, tzinfo=timezone.utc))
        self.assertIs(result, receipt['promotionBundle'])
        self.assertEqual(set(result['images']), {'api-web', 'ai-gateway', 'workers', 'tools'})
        self.assertTrue(all('@sha256:' in row['uri'] for row in result['images'].values()))

    def test_rejects_unsigned_neighbors_mixed_images_source_and_partial_readiness(self):
        mutations = [
            lambda d: d.pop('promotionBundle'),
            lambda d: d.update(environment='production'),
            lambda d: d.update(rollbackOf='previous'),
            lambda d: d['promotionBundle']['images'].pop('tools'),
            lambda d: d['promotionBundle'].update(sourceCommit='f' * 40),
            lambda d: d['promotionBundle']['images']['api-web'].update(imageId='sha256:' + 'f' * 64),
            lambda d: d['promotionBundle']['images']['api-web'].update(uri='evil.invalid/image@sha256:' + 'd' * 64),
            lambda d: d['readiness']['workers'].clear(),
            lambda d: d['customerAcceptance'].update(passed=False),
            lambda d: d['launchRetirement'].update(passed=False),
            lambda d: d['promotionBundle']['agentcore'].update(artifact='../../private.zip'),
            lambda d: d['agentcore'].update(artifactSha256='f' * 64),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                receipt = deepcopy(accepted()); mutate(receipt)
                with self.assertRaises(ValueError):
                    accepted_uat_bundle(receipt, datetime(2026, 9, 18, 7, tzinfo=timezone.utc))

    def test_expiry_future_and_naive_completion_times_fail_closed(self):
        now = datetime(2026, 9, 18, 7, tzinfo=timezone.utc)
        for value in ((now - timedelta(days=2)).isoformat(), (now + timedelta(seconds=1)).isoformat(),
                      '2026-09-18T06:00:00', 'invalid'):
            receipt = accepted(); receipt['completedAt'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                accepted_uat_bundle(receipt, now)


if __name__ == '__main__':
    unittest.main()

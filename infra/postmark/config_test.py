import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('postmark_config', Path(__file__).with_name('config.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def ready():
    data = json.loads(Path(__file__).with_name('config.json').read_text())
    for stage, server in [('uat', '123'), ('production', '456')]:
        row = data[stage]
        row['provider'] = 'postmark'
        row['environment']['POSTMARK_SERVER_ID'] = server
        row['secrets'] = {name: f'arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/{stage}/postmark/{name}-abcdef'
                          for name in m.SECRET_KEYS if stage == 'uat' or name != 'POSTMARK_UAT_ALLOWED_RECIPIENTS'}
    return data


class Configuration(unittest.TestCase):
    def test_actual_ecs_container_renderer_keeps_values_and_credentials_separate(self):
        deploy = Path(__file__).parents[1]/'prod-ecs-express/deploy.sh'
        function = 'api_container_json() {' + deploy.read_text().split('api_container_json() {', 1)[1].split('\nai_container_json()', 1)[0]
        script = 'normalize_url() { printf "%s" "$1"; }\nsecret_arn() { case "$1" in arn:*) printf "%s" "$1";; *) printf "fixture:%s" "$1";; esac; }\naws() { exit 99; }\n' + function + '\napi_container_json fixture-image https://mangmeeplus.com https://ai.example.test'
        for stage in ['uat', 'production']:
            settings = m.deployment_config(ready(), stage)
            origin = 'https://uat.mangmeeplus.com' if stage == 'uat' else 'https://mangmeeplus.com'
            env = {'PATH': os.environ['PATH'], 'POSTMARK_DEPLOYMENT': json.dumps(settings), 'DEPLOY_ENV': stage,
                   'SERVING_EMAIL_PROVIDER': 'postmark', 'PUBLIC_DOMAIN_URL': origin}
            result = subprocess.run(['bash', '-c', script], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            container = json.loads(result.stdout)
            values = {row['name']: row['value'] for row in container['environment']}
            secrets = {row['name']: row['valueFrom'] for row in container['secrets']}
            self.assertEqual(len(values), len(container['environment']))
            self.assertEqual(values['EMAIL_PROVIDER'], 'postmark')
            self.assertEqual(values['WEB_BASE_URL'], origin)
            for key, value in settings['environment'].items(): self.assertEqual(values[key], value)
            for key, value in settings['secrets'].items():
                self.assertEqual(secrets[key], value)
                self.assertNotIn(key, values)
            env['PUBLIC_DOMAIN_URL'] = 'https://foreign.example.test'
            rejected = subprocess.run(['bash', '-c', script], env=env, text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(rejected.stdout, '')

    def test_checked_in_defaults_enable_both_environments_without_feature_flags(self):
        data = json.loads(Path(__file__).with_name('config.json').read_text())
        for stage in ['uat', 'production']:
            value = m.deployment_config(data, stage)
            self.assertEqual(value['provider'], 'postmark')
            self.assertIn('EMAIL_OTP_HMAC_KEY', value['secrets'])
            self.assertIn('EMAIL_OTP_HMAC_KEY_VERSION', value['environment'])
            with self.assertRaises(ValueError): m.deployment_config(data, stage, 'disabled')

    def test_cross_environment_and_missing_config_fail_closed(self):
        changes = [
            lambda d: d['uat']['environment'].update(POSTMARK_SERVER_ID='456'),
            lambda d: d['uat']['environment'].update(POSTMARK_FROM_ADDRESS='contact@mangmeeplus.com'),
            lambda d: d['uat']['environment'].update(POSTMARK_SERVER_TOKEN='PRIVATE'),
            lambda d: d['uat']['secrets'].update(POSTMARK_SERVER_TOKEN=d['production']['secrets']['POSTMARK_SERVER_TOKEN']),
            lambda d: d['uat']['secrets'].pop('POSTMARK_UAT_ALLOWED_RECIPIENTS'),
            lambda d: d['uat']['secrets'].pop('POSTMARK_WEBHOOK_PASSWORD'),
            lambda d: d['uat']['secrets'].pop('EMAIL_OTP_HMAC_KEY'),
            lambda d: d['uat']['environment'].pop('EMAIL_OTP_HMAC_KEY_VERSION'),
            lambda d: d['uat']['secrets'].update(POSTMARK_SERVER_TOKEN='PRIVATE'),
            lambda d: d['uat']['secrets'].update(POSTMARK_SERVER_TOKEN=d['uat']['secrets']['POSTMARK_WEBHOOK_PASSWORD']),
            lambda d: d['uat']['environment'].update(POSTMARK_SERVER_ID='0'),
        ]
        for change in changes:
            data = ready(); change(data)
            with self.subTest(change=changes.index(change)), self.assertRaises(ValueError):
                m.deployment_config(data, 'uat')

    def test_native_preflight_checks_identity_mode_stream_and_never_returns_tokens(self):
        configuration = m.deployment_config(ready(), 'uat')
        secrets = {'POSTMARK_SERVER_TOKEN': 'private-server-token', 'POSTMARK_UAT_ALLOWED_RECIPIENTS': 'controlled@example.test'}
        server = {'ID': 123, 'DeliveryType': 'Live', 'ApiTokens': ['do-not-publish']}
        stream = {'ServerID': 123, 'ID': configuration['environment']['POSTMARK_MESSAGE_STREAM'], 'MessageStreamType': 'Transactional', 'ArchivedAt': None}
        fetch = lambda path: server if path == '/server' else stream
        result = m.native_preflight(configuration, secrets, fetch)
        self.assertEqual(result['serverId'], 123)
        self.assertNotIn('do-not-publish', json.dumps(result))
        for target, field, bad in [(server, 'ID', 456), (server, 'DeliveryType', 'Sandbox'), (stream, 'ServerID', 456),
                                   (stream, 'MessageStreamType', 'Broadcasts'), (stream, 'ArchivedAt', '2026-09-15')]:
            old = target[field]; target[field] = bad
            with self.subTest(field=field), self.assertRaises(ValueError): m.native_preflight(configuration, secrets, fetch)
            target[field] = old
        with self.assertRaises(ValueError): m.native_preflight(configuration, {**secrets, 'POSTMARK_UAT_ALLOWED_RECIPIENTS': '*'}, fetch)

    def test_secret_resolution_uses_exact_identity_and_current_version(self):
        config = m.deployment_config(ready(), 'uat')
        def secret(ref):
            return {'ARN': ref, 'SecretString': 'ab'*32 if 'EMAIL_OTP_HMAC_KEY' in ref else 'PRIVATE', 'VersionId': 'version-one', 'VersionStages': ['AWSCURRENT']}
        values, versions = m.resolve_secrets(config, secret)
        self.assertEqual(set(values), m.SECRET_KEYS)
        self.assertTrue(all(value['versionId'] == 'version-one' for value in versions.values()))
        for change in [{'ARN': 'foreign'}, {'VersionStages': ['AWSPREVIOUS']}, {'SecretString': ''}, {'VersionId': None}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.resolve_secrets(config, lambda ref: {**secret(ref), **change})


if __name__ == '__main__':
    unittest.main()

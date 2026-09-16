#!/usr/bin/env python3
"""Canonical Postmark config for ECS/Kamal. Output contains values and secret references, never credentials."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import urllib.request

ENV_KEYS = {'POSTMARK_SERVER_ID', 'POSTMARK_MESSAGE_STREAM', 'POSTMARK_FROM_ADDRESS', 'POSTMARK_FROM_NAME', 'EMAIL_OTP_HMAC_KEY_VERSION'}
SECRET_KEYS = {'POSTMARK_SERVER_TOKEN', 'POSTMARK_WEBHOOK_USERNAME', 'POSTMARK_WEBHOOK_PASSWORD', 'POSTMARK_UAT_ALLOWED_RECIPIENTS', 'EMAIL_OTP_HMAC_KEY'}
REQUIRED_SECRETS = SECRET_KEYS - {'POSTMARK_UAT_ALLOWED_RECIPIENTS'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def deployment_config(document, environment, provider=None):
    require(document.get('schemaVersion') == 1 and environment in ('uat', 'production'), 'Invalid mail config identity')
    for stage in ('uat', 'production'):
        row = document[stage]
        values, secrets = row['environment'], row['secrets']
        require(set(values) <= ENV_KEYS and set(secrets) <= SECRET_KEYS, 'Unexpected mail config key; credentials must use secret references')
        require(row['provider'] == 'postmark', 'Account email OTP requires Postmark in UAT and Production')
        require(stage != 'production' or row['provider'] != 'ses', 'Production SES is not activated')
        sender = 'developer@mangmeeplus.com' if stage == 'uat' else 'contact@mangmeeplus.com'
        require(values.get('POSTMARK_FROM_ADDRESS') == sender, 'Mail sender does not match environment')
        require(isinstance(values.get('POSTMARK_FROM_NAME'), str) and re.fullmatch(r'[^<>\r\n]{1,80}', values['POSTMARK_FROM_NAME']), 'Invalid mail sender name')
        require(isinstance(values.get('POSTMARK_MESSAGE_STREAM'), str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', values['POSTMARK_MESSAGE_STREAM']), 'Invalid mail stream')
        if 'POSTMARK_SERVER_ID' in values:
            require(isinstance(values['POSTMARK_SERVER_ID'], str) and re.fullmatch(r'[1-9][0-9]{0,14}', values['POSTMARK_SERVER_ID']), 'Invalid mail server ID')
        require(re.fullmatch(r'[a-zA-Z0-9_-]{1,32}', values.get('EMAIL_OTP_HMAC_KEY_VERSION', '')), 'OTP key version is required')
        for ref in secrets.values():
            require(isinstance(ref, str) and re.fullmatch(r'(?:arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:)?watchdog-bms/' + stage + r'/postmark/[A-Za-z0-9/_-]+', ref), 'Foreign or invalid Postmark secret reference')
        require(len(set(secrets.values())) == len(secrets), 'Mail credentials must have distinct secret references')
        selected = provider if stage == environment and provider else row['provider']
        require(selected == 'postmark', 'Postmark cannot be disabled for a normal feature release')
        require(stage != 'production' or selected != 'ses', 'Production SES is not activated')
        if selected == 'postmark' or 'POSTMARK_SERVER_ID' in values or secrets:
            require('POSTMARK_SERVER_ID' in values and REQUIRED_SECRETS <= set(secrets), 'Postmark server and webhook secret references are required')
            require(stage != 'uat' or 'POSTMARK_UAT_ALLOWED_RECIPIENTS' in secrets, 'UAT recipient allowlist secret is required')
    uat_id = document['uat']['environment'].get('POSTMARK_SERVER_ID')
    prod_id = document['production']['environment'].get('POSTMARK_SERVER_ID')
    require(not uat_id or not prod_id or uat_id != prod_id, 'UAT and Production must use distinct Postmark server IDs')
    row = document[environment]
    return {'provider': provider or row['provider'], 'environment': dict(row['environment']), 'secrets': dict(row['secrets'])}


def resolve_secrets(configuration, read_secret):
    """Kamal only: resolve the same references ECS receives, retaining exact versions for its inventory."""
    values, versions = {}, {}
    for name, ref in configuration['secrets'].items():
        data = read_secret(ref)
        arn = data.get('ARN', '')
        identity = arn == ref if ref.startswith('arn:') else data.get('Name') == ref and arn.startswith('arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:' + ref + '-')
        require(identity and 'AWSCURRENT' in data.get('VersionStages', []) and
                isinstance(data.get('SecretString'), str) and bool(data['SecretString']) and
                isinstance(data.get('VersionId'), str) and bool(data['VersionId']), 'Invalid current Postmark secret version')
        values[name] = data['SecretString']
        if name == 'EMAIL_OTP_HMAC_KEY': require(re.fullmatch(r'[a-f0-9]{64}', data['SecretString']), 'OTP HMAC key must be 32 random bytes encoded as hex')
        versions[arn] = {'versionId': data['VersionId'], 'value': data['SecretString']}
    return values, versions


def native_preflight(configuration, secret_values, request=None):
    """Read-only provider checks; never return /server (it contains API tokens)."""
    def get(path):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        req = urllib.request.Request('https://api.postmarkapp.com' + path, headers={
            'X-Postmark-Server-Token': secret_values['POSTMARK_SERVER_TOKEN'], 'Accept': 'application/json'})
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=10) as response:
                require(response.status == 200, 'Postmark native preflight unavailable')
                return json.loads(response.read(1_048_576))
        except Exception:
            raise ValueError('Postmark native preflight unavailable') from None
    fetch = request or get
    values = configuration['environment']
    server_id, stream = int(values['POSTMARK_SERVER_ID']), values['POSTMARK_MESSAGE_STREAM']
    require(secret_values.get('POSTMARK_SERVER_TOKEN') != 'POSTMARK_API_TEST', 'Native Live server credentials required')
    allowlist = secret_values.get('POSTMARK_UAT_ALLOWED_RECIPIENTS')
    if allowlist is not None:
        recipients = [part.strip() for part in allowlist.split(',')]
        require(bool(recipients) and all(re.fullmatch(r'[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+', item) for item in recipients), 'Invalid UAT recipient allowlist')
    server = fetch('/server')
    require(isinstance(server, dict) and server.get('ID') == server_id and server.get('DeliveryType') == 'Live', 'Postmark server identity or Live mode mismatch')
    message_stream = fetch('/message-streams/' + stream)
    require(isinstance(message_stream, dict) and message_stream.get('ServerID') == server_id and message_stream.get('ID') == stream and
            message_stream.get('MessageStreamType') == 'Transactional' and 'ArchivedAt' in message_stream and message_stream['ArchivedAt'] is None,
            'Postmark stream is not active Transactional on the expected server')
    return {'serverId': server_id, 'stream': stream, 'mode': 'Live', 'sender': values['POSTMARK_FROM_ADDRESS'],
            'otpKeyVersion': values['EMAIL_OTP_HMAC_KEY_VERSION'], 'outbound': 'native-identity-checked'}


def aws_secret(ref):
    result = subprocess.run(['aws', '--region', 'ap-southeast-1', 'secretsmanager', 'get-secret-value',
                             '--secret-id', ref, '--version-stage', 'AWSCURRENT', '--output', 'json'],
                            text=True, capture_output=True, timeout=30)
    require(result.returncode == 0, 'Required current mail/OTP secret unavailable')
    return json.loads(result.stdout)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=['uat', 'production'])
    parser.add_argument('--provider', default=None)
    parser.add_argument('--preflight', action='store_true', help='Read-only secret and native provider check; prints only identity evidence')
    args = parser.parse_args()
    try:
        configuration = deployment_config(json.loads(Path(__file__).with_name('config.json').read_text()), args.environment, args.provider)
        if args.preflight:
            values, versions = resolve_secrets(configuration, aws_secret)
            evidence = native_preflight(configuration, values)
            print(json.dumps(dict(evidence, environment=args.environment, secretVersions={arn: item['versionId'] for arn, item in versions.items()})))
        else:
            print(json.dumps(configuration))
    except (KeyError, TypeError, ValueError, subprocess.TimeoutExpired):
        raise SystemExit('Invalid Postmark deployment configuration; verify environment values and secret references')

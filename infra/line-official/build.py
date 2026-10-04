#!/usr/bin/env python3
"""Build the isolated Official OA stack; no cloud calls or credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
NAME = 'watchdog-bms-line-official-oa-prod'
ACCOUNT, REGION = '311414082667', 'ap-southeast-1'
FILES = ['infra/line-official/handler.cjs', 'infra/line-official/build.py',
         'apps/api/src/modules/auth/domain/logic/line-official-menu.logic.ts',
         'apps/api/src/modules/auth/infrastructure/line-webhook-verifier.ts']
FILES += ['apps/api/src/modules/auth/domain/logic/line-official-' + name + '-card.json' for name in ('contact', 'social')]
FILES += ['apps/web/public/assets/line/official-oa-' + name + '.png' for name in ('instagram', 'facebook', 'tiktok')]


def ref(name): return {'Ref': name}
def att(name, key): return {'Fn::GetAtt': [name, key]}
def resource(kind, properties, **kwargs): return dict(Type='AWS::'+kind, Properties=properties, **kwargs)
def write(path, value):
    data = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f: f.write(data+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    esbuild = sorted((ROOT/'node_modules/.pnpm').glob('esbuild@*/node_modules/esbuild/bin/esbuild'))
    assert len(esbuild) == 1, 'Use the repository-installed esbuild; do not install another dependency'
    subprocess.run(['node', str(esbuild[0]), 'infra/line-official/handler.cjs', '--bundle', '--minify',
        '--platform=node', '--target=node24', '--format=cjs', '--loader:.png=base64',
        '--external:@aws-sdk/client-secrets-manager', '--outfile='+str(out/'index.cjs')], cwd=ROOT, check=True)
    os.chmod(out/'index.cjs', 0o600)
    code = (out/'index.cjs').read_text()
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all', '--', *FILES], cwd=ROOT, text=True).strip()
    version = 'Version'+hashlib.sha256((code_hash+commit).encode()).hexdigest()[:12]
    tags = [{'Key':'Environment','Value':'production'}, {'Key':'Component','Value':'line-official'},
            {'Key':'ManagedBy','Value':'mangmeeplus-infra'}]
    resources = {}
    for suffix, parameter in [('Secret','ChannelSecret'), ('Token','ChannelAccessToken')]:
        resources['Official'+suffix] = resource('SecretsManager::Secret', {
            'Name':'watchdog-bms/production/line-official/channel-'+('secret' if suffix=='Secret' else 'access-token'),
            'Description':'Dedicated MangmeePlus Official @107ewccg credential', 'SecretString':ref(parameter),
            'Tags':tags}, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    resources['Logs'] = resource('Logs::LogGroup', {'LogGroupName':'/aws/lambda/'+NAME, 'RetentionInDays':14, 'Tags':tags},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    resources['Role'] = resource('IAM::Role', {
        'RoleName':NAME, 'Tags':tags,
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{
            'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},
        'Policies':[{'PolicyName':'official-only','PolicyDocument':{'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Action':['secretsmanager:GetSecretValue'],'Resource':[ref('OfficialSecret'),ref('OfficialToken')]},
            {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':att('Logs','Arn')}]}}]})
    resources['Function'] = resource('Lambda::Function', {
        'FunctionName':NAME, 'Description':'Official OA only; source '+commit, 'Runtime':'nodejs24.x',
        'Handler':'index.handler', 'Role':att('Role','Arn'), 'Architectures':['arm64'],
        'Timeout':10, 'MemorySize':256, 'ReservedConcurrentExecutions':10,
        'RuntimeManagementConfig':{'UpdateRuntimeOn':'FunctionUpdate'},
        'Environment':{'Variables':{'OFFICIAL_SECRET_ARN':ref('OfficialSecret'),'OFFICIAL_TOKEN_ARN':ref('OfficialToken'),
                                    'OFFICIAL_RELEASE_SHA':commit}},
        'Code':{'ZipFile':code}, 'Tags':tags}, DependsOn='Logs')
    resources[version] = resource('Lambda::Version', {
        'FunctionName':ref('Function'), 'Description':'source '+commit+'; bundle '+code_hash},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    outputs = {}
    for name, alias in [('Staging','staging'), ('Live','live')]:
        condition = {'Condition':'PublishLive'} if name=='Live' else {}
        resources[name+'Alias'] = resource('Lambda::Alias', {
            'Name':alias,'FunctionName':ref('Function'),'FunctionVersion':att(version,'Version')}, **condition)
        resources[name+'Url'] = resource('Lambda::Url', {
            'AuthType':'NONE','TargetFunctionArn':ref('Function'),'Qualifier':alias,'InvokeMode':'BUFFERED'},
            DependsOn=name+'Alias', **condition)
        resources[name+'UrlPermission'] = resource('Lambda::Permission', {
            'Action':'lambda:InvokeFunctionUrl','FunctionName':ref(name+'Alias'),'Principal':'*','FunctionUrlAuthType':'NONE'}, **condition)
        resources[name+'InvokePermission'] = resource('Lambda::Permission', {
            'Action':'lambda:InvokeFunction','FunctionName':ref(name+'Alias'),'Principal':'*','InvokedViaFunctionUrl':True}, **condition)
        outputs[name+'Url'] = dict(Value=att(name+'Url','FunctionUrl'), **condition)
    template = {'AWSTemplateFormatVersion':'2010-09-09',
        'Description':'Isolated MangmeePlus Official cards; no ERP/DB/worker/gate resources',
        'Parameters':{
            'ChannelSecret':{'Type':'String','NoEcho':True,'AllowedPattern':'[a-fA-F0-9]{32}'},
            'ChannelAccessToken':{'Type':'String','NoEcho':True,'MinLength':60},
            'PromoteLive':{'Type':'String','Default':'false','AllowedValues':['false','true']}},
        'Conditions':{'PublishLive':{'Fn::Equals':[ref('PromoteLive'),'true']}},
        'Resources':resources, 'Outputs':outputs}
    write(out/'template.json', template)
    assert (out/'template.json').stat().st_size <= 51200, 'Inline CloudFormation template exceeds provider limit'
    manifest = {'schemaVersion':1,'functionName':NAME,'account':ACCOUNT,'region':REGION,
        'sourceCommit':commit,'sourceDirty':bool(dirty),'bundleSha256':code_hash,
        'templateSha256':hashlib.sha256((out/'template.json').read_bytes()).hexdigest(),
        'inputsSha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in FILES},
        'versionLogicalId':version,'erpDeployment':'NOT_DISPATCHED','credentialsIncluded':False}
    write(out/'manifest.json', manifest)
    print(json.dumps({'output':str(out),'sourceCommit':commit,'sourceDirty':bool(dirty),
        'bundleSha256':code_hash,'templateBytes':(out/'template.json').stat().st_size}))


if __name__ == '__main__': main()

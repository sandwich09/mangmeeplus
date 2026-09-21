#!/usr/bin/env python3
"""Patch the enrolled UAT stack for SSM-only SSH transport; never calls AWS."""
import argparse
import copy
import json
import os
from pathlib import Path

SSM_CORE = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'


def patch_template(original):
    template = copy.deepcopy(original)
    resources = template['Resources']
    for name in ('ApiRole', 'AiRole'):
        role = resources[name]
        assert role['Type'] == 'AWS::IAM::Role'
        assert {'Key':'Environment','Value':'uat'} in role['Properties']['Tags'], 'UAT only'
        policies = role['Properties'].setdefault('ManagedPolicyArns', [])
        if SSM_CORE not in policies: policies.append(SSM_CORE)
    for name in ('ApiSg', 'AiSg'):
        group = resources[name]
        assert group['Type'] == 'AWS::EC2::SecurityGroup'
        ingress = group['Properties'].get('SecurityGroupIngress', [])
        assert all(r.get('FromPort') == r.get('ToPort') == 22 for r in ingress), 'Expected only operator SSH ingress'
        group['Properties']['SecurityGroupIngress'] = []
    deploy = resources['DeployRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
    managed = {'UatSsmInventory','UatSsmSshTransport','UatSsmOwnSession','UatSsmDataChannel'}
    deploy[:] = [statement for statement in deploy if statement.get('Sid') not in managed]
    instances = [{'Fn::Sub':'arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:instance/${'+name+'}'}
                 for name in ('ApiServer','AiServer')]
    deploy.extend([
        {'Sid':'UatSsmInventory','Effect':'Allow','Action':['ssm:DescribeInstanceInformation'],'Resource':'*'},
        {'Sid':'UatSsmSshTransport','Effect':'Allow','Action':['ssm:StartSession'],
         'Resource':instances+['arn:aws:ssm:ap-southeast-1::document/AWS-StartPortForwardingSession']},
        {'Sid':'UatSsmOwnSession','Effect':'Allow','Action':['ssm:ResumeSession','ssm:TerminateSession'],
         'Resource':'*','Condition':{
             'StringLike':{'ssm:resourceTag/aws:ssmmessages:session-id':{'Fn::Sub':'${!aws:userid}*'}},
             'StringEquals':{'ssm:resourceTag/aws:ssmmessages:target-id':[
                 {'Ref':'ApiServer'},{'Ref':'AiServer'}]}}},
        {'Sid':'UatSsmDataChannel','Effect':'Allow','Action':['ssmmessages:OpenDataChannel'],
         'Resource':{'Fn::Sub':'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:session/${!aws:userid}-*'}}])
    return template


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    body = json.loads(args.input.read_text())
    if 'Resources' not in body and isinstance(body.get('TemplateBody'), dict): body = body['TemplateBody']
    patched = patch_template(body)
    raw = (json.dumps(patched, separators=(',', ':')) + '\n').encode()
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
        handle.write(raw)
    print(json.dumps({'scope':'UAT Api/Ai SSM instance policy, deploy session policy, and removal of TCP/22 ingress',
                      'resources':len(patched['Resources']),'output':str(args.output)}))


if __name__ == '__main__': main()

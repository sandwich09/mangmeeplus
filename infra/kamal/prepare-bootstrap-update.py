#!/usr/bin/env python3
"""Patch only UAT EC2 UserData in a private existing template; never calls AWS."""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent


def patch_template(original):
    template = copy.deepcopy(original)
    script = (HERE / 'bootstrap-host.sh').read_text()
    changes = {}
    for name in ('ApiServer', 'AiServer'):
        resource = template['Resources'][name]
        props = resource['Properties']
        assert resource['Type'] == 'AWS::EC2::Instance'
        assert {'Key': 'Environment', 'Value': 'uat'} in props['Tags'], 'UAT only'
        assert any('Ebs' in b for b in props['BlockDeviceMappings']), 'EBS hosts only'
        before = base64.b64decode(props['UserData'], validate=True).decode()
        keys = re.findall(r'^\s*- (ssh-ed25519 [A-Za-z0-9+/=]+)\s*$', before, re.M)
        assert len(keys) == 1, 'Expected the existing single public SSH key'
        cloud = ('#cloud-config\nusers:\n  - default\nssh_authorized_keys:\n  - '+keys[0]+
                 '\nwrite_files:\n  - path: /usr/local/sbin/mangmee-kamal-bootstrap\n'
                 '    owner: root:root\n    permissions: "0755"\n    content: |\n'+
                 ''.join('      '+line+'\n' for line in script.splitlines())+
                 'runcmd:\n  - [bash, /usr/local/sbin/mangmee-kamal-bootstrap]\n')
        assert len(cloud.encode()) <= 16384
        props['UserData'] = base64.b64encode(cloud.encode()).decode()
        changes[name] = {'beforeSha256': hashlib.sha256(before.encode()).hexdigest(),
                         'afterSha256': hashlib.sha256(cloud.encode()).hexdigest()}
    return template, changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    template, changes = patch_template(json.loads(args.input.read_text()))
    raw = json.dumps(template, separators=(',', ':')).encode()
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
        f.write(raw)
    print(json.dumps({'scope': 'Only ApiServer/AiServer.UserData; no AWS calls',
                      'templateSha256': hashlib.sha256(raw).hexdigest(), 'changes': changes}))


if __name__ == '__main__':
    main()

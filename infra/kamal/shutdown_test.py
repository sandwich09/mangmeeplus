#!/usr/bin/env python3
"""Exercise the actual supervisor with controlled children, no Docker/cloud effects."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

script=Path(__file__).resolve().parents[1]/'api-web/start-api-web-runtime.sh'
for abnormal in (False,True):
 with tempfile.TemporaryDirectory(prefix='kamal-drain-test-') as tmp:
  d=Path(tmp);node=d/'node'
  node.write_text('#!'+sys.executable+'\n'+'''import os,signal,sys,time
api=any('main.js' in s for s in sys.argv)
def stop(*_):
 if api:
  time.sleep(0.4)
  print('API_DRAIN_FINISHED',flush=True)
 sys.exit(0)
signal.signal(signal.SIGTERM,stop)
print('API_READY' if api else 'CHILD_READY',flush=True)
if os.environ.get('FAKE_EXIT_PROXY')=='true' and any('web-api-proxy' in s for s in sys.argv):
 time.sleep(0.1)
 sys.exit(9)
while True:time.sleep(0.05)
''');node.chmod(0o700)
  with (d/'log').open('w') as log:
   p=subprocess.Popen(['sh',str(script)],env=dict(os.environ,PATH=tmp+':'+os.environ['PATH'],CLAMAV_HOST='',FAKE_EXIT_PROXY=str(abnormal).lower()),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:
    deadline=time.monotonic()+5
    while 'API_READY' not in (d/'log').read_text():
     assert time.monotonic()<deadline,'fake API did not start'
     time.sleep(0.05)
    if not abnormal:p.send_signal(signal.SIGTERM)
    code=p.wait(timeout=8)
    assert code==(1 if abnormal else 0),(code,abnormal)
    assert 'API_DRAIN_FINISHED' in (d/'log').read_text(),'supervisor exited before API cleanup'
   finally:
    if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
 print('PASS: '+('child failure cleans up with exit 1' if abnormal else 'SIGTERM waits for API cleanup with exit 0'))

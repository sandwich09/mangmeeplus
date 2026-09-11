import datetime,json,os,pathlib,subprocess,sys,time
root=pathlib.Path.cwd();audit=root/'.env.kamal/uat/cold-cache-20260912';phase='cold'
preparation_clock=time.monotonic();preparation_started=datetime.datetime.now(datetime.timezone.utc).isoformat()
path=audit/(phase+'-invocation.json');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
record={'phase':phase,'preparationStartedAt':preparation_started};os.write(fd,json.dumps(record).encode());os.close(fd)
def save():
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(record,indent=2)+'\n');temp.chmod(0o600);temp.replace(path)
def gh(*args):return json.loads(subprocess.check_output(['gh',*args],text=True))
assert not (root/'.env.kamal/uat/active.json').exists()
for status in ('queued','in_progress'):
 active=gh('run','list','--status',status,'--limit','100','--json','databaseId,workflowName')
 blocking=[]
 for x in active:
  if x['databaseId']==31611733340:
   ghost=gh('api','repos/MangmeeDev/mangmeeplus/actions/runs/31611733340')
   jobs=gh('api','repos/MangmeeDev/mangmeeplus/actions/runs/31611733340/jobs')
   checks=gh('api','repos/MangmeeDev/mangmeeplus/check-suites/85752682208/check-runs')
   pending=gh('api','repos/MangmeeDev/mangmeeplus/actions/runs/31611733340/pending_deployments')
   assert ghost['created_at']==ghost['updated_at']=='2026-08-12T15:20:13Z' and ghost['head_sha']=='33ed788ccc644502e572fe2d679aac9b2b98cc6e' and ghost['check_suite_id']==85752682208
   assert jobs['total_count']==checks['total_count']==0 and not pending
   record['excludedProvenProviderGhost']={'id':31611733340,'checkSuiteId':85752682208,'createdAt':ghost['created_at'],'headSha':ghost['head_sha'],'jobCount':0,'checkRunCount':0,'pendingDeployments':[],'basis':'docs/agent-memory/release-receipt-signup-2026-09-07.md; same exact stale identity reverified; not an executable job'};save()
  elif x['workflowName'] in ('UAT Deploy','Production Readiness V2','Production Deploy V2'):blocking.append(x)
 assert not blocking,blocking

import hashlib,uuid
expected='6b95e50555c9905aa32d17d1372241bb4889cc1b'
latest=subprocess.check_output(['git','ls-remote','origin','refs/heads/main'],text=True).split()[0];assert latest==expected
record['sourceCommitExpected']=expected
record['cacheScope']='Fresh isolated BuildKit/dependency store; same-run stages reused; existing UAT running/rollback images and registry/CDN retained'
record['adapterSha256']=hashlib.sha256((audit/'docker-adapter.py').read_bytes()).hexdigest();save()
builder='kamal-cold-20260912-'+uuid.uuid4().hex[:8];record['builder']=builder;save()
env=dict(os.environ,PATH=str((audit/'bin').resolve())+':'+os.environ['PATH'],
 KAMAL_COLD_BUILDER=builder,KAMAL_COLD_LEDGER=str((audit/'build-ledger.json').resolve()),
 npm_config_store_dir=str((audit/'pnpm-store').resolve()),npm_config_cache=str((audit/'npm-cache').resolve()),XDG_CACHE_HOME=str((audit/'xdg-cache').resolve()))
for name in ('pnpm-store','npm-cache','xdg-cache'):(audit/name).mkdir()
created=False;exit_code=1
try:
 setup=time.monotonic()
 with (audit/'builder-setup.log').open('x') as log:
  subprocess.run(['/usr/local/bin/docker','buildx','create','--name',builder,'--driver','docker-container','--driver-opt','default-load=true','--driver-opt','image=moby/buildkit@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec','desktop-linux'],stdout=log,stderr=subprocess.STDOUT,check=True);created=True
  subprocess.run(['/usr/local/bin/docker','buildx','inspect',builder,'--bootstrap'],stdout=log,stderr=subprocess.STDOUT,check=True)
 record['builderSetupSeconds']=round(time.monotonic()-setup,6)
 inspection=(audit/'builder-setup.log').read_text();assert 'v0.31.2' in inspection
 empty=subprocess.check_output(['/usr/local/bin/docker','buildx','du','--builder',builder,'--format','{{json .}}'],text=True);(audit/'builder-cache-before.jsonl').write_text(empty);assert not empty.strip(), 'Cold builder cache is not empty'
 store=subprocess.check_output(['pnpm','store','path'],env=env,text=True).strip();assert pathlib.Path(store).is_relative_to(pathlib.Path(env['npm_config_store_dir']));assert not any(p.is_file() for p in (audit/'pnpm-store').rglob('*'))
 record['cacheBefore']={'buildkitRecords':0,'pnpmStoreFiles':0,'pnpmStorePath':store};save();print('COLD_CACHE_VERIFIED_ZERO '+builder,flush=True)
 cmd=['infra/kamal/deploy-uat','--profile','mangmee-kamal-uat','--mode','hotfix','--apply','--uat-smoke-acceptance']
 runs=root/'.env.kamal/uat/runs';before=set(runs.iterdir());clock=time.monotonic();record['startedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();record['preparationSeconds']=round(time.monotonic()-preparation_clock,6);record['command']=cmd;save()
 with (audit/'cold-console.log').open('x') as log:
  os.chmod(log.name,0o600);p=subprocess.Popen(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  for line in p.stdout:
   log.write(line);log.flush();print(line,end='',flush=True)
   if 'operationId' not in record:
    new=set(runs.iterdir())-before
    if len(new)==1:record['operationId']=next(iter(new)).name;save();print('COLD_OPERATION '+record['operationId'],flush=True)
  p.wait();exit_code=p.returncode
 record.update(exitCode=exit_code,endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),elapsedSeconds=round(time.monotonic()-clock,6),throughDeploymentSeconds=round(time.monotonic()-preparation_clock,6));save()
 if 'operationId' in record:
  result=json.loads((runs/record['operationId']/'result.json').read_text());record['deploymentStatus']=result['status'];assert result.get('sourceCommit',expected)==expected
finally:
 cleanup=time.monotonic()
 if created:
  with (audit/'builder-cache-after.jsonl').open('w') as log:subprocess.run(['/usr/local/bin/docker','buildx','du','--builder',builder,'--format','{{json .}}'],stdout=log,stderr=subprocess.STDOUT)
  with (audit/'builder-cleanup.log').open('w') as log:
   cleaned=subprocess.run(['/usr/local/bin/docker','buildx','rm',builder],stdout=log,stderr=subprocess.STDOUT);record['builderRemoved']=cleaned.returncode==0
 record['cleanupSeconds']=round(time.monotonic()-cleanup,6);record['completeHarnessSeconds']=round(time.monotonic()-preparation_clock,6);record['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
print(json.dumps(record),flush=True);sys.exit(exit_code)

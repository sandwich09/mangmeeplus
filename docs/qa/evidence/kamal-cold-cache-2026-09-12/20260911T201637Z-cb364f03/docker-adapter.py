#!/opt/homebrew/bin/python3
"""Benchmark-only transport: unchanged main, a fresh BuildKit store, and same-run local bases."""
import datetime,fcntl,json,os,pathlib,subprocess,sys,time
REAL='/usr/local/bin/docker'
SOURCE_FILES={'infra/api-web/Dockerfile.api-web','apps/ai-gateway/Dockerfile','apps/workers/Dockerfile'}
def adapt(args,env,produced):
 if not args or args[0]!='build':return args,None,None
 assert not any(x in args for x in ('--cache-from','--cache-to','--builder','--no-cache')), 'Unexpected caller cache policy'
 f=args[args.index('-f')+1];tag=args[args.index('-t')+1]
 if f in SOURCE_FILES:
  return ['build','--builder',env['KAMAL_COLD_BUILDER'],'--load',*args[1:]],tag,'fresh-isolated-builder'
 assert f=='-' or pathlib.Path(f).name=='Dockerfile.tools','Unknown Dockerfile'
 bases=[args[i+1].split('=',1)[1] for i,x in enumerate(args) if x=='--build-arg' and args[i+1].startswith(('BASE=','DEV_BUILD_IMAGE='))]
 assert len(bases)==1 and bases[0] in produced,'Local base was not produced in this cold run'
 return ['build','--builder','desktop-linux','--no-cache',*args[1:]],tag,'no-cache-using-same-run-base'
def main():
 args=sys.argv[1:]
 if not args or args[0]!='build':os.execv(REAL,[REAL,*args])
 ledger=pathlib.Path(os.environ['KAMAL_COLD_LEDGER']);ledger.parent.mkdir(parents=True,exist_ok=True)
 with ledger.with_suffix('.lock').open('a+') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  data=json.loads(ledger.read_text()) if ledger.exists() else {'builds':[],'produced':{}}
  command,tag,policy=adapt(args,os.environ,data['produced'])
  for i,x in enumerate(args):
   if x=='--build-arg' and args[i+1].startswith(('BASE=','DEV_BUILD_IMAGE=')):
    base=args[i+1].split('=',1)[1];actual=subprocess.check_output([REAL,'image','inspect','--format','{{.Id}}',base],text=True).strip();assert actual==data['produced'][base]
  row={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':command,'policy':policy,'tag':tag};clock=time.monotonic();data['builds'].append(row);ledger.write_text(json.dumps(data,indent=2)+'\n')
  result=subprocess.run([REAL,*command]);row.update(exitCode=result.returncode,elapsedSeconds=round(time.monotonic()-clock,6))
  if result.returncode==0:data['produced'][tag]=subprocess.check_output([REAL,'image','inspect','--format','{{.Id}}',tag],text=True).strip()
  ledger.write_text(json.dumps(data,indent=2)+'\n');return result.returncode
if __name__=='__main__':sys.exit(main())

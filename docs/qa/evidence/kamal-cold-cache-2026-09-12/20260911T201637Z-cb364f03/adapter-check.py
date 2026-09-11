import importlib.util,os,pathlib,subprocess,tempfile
p=pathlib.Path(__file__).with_name('docker-adapter.py');spec=importlib.util.spec_from_file_location('adapter',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
e={'KAMAL_COLD_BUILDER':'empty-builder'}
for f in m.SOURCE_FILES:
 a=['build','--platform','linux/amd64','-f',f,'-t','result','.'];cmd,tag,policy=m.adapt(a,e,{});assert cmd[1:5]==['--builder','empty-builder','--load','--platform'] and tag=='result'
for f,arg in [('/absolute/Dockerfile.tools','DEV_BUILD_IMAGE'),('-','BASE')]:
 a=['build','--build-arg',arg+'=fresh-base','-f',f,'-t','out','.'];cmd,tag,policy=m.adapt(a,e,{'fresh-base':'id'});assert '--no-cache' in cmd
 try:m.adapt(a,e,{})
 except AssertionError:pass
 else:raise AssertionError('stale local base accepted')
for a in [['build','-f','unknown','-t','x','.'],['build','--cache-from','old','-f','infra/api-web/Dockerfile.api-web','-t','x','.']]:
 try:m.adapt(a,e,{})
 except AssertionError:pass
 else:raise AssertionError('unsafe input accepted')
assert m.adapt(['image','inspect','x'],e,{})[0]==['image','inspect','x']
# Actual driver -> local-image transfer -> default-driver no-cache extension, with no application build.
base=p.parent;env=dict(os.environ,KAMAL_COLD_BUILDER='kamal-cold-probe-20260912',KAMAL_COLD_LEDGER=str((base/'probe-ledger.json').resolve()))
import json
image=subprocess.check_output([m.REAL,'image','inspect','--format','{{.Id}}','kamal-cold-transfer-probe:20260912'],text=True).strip();pathlib.Path(env['KAMAL_COLD_LEDGER']).write_text(json.dumps({'builds':[],'produced':{'kamal-cold-transfer-probe:20260912':image}}))
with (base/'probe-extension.log').open('w') as log:
 subprocess.run([str(p.resolve()),'build','--build-arg','BASE=kamal-cold-transfer-probe:20260912','-f','-','-t','kamal-cold-transfer-probe:extended','.'],input='ARG BASE\nFROM ${BASE}\nLABEL benchmark=probe\n',text=True,stdout=log,stderr=subprocess.STDOUT,env=env,check=True)
assert json.loads(pathlib.Path(env['KAMAL_COLD_LEDGER']).read_text())['builds'][0]['exitCode']==0
print('Adapter controls and actual isolated-builder/local-base transfer passed; no application cache warmed.')

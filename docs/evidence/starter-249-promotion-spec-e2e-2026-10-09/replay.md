# หลักฐานโปรแกรมจำลอง spec Starter 249 วันที่ 9 ตุลาคม 2026

เก็บ diagnostic source เป็นเอกสารเพื่อทำซ้ำได้หลังไฟล์ชั่วคราวถูกล้าง ไม่มีการเพิ่มหรือแก้ application/test code ของ repository โปรแกรมแรกเป็น reference model, โปรแกรมที่สองใส่ข้อผิดพลาดในสำเนา model เพื่อทดสอบตัวตรวจ, โปรแกรมที่สามเรียก pure functions จาก Git snapshot M แบบ read-only

รันจาก repository root โดย extract code blocks เป็นไฟล์ใน temporary directory (Python stdlib; source probe ใช้ Node และ TypeScript ที่ติดตั้งอยู่แล้ว ไม่ติดตั้ง dependency):

```sh
python3 - <<'EXTRACT'
from pathlib import Path
import re, tempfile, subprocess
root = Path.cwd()
evidence = root / 'docs/evidence/starter-249-promotion-spec-e2e-2026-10-09'
text = (evidence / 'replay.md').read_text()
tmp = Path(tempfile.mkdtemp(prefix='starter-promo-replay-'))
for filename, language in [('model.py', 'python'), ('mutations.py', 'python'), ('source-probe.cjs', 'javascript')]:
    block = re.search(r'### ' + re.escape(filename) + r'\n\n```' + language + r'\n(.*?)\n```', text, re.S).group(1)
    (tmp / filename).write_text(block + '\n')
spec = root / 'docs/specs/starter-249-bonus-month-promotion-spec-th.md'
subprocess.run(['python3', str(tmp/'model.py'), str(spec), str(tmp/'model-results.json')], check=True)
subprocess.run(['python3', str(tmp/'mutations.py'), str(tmp/'model.py'), str(spec), str(tmp/'negative-controls.json')], check=True)
subprocess.run(['node', str(tmp/'source-probe.cjs'), str(tmp/'source-probe-results.json')], check=True)
print(tmp)
EXTRACT
```

หากแก้ spec ภายหลัง hash จะเปลี่ยน ต้อง review oracle ก่อนอ้างว่ารองรับ spec รุ่นใหม่ Model ไม่ได้ parse prose แล้ว implement กติกาอัตโนมัติ

### model.py

```python
"""Offline specification oracle; no application, DB, provider or UI calls."""
from datetime import datetime, timezone, timedelta
from calendar import monthrange
from copy import deepcopy
from itertools import permutations
from pathlib import Path
import hashlib, json, sys
D=lambda s: datetime.fromisoformat(s.replace('Z','+00:00'))
T=D('2026-10-05T03:00:00Z')
def iso(d): return d.isoformat().replace('+00:00','Z')
def months(d,n,anchor=None):
    y,m=divmod(d.year*12+d.month-1+n,12);m+=1
    return d.replace(year=y,month=m,day=min(anchor or d.day,monthrange(y,m)[1]))
def term(start,interval,anchor=None):
    n=1 if interval=='month' else 12
    return {'start':start,'paidEnd':months(start,n,anchor),'end':months(start,n+1,anchor),'base':30 if n==1 else 360,'bonus':30}
class Ref:
    def __init__(self,cap=2):
        self.cap=cap;self.version=1;self.live=(24900,249000,30,360,'THB','tax-v1');self.pin=self.live
        self.published=True;self.paused=False;self.ended=False;self.gate=True
        self.start=D('2026-10-01T00:00:00Z');self.end=D('2026-11-01T00:00:00Z')
        self.rows={};self.seq=0;self.tickets=0
    def state(self,at):
        if not self.published:return 'DRAFT'
        if self.ended or at>=self.end:return 'ENDED'
        if self.paused:return 'PAUSED'
        if self.pin!=self.live:return 'CATALOG_STALE'
        if at<self.start:return 'SCHEDULED'
        return 'ACTIVE'
    def taken(self,env='LIVE',campaign='C'):return sum(r['state'] in ('RESERVED','CONSUMED') and r['env']==env and r['campaign']==campaign for r in self.rows.values())
    def quote(self,company='A',choice='PROMOTION',at=T,env='LIVE',campaign='C',interval='month',provider='P1',mode='CARD_ONCE'):
        return dict(company=company,choice=choice,at=at,expires=at+timedelta(minutes=10),env=env,campaign=campaign,interval=interval,provider=provider,version=self.version,signature=self.live,mode=mode)
    def reserve(self,q,at=T,authorized=True,guard=True):
        if not authorized:return 'FORBIDDEN'
        if not self.gate or not guard:return 'PURCHASE_BLOCKED'
        if q['expires']<=at or q['version']!=self.version or q['signature']!=self.live:return 'QUOTE_STALE'
        if q['choice']!='PROMOTION':
            if q['choice']=='EVENT_DISCOUNT':self.tickets+=1
            return q['choice']
        if self.state(at)!='ACTIVE':return self.state(at)
        key=(q['env'],q['campaign'],q['company']);old=self.rows.get(key)
        if old and old['state']!='RELEASED':return 'USED_OR_RESERVED'
        if self.cap is not None and self.taken(q['env'],q['campaign'])>=self.cap:return 'CAP_FULL'
        self.seq+=1;r=dict(q);r.update(state='RESERVED',id='a'+str(self.seq),accepted=at,createBy=at+timedelta(minutes=10),dispatch=None,payload=None,applied=False,grants=0,consumed=0,held=0,renewal='NOT_REQUIRED' if q['mode'].endswith('ONCE') else 'PENDING',next=None,revoked=False,refund=0)
        self.rows[key]=r;return r
    def publish(self,cap,version):
        if version!=self.version:return 'STALE_VERSION'
        if self.live[2:4]!=(30,360) or self.live[0]!=24900:return 'TEMPLATE_INVALID'
        if cap is not None and cap<self.taken():return 'CAP_BELOW_TAKEN'
        self.cap=cap;self.pin=self.live;self.version+=1;self.published=True;return 'PUBLISHED'
    def dispatch(self,r,at):
        if r['state']!='RESERVED':return 'FENCED'
        if r['dispatch'] is not None:return 'RECOVER_ORIGINAL'
        if at>=r['createBy']:return 'DEADLINE'
        r['dispatch']=at;r['payload']=(r['id'],iso(at+timedelta(minutes=30)));return 'DISPATCHED'
    def release(self,r,at,proof='UNKNOWN',attempt=None):
        if attempt and attempt!=r['id']:return 'SOURCE_MISMATCH'
        if r['state']=='CONSUMED':return 'CONSUMED'
        if r['state']=='RELEASED':return 'RELEASED'
        if (r['dispatch'] is None and at>=r['createBy']) or proof=='TERMINAL_UNPAID':r['state']='RELEASED';return 'RELEASED'
        return 'RETAINED'
    def paid(self,r,paidAt=T,prior=None,hold=False,proof=True,attempt=None):
        if attempt and attempt!=r['id']:return 'SOURCE_MISMATCH'
        if not proof:return 'UNVERIFIED'
        if r['state']=='RELEASED':return 'CONTRADICTORY_REVIEW'
        if r['state']=='CONSUMED':return 'CONSUMED'
        r['state']='CONSUMED';r['term']=term(max(paidAt,prior) if prior else paidAt,r['interval'])
        if not hold:self.apply(r)
        return 'CONSUMED'
    def apply(self,r):
        if r['revoked']:return 'REVOKED'
        if r['state']!='CONSUMED':return 'UNPAID'
        if not r['applied']:r['applied']=True;r['grants']=r['term']['base']+30
        return 'APPLIED'
    def bind(self,r,evidence=False,cancel=False):
        if r['renewal']=='NOT_REQUIRED':return 'NOT_REQUIRED'
        if cancel:r['cancelIntent']=True
        if not evidence:r['renewal']='REVIEW';return 'REVIEW'
        r['renewal']='CANCELLED' if r.get('cancelIntent') else 'READY'
        r['next']=None if r.get('cancelIntent') else r['term']['end'];return r['renewal']
    def refund(self,r,amount,verified=True):
        if not verified:return 'PENDING'
        r['state']='CONSUMED'
        r['refund']+=amount;paid=24900 if r['interval']=='month' else 249000
        if r['refund']<paid:return 'PARTIAL_UNCHANGED'
        r['revoked']=True
        if r['held']:return 'ENTITLEMENT_PENDING'
        r['grants']=r['consumed'];return 'REVOKED_UNUSED'
def buy(**kw):
    e=Ref();r=e.reserve(e.quote(**kw));e.paid(r);return e,r
def allocate(lots,units,at=T,single=True):
    # Existing product groups preserved; FEFO and promo tie inside package group.
    groups={'BASE':0,'PROMOTION':0,'TRIAL':0,'GIFT':1,'ADDON':2}
    eligible=[x for x in lots if x['at']<=at<x['end'] and x['left']>0 and (x['kind']!='ADDON' or single)]
    eligible.sort(key=lambda x:(groups[x['kind']],x['end'],0 if x['kind']=='PROMOTION' else 1,x['id']))
    used=[]
    for x in eligible:
        n=min(units,x['left']);x['left']-=n;units-=n
        if n:used.append((x['id'],n))
    return used

def lot(id,kind,n,end,at=T):return dict(id=id,kind=kind,left=n,end=end,at=at)
def cycle(at,segments):
    eligible=[x for x in segments if not x.get('revoked') and x['start']<=at<x['end']]
    if len(eligible)>1:return 'REVIEW'
    if not eligible:return None
    seg=eligible[0]
    if seg['kind']=='PROMOTION':return (iso(seg['start']),iso(seg['end']),'PROMOTION',seg['source'])
    start=seg['start']
    for n in range(1,14):
        end=min(months(seg['start'],n),seg['end'])
        if at<end:return (iso(start),iso(end),'PAID',seg['source'])
        start=end
    return None

def segments(start=T,interval='month',future=False):
    t=term(start,interval);s=[dict(start=start,end=t['paidEnd'],kind='PAID',source='I1'),dict(start=t['paidEnd'],end=t['end'],kind='PROMOTION',source='I1')]
    if future:s.append(dict(start=t['end'],end=months(t['end'],1),kind='PAID',source='I2'))
    return s

def upgrade(at,promoEnd,committedEnd):return ('DEFERRED',iso(max(promoEnd,committedEnd))) if at<max(promoEnd,committedEnd) else ('NORMAL',None)
results=[]
def check(id,title,criteria,expected,run,inputs=None):
    try:
        actual=run();ok=actual==expected;error=None
    except Exception as e:actual=None;ok=False;error=type(e).__name__+': '+str(e)
    results.append(dict(id=id,title=title,criteria=criteria.split(),inputs=inputs or {},expected=expected,observed=actual,status='MODEL_PASS' if ok else 'MODEL_FAIL',error=error))
# Baseline regression set mapped to the earlier S01–S37 journeys, executed anew.
def draft():
    e=Ref();e.published=False;return [e.reserve(e.quote()),e.taken()]
check('S01','Incomplete draft has no admission','A23',['DRAFT',0],draft)
check('S02','Start inclusive end exclusive','A15 A24',['SCHEDULED','ACTIVE','ENDED'],lambda:[Ref().state(D(x)) for x in ['2026-09-30T23:59:59Z','2026-10-01T00:00:00Z','2026-11-01T00:00:00Z']])
def gate():
    e=Ref();e.gate=False;e.publish(2,1);return e.reserve(e.quote())
check('S03','Publication preserves sales gate','A24','PURCHASE_BLOCKED',gate)
def stale():
    e=Ref();q=e.quote();e.publish(2,1);return [e.reserve(q),e.publish(2,1)]
check('S04','Stale quote and stale admin version','A04 A26',['QUOTE_STALE','STALE_VERSION'],stale)
check('S05','Unauthorized admission','A19','FORBIDDEN',lambda:Ref().reserve(Ref().quote(),authorized=False))
def paused(end=False):
    e=Ref();r=e.reserve(e.quote());e.paused=not end;e.ended=end;e.paid(r);return [r['grants'],e.reserve(e.quote(company='B'))]
check('S06','Pause preserves accepted purchase','A25',[60,'PAUSED'],paused)
check('S07','End preserves accepted purchase','A25',[60,'ENDED'],lambda:paused(True))
def summary(interval):
    e,r=buy(interval=interval);return [24900 if interval=='month' else 249000,iso(r['term']['paidEnd']),iso(r['term']['end']),r['grants']]
check('S08','Monthly exact paid/free units','A01 A06 A07',[24900,'2026-11-05T03:00:00Z','2026-12-05T03:00:00Z',60],lambda:summary('month'))
check('S09','Annual exact paid/free units','A01 A06 A07',[249000,'2027-10-05T03:00:00Z','2027-11-05T03:00:00Z',390],lambda:summary('year'))
def dates(prior):
    e=Ref();r=e.reserve(e.quote());e.paid(r,prior=D(prior));return [iso(r['term']['start']),iso(r['term']['end'])]
check('S10','Active extends prior term','A02 A06',['2026-10-20T03:00:00Z','2026-12-20T03:00:00Z'],lambda:dates('2026-10-20T03:00:00Z'))
check('S11','Lapsed restarts from paidAt','A02 A06',['2026-10-05T03:00:00Z','2026-12-05T03:00:00Z'],lambda:dates('2026-10-01T03:00:00Z'))
for id,title,start,interval,expected in [('S12','Jan31','2026-01-31T03:00:00Z','month',['2026-02-28T03:00:00Z','2026-03-31T03:00:00Z']),('S13','Leap annual','2028-02-29T03:00:00Z','year',['2029-02-28T03:00:00Z','2029-03-29T03:00:00Z']),('S14','December','2026-12-31T03:00:00Z','month',['2027-01-31T03:00:00Z','2027-02-28T03:00:00Z']),('S15','Thai 00:30 UTC anniversary','2026-01-30T17:30:00Z','month',['2026-02-28T17:30:00Z','2026-03-30T17:30:00Z'])]:
    check(id,title,'A05',expected,lambda start=start,interval=interval:[iso(term(D(start),interval)[k]) for k in ['paidEnd','end']],{'startUTC':start})
for i,mode in enumerate(['CARD_ONCE','PROMPTPAY_ONCE','CARD_AUTO','PROMPTPAY_RENEW'],16):
    def run(mode=mode):
        e,r=buy(mode=mode);e.bind(r,True);return [r['grants'],r['renewal'],iso(r['next']) if r['next'] else None]
    check('S'+str(i),mode+' desired boundary','A10 A11',[60,'NOT_REQUIRED' if mode.endswith('ONCE') else 'READY',None if mode.endswith('ONCE') else '2026-12-05T03:00:00Z'],run)
def two(**kw):
    e,r=buy();v=e.reserve(e.quote(**kw));return 'RESERVED' if isinstance(v,dict) else v
check('S20','Company monthly/yearly share usage','A03','USED_OR_RESERVED',lambda:two(interval='year'))
check('S21','Distinct company','A03','RESERVED',lambda:two(company='B'))
check('S22','TEST/LIVE separated','A03','RESERVED',lambda:two(env='TEST'))
def revision():
    e,r=buy();e.publish(2,1);return e.reserve(e.quote())
check('S23','Revision does not reset usage','A03 A04','USED_OR_RESERVED',revision)
check('S24','New explicit campaign','A03','RESERVED',lambda:two(campaign='C2'))
def release_test(proof):
    e=Ref();r=e.reserve(e.quote());e.dispatch(r,T);return [e.release(r,T+timedelta(hours=2),proof),e.taken()]
check('S25','Verified unpaid releases','A10 A16',['RELEASED',0],lambda:release_test('TERMINAL_UNPAID'))
check('S26','Unknown retains slot','A10 A16',['RETAINED',1],lambda:release_test('UNKNOWN'))
def old_callback():
    e=Ref();r=e.reserve(e.quote());old=r['id'];e.release(r,T,proof='TERMINAL_UNPAID');new=e.reserve(e.quote());return [e.paid(new,attempt=old),new['grants']]
check('S27','Old generation cannot consume new','A16',['SOURCE_MISMATCH',0],old_callback)
def held():
    e=Ref();r=e.reserve(e.quote());e.paid(r,hold=True);before=[e.taken(),r['grants']];e.apply(r);return before+[r['grants']]
check('S28','Paid held already consumed','A16',[1,0,60],held)
def replay():
    e,r=buy();e.paid(r);e.apply(r);return [e.taken(),r['grants']]
check('S29','Paid/apply replay no duplicate','A16 A26',[1,60],replay)
check('S30','Browser success is not proof','A10 A19','UNVERIFIED',lambda:Ref().paid(Ref().reserve(Ref().quote()),proof=False))
def used_replay():
    e,r=buy();r['grants']-=20;e.apply(r);e.paid(r);return r['grants']
check('S31','No refill replay at bonus start','A07 A08',40,used_replay)
check('S32','Following normal period cadence','A13',['2027-01-05T03:00:00Z',30],lambda:[iso(months(term(T,'month')['end'],1)),30])
def last_slot():
    counts=[]
    for order in permutations(['A','B']):
        e=Ref(1);v=[e.reserve(e.quote(company=x)) for x in order];counts.append([sum(isinstance(x,dict) for x in v),e.taken()])
    return counts
check('S33','Both orders last slot','A15',[[1,1],[1,1]],last_slot)
def late_paid():
    e=Ref();r=e.reserve(e.quote());e.ended=True;e.paid(r,paidAt=D('2026-11-02T03:00:00Z'));return [r['grants'],iso(r['term']['end'])]
check('S34','Accepted paid after campaign end','A15 A16',[60,'2027-01-02T03:00:00Z'],late_paid)
def endquote():
    e=Ref();q=e.quote();e.ended=True;return e.reserve(q)
check('S35','Quote alone not accepted','A15','ENDED',endquote)
def heldcap():
    e=Ref(1);r=e.reserve(e.quote());e.paid(r,hold=True);return e.reserve(e.quote(company='B'))
check('S36','Paid-held occupies capacity','A22','CAP_FULL',heldcap)
def drift():
    e=Ref();r=e.reserve(e.quote());e.paid(r,paidAt=T+timedelta(days=1));return iso(r['term']['end'])
check('S37','Final dates follow paidAt','A06','2026-12-06T03:00:00Z',drift)
# Closure regressions, each has an explicit oracle independent of its model output.
def catalog():
    e=Ref();e.live=(24900,249000,50,600,'THB','tax-v1');return [e.reserve(e.quote()),e.publish(2,1),e.reserve(e.quote(choice='NORMAL'))]
check('R01','Catalog drift blocks only promo/template','A28',['CATALOG_STALE','TEMPLATE_INVALID','NORMAL'],catalog)
def accepted_catalog():
    e=Ref();r=e.reserve(e.quote());e.live=(30000,300000,50,600,'THB','tax-v2');e.paid(r);return [r['signature'][:4],r['grants']]
check('R02','Accepted snapshot survives catalog changes','A28',[(24900,249000,30,360),60],accepted_catalog)
check('R03','Provider migration cannot reset','A29','USED_OR_RESERVED',lambda:two(provider='P2'))
def postenddispatch():
    e=Ref();r=e.reserve(e.quote());e.ended=True;return [e.dispatch(r,T+timedelta(minutes=9)),r['payload']]
check('R04','Reserve end dispatch keeps promise','A30',['DISPATCHED',('a1','2026-10-05T03:39:00Z')],postenddispatch)
def undispatched():
    e=Ref();r=e.reserve(e.quote());later=T+timedelta(minutes=10);return [e.release(r,later),e.dispatch(r,later),e.taken()]
check('R05','Undispatched expires and fences worker','A30',['RELEASED','FENCED',0],undispatched)
def lost():
    e=Ref();r=e.reserve(e.quote());e.dispatch(r,T);payload=r['payload'];out=e.dispatch(r,T+timedelta(minutes=2));return [out,payload==r['payload'],e.release(r,T+timedelta(days=2)),e.taken()]
check('R06','Lost response retains original payload and slot','A30',['RECOVER_ORIGINAL',True,'RETAINED',1],lost)
end=term(T,'month')['end']
def tie():
    ls=[lot('base','BASE',30,end),lot('bonus','PROMOTION',30,end)];used=allocate(ls,20);return [used,[x['left'] for x in ls]]
check('R07','Equal expiry bonus before base','A31',[[('bonus',20)],[30,10]],tie)
def fefo():
    ls=[lot('base','BASE',30,end-timedelta(days=1)),lot('bonus','PROMOTION',30,end)];return allocate(ls,20)
check('R08','Earlier expiry overrides bonus preference','A31',[('base',20)],fefo)
def carry():
    ls=[lot('base','BASE',30,end),lot('bonus','PROMOTION',30,end)];allocate(ls,20);ls[0]['end']=months(end,1);ls.append(lot('repeat','BASE',30,months(end,1)))
    return sum(x['left'] for x in ls if x['at']<=end<x['end'])
check('R09','Repeat carries paid only bonus expires','A31',60,carry)
check('R10','No preapply or expired bonus available','A31',[[],[]],lambda:[allocate([lot('bonus','PROMOTION',30,end,T+timedelta(days=1))],1),allocate([lot('bonus','PROMOTION',30,end)],1,end)])
check('R11','Package group preserved addon file restriction','A08 A31',[[('base',1)],[]],lambda:[allocate([lot('paid','ADDON',10,T+timedelta(days=1)),lot('base','BASE',30,end)],1),allocate([lot('paid','ADDON',10,end)],1,single=False)])
for id,future in [('R12',False),('R13',True)]:
    check(id,'Free '+('gap' if future else 'tail')+' yields promotion cycle','A09 A32',('2026-11-05T03:00:00Z','2026-12-05T03:00:00Z','PROMOTION','I1'),lambda future=future:cycle(D('2026-11-10T03:00:00Z'),segments(future=future)))
check('R14','Jan31 bonus cycle retains original end','A32',('2026-02-28T03:00:00Z','2026-03-31T03:00:00Z','PROMOTION','I1'),lambda:cycle(D('2026-03-05T03:00:00Z'),segments(D('2026-01-31T03:00:00Z'))))
def funding():
    lots=set();s=segments(future=True)
    for _ in range(3):
        c=cycle(D('2026-11-10T03:00:00Z'),s);lots.add(('logical-account',c[0]))
    return [len(lots),cycle(T,s)[2]]
check('R15','Lazy cycle funding idempotency key','A09 A32',[1,'PAID'],funding)
def revoke_cycle():
    s=segments(future=True);s[1]['revoked']=True;return [cycle(D('2026-11-10T03:00:00Z'),s),cycle(D('2026-12-10T03:00:00Z'),s)[3]]
check('R16','Revoked free segment no funding future preserved','A32 A35',[None,'I2'],revoke_cycle)
def renewal():
    e,r=buy(mode='CARD_AUTO');a=e.bind(r);before=[a,r['grants'],r['next']];e.bind(r,True);e.bind(r,True);return before+[r['renewal'],iso(r['next']),r['grants']]
check('R17','Paid applied bind failure and verified retry','A33',['REVIEW',60,None,'READY','2026-12-05T03:00:00Z',60],renewal)
def cancel():
    e,r=buy(mode='CARD_AUTO');e.bind(r,cancel=True);e.bind(r,True);e.bind(r,True);return [r['renewal'],r['next'],r['grants']]
check('R18','Cancellation intent survives bind retry','A33',['CANCELLED',None,60],cancel)
def choice():
    e=Ref(0);out=[e.reserve(e.quote(choice=c)) for c in ['PROMOTION','NORMAL','EVENT_DISCOUNT','DEAL']];return out+[e.taken(),e.tickets]
check('R19','Explicit choice no campaign usage for alternatives','A17 A34',['CAP_FULL','NORMAL','EVENT_DISCOUNT','DEAL',0,1],choice)
def promo_ticket():
    e,r=buy();return [e.tickets,e.reserve(e.quote(choice='NORMAL')),e.taken()]
check('R20','Promo does not burn event ticket normal still available','A34',[0,'NORMAL',1],promo_ticket)
for id,at,expected in [('R21',T,('DEFERRED','2026-12-05T03:00:00Z')),('R22',D('2026-11-20T03:00:00Z'),('DEFERRED','2026-12-05T03:00:00Z')),('R23',end,('NORMAL',None))]:
    check(id,'Upgrade paid free or completed promo','A14 A35',expected,lambda at=at:upgrade(at,end,end))
check('R24','Future paid segment delays upgrade','A14 A35',('DEFERRED','2027-01-05T03:00:00Z'),lambda:upgrade(T,end,months(end,1)))
def partial():
    e,r=buy();r['consumed']=20;return [e.refund(r,10000),r['grants'],r['revoked'],e.taken()]
check('R25','Partial refund retains rights usage','A18 A35',['PARTIAL_UNCHANGED',60,False,1],partial)
def full(used=0):
    e,r=buy();r['consumed']=used;state=e.refund(r,24900);replay=e.apply(r);return [state,r['grants'],replay,e.taken(),e.reserve(e.quote())]
for id,used in [('R26',0),('R27',20),('R28',60)]:
    check(id,'Full refund unused partially used fully used','A18 A35',['REVOKED_UNUSED',used,'REVOKED',1,'USED_OR_RESERVED'],lambda used=used:full(used),{'used':used})
def cumulative():
    e,r=buy();a=e.refund(r,10000);b=e.refund(r,14900);return [a,b,r['grants']]
check('R29','Cumulative partials reaching full revoke','A35',['PARTIAL_UNCHANGED','REVOKED_UNUSED',0],cumulative)
def beforeapply():
    e=Ref();r=e.reserve(e.quote());e.paid(r,hold=True);e.refund(r,24900);return [e.apply(r),r['grants'],e.taken()]
check('R30','Full refund before apply no late grants','A35',['REVOKED',0,1],beforeapply)
def pendingrefund():
    e,r=buy();a=e.refund(r,24900,False);return [a,r['grants'],r['revoked']]
check('R31','Unknown refund does not guess revoke','A35',['PENDING',60,False],pendingrefund)
def inflight():
    e,r=buy();r['held']=5;a=e.refund(r,24900);blocked=r['revoked'];r['held']=0;r['consumed']=5;b=e.refund(r,0);return [a,blocked,b,r['grants']]
check('R32','In-flight settles before revoking unused','A31 A35',['ENTITLEMENT_PENDING',True,'REVOKED_UNUSED',5],inflight)
def unaffected():
    e,r=buy();other={'start':iso(end),'end':iso(months(end,1)),'units':30};copy=deepcopy(other);e.refund(r,24900);return [other==copy,r['grants']]
check('R33','Refund source does not cascade','A35',[True,0],unaffected)
def gaps():
    ss=segments(future=True)
    for x in ss:
        if x['source']=='I1':x['revoked']=True
    return [cycle(D('2026-11-10T03:00:00Z'),ss),cycle(D('2026-12-10T03:00:00Z'),ss)[3]]
check('R34','Refund leaves original future service anchor','A35',[None,'I2'],gaps)
def cap_permutations():
    rows=[]
    for order in permutations('ABP'):
        e=Ref(2);trace=[]
        for step in order:
            r=e.publish(1,e.version) if step=='P' else e.reserve(e.quote(company=step))
            trace.append('RESERVED' if isinstance(r,dict) else r)
        rows.append(dict(order=''.join(order),trace=trace,cap=e.cap,taken=e.taken(),invariant=e.taken()<=e.cap))
    return rows
cap_rows=cap_permutations()
check('R35','All six cap reduction interleavings','A15 A26 A36',[True]*6,lambda:[x['invariant'] for x in cap_rows],{'interleavings':cap_rows})
check('R36','Old failing order now rejects cap change','A36','CAP_BELOW_TAKEN',lambda:next(x for x in cap_rows if x['order']=='ABP')['trace'][-1])
def pause_permutations():
    out=[]
    for order in permutations('AP'):
        e=Ref();r=None
        for step in order:
            if step=='P':e.paused=True
            else:r=e.reserve(e.quote())
        out.append('ACCEPTED' if isinstance(r,dict) else r)
    return out
check('R37','Pause admission serialization','A25 A36',['ACCEPTED','PAUSED'],pause_permutations)
def release_replay():
    e=Ref(1);r=e.reserve(e.quote());a=e.release(r,T,'TERMINAL_UNPAID');b=e.release(r,T,'TERMINAL_UNPAID');return [a,b,e.taken()]
check('R38','Release is idempotent','A16 A36',['RELEASED','RELEASED',0],release_replay)
def annualcycles():
    s=segments(interval='year');keys={cycle(months(T,n)+timedelta(hours=1),s)[0] for n in range(13)}
    return [len(keys),cycle(T,s)[2],cycle(months(T,12),s)[2]]
check('R39','Annual 12 paid plus one free cycles over time','A09 A32',[13,'PAID','PROMOTION'],annualcycles)
check('R40','Overlapping service sources fail closed','A32','REVIEW',lambda:cycle(T,segments()+segments()))
# Model only: hold sets and reservation consumption, no actual workers or dispute provider calls.
def dispute():
    holds={'SECURITY','DISPUTE'};units=40;holds.remove('DISPUTE');return [sorted(holds),units]
check('R41','Dispute won clears only own hold','A18 A35',[['SECURITY'],40],dispute)
def ocr():
    left=30;held=5;consumed=0;seen=set()
    for op in ['CONSUME','CONSUME']:
        if op not in seen:left-=5;held-=5;consumed+=5;seen.add(op)
    return [left,held,consumed]
check('R42','Original OCR allocation consumed once','A07 A31',[25,0,5],ocr)
check('R43','Continuing original anniversary after clamped February','A05',['2026-03-31T03:00:00Z','2026-04-30T03:00:00Z'],lambda:[iso(term(D('2026-02-28T03:00:00Z'),'month',31)[k]) for k in ['paidEnd','end']])
def scope_cap():
    e=Ref(1);e.reserve(e.quote(env='TEST'));a=e.reserve(e.quote());b=e.reserve(e.quote(campaign='NEW'));return [isinstance(a,dict),isinstance(b,dict),e.taken(),e.taken('TEST')]
check('R44','Capacity scoped by logical environment and campaign','A29 A36',[True,True,1,1],scope_cap)
def refund_before_callback():
    e=Ref();r=e.reserve(e.quote());e.refund(r,24900);a=e.release(r,T,'TERMINAL_UNPAID');e.paid(r);return [a,r['grants'],e.taken(),r['revoked']]
check('R45','Verified full refund imports paid evidence before webhook','A35',['CONSUMED',0,1,True],refund_before_callback)
fail=[x for x in results if x['status']=='MODEL_FAIL']
spec=Path(sys.argv[1]);out=Path(sys.argv[2]);out.parent.mkdir(parents=True,exist_ok=True)
data=dict(kind='OFFLINE_SPEC_REFERENCE_MODEL',date='2026-10-09',specSha256=hashlib.sha256(spec.read_bytes()).hexdigest(),harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),summary=dict(cases=len(results),modelPass=len(results)-len(fail),modelFail=len(fail),baselineCases=37,closureCases=len(results)-37,capInterleavings=len(cap_rows)),limitations=['Atomic in-memory steps, not actual DB concurrency or lock correctness','Synthetic permission/payment/provider readback booleans','Receipt/group policy tested with fixture lots, not OCR API','Dispute and subscription states model desired behavior only','No browser, network, provider, customer data, migration or application mutations'],cases=results)
out.write_text(json.dumps(data,ensure_ascii=False,indent=2,default=lambda v:iso(v) if isinstance(v,datetime) else list(v))+'\n')
print(json.dumps(data['summary']));print(json.dumps(fail,ensure_ascii=False,default=str))
sys.exit(bool(fail))
```

### mutations.py

```python
from pathlib import Path
import subprocess,json,tempfile,sys,hashlib
base=Path(sys.argv[1]);spec=Path(sys.argv[2]);out=Path(sys.argv[3]);source=base.read_text();tmp=Path(tempfile.mkdtemp(prefix='starter-promo-negative-'))
mutations=[
('F01','Ignore live offer signature',"if self.pin!=self.live:return 'CATALOG_STALE'","if False:return 'CATALOG_STALE'",'R01'),
('F02','Partition company usage by provider',"key=(q['env'],q['campaign'],q['company']);old=", "key=(q['env'],q['campaign'],q['company'],q['provider']);old=",'R03'),
('F03','Recheck campaign end after accepted reservation',"if r['dispatch'] is not None:return 'RECOVER_ORIGINAL'", "if self.ended:return 'ENDED'\n        if r['dispatch'] is not None:return 'RECOVER_ORIGINAL'",'R04'),
('F04','Base-first on equal expiry',"0 if x['kind']=='PROMOTION' else 1", "0 if x['kind']=='BASE' else 1",'R07'),
('F05','Read only paid AI segments',"if not x.get('revoked') and x['start']<=at<x['end']", "if x['kind']=='PAID' and not x.get('revoked') and x['start']<=at<x['end']",'R13'),
('F06','Claim renewal ready before provider proof',"if not evidence:r['renewal']='REVIEW';return 'REVIEW'", "if not evidence:r['renewal']='READY';return 'READY'",'R17'),
('F07','Promotion usage disables NORMAL',"if q['choice']!='PROMOTION':", "if q['choice']=='NORMAL' and self.taken()>0:return 'USED_OR_RESERVED'\n        if q['choice']!='PROMOTION':",'R20'),
('F08','Full refund leaves benefits applied',"r['revoked']=True\n        if r['held']", "return 'FULL_BENEFITS_UNCHANGED'\n        r['revoked']=True\n        if r['held']",'R30'),
('F09','Publish cap without final usage check',"if cap is not None and cap<self.taken():return 'CAP_BELOW_TAKEN'", "if False:return 'CAP_BELOW_TAKEN'",'R35')]
rows=[]
for id,title,old,new,target in mutations:
    assert source.count(old)==1,(id,source.count(old))
    p=tmp/(id+'.py');p.write_text(source.replace(old,new));result=tmp/(id+'.json')
    run=subprocess.run([sys.executable,str(p),str(spec),str(result)],capture_output=True,text=True)
    data=json.loads(result.read_text());failed=[x['id'] for x in data['cases'] if x['status']=='MODEL_FAIL']
    caught=run.returncode==1 and target in failed
    rows.append(dict(finding=id,mutation=title,expectedFailCase=target,observedFailedCases=failed,result='CAUGHT' if caught else 'NOT_CAUGHT'))
result=dict(kind='OFFLINE_MODEL_NEGATIVE_CONTROLS',date='2026-10-09',specSha256=hashlib.sha256(spec.read_bytes()).hexdigest(),harnessSha256=hashlib.sha256(base.read_bytes()).hexdigest(),mutationHarnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),summary=dict(injected=9,caught=sum(x['result']=='CAUGHT' for x in rows)),limitations='Defects are injected into a temporary reference model, not source code. Detecting them is not proof that a future implementation has no defects.',cases=rows)
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result['summary']));sys.exit(result['summary']['caught']!=9)
```

### source-probe.cjs

```javascript
const fs=require('node:fs'),cp=require('node:child_process'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const repo=process.cwd(),ref='fddfd05baf97be683796f6b7db4d2e72157197db';
const ts=createRequire(repo+'/apps/api/package.json')('typescript');
const paths=['apps/api/src/modules/billing/domain/billing-package.ts','apps/api/src/modules/line-ai/application/ai-credit-cycles.ts'];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const source=paths.map(p=>cp.execFileSync('git',['show',ref+':'+p],{cwd:repo,encoding:'utf8'}));
function moduleOf(s,requireFn){const m={exports:{}};vm.runInNewContext(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,require:requireFn,Date,Set,Number,Math,BigInt});return m.exports;}
const pkg=moduleOf(source[0],name=>{assert.equal(name,'./billing-policy');return {billingError:()=>new Error('unused validation'),paidVariant:()=>{throw new Error('paidVariant must not be called')}}});
const cycles=moduleOf(source[1],name=>{assert.equal(name,'../../billing/domain/billing-package');return pkg});
const d=x=>new Date(x),base={id:'synthetic-account',billingAnchorDay:5,renewalMode:'CARD_ONCE',cancelAtPeriodEnd:false,subscriptionState:'none',paidThrough:d('2026-12-05T03:00:00Z'),graceEndsAt:null};
const periods=[{id:'I1',periodStart:d('2026-10-05T03:00:00Z'),periodEnd:d('2026-11-05T03:00:00Z')}];
const future={id:'I2',periodStart:d('2026-12-05T03:00:00Z'),periodEnd:d('2027-01-05T03:00:00Z')};
const scenarios=[];
for(const [id,at,add,expected] of [['P01','2026-10-10T03:00:00Z',false,'2026-10-05T03:00:00.000Z'],['P02','2026-11-10T03:00:00Z',false,'2026-10-05T03:00:00.000Z'],['P03','2026-11-10T03:00:00Z',true,null],['P04','2026-12-10T03:00:00Z',true,'2026-12-05T03:00:00.000Z']]){
 const account={...base,paidThrough:add?future.periodEnd:base.paidThrough};
 const actual=cycles.aiCreditCycleAt({account,periods:add?[...periods,future]:periods,at:d(at),graceDays:null,renewalReview:false});
 assert.equal(actual?.start?.toISOString()??null,expected);scenarios.push({id,at,futurePaidPeriod:add,expectedCycleStart:expected,actual});
}
for(const [id,start,n,expected] of [['P05','2026-01-31T03:00:00Z',2,'2026-03-31T03:00:00.000Z'],['P06','2028-02-29T03:00:00Z',13,'2029-03-29T03:00:00.000Z']]){
 const actual=pkg.appendPackageInterval(d(start),'month',d(start).getUTCDate(),n).toISOString();assert.equal(actual,expected);scenarios.push({id,start,months:n,expected,actual});
}
const result={kind:'EXACT_SOURCE_PURE_FUNCTION_PROBE',date:'2026-10-09',sourceRef:ref,sourceHashes:Object.fromEntries(paths.map((p,i)=>[p,hash(source[i])])),harnessSha256:hash(fs.readFileSync(__filename)),assertions:6,status:'PASS_REPRODUCTION',finding:'F05 remains in unchanged source; revised reference model defines desired promotion segment behavior',limitations:'Synthetic account fixtures and exact transpiled calendar/cycle source only; unused billing-policy dependency stubbed. No DB/provider/funding/browser calls.',scenarios};
fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({assertions:6,status:result.status,oldFreeGapCycle:scenarios[2].actual}));
```

// Pure local preview math; production sources and coverage rules are specified separately.
export type Adoption = 'EVER'|'NEVER'|'UNKNOWN';
export function receiptAdoption(lifetime:number|null):Adoption {
  return lifetime===null?'UNKNOWN':lifetime>0?'EVER':'NEVER';
}
export function ratio(count:number,total:number):number|null {return total>0?count/total*100:null;}
export function rankCompanies<T extends {id:string}>(rows:T[],value:(row:T)=>number|null):T[] {
  return [...rows].sort((a,b)=>{const av=value(a),bv=value(b);return av===null?(bv===null?a.id.localeCompare(b.id):1):bv===null?-1:bv-av||a.id.localeCompare(b.id);});
}
export function spendConcentration<T extends {id:string}>(rows:T[],value:(row:T)=>number|null){
  const population=rows.length,targetCount=Math.ceil(population*.2);
  if(rows.some(c=>value(c)===null))return {ready:false as const,population,targetCount};
  const ranked=rankCompanies(rows,value),positive=ranked.filter(c=>value(c)!>0);
  const positiveTotal=positive.reduce((sum,c)=>sum+value(c)!,0),signedTotal=ranked.reduce((sum,c)=>sum+value(c)!,0);
  const top=positive.slice(0,targetCount),topTotal=top.reduce((sum,c)=>sum+value(c)!,0),topIds=new Set(top.map(c=>c.id));
  const rest=ranked.filter(c=>!topIds.has(c.id));let cumulative=0;const to80:T[]=[];
  for(const c of positive){if(cumulative*100>=positiveTotal*80)break;to80.push(c);cumulative+=value(c)!;}
  return {ready:true as const,population,targetCount,ranked,positive,positiveTotal,signedTotal,negativeTotal:signedTotal-positiveTotal,top,rest,topTotal,topShare:ratio(topTotal,positiveTotal),to80,prefixShare:ratio(cumulative,positiveTotal)};
}

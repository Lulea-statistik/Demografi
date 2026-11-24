const BASE='https://statistikdatabasen.scb.se/api/v2/tables/';
const TABLES=[{id:'TAB1625',start:2021,end:2024},{id:'TAB6473',start:2025,end:9999}];
let all=[], measures=[], latestYear=0, measureCatalog=[], forecastView='monthly';
let publicationSchedule=null;
let scbStatusWatcher=null,scbRefreshPending=false;
const $=id=>document.getElementById(id), fmt=n=>Number(n).toLocaleString('sv-SE',{maximumFractionDigits:0});
function items(v){return (v.values||v.valueCodes||[]).map((x,i)=>typeof x==='object'?{code:String(x.code??x.value??i),text:String(x.text??x.label??x.code??i)}:{code:String(x),text:String((v.valueTexts||v.valueText||[])[i]??x)});}
function variable(meta,words){let vars=meta.variables||meta.Variables||[];return vars.find(v=>words.some(w=>String(v.text||v.label||v.code).toLowerCase().includes(w)))}
function dims(json){return json.id.map((id,i)=>({id,size:json.size[i],cats:json.dimension[id].category,index:json.dimension[id].category.index}))}
function records(json){const ds=dims(json), vals=json.value||[];let output=[];
for(let n=0;n<vals.length;n++){const value=vals[n];if(value===null||value===undefined)continue;
 let residue=n, record={value:Number(value)};for(let k=ds.length-1;k>=0;k--){let d=ds[k], ix=residue%d.size;residue=Math.floor(residue/d.size);
 let codes=Array.isArray(d.index)?d.index:Object.keys(d.index).sort((a,b)=>d.index[a]-d.index[b]), code=codes[ix], label=d.cats.label?.[code]??code;
 let key=d.id.toLowerCase();if(/tid|månad|time/.test(key))record.month=code;else if(/region/.test(key))record.region=code;else if(/kön|kon|sex/.test(key))record.sex=String(label);else if(/förändring|forandring/.test(key)){record.measure=String(label);record.measureCode=String(code)}else if(/contentscode|innehåll/.test(key)){record.unitLabel=String(label);record.unitCode=String(code)}}
 if(/^\d{4}M\d{2}$/.test(record.month||'')&&Number(record.month.slice(0,4))>=2021)output.push(record);
}return output}
function metaDimensions(meta){
 if(Array.isArray(meta.id)&&meta.dimension){
  return meta.id.map(id=>{const d=meta.dimension[id],cat=d.category||{},idx=cat.index||{},codes=Array.isArray(idx)?idx:Object.keys(idx).sort((a,b)=>idx[a]-idx[b]);return {code:id,text:d.label||id,values:codes,valueTexts:codes.map(c=>cat.label?.[c]||c),elimination:!!d.extension?.elimination,time:(meta.role?.time||[]).includes(id)};});
 }
 return meta.variables||meta.Variables||[];
}
function matchVar(vars,pattern){return vars.find(v=>pattern.test(String(v.code)+' '+String(v.text)))}
function selectTotal(v){
 const codes=v.values||[],labels=v.valueTexts||[];
 const i=labels.findIndex(x=>/^(totalt|total|samtliga|alla åldrar|summa|båda könen)$/i.test(String(x).trim()));
 if(i>=0)return [codes[i]];
 const j=codes.findIndex(x=>/^(TotSa|TotSA|TOTAL|SUM)$/i.test(String(x)));
 if(j>=0)return [codes[j]];
 return [codes[0]];
}

const map=new Map();let months=[], metrics=[], population;
async function retryFetch(url){let last;for(let i=0;i<3;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(r.ok)return r;throw Error('HTTP '+r.status);}catch(e){last=e;if(i<2)await new Promise(r=>setTimeout(r,1000*(i+1)));}}throw Error('SCB '+(url.includes('/metadata')?'metadata':'data')+': '+last.message);}
async function fetchRanking(){
 const url=BASE+'TAB6473', response=await retryFetch(url+'/metadata?lang=sv');if(!response.ok)throw Error('Metadata: '+response.status);
 const vars=metaDimensions(await response.json()),reg=matchVar(vars,/region/i),measure=matchVar(vars,/förändring|forandring/i),sex=matchVar(vars,/^(Kon|Kön|Sex)\b|\bkön\b/i),time=vars.find(v=>v.time)||matchVar(vars,/^(Tid|Time|Månad|Manad)\b|\bmånad\b/i);
 if(!reg||!measure||!sex||!time)throw Error('SCB:s variabler kunde inte identifieras.');
 const regions=reg.values.filter(c=>/^\d{4}$/.test(c));if(regions.length!==290||!regions.includes('2580')||!regions.includes('2582'))throw Error('Förväntade 290 kommuner, fick '+regions.length);
 const classify=s=>/^(män|man|male|men)$/i.test(s.trim())?'men':/^(kvinnor|kvinna|female|women)$/i.test(s.trim())?'women':/^(totalt|total|båda könen|samtliga)$/i.test(s.trim())?'total':'unknown';
 const sexCodes=sex.values.filter((c,i)=>classify(sex.valueTexts[i])!=='unknown');
 if(!['men','women'].every(k=>sex.valueTexts.some(t=>classify(t)===k)))throw Error('Könskategorier kunde inte identifieras: '+sex.valueTexts.join(', '));
 months=time.values.filter(c=>/^\d{4}M(0[1-9]|1[0-2])$/.test(c)).sort();
 metrics=measure.values.map((code,i)=>({code,label:measure.valueTexts[i]}));population=metrics.find(m=>/^folkmängd$|^befolkning$/i.test(m.label));if(!population)throw Error('Folkmängd saknas.');
 for(let i=0;i<months.length;i+=3){
 for(let j=0;j<regions.length;j+=40){
 const selections=new Map([[reg.code,regions.slice(j,j+40)],[measure.code,measure.values],[sex.code,sexCodes],[time.code,months.slice(i,i+3)]]);
 for(const v of vars)if(!selections.has(v.code)&&!v.elimination)selections.set(v.code,selectTotal(v));
 const params=new URLSearchParams({lang:'sv',outputFormat:'json-stat2'});for(const [k,v] of selections)params.set('valueCodes['+k+']',v.join(','));
 const res=await retryFetch(url+'/data?'+params);if(!res.ok)throw Error('SCB-data: '+res.status);
 for(const row of records(await res.json()))if(Number.isFinite(row.value)&&regions.includes(row.region))map.set([row.region,row.measureCode,row.month,classify(row.sex)].join('|'),row.value);
 }
 }
 return {regions,regionNames:Object.fromEntries(reg.values.map((c,i)=>[c,reg.valueTexts[i]])),months,metrics,population,entries:[...map]};
}

import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
function previous(m){let y=+m.slice(0,4),n=+m.slice(-2);return n===1?(y-1)+'M12':y+'M'+String(n-1).padStart(2,'0')}
function groups(periodType='month'){if(periodType==='month')return months.map(m=>({label:m,months:[m]}));let q=new Map();for(const m of months){let k=m.slice(0,4)+'K'+Math.ceil(+m.slice(-2)/3);if(!q.has(k))q.set(k,[]);q.get(k).push(m)}return [...q].filter(([k,v])=>v.length===3).map(([label,months])=>({label,months}))}
function cell(c,m,t,sex='total'){
 const get=k=>map.get([c,m,t,k].join('|'));
 const direct=get(sex);if(Number.isFinite(direct))return direct;
 if(sex!=='total')return undefined;
 const label=metrics.find(x=>x.code===m)?.label||'';
 if(/andel|procent|kvot|medel|per |promille/i.test(label))return undefined;
 const a=get('men'),b=get('women');return Number.isFinite(a)&&Number.isFinite(b)?a+b:undefined;
}
function value(codes,m,period,relative,sex='total'){
 const stock=m===population.code, selected=stock?period.slice(-1):period;
 let values=codes.flatMap(c=>selected.map(t=>cell(c,m,t,sex)));if(values.some(v=>!Number.isFinite(v)))return null;let sum=values.reduce((a,b)=>a+b,0);
 if(!relative||stock)return sum;
 let base=codes.map(c=>cell(c,population.code,previous(period[0]),sex));if(base.some(v=>!Number.isFinite(v)))return null;let denominator=base.reduce((a,b)=>a+b,0);return denominator>0?sum/denominator*1000:null;
}

function calculatePeriod(regions,period,periodType){let hits=[],hitsChecked=0,hitsMissing=0;
 for(const p of [period])for(const metric of metrics)for(const [sex,sexLabel] of [['total','Totalt'],['men','Män'],['women','Kvinnor']])for(const relative of [false,true]){
 if(relative&&metric.code===population.code)continue;
 if(/andel|procent|kvot|medel|per |promille/i.test(metric.label))continue;
 const vals=regions.map(c=>value([c],metric.code,p.months,relative,sex));
 if(vals.some(v=>!Number.isFinite(v))){hitsMissing++;continue}
 hitsChecked++;const v=vals[regions.indexOf('2580')],rank=1+vals.filter(x=>x>v).length;
 if(rank<=10)hits.push({period:p.label,type:periodType==='month'?'Månad':'Kvartal',metric:metric.label,value:v,rank,comparison:relative?'Per 1 000 invånare':'Antal personer',sex:sexLabel,relative});
 }

return {hits,checked:hitsChecked,missing:hitsMissing};}
function top10(data,old){
 const signature=JSON.stringify([data.regions,data.metrics,data.population]);
 const byMonth=new Map();for(const [k,v] of data.entries){const m=k.split('|')[2];if(!byMonth.has(m))byMonth.set(m,[]);byMonth.get(m).push([k,v]);}
 const hashes=new Map([...byMonth].map(([m,entries])=>[m,createHash('sha256').update(JSON.stringify(entries.sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex')]));
 const periods={};let reused=0,computed=0;
 for(const type of ['month','quarter'])for(const p of groups(type)){
 const fingerprint=createHash('sha256').update(JSON.stringify([signature,type,...[previous(p.months[0]),...p.months].map(m=>[m,hashes.get(m)||null])])).digest('hex');
 const prior=old?.version===1?old.periods?.[p.label]:null;
 if(prior?.fingerprint===fingerprint){periods[p.label]=prior;reused++;}else{periods[p.label]={fingerprint,...calculatePeriod(data.regions,p,type)};computed++;}
 }
 console.log('Top 10: '+computed+' periods calculated, '+reused+' reused');return {version:1,periods};
}

const data=await fetchRanking();if(data.regions.length!==290||!data.entries.length)throw Error('Tom eller ofullständig leverans');let old=null;try{old=JSON.parse(await readFile('data/ranking.json','utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}data.top10=top10(data,old?.top10);if(old){const {updated,...rest}=old;if(JSON.stringify(rest)===JSON.stringify(data)){console.log('No changed ranking data');process.exit(0);}}data.updated=new Date().toISOString();await mkdir('data',{recursive:true});await writeFile('data/ranking.json.tmp',JSON.stringify(data));await rename('data/ranking.json.tmp','data/ranking.json');

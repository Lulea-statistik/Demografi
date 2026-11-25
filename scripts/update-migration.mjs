
const BASE='https://statistikdatabasen.scb.se/api/v2/tables/';
const migrationIds=['TAB1211','TAB1212','TAB6640'], balanceIds=['TAB5169','TAB6481'];
const clean=s=>String(s).trim().toLowerCase();
const sexKey=s=>/^(män|man)$/.test(clean(s))?'men':/^(kvinnor|kvinna)$/.test(clean(s))?'women':/^(totalt|total|båda könen|samtliga)$/.test(clean(s))?'total':null;
const ageKey=s=>{s=clean(s).replace(/[–—]/g,'-');if(/^(totalt|total|samtliga|alla åldrar)$/.test(s))return 'all';let m=s.match(/^(\d+)\s*-\s*(\d+)(?:\s*år)?$/);if(m&&+m[2]===+m[1]+4&&+m[1]%5===0)return m[1]+'-'+m[2];m=s.match(/^(\d+)\s*(?:\+|år och äldre|år eller äldre|år -|-)$/);if(m&&+m[1]%5===0)return m[1]+'+';m=s.match(/^(\d+)(?:\s*år)?$/);return m?'single:'+m[1]:null};
const normMeasure=s=>clean(s).replace(/\s+/g,' ');
async function request(url){let err;for(let i=0;i<3;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}catch(e){err=e}}throw Error(url+' '+err.message)}
function dimensions(meta){return meta.id.map(id=>{const c=meta.dimension[id].category,idx=c.index,codes=Array.isArray(idx)?idx:Object.keys(idx).sort((a,b)=>idx[a]-idx[b]);return {id,codes,labels:codes.map(k=>c.label?.[k]||k),name:meta.dimension[id].label||id}})}
function findDim(ds,re){return ds.find(d=>re.test(d.id+' '+d.name))}
async function readTable(id,balance=false){
 const url=BASE+id,meta=await request(url+'/metadata?lang=sv'),ds=dimensions(meta);
 const region=findDim(ds,/region/i),sex=findDim(ds,/kön|kon\b|sex/i),age=findDim(ds,/ålder|alder|age/i),time=findDim(ds,/^tid\b|^time\b|^år\b/i),period=findDim(ds,/^period\b/i),measure=findDim(ds,balance?/förändring|forandring/i:/contentscode|tabellinnehåll/i);
 if(!region||!sex||!time||!measure||(!balance&&!age)||!region.codes.includes('2580'))throw Error(id+': okända dimensioner '+ds.map(d=>d.id).join(','));
 const select=new Map([[region.id,['2580']],[sex.id,sex.codes.filter((c,i)=>sexKey(sex.labels[i]))],[time.id,time.codes.filter(c=>/^\d{4}$/.test(c)&&+c<new Date().getUTCFullYear())],[measure.id,measure.codes]]);
 if(age)select.set(age.id,age.codes.filter((c,i)=>ageKey(age.labels[i])));
 if(period){const codes=period.codes.filter((c,i)=>/helår|hela året|^år$/i.test(period.labels[i]));if(codes.length!==1)throw Error(id+': helårsperiod kunde inte identifieras: '+period.labels.join(', '));select.set(period.id,codes)}
 if(!select.get(time.id).length)throw Error(id+': inga avslutade år');
 for(const d of ds)if(!select.has(d.id)){if(d.codes.length!==1)throw Error(id+': oidentifierad dimension '+d.id);select.set(d.id,d.codes)}
 const rows=[];
 for(let start=0;start<select.get(time.id).length;start+=8){
 const params=new URLSearchParams({lang:'sv',outputFormat:'json-stat2'});for(const [k,v] of select)params.set('valueCodes['+k+']',(k===time.id?v.slice(start,start+8):v).join(','));
 const json=await request(url+'/data?'+params),out=dimensions(json);
 for(let i=0;i<json.size.reduce((a,b)=>a*b,1);i++){const raw=json.value?.[i];if(raw===null||raw===undefined||!Number.isFinite(Number(raw)))continue;let n=i,record={};for(let j=out.length-1;j>=0;j--){const d=out[j],k=n%json.size[j];n=Math.floor(n/json.size[j]);record[d.id]={code:d.codes[k],label:d.labels[k]}}
 const a=age?ageKey(record[age.id].label):'all',s=sexKey(record[sex.id].label);if(a&&s)rows.push([record[time.id].code,a,s,normMeasure(record[measure.id].label),Number(raw)]);
 }}
 if(!rows.length)throw Error(id+': inga data');return rows;
}
async function buildData(){
 const migration=(await Promise.all(migrationIds.map(id=>readTable(id)))).flat();
 const balance=(await Promise.all(balanceIds.map(id=>readTable(id,true)))).flat();
 return {region:'2580',migration,balance,updated:new Date().toISOString()};
}

import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
const data=await buildData();let old;try{old=JSON.parse(await readFile('data/flyttningar.json','utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(old&&JSON.stringify(old.migration)===JSON.stringify(data.migration)&&JSON.stringify(old.balance)===JSON.stringify(data.balance)){console.log('No changed migration data');process.exit(0)}await mkdir('data',{recursive:true});await writeFile('data/flyttningar.json.tmp',JSON.stringify(data));await rename('data/flyttningar.json.tmp','data/flyttningar.json');console.log('Migration rows',data.migration.length,'balance rows',data.balance.length);

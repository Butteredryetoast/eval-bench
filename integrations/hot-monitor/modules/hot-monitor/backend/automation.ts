import {sql} from "@aihot/backend/db";
import {config} from "@aihot/backend/config";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import type {Event,Report,Job,ModelSpendingSettings} from "../contracts.ts";
import {needsChinese,textDigest,availableReport} from "./chinese.ts";
import {priorityFor} from "./priority.ts";
import {digest} from "./domain.ts";
import {spendingSettings,modelUsage,cnyDate} from "./spending.ts";
import {submitWork,editorialQueue} from "./jobs.ts";

export function automaticCandidate(e:Event,reports:Report[],settings:ModelSpendingSettings,now=Date.now()) {
  if(settings.autoMode==="off"||!settings.enabledAt||e.mergedInto)return false;
  const recent=reports.some(r=>availableReport(r)&&!r.backfill&&r.publishedAt&&Date.parse(r.publishedAt)>=now-86400000&&Date.parse(r.publishedAt)<=now&&Date.parse(r.receivedAt??r.discoveredAt)>=Date.parse(settings.enabledAt!));
  if(!recent)return false;
  const rank=priorityFor(e,reports).rank;
  return settings.autoMode==="recommended"?rank===0:rank<2;
}
export async function runModelAutomation() {
  if(!config.modelCallsEnabled)return;
  const settings=await spendingSettings();const usage=await modelUsage();
  if(usage.remaining<=0)return;
  // Lock only dispatch, never hold a transaction open during an external request.
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext('hot-monitor.auto-dispatch'))`;
    const waiting=await tx`SELECT id,data FROM hm_jobs WHERE data->>'status'='waiting' ORDER BY updated_at LIMIT 20`;
    for(const row of waiting){const j=row.data as Job;
      if(j.automatic&&settings.autoMode==="off")continue;
      if(cnyDate(new Date(j.updatedAt))===cnyDate()&&(!settings.updatedAt||settings.updatedAt<j.updatedAt))continue;
      if(!j.eventId||!['score','translate'].includes(j.kind))continue;
      await enqueueOn(editorialQueue,{jobId:j.id,kind:j.kind as 'score'|'translate',eventId:j.eventId,automatic:j.automatic},{},tx);
      await tx`UPDATE hm_jobs SET data=data||'{"status":"queued","message":"预算恢复，等待后台继续"}'::jsonb,updated_at=now() WHERE id=${j.id}`;
    }
  });
  if(settings.autoMode==="off")return;
  const events=await sql`SELECT data FROM hm_events WHERE NOT(data ? 'mergedInto') ORDER BY updated_at DESC`;
  const reports=await sql`SELECT event_id,data FROM hm_reports WHERE data->>'active'='true'`;
  const grouped=new Map<string,Report[]>();for(const r of reports){const rs=grouped.get(r.event_id)??[];rs.push(r.data);grouped.set(r.event_id,rs);}
  let count=0;
  for(const row of events){const e=row.data as Event,rs=grouped.get(e.id)??[];
    if(!automaticCandidate(e,rs,settings))continue;
    let kind:'score'|'translate'|null=null;
    if(e.scoreMethod!=="manual"&&e.scoreStatus!=="scored"&&e.scoreStatus!=="failed")kind='score';
    else if(settings.translate&&[e,...rs.filter(availableReport)].some(v=>(needsChinese(v.title)||needsChinese(v.summary))&&v.chinese?.sourceDigest!==textDigest(v)))kind='translate';
    if(!kind)continue;
    const fingerprint=digest(JSON.stringify([e.title,e.summary,rs.map(r=>[r.id,r.title,r.summary]).sort()]));
    const remaining=kind==='translate'?digest(JSON.stringify([e,...rs.filter(availableReport)].filter(v=>(needsChinese(v.title)||needsChinese(v.summary))&&v.chinese?.sourceDigest!==textDigest(v)).map(v=>[v.id,textDigest(v)]).sort())):'';
    const key='auto:'+kind+':'+e.id+':'+fingerprint+':'+remaining;
    const job=await submitWork({kind,eventId:e.id,automatic:true},key);
    if(["queued","running","waiting"].includes(job.status)&&++count>=20)break;
  }
}

import {z} from "zod";
import {sql,type Db} from "@aihot/backend/db";
import {modelFor} from "@aihot/backend/editorial/models";
import {MODELS} from "@aihot/backend/providers/llm";
import {config} from "@aihot/backend/config";
import type {Event,Report,ModelSpendingSettings,ModelUsageDay,ModelUsageData} from "../contracts.ts";

const KEY="hot-monitor.spending";
const LOCK="hot-monitor.model-spending";
export const spendingInput=z.object({dailyBudget:z.number().min(0).max(1000).multipleOf(0.01),autoMode:z.enum(["off","recommended","all"]),translate:z.boolean()}).strict();
export const cnyDate=(date=new Date())=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
export function estimateUsage(usage:Record<string,any>|null) {
  const input=Math.max(0,Number(usage?.prompt_tokens)||0),output=Math.max(0,Number(usage?.completion_tokens)||0);
  const cached=Math.min(input,Math.max(0,Number(usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens)||0));
  return {input,output,cached,estimated:((input-cached)*2+cached*.04+output*8)/1e6};
}
export async function spendingSettings(db:Db=sql):Promise<ModelSpendingSettings> {
  return (await db`SELECT value FROM settings WHERE key=${KEY}`)[0]?.value??{dailyBudget:5,autoMode:"off",translate:true,enabledAt:null,updatedAt:null};
}
export async function saveSpending(input:unknown) {
  const next=spendingInput.parse(input);
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    const old=await spendingSettings(tx);const now=new Date().toISOString();
    const value={...next,enabledAt:next.autoMode==="off"?null:old.enabledAt??now,updatedAt:now};
    await tx`INSERT INTO settings(key,value) VALUES(${KEY},${tx.json(value)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
    return value;
  });
}
async function usageDays(db:Db=sql):Promise<ModelUsageDay[]> {
  const rows=await db`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,usage,attempts FROM receipts WHERE purpose IN ('monitor_score','monitor_translate') AND created_at >= ((now() AT TIME ZONE 'Asia/Shanghai')::date-6) AT TIME ZONE 'Asia/Shanghai'`;
  const days=new Map<string,ModelUsageDay>();
  for(let i=6;i>=0;i--){const date=cnyDate(new Date(Date.now()-i*86400000));days.set(date,{date,calls:0,input:0,output:0,cached:0,estimated:0,missingUsage:0});}
  for(const r of rows){const d=days.get(r.date);if(!d)continue;const u=estimateUsage(r.usage);d.calls+=Number(r.attempts);d.input+=u.input;d.output+=u.output;d.cached+=u.cached;d.estimated+=u.estimated;if(!r.usage&&r.attempts)d.missingUsage++;}
  return [...days.values()];
}
async function totals(db:Db=sql) {
  const days=await usageDays(db);const today=days.at(-1)!;
  const [held]=await db`SELECT coalesce(sum(amount),0) AS reserved,count(*) AS reservations FROM hm_model_reservations WHERE state='active'`;
  return {days,today,reserved:Number(held.reserved),reservations:Number(held.reservations)};
}
export async function modelUsage():Promise<ModelUsageData> {
  const settings=await spendingSettings();const t=await totals();
  const [w]=await sql`SELECT count(*) AS n FROM hm_jobs WHERE data->>'status'='waiting'`;
  return {settings,...t,remaining:Math.max(0,settings.dailyBudget-t.today.estimated-t.reserved),waiting:Number(w.n),models:{score:MODELS[await modelFor("monitorScore")]?.model??"待配置",translate:MODELS[await modelFor("monitorTranslate")]?.model??"待配置"}};
}
export class ModelBudgetReached extends Error {
  constructor(){super("今日模型预算不足，任务已等待；提高预算或次日额度恢复后自动继续。费用按DeepSeek高峰价保守估算。");}
}
export function reservationAmount(kind:"score"|"translate",event:Event,reports:Report[],reasoningTokens=0) {
  // UTF-8 bytes bound text tokens; allowance covers the fixed prompt and chat framing.
  // Both scoring passes and the maximum output are reserved before either request starts.
  const bytes=Buffer.byteLength(JSON.stringify({event:{title:event.title,summary:event.summary},reports:reports.map(r=>({id:r.id,title:r.title,summary:r.summary,url:r.url,source:r.source}))}),"utf8")+8192;
  const passes=kind==="score"?2:1,output=kind==="score"?1600:6000;
  return Math.ceil((bytes*2+(output+reasoningTokens)*8)*passes)/1e6;
}
export async function reserveModelJob(id:string,kind:"score"|"translate",event:Event,reports:Report[]) {
  if(!config.modelCallsEnabled)return false;
  const model=MODELS[await modelFor(kind==="score"?"monitorScore":"monitorTranslate")];
  if(!model||!["deepseek-flash","deepseek-v4-flash","deepseek-v4-flash-vision-exp"].includes(model.model))throw new Error("预算目前按DeepSeek Flash定价；请先配置DeepSeek Flash，再进行评分或翻译");
  const amount=reservationAmount(kind,event,reports,model.reasoningTokens);
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    if((await tx`SELECT id FROM hm_model_reservations WHERE id=${id} AND state='active'`).length)throw new ModelBudgetReached();
    const settings=await spendingSettings(tx),t=await totals(tx);
    if(settings.dailyBudget===0||t.today.estimated+t.reserved+amount>settings.dailyBudget)throw new ModelBudgetReached();
    await tx`INSERT INTO hm_model_reservations(id,event_id,amount,state) VALUES(${id},${event.id},${amount},'active') ON CONFLICT(id) DO UPDATE SET amount=EXCLUDED.amount,state='active',created_at=now()`;
  });
  return true;
}
export async function settleModelJob(id:string) {
  // Unknown outcomes may have been billed. Keep their allowance across midnight/restarts.
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    const [r]=await tx`SELECT * FROM hm_model_reservations WHERE id=${id} AND state='active'`;
    if(!r)return;
    const unresolved=await tx`SELECT id FROM receipts WHERE subject=${r.event_id} AND purpose IN ('monitor_score','monitor_translate') AND created_at>=${r.created_at} AND (status IN ('pending','unknown') OR (received_at IS NOT NULL AND (jsonb_typeof(usage->'prompt_tokens') IS DISTINCT FROM 'number' OR jsonb_typeof(usage->'completion_tokens') IS DISTINCT FROM 'number')))`;
    if(!unresolved.length)await tx`UPDATE hm_model_reservations SET state='released' WHERE id=${id}`;
  });
}

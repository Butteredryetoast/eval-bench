import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql} from "@aihot/backend/db";
import {casePlatform,type Case} from "../contracts.ts";
import {canonicalUrl,caseVersion} from "./domain.ts";
import {eventById} from "./store.ts";
const link=z.string().url().max(4000).transform(canonicalUrl);
export const caseImport=z.object({schemaVersion:z.literal(1),eventId:z.string().min(1),source:z.literal("browser").optional(),destination:z.enum(["candidates","library"]).default("candidates"),note:z.string().trim().max(2000).default(""),intent:z.enum(["keywords","example","comparison","failure"]).default("keywords"),items:z.array(z.object({url:link,title:z.string().trim().min(1).max(300).default("待补充案例标题"),author:z.string().max(200).default(""),summary:z.string().max(30000).default(""),publishedAt:z.string().datetime({offset:true}).nullable().default(null),media:z.array(z.object({kind:z.enum(["image","video","poster","link"]),url:link}).strict()).max(20).default([])}).strict()).min(1).max(50)}).strict();
export async function importCaseCandidates(input:unknown,method:"batch"|"external") {
  const b=caseImport.parse(input),e=await eventById(b.eventId);
  if(!e?.confirmed)throw Object.assign(new Error("请先确认有效选题，再导入案例"),{statusCode:400});
  if(method==="external"&&b.destination!=="candidates")throw Object.assign(new Error("外部脚本只能收集候选，收入案例库需编辑操作"),{statusCode:400});
  const seen=new Set<string>();let created=0;let adopted=0;const ids:string[]=[];
  for(const item of b.items){
    if(seen.has(item.url))continue;seen.add(item.url);
    const c:Case={id:randomUUID(),eventId:e.id,...item,platform:casePlatform(item.url),captureMethod:method==="batch"&&b.source==="browser"?"browser":method,collectedAt:new Date().toISOString(),...caseVersion(e.version,item.title+" "+item.summary),evidence:"unknown",role:"unknown",searchIntent:b.intent,conditions:"待核对原文测试条件",notes:b.note,saved:false,reviewed:false,media:item.media.map(m=>({...m,status:"candidate"}))};
    const cover=c.media.find(m=>m.kind==="image"||m.kind==="poster");
    if(c.captureMethod==="browser"&&c.title!=="待补充案例标题"&&c.author&&c.summary&&cover)c.metadata={status:"ready",method:"browser",updatedAt:new Date().toISOString(),coverUrl:cover.url};
    const inserted=await sql`INSERT INTO hm_cases(id,event_id,url,data) VALUES(${c.id},${c.eventId},${c.url},${sql.json(c as never)}) ON CONFLICT(event_id,url) DO NOTHING RETURNING id`;
    if(inserted.length)created++;
    const [row]=inserted.length?inserted:await sql`SELECT id FROM hm_cases WHERE event_id=${e.id} AND url=${c.url}`;
    if(b.destination==="library"){const changed=await sql`UPDATE hm_cases SET data=jsonb_set(data,'{saved}','true'::jsonb),updated_at=now() WHERE id=${row.id} AND data->>'saved' IS DISTINCT FROM 'true' RETURNING id`;adopted+=changed.length;}
    ids.push(row.id);
  }
  return {schemaVersion:1,adopted,received:b.items.length,created,existing:seen.size-created,duplicates:b.items.length-seen.size,caseIds:ids};
}

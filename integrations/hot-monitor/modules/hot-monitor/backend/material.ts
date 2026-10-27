import {sql} from "@aihot/backend/db";
import type {Event,Report} from "../contracts.ts";
import {eventById,reportsFor} from "./store.ts";
import {put,remotePage} from "./sync.ts";
import {extractCaseKeywords} from "../case-search.ts";

export const availableReport=(r:Report)=>r.active&&(!r.expiresAt||Date.parse(r.expiresAt)>Date.now());

/** Revalidate the relevant public page before a paid call, never extend an expired lease locally. */
export async function modelMaterial(input:Event) {
  let e=(await eventById(input.id))??input;
  let reports=await reportsFor(e.id);
  let fresh=reports.filter(availableReport);
  if(!fresh.length) {
    const targets=reports.filter(r=>r.active&&r.origin==="aihot");
    if(!targets.length)throw new Error("当前没有可用报道，请打开原文核对后添加材料或使用人工评分；未调用模型");
    const ids=new Set(targets.map(r=>r.externalId));
    const pages=await sql<{path:string;data:{items?:Array<{id:string}>}}[]>`SELECT path,data FROM hm_sync_cache WHERE path LIKE '/api/v1/items?%'`;
    const known=pages.map(p=>({...p,matches:Array.isArray(p.data?.items)?p.data.items.filter((i:{id:string})=>ids.has(i.id)).length:0})).filter(p=>p.matches).sort((a,b)=>b.matches-a.matches);
    const keyword=extractCaseKeywords(e).keywords||e.title;
    const path=known[0]?.path??"/api/v1/items?"+new URLSearchParams({mode:"all",window:"7d",limit:"100",q:[...keyword].slice(0,200).join("")});
    let page;
    try {page=await remotePage(path);}
    catch {throw new Error("新闻材料更新失败，上游暂时无法连接或要求稍后重试；请稍后重试，未调用模型");}
    if(!Array.isArray(page.data.items))throw new Error("上游报道格式异常，请稍后重试；未调用模型");
    for(const item of page.data.items)if(ids.has(item.id))await put(item,page.expiresAt);
    e=(await eventById(e.id))??e;
    reports=await reportsFor(e.id);
    fresh=reports.filter(availableReport);
    if(!fresh.length)throw new Error("这条报道暂未在最新动态中核实，可能已更正、撤回或超出7天范围；请打开原文核对或使用人工评分，未调用模型");
  }
  const eventCurrent=!e.summaryExpiresAt||Date.parse(e.summaryExpiresAt)>Date.now();
  // A still-fresh report does not make an old, independently cached event digest fresh.
  const primary=fresh.find(r=>r.tier==="T1")??fresh[0]!;
  return {event:eventCurrent?e:{...e,title:primary.title,summary:primary.summary},reports:fresh,eventCurrent};
}

import {extractCaseKeywords} from "../case-search.ts";
import type {Event,Report} from "../contracts.ts";
import {safeExport} from "./domain.ts";
import {timeline} from "./query.ts";
export function topicExport(entries:Array<{event:Event;reports:Report[]}>) {
  const clean=(s:unknown)=>String(safeExport(String(s??""))).replace(/\r?\n/g," ").trim();
  const clip=(s:unknown,n:number)=>{const value=clean(s);return value.length>n?value.slice(0,n)+"…":value;};
  const records=entries.map(({event:e,reports})=>{
    const sources=timeline(reports.filter(r=>r.active&&(!r.expiresAt||Date.parse(r.expiresAt)>Date.now())),"desc").slice(0,3);
    return {keywords:clean(extractCaseKeywords(e).keywords),id:e.id,title:clean(e.title),field:clean(e.field),status:e.confirmed?"已确认":"待讨论",summary:clip(e.summary,300),why:clip(e.priority?.reasons.join("；")||e.scoreReason,220),angle:clip(e.classification?.angle||"待讨论",300),score:e.scoreStatus==="scored"&&e.score!==null?String(e.score)+"（"+(e.scoreMethod==="manual"?"人工":"AI两轮")+"）":"未评分",sources:sources.map(r=>({name:clean(r.source),url:clean(r.url)})),requirements:(e.classification?.researchRequirements??[]).map(clean)};
  });
  const text=["猿大侠｜选题清单",`共${records.length}个选题；用于讨论和分工，摘要为简版，导出不等于确认或核实。`,"",...records.flatMap((r,i)=>[`${i+1}. ${r.title}`,`领域：${r.field}｜${r.status}｜本站评分：${r.score}`,`核心信息：${r.summary||"摘要待更新，请回查原文"}`,`关注理由：${r.why||"待补充"}`,`写作方向：${r.angle}`,`案例搜寻词：${r.keywords||"请先补充具体产品或主体"}`,...r.requirements.map(s=>"待研究："+s),...r.sources.map(s=>`出处：${s.name} ${s.url}`),...(r.sources.length?[]:["出处：当前摘要已过期或撤回，请回站内核对"]),`事件ID：${r.id}`,""])].join("\n");
  const csvCell=(v:string)=>'"'+(/^[\s]*[=+\-@]/.test(v)?"'"+v:v).replaceAll('"','""')+'"';
  const csv="\uFEFF"+[["选题","领域","状态","本站评分","核心信息","关注理由","写作方向","案例搜寻词","出处","事件ID"],...records.map(r=>[r.title,r.field,r.status,r.score,r.summary,r.why,r.angle,r.keywords,r.sources.map(s=>s.name+" "+s.url).join("\n"),r.id])].map(row=>row.map(csvCell).join(",")).join("\r\n");
  return {count:records.length,text,csv};
}

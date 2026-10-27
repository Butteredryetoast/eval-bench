import type { Event, Report } from "../contracts.ts";
import { MONITOR_POLICY as P } from "@aihot/industry/monitor-policy";
import { digest, inferField, visibleToday } from "./domain.ts";
export const reviewDigest = (e: Pick<Event,"title"|"summary">) => digest(e.title+"\n"+e.summary);
export function currentReview(e: Event) {
  return e.editorialReview?.materialDigest === reviewDigest(e) ? e.editorialReview : null;
}
// 收录、规则候选、助理/编辑标注和正式评分分别保存；未知内容保持待核对。
export function priorityFor(e: Event, reports: Report[],now=Date.now()) {
  const active = reports.filter(r=>r.active);
  const recent = active.some(r=>visibleToday({...r,expiresAt:null},now));
  const review = currentReview(e);
  if (review) return {
    label: (review.by==="assistant"?"助理初标：":"编辑标注：") + ({select:"建议写",reject:"不建议写",observe:"观察"}[review.decision]),
    reasons:[review.reason], rank:review.decision==="reject"?3:recent&&review.decision==="select"?0:1,
  };
  if (!recent) return {label:"历史资料",reasons:["无近48小时的已知发布时间；可在全部事件核对"],rank:2};
  const title = e.title;
  const text = title+" "+active.map(r=>r.title+" "+r.summary.slice(0,500)).join(" ");
  const ai = P.ai.test(title) || active.some(r=>P.ai.test(r.title));
  if (active.length && active.every(r=>r.screening==="block")) return {label:"预筛不相关",reasons:["框架预筛已判定无关，留在原始动态供核对"],rank:3};
  if (P.noise.test(title) && !P.creative.test(title)) return {label:"过滤：促销或常规商品",reasons:["单纯价格、配件、配色或促销不进入推荐；重大变化可人工改标"],rank:3};
  if (P.routine.test(title)) return {label:"观察：例行更新",reasons:["例行修复、适配、上架或发售消息，需要新增实际影响或体验证据"],rank:1};
  if (P.controversy.test(title)) return {label:"观察：待实质影响",reasons:["观点争议、预测或预告先观察；有实际产品、经营或社会影响再升级"],rank:1};
  if (e.scoreStatus==="scored" && e.score!==null) return {label:e.score>=e.scoreThreshold?"独立评分达标":"独立评分未达标",reasons:[e.scoreReason],rank:e.score>=e.scoreThreshold?0:1};
  if (active.some(r=>r.origin==="aihot"&&r.upstreamSelected)) return {label:"上游精选·待复评",reasons:["复用AIHOT精选作为候选依据，尚不代表猿大侠独立通过"],rank:0};
  if (!ai && inferField(title)==="待归类") return active.some(r=>r.origin==="aihot") ? {label:"观察：领域待核对",reasons:["上游已收录，但现有标题不足以判断本站领域；先补材料"],rank:1} : {label:"过滤：关注范围外",reasons:["没有明确落入既定关注领域，不再默认归为AI"],rank:3};
  if (ai && P.creative.test(text) && !/直播.*(?:预告|将|月\s*\d+\s*日)|将.*直播/.test(text)) return {label:"创作/体验候选",reasons:["包含AI创作、实测或可迁移方法线索；需核对原作、条件与失败边界"],rank:0};
  if (ai && P.release.test(title) && active.some(r=>r.tier==="T1"||r.tier==="T1_5")) return {label:"一手发布候选",reasons:["AI一手发布值得评估；公告只能证明发布，不能证明宣传效果"],rank:0};
  return {label:"观察：证据或意义待补",reasons:[ai?"AI相关，但还缺明确变化意义、可用方法或独立证据":"非AI领域需重大变化或真实体验才进入推荐"],rank:1};
}
export function entersCandidates(e:Event,reports:Report[]) {
  return !e.candidate&&priorityFor(e,reports).rank===0;
}

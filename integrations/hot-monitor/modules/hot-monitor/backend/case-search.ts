import {CASE_KEYWORD_LIMIT,CASE_SEARCH_TERMS,platformCaseSearch,type SearchPrecision,type KeywordSource,type SearchIntent} from "../case-search.ts";
import type { Event } from "../contracts.ts";
export const CASE_SEARCH_POLICY = {
  keywordLimit:CASE_KEYWORD_LIMIT, receiptWindowMinutes:10,
  xFallbackDays:7, mpRecentDays:7, mpHistoryDays:180,
  wechat:{mode:1,search_type:1,sort_type:1,currentPage:1,offset:0},
  ...CASE_SEARCH_TERMS,
  extraction:"规则提取主体、当前材料中的版本和标题任务词，不调用模型",
  replies:"包含回复，不自动读取整条讨论",
};
export function caseSearchPlan(e:Event,platform:"wechat"|"x",role:SearchIntent,customQuery?:string,now=Date.now(),precision:SearchPrecision="precise",keywordSource?:KeywordSource) {
  const p=CASE_SEARCH_POLICY,plan=platformCaseSearch(e,platform,role,customQuery,precision,now,keywordSource);
  if(plan.base.length<2)throw new Error("无法自动识别主体，请先填写具体产品或模型名");
  const age=e.publishedAt?now-Date.parse(e.publishedAt):0;
  const publishTimeType=age>p.mpRecentDays*86400000 ? age>p.mpHistoryDays*86400000?0:3 :2;
  return {keyword:plan.query,publishTimeType,xQuery:plan.query,bucket:String(Math.floor(now/(p.receiptWindowMinutes*60000)))};
}

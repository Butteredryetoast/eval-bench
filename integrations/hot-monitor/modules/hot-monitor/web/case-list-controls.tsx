import {caseContext} from "./navigation.ts";
import {Form,Link,useSearchParams} from "react-router";
import {CASE_GAP_LABELS,CASE_PLATFORM_LABELS,type CaseListData} from "../contracts.ts";
export function CaseFilters({data,saved=false}:{data:CaseListData;saved?:boolean}){
  const [sp]=useSearchParams();const v=(k:string)=>sp.get(k)??"";
  const reset=caseContext(sp)||"?";
  return <Form method="get" className="hm-filter-panel hm-case-filters" key={sp.toString()}>
    {["keywords","searchPlatform","intent","precision","keywordSource"].map(key=>sp.get(key)?<input key={key} type="hidden" name={key} value={sp.get(key)!}/>:null)}
    {sp.get("eventId")&&<input type="hidden" name="eventId" value={sp.get("eventId")!}/>}
    <div className="hm-filter-main"><label className="hm-filter-search">查找案例<input aria-label="查找案例" name="q" defaultValue={v("q")} placeholder="标题、作者、版本、原帖链接或备注"/></label>
      <label>{saved?"案例平台":"结果平台"}<select name="platform" aria-label={saved?"案例平台":"结果平台"} defaultValue={v("platform")}><option value="">全部平台（{data.scopeCount}）</option>{data.platforms.map(p=><option key={p.platform} value={p.platform}>{CASE_PLATFORM_LABELS[p.platform]}（{p.count}）</option>)}</select></label>
      <label>待补信息<select name="gap" aria-label="待补信息" defaultValue={v("gap")}><option value="">全部材料</option>{Object.entries(CASE_GAP_LABELS).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
    </div><details className="hm-filter-more" open={["verification","evidence","reviewed","captureMethod","sort"].some(k=>Boolean(v(k)))||Boolean(v("pageSize")&&v("pageSize")!=="20")}><summary>更多筛选：版本、证据、审核和收集方式</summary><div className="hm-filter-advanced">
      <label>版本状态<select name="verification" aria-label="案例版本状态" defaultValue={v("verification")}><option value="">全部版本状态</option><option value="pending">待确认</option><option value="matched">版本字符串匹配</option><option value="mismatch">版本不一致</option></select></label>
      <label>证据来源<select name="evidence" aria-label="案例证据来源" defaultValue={v("evidence")}><option value="">全部证据来源</option><option value="unknown">身份待核对</option><option value="author_test">作者实测</option><option value="repost">转述</option></select></label>
      <label>人工检查<select name="reviewed" aria-label="案例人工检查" defaultValue={v("reviewed")}><option value="">全部检查状态</option><option value="false">尚未检查</option><option value="true">已人工检查</option></select></label>
      <label>收集方式<select name="captureMethod" aria-label="案例收集方式" defaultValue={v("captureMethod")}><option value="">全部收集方式</option><option value="api">API搜索</option><option value="manual">手动保存</option><option value="batch">批量收集</option><option value="browser">浏览器采集</option><option value="external">脚本导入</option><option value="unknown">未记录方式</option></select></label>
      <label>排序<select name="sort" aria-label="案例排序" defaultValue={v("sort")}><option value="">最近收集优先</option><option value="published">最近发布优先，未知日期在后</option></select></label>
      <label>每页条数<select name="pageSize" aria-label="案例每页条数" defaultValue={v("pageSize")||"20"}>{[20,50,100].map(n=><option key={n} value={n}>{n}条</option>)}</select></label>
    </div></details><div className="hm-filter-bottom"><span className="hm-caption">筛选后{data.page.count}条；平台数量按当前选题下的{saved?"已保存案例":"待挑选结果"}统计。更改筛选回首页，不调用模型。</span><div className="hm-actions"><Link className="hm-button" to={reset}>清空案例筛选</Link><button className="hm-primary">筛选案例</button></div></div>
  </Form>;
}

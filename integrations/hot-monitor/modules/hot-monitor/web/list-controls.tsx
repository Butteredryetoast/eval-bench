import {monitorViewHref,monitorViewKey} from "./navigation.ts";
import { Form, Link, useSearchParams } from "react-router";
import { FIELDS, FORMATS, type MonitorData } from "../contracts.ts";
export function Filters({ filters, mode, events = true }: { filters: MonitorData["filters"]; mode: string; events?: boolean }) {
  const [sp] = useSearchParams();
  const value=(key:string,fallback="")=>sp.get(key)??fallback;
  const navigationState=["confirmed","bookmarked"].includes(value("state"));
  const advanced=["from","to","source","format","origin","state"].some(k=>Boolean(sp.get(k))) || value("sort")==="upstream" || value("timeBy")==="discovered";
  const active=["q","field","format","platform","origin","source","from","to","state","review"].filter(k=>Boolean(sp.get(k)));
  return <Form className="hm-filter-panel" method="get" key={sp.toString()}>
    <input type="hidden" name="mode" value={events&&navigationState?"all":mode}/>
    {events&&navigationState&&<input type="hidden" name="state" value={value("state")}/>}
    {sp.get("review") && <input type="hidden" name="review" value={sp.get("review")!}/>}
    <div className="hm-filter-main">
      <label className="hm-filter-search">关键词<input name="q" aria-label="搜索标题和摘要" placeholder="搜索标题、产品或关键词…" defaultValue={value("q")}/></label>
      <label>领域<select name="field" aria-label="关注领域" defaultValue={value("field")}><option value="">全部领域</option><option value="待归类">待归类</option>{FIELDS.map(x=><option key={x}>{x}</option>)}</select></label>

      <label>时间范围<select name="window" aria-label="时间范围" defaultValue={value("window","7d")}><option value="today">今天</option><option value="24h">近24小时</option><option value="48h">近48小时</option><option value="7d">近7天</option><option value="all">全部存档</option></select></label>
      <label>数据平台<select name="platform" aria-label="数据平台" defaultValue={value("platform")}><option value="">全部平台</option>{filters.platforms.map(x=><option key={x}>{x}</option>)}</select></label>

    </div>
    <details className="hm-filter-more" open={advanced}><summary>更多筛选：类型、渠道、日期与账号{advanced?" · 有已选条件":""}</summary><div className="hm-filter-advanced">
      <label>内容类型<select name="format" aria-label="内容类型" defaultValue={value("format")}><option value="">全部类型</option>{FORMATS.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>发现渠道<select name="origin" aria-label="发现渠道" defaultValue={value("origin")}><option value="">全部渠道</option><option value="aihot">AIHOT发现</option><option value="self">本机自采</option><option value="manual">人工提交</option></select></label>
      <label>开始日期<input type="date" aria-label="从" name="from" defaultValue={value("from")}/></label>
      <label>结束日期<input type="date" aria-label="至" name="to" defaultValue={value("to")}/></label>
      <label>日期依据<select name="timeBy" aria-label="日期依据" defaultValue={value("timeBy","published")}><option value="published">原文发布时间</option><option value="discovered">来源发现时间</option></select></label>
      <label className="hm-filter-source">来源账号<select name="source" aria-label="来源账号" defaultValue={value("source")}><option value="">全部来源账号</option>{filters.sources.map(x=><option key={x}>{x}</option>)}</select></label>
      {!events && <label>排序方式<select name="sort" aria-label="动态排序" defaultValue={value("sort","time")}><option value="time">按所选日期</option><option value="upstream">AIHOT动态顺序</option></select></label>}
      {events && !navigationState && <label>工作状态<select name="state" aria-label="工作状态" defaultValue={value("state")}><option value="">全部状态</option><option value="pending">待分类</option></select></label>}
      <label>每页显示<select name="pageSize" aria-label="每页条数" defaultValue={value("pageSize","20")}>{[20,50,100].map(x=><option key={x} value={x}>{x} 条</option>)}</select></label>
      <p className="hm-filter-note">日期按北京时间，包含起止日；填写日期后覆盖快捷范围。发布时间未知时采用来源发现时间。AIHOT排序仅展示AIHOT记录。</p>
    </div></details>
    <div className="hm-filter-bottom"><span>{active.length?`已选择 ${active.length} 项筛选`:"按需筛选，保留值得研究的内容"}{value("source") && <b> · {value("source")}</b>}{value("from") && <b> · 从 {value("from")}</b>}{value("to") && <b> · 至 {value("to")}</b>}</span><div className="hm-actions"><Link className="hm-button" to={events?monitorViewHref(monitorViewKey(sp)):"?mode="+mode}>重置</Link><button className="hm-primary">应用筛选</button></div></div>
  </Form>;
}
export function Pagination({ page, unit = "个事件", pageParam="page" }: { page: MonitorData["page"]; unit?: string; pageParam?:string }) {
  const [sp] = useSearchParams();
  const href=(n:number)=>"?"+new URLSearchParams({...Object.fromEntries(sp),[pageParam]:String(n)});
  return <nav className="hm-toolbar hm-pagination" aria-label="列表分页">
    <span className="hm-caption">{page.count} {unit} · 第 {page.number} / {page.total} 页 · 每页 {page.size} 条</span>
    <div className="hm-actions">
      {page.number>1 && <><Link className="hm-button" to={href(1)}>首页</Link><Link className="hm-button" to={href(page.number-1)}>上一页</Link></>}
      {page.number<page.total && <Link className="hm-button" to={href(page.number+1)}>下一页</Link>}
      <Form method="get" className="hm-page-jump">{[...sp].filter(([k])=>k!==pageParam).map(([k,v])=><input key={k} type="hidden" name={k} value={v}/>)}<label>跳至 <input aria-label="页码" name={pageParam} type="number" min="1" max={page.total} defaultValue={page.number} key={page.number}/></label><button>前往</button></Form>
    </div>
  </nav>;
}

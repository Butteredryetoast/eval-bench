import {SyncDialog} from "./sync-dialog.tsx";
import {InfoDialog} from "./info-dialog.tsx";
import {monitorView} from "./navigation.ts";
import {TopicExport} from "./topic-export.tsx";
import {useNavigate} from "react-router";
import { Filters, Pagination } from "./list-controls.tsx";
import { useState } from "react";
import {
  Form,
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { type MonitorData } from "../contracts.ts";
import {
  API,
  date,
  Empty,
  EventOrigin,
  Jobs,
  Panel,
  ProviderNote,
  EventActions,
  CandidateAction,
  LocalScoreTag,
  SelfScoreTag,
  Tag,
  useLiveRefresh,
  Workspace,
} from "./shared.tsx";
export async function loader({ request }: LoaderFunctionArgs) {
  const q=new URL(request.url).searchParams;
  if(["confirmed","bookmarked"].includes(q.get("state")??""))q.set("mode","all");
  if(!q.has("mode") && !q.has("state")) q.set("mode","priority");
  return adminGet<MonitorData>(request,API+"/overview?"+q);
}
export const meta:MetaFunction = ({location}) => [{title:monitorView(new URLSearchParams(location.search)).label+" · 热点监测"}];
export default function Monitor() {
  const data = useLoaderData<typeof loader>();
  useLiveRefresh(data.jobs);
  const [sp] = useSearchParams();
  const action = useAdminAction();
  const navigate=useNavigate();
  const [picked,setPicked]=useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const mode = sp.get("mode") ?? (sp.has("state") ? "all" : "priority");
  const view=monitorView(sp);
  const notices=data.jobs.some(j=>["failed","partial","unconfigured","waiting"].includes(j.status))||Boolean(data.coverage?.errors?.length)||Boolean(data.syncHealth?.missing);
  const pending=data.jobs.some(j=>["queued","running"].includes(j.status));
  return (
    <Workspace
      title={view.label}
      subtitle={view.description.split(/[：。]/)[0].slice(0,30)}
      annotation={<InfoDialog label="栏目说明" title={view.label+"说明"} description={view.description}><p className="hm-prose">{view.description}</p><Link to="/admin/monitor/rules#views">查看完整规则 →</Link></InfoDialog>}
      actions={
        <>
          <InfoDialog label="选题标准" title="猿大侠选题标准">
        <p className="hm-caption">优先：模型重大变化、AI办公与创作、能展示过程和效果的真实案例。苹果、手机、汽车、商业、游戏与职场需重大变化或真实体验。促销、配件、配色、例行修复和关注范围外消息不进入推荐；纯争议和预告先观察。</p>
        <p className="hm-caption">推荐候选由规则或编辑加入，进入后不会因低分自动移出；右下红色按钮可手动取消。评分不代表事实核验，原文入口和分数始终保留。</p>
<Link to="/admin/monitor/rules">评分权重与完整规则 →</Link></InfoDialog>
          <InfoDialog label={notices?"运行状态 · 需关注":pending?"运行状态 · 处理中":"运行状态"} title="同步与运行状态" warning={notices}>
      <ProviderNote providers={data.providers} />
      <div className="hm-meta">
        <span>{data.totals.events} 个事件</span>
        <span>{data.totals.confirmed} 个已确认选题</span>
        <span>{data.totals.cases} 条已保存案例</span>
        <span>{data.totals.sources} 个候选来源名称</span>
        <span>最新动态检查 {date(data.lastHead ?? data.lastSync)}</span><span>同步尝试 {date(data.lastSync)}</span>
      </div>
      {data.coverage && <p className="hm-caption">本轮核对 {data.coverage.checked ?? "—"} 篇上游动态，{data.coverage.pages ?? "—"} 页。{data.coverage.errors?.length ? "部分同步未完成："+data.coverage.errors.join("；") : "动态分页核对完成"}</p>}
      {data.syncHealth && <p className="hm-caption">上游最新页检查 {date(data.syncHealth.checkedAt)} · {data.syncHealth.count} 篇中未入库 {data.syncHealth.missing} 篇 · 上游最新发现 {date(data.syncHealth.newestDiscoveredAt)}。这是该次检查结果，不代表两次检查之间实时无遗漏。</p>}
      <Jobs jobs={data.jobs} inline/>
<p className="hm-caption">电脑需保持运行；休眠或关机后恢复会补收，不能保证期间实时采集。</p><div className="hm-actions"><Link to="/admin/monitor/feed?origin=aihot&sort=upstream&timeBy=discovered">AIHOT逐条核对 →</Link><Link to="/admin/monitor?mode=all&review=assistant&window=all">助理初标与理由 →</Link></div></InfoDialog>
          <button title="把你在公众号、X或其他平台找到的新闻链接加入热点台" onClick={() => setManual(!manual)}>手动添加新闻</button>

          <SyncDialog data={data}/>
        </>
      }
    >
      {manual && (
        <Panel title="添加你发现的线索">
          <Form
            className="hm-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const created = await action.run(
                "POST",
                API + "/events",
                {
                  title: f.get("title"),
                  url: f.get("url"),
                  summary: f.get("summary"),
                  source: f.get("source"),
                  publishedAt: f.get("publishedAt")
                    ? new Date(String(f.get("publishedAt"))).toISOString()
                    : null,
                },
                { success: "已加入线索池" },
              );
              if (created) setManual(false);
            }}
          >
            <div className="hm-form-row">
              <label>
                标题
                <input name="title" required maxLength={300} />
              </label>
              <label>
                原文链接
                <input name="url" type="url" required />
              </label>
            </div>
            <div className="hm-form-row">
              <label>
                来源
                <input name="source" defaultValue="人工提交" />
              </label>
              <label>
                原文发布时间
                <input type="datetime-local" name="publishedAt" />
              </label>
            </div>
            <label>
              摘要
              <textarea name="summary" />
            </label>
            <button className="hm-primary" disabled={action.busy}>
              加入线索池
            </button>
          </Form>
        </Panel>
      )}
      <Filters filters={data.filters} mode={mode}/>
      <div className="hm-topic-selection"><label><input type="checkbox" checked={data.events.length>0&&data.events.every(e=>picked.includes(e.id))} onChange={ev=>setPicked(ev.target.checked?[...new Set([...picked,...data.events.map(e=>e.id)])].slice(0,50):picked.filter(id=>!data.events.some(e=>e.id===id)))}/>勾选本页</label><span className="hm-caption">勾选后可复制或下载选题清单，跨页保留。</span></div>
      {!!picked.length&&<TopicExport ids={picked} onClear={()=>setPicked([])}/>}
      <Pagination page={data.page}/>
      <section className="hm-feed" aria-label="事件列表">
        {data.events.length ? (
          data.events.map((e) => (
            <article className="hm-feed-row hm-action-row" key={e.id} data-picked={picked.includes(e.id)}>
              <div>
                <div className="hm-meta">
                  <EventOrigin event={e} />
                  <Tag tone={e.field==="待归类"?"neutral":"field"}>{e.field}</Tag>
                  <Tag tone="type">{e.format}</Tag>
                  <span>{date(e.latestAt ?? e.publishedAt)}</span>
                  {e.chineseStatus === "translated" && <span title="详情可以查看翻译前原文">中文译文</span>}
                  {e.chineseStatus === "related" && <span title="同一事件已有中文报道，优先显示中文">中文报道</span>}
                  {e.chineseStatus === "pending" && <span>外文待翻译</span>}
                </div>
                <div className="hm-event-title"><input type="checkbox" aria-label={"勾选选题："+e.title} checked={picked.includes(e.id)} disabled={picked.length>=50&&!picked.includes(e.id)} onChange={ev=>setPicked(ev.target.checked?[...picked,e.id]:picked.filter(id=>id!==e.id))}/><h2><Link to={"/admin/monitor/events/"+e.id}>{e.title}</Link></h2></div>
                <p className="hm-summary">{e.summary}</p>
                {e.editorialReview && <p className="hm-caption">{e.editorialReview.by==="assistant"?"助理初标":"编辑标注"}：{e.editorialReview.reason}</p>}
                <div className="hm-badges">
                  {e.priority && <Tag tone={e.priority.rank===0?"selected":e.priority.rank===1?"warning":"neutral"} title={e.priority.reasons.join("；")}>{e.priority.label}</Tag>}
                  {e.aihotScore!==null && e.aihotScore!==undefined && <Tag tone="score" title="上游参考分，与本站独立评分分开">AIHOT参考 <b>{e.aihotScore}</b></Tag>}
                  {e.origins.includes("self") && <SelfScoreTag score={e.selfArticleScore}/>}
                  <LocalScoreTag event={e}/>
                  <span className="hm-source-count">{e.sourceCount}个来源</span>
                  {e.originalUrl&&<a className="hm-original-link" href={e.originalUrl} target="_blank" rel="noreferrer" title={e.originalSource}>查看原帖 ↗</a>}
                  {e.classification&&<span className="hm-state">{e.classification.category}</span>}
                  {e.confirmed && <span className="hm-state">已确认选题</span>}
                  {e.hotRank && (
                    <span className="hm-state">上游热榜第 {e.hotRank} 名</span>
                  )}
                </div>
              </div>
              <div className="hm-topic-tools"><button className="hm-primary" disabled={action.busy} title="确认准备研究这个选题，直接进入案例搜寻；此操作不发起付费搜索" onClick={async()=>{if(e.confirmed||await action.run("PATCH",API+"/events/"+e.id,{confirmed:true},{success:"已确认选题，开始收集案例"}))navigate("/admin/monitor/research?eventId="+e.id);}}>{e.confirmed?"继续找案例":"确定并找案例"}</button><EventActions event={e} modelReady={data.providers.model} jobs={data.jobs}/><CandidateAction event={e}/></div>
            </article>
          ))
        ) : (
          <Empty>
            {mode === "selected"
              ? "这里仅展示达到原有门槛的AI或人工评分事件。先到全部动态打开新闻，进行人工评分或接入模型。"
              : "当前条件下没有事件。可刷新新闻或手动添加新闻；历史资料请切换到全部与存档。"}
          </Empty>
        )}
      </section>
      <Pagination page={data.page}/>

    </Workspace>
  );
}

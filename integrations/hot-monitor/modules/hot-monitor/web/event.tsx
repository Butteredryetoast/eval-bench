import {useMemo,useState} from "react";
import {caseContext} from "./navigation.ts";
import {InfoDialog} from "./info-dialog.tsx";
import {
  Form,
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import {
  FIELDS,
  FORMATS,
  type Event,
  type Report,
  type Case,
  type Asset,
  type Experiment,
  type MonitorData,
  type Job,
} from "../contracts.ts";
import { ClassificationForm, ExperimentForm, ManualScore, AXES } from "./editor-forms.tsx";
import { API, date, EventOrigin, Jobs, Panel, Score, Workspace } from "./shared.tsx";
export async function loader({ request, params }: LoaderFunctionArgs) {
  return adminGet<{
    event: Event;
    reports: Report[];
    cases: Case[];
    assets: Asset[];
    experiments: Experiment[];
    providers: MonitorData["providers"];
    jobs: Job[];
  }>(request, API + "/events/" + params.id + new URL(request.url).search);
}
export const meta = () => [{ title: "选题详情 · 热点监测" }];
export default function Detail() {
  const {
    event: e,
    reports,
    cases,
    experiments,
    providers,
    jobs,
  } = useLoaderData<typeof loader>();
  const action = useAdminAction();
  const [sp] = useSearchParams();
  const [timelineOrder,setTimelineOrder]=useState(sp.get("order")==="desc"?"desc":"asc");
  const orderedReports=useMemo(()=>[...reports].sort((a,b)=>{
    if(!a.publishedAt!==!b.publishedAt)return a.publishedAt?-1:1;
    return (Date.parse(a.publishedAt??a.discoveredAt)-Date.parse(b.publishedAt??b.discoveredAt))*(timelineOrder==="desc"?-1:1)||a.id.localeCompare(b.id);
  }),[reports,timelineOrder]);
  return (
    <Workspace
      title="选题详情"
      subtitle="先核实事实，再决定是否值得写。"
      actions={
        <>
          <InfoDialog label={"事实报道与时间线（"+reports.length+"）"} title="事实报道与时间线">
            <p className="hm-caption">默认按原文发布时间从早到晚；未知发布时间的报道放在最后，标注发现时间。同一链接只展示一次，保留所有发现渠道。</p>
            <label className="hm-timeline-sort">报道顺序<select aria-label="时间线顺序" value={timelineOrder} onChange={ev=>setTimelineOrder(ev.target.value)}><option value="asc">最早报道在前</option><option value="desc">最新报道在前</option></select></label>
            <div className="hm-timeline">
              {orderedReports.map((r) => (
                <article key={r.id}>
                  <div className="hm-meta">
                    <span>{r.source}</span>
                    <span>{r.publishedAt ? "发布 " + date(r.publishedAt) : "发布时间待确认 · 发现 " + date(r.discoveredAt)}</span>
                    <span>
                      {(r.origins ?? [r.origin]).map(o=>o === "aihot" ? "AIHOT发现" : o === "self" ? "自采" : "人工").join(" / ")}
                    </span>
                    {!r.active && <span>已撤回或不可用</span>}
                  </div>
                  <h3>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>
                  </h3>
                  <p className="hm-summary">{r.summary}</p>
                  <p className="hm-caption">
                    AIHOT参考分：{r.upstreamScore ?? "—"}；自采文章评分：
                    {r.localScore ?? "—"}。事件评分单独计算。
                  </p>
                </article>
              ))}
            </div>
          </InfoDialog>
          <button disabled={action.busy} title="全体同事共享的选题收藏夹" onClick={()=>action.run("PATCH",API+"/events/"+e.id,{bookmarked:!e.bookmarked},{success:e.bookmarked?"已取消收藏":"已加入共享收藏"})}>{e.bookmarked?"★ 已收藏":"☆ 收藏选题"}</button>
          <Link className="hm-button" to="/admin/monitor">
            返回热点
          </Link>
          <Link title="勾选本次需要的案例，再下载文字交接单或素材包" className="hm-button hm-primary" to={"/admin/monitor/handoff"+caseContext(sp,e.id)}>整理与交接</Link>
        </>
      }
    >
      <Jobs jobs={jobs}/>
      <div className="hm-split">
        <div>
          <Panel>
            <div className="hm-meta">
              <EventOrigin event={e} />
              <span>{date(e.publishedAt)}</span>
              <span>{e.field}</span>
              <span>{e.format}</span>
            </div>
            <h2 className="hm-detail-title">{e.title}</h2>
            <p className="hm-prose">{e.summary}</p>
            {e.chineseStatus === "pending" && <p className="hm-caption">这条资讯仍含外文。模型接入后可自动翻译；产品名和版本会保留。</p>}
            {e.chineseStatus === "translated" && <details><summary>查看翻译前原文，便于核对</summary><p>{e.originalTitle}</p><p className="hm-prose">{e.originalSummary}</p></details>}
            <div className="hm-badges">
              <span className="hm-state">
                {e.confirmed ? "已确认选题" : "待选题"}
              </span>
              <span className="hm-state">
                {e.classification ? "已分类" : "待同事分类"}
              </span>
              <span className="hm-state">
                {cases.filter((c) => c.saved).length} 条已保存案例
              </span>
            </div>
          </Panel>
          <Panel title="选题标注（可修改）">
            <p className="hm-caption">{e.editorialReview ? (e.editorialReview.by==="assistant"?"助理初标":"编辑标注")+" · "+({select:"建议写",reject:"不建议写",observe:"观察"}[e.editorialReview.decision])+"："+e.editorialReview.reason : "还没有有效标注；素材更正后旧标注需重新核对。"} 标注不改AI分数，不等于已确认选题或已核验效果。</p>
            <InfoDialog label="修改选题标注" title="编辑选题标注">            <Form className="hm-form" onSubmit={async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);await action.run("PATCH",API+"/events/"+e.id,{editorialReview:{decision:f.get("decision"),reason:f.get("reason")}},{success:"已保存编辑标注"});}}>
              <label>是否值得写<select name="decision" defaultValue={e.editorialReview?.decision??"observe"}><option value="select">建议写</option><option value="observe">观察，先补材料</option><option value="reject">不建议写</option></select></label>
              <label>判断依据<textarea required name="reason" defaultValue={e.editorialReview?.reason??""}/></label><button disabled={action.busy}>保存选题标注</button>
            </Form>
</InfoDialog>
          </Panel>

          <div id="writing"><Panel title="分类与写作方向（可人工填写）">
            <ClassificationForm event={e}/>
            <details>
              <summary className="hm-inline-link">同事项目对接：导入分类JSON（高级）</summary>
              <Form
                className="hm-form"
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  try {
                    const v = JSON.parse(String(f.get("json")));
                    if (v.eventId !== e.id) {
                      alert("结果属于其他事件，请核对事件ID");
                      return;
                    }
                    await action.run("POST", API + "/classifications", v, {
                      success: "已接收分类结果",
                    });
                  } catch {
                    alert("请输入合法JSON");
                  }
                }}
              >
                <textarea
                  name="json"
                  aria-label="分类结果JSON"
                  defaultValue={JSON.stringify(
                    {
                      schemaVersion: 1,
                      eventId: e.id,
                      category: "评测体验",
                      angle: "",
                      researchRequirements: [],
                    },
                    null,
                    2,
                  )}
                />
                <button disabled={action.busy}>导入分类</button>
              </Form>
            </details>
          </Panel>
          </div>
          <InfoDialog label={"自测与复现（"+experiments.length+"）"} title="自测与复现结果">
            <ExperimentForm event={e}/>
            {experiments.length ? (
              experiments.map((x) => (
                <article key={x.experimentId}>
                  <strong>{x.version}</strong>
                  <p className="hm-prose">{x.conclusion}</p>
                  <p className="hm-caption">环境：{x.environment}</p>
                </article>
              ))
            ) : (
              <p className="hm-caption">
                还没有团队自测。第三方演示不会自动标记成已复现。
              </p>
            )}
            <details>
              <summary className="hm-inline-link">同事项目对接：导入自测JSON（高级）</summary>
              <Form
                className="hm-form"
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  try {
                    const v = JSON.parse(
                      String(new FormData(ev.currentTarget).get("json")),
                    );
                    if (v.eventId !== e.id) {
                      alert("结果属于其他事件，请核对事件ID");
                      return;
                    }
                    await action.run("POST", API + "/experiments", v, {
                      success: "已接收自测结果",
                    });
                  } catch {
                    alert("请输入合法JSON");
                  }
                }}
              >
                <textarea
                  name="json"
                  aria-label="自测结果JSON"
                  defaultValue={JSON.stringify(
                    {
                      schemaVersion: 1,
                      experimentId: "experiment-" + e.id,
                      eventId: e.id,
                      version: e.version ?? "",
                      environment: "",
                      input: "",
                      output: "",
                      conclusion: "",
                    },
                    null,
                    2,
                  )}
                />
                <button disabled={action.busy}>导入自测</button>
              </Form>
            </details>
          </InfoDialog>
        </div>
        <aside>
          <Panel title="猿大侠选题判断">
            {e.priority && <><strong>免费规则初排：{e.priority.label}</strong><p className="hm-caption">{e.priority.reasons.join("；")}。这是线索排序，不是AI判断或事实核验。</p></>}
            {e.aihotScore!==null && e.aihotScore!==undefined && <p className="hm-caption">AIHOT参考分：{e.aihotScore}。仅作上游参考，不覆盖猿大侠评分。</p>}
            <Score event={e} />
            <p className="hm-caption">{e.scoreReason}</p>
            {e.scoreAxes && <dl className="hm-score-axes">{AXES.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{(e.scoreAxes!.reduce((s,a)=>s+(a[key]??0),0)/e.scoreAxes!.length).toFixed(1)} / 10</dd></div>)}</dl>}
            <p className="hm-caption">当前精选门槛：{e.scoreThreshold}分。评分只辅助筛选；确定选题仍由你决定。</p>
            <button
              title="调用已配置模型独立评两次，并尽量把外文标题摘要翻译成中文"
              disabled={action.busy || !providers.model || e.scoreMethod === "manual"}
              onClick={() =>
                action.run(
                  "POST",
                  API + "/events/" + e.id + "/score",
                  {},
                  { success: "已安排两次独立评分" },
                )
              }
            >
              AI翻译与评分
            </button>
            <button title="只把外文标题和摘要翻译为中文并保存，不进行两次评分" disabled={action.busy || !providers.model || e.chineseStatus!=="pending"} onClick={()=>action.run("POST",API+"/events/"+e.id+"/translate",{},{success:"已安排中文标题摘要翻译"})}>只翻译中文，不评分</button>
            {e.scoreMethod === "manual" && <p className="hm-caption">当前保留人工评分，AI复评不会覆盖它。需要调整时可直接修改下方人工分数。</p>}
            {!providers.model && <p className="hm-caption">尚未填写模型API凭证，AI评分与翻译未启用；下方人工评分现在就能使用。</p>}
            <ManualScore event={e}/>
            <hr className="my-4 border-line" />
            <div className="hm-actions">
              <button
                title="标记准备写或继续研究这件事，随后可以搜索案例；不会发布文章"
                className="hm-primary"
                disabled={action.busy}
                onClick={() =>
                  action.run(
                    "PATCH",
                    API + "/events/" + e.id,
                    { confirmed: !e.confirmed },
                    { success: e.confirmed ? "已取消选题" : "已确认选题" },
                  )
                }
              >
                {e.confirmed ? "取消选题" : "确定选题"}
              </button>
              {e.confirmed && (
                <Link
                  className="hm-button"
                  to={"/admin/monitor/research"+caseContext(sp,e.id)}
                >
                  寻找案例
                </Link>
              )}
            </div>
          </Panel>
          <Panel title="核对研究范围">
            <Form
              className="hm-form"
              onSubmit={async (ev) => {
                ev.preventDefault();
                const f = new FormData(ev.currentTarget);
                await action.run(
                  "PATCH",
                  API + "/events/" + e.id,
                  {
                    product: f.get("product"),
                    version: f.get("version") || null,
                    field: f.get("field"),
                    format: f.get("format"),
                    aliases: String(f.get("aliases"))
                      .split(/[,，\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                  { success: "已更新研究范围" },
                );
              }}
            >
              <label>
                产品或主体
                <input
                  name="product"
                  defaultValue={e.product}
                  placeholder="例如 DeepSeek"
                />
              </label>
              <label>
                精确版本
                <input
                  name="version"
                  defaultValue={e.version ?? ""}
                  placeholder="未经确认请留空"
                />
              </label>
              <label>
                别名与搜索词
                <textarea name="aliases" defaultValue={e.aliases.join("\n")} />
              </label>
              <label>
                关注领域
                <select name="field" defaultValue={e.field}>
                  {!FIELDS.includes(e.field as any) && <option value={e.field}>待归类（请选领域）</option>}
              {FIELDS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                内容类型
                <select name="format" defaultValue={e.format}>
                  {FORMATS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <button disabled={action.busy}>保存范围</button>
            </Form>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}

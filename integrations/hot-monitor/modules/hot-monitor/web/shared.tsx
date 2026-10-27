import {InfoDialog} from "./info-dialog.tsx";
import { useEffect } from "react";
import {caseContext} from "./navigation.ts";
import { Link, useRevalidator,useSearchParams } from "react-router";
import type { Case, Event, Job, Asset } from "../contracts.ts";
import {CASE_PLATFORM_LABELS,casePlatform,caseGaps,CASE_GAP_LABELS} from "../contracts.ts";
import { useAdminAction } from "@aihot/web/features/admin/action";
import "./monitor.css";
import { Guide } from "./guide.tsx";
export const API = "/api/admin/monitor";
export const date = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Taipei",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(s))
    : "日期待确认";
export const ORIGIN = {
  aihot: "AIHOT发现",
  self: "自采发现",
  manual: "人工提交",
};
// Read-only refresh; it never submits work or calls a model. Keep in-progress input intact.
export function useLiveRefresh(jobs:Job[]=[]) {
  const revalidator=useRevalidator();
  const pending=jobs.some(j=>["score","translate","sync"].includes(j.kind)&&["queued","running"].includes(j.status));
  useEffect(()=>{
    const refresh=()=>{
      if(document.visibilityState!=="visible" || (!pending&&document.activeElement?.matches("input,textarea,select,[contenteditable=true]")) || revalidator.state!=="idle") return;
      void revalidator.revalidate();
    };
    const timer=setInterval(refresh,pending?2000:60000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[revalidator,pending]);
}
export function Tag({children,tone="neutral",title}:{children:React.ReactNode;tone?:"neutral"|"field"|"type"|"origin"|"selected"|"score"|"warning";title?:string}) {
  return <span className="hm-tag" data-tone={tone} title={title}>{children}</span>;
}
export function EventOrigin({ event }: { event: Event }) {
  return (
    <Tag tone="origin" title="这里标记发现新闻的渠道，不是独立事实证据的数量。同一事件可同时被AIHOT和本机自采收录。">
      {event.origins.includes("aihot") && event.origins.includes("self")
        ? "AIHOT + 自采"
        : event.origins.map((o) => ORIGIN[o]).join(" / ") || "上游待刷新"}
    </Tag>
  );
}
export function Workspace({
  title,
  subtitle,
  actions,
  children,
  annotation,
}: {
  annotation?: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="hm-workspace">
      <header className="hm-heading">
        <div>
          <div className="hm-title-line"><h1>{title}</h1>{subtitle&&<span className="hm-title-note">{subtitle}</span>}{annotation}</div>
        </div>
        <div className="hm-actions hm-heading-actions">{actions}<Guide /></div>
      </header>
      {children}
    </div>
  );
}
export function Panel({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="hm-panel">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="hm-empty">{children}</div>;
}
export function ProviderNote({
  providers,
}: {
  providers: {
    wechat: boolean;
    x: boolean;
    model: boolean;
    collecting: boolean;
  };
}) {
  return (
    <div className="hm-providers">
      <span>
        公众号 <b>{providers.wechat ? "已配置" : "待配置"}</b>
      </span>
      <span>
        X自动检索 <b>{providers.x ? "已配置" : "待配置"}</b>
      </span>
      <span>
        AI评分与翻译 <b>{providers.model ? "已配置 · 按需调用" : "缺少模型凭证"}</b>
      </span>
      <span>
        自动采集 <b>{providers.collecting ? "已开启" : "未开启"}</b>
      </span>
      {!providers.model && <span className="hm-caption">免费规则初排、AIHOT参考分和人工评分可直接使用；AI只在你点击时付费复评。</span>}
    </div>
  );
}
export function Jobs({ jobs,inline=false }: { jobs: Job[];inline?:boolean }) {
  const revalidate = useRevalidator();
  const waiting = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if(document.visibilityState==="visible"&&revalidate.state==="idle")void revalidate.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, revalidate]);
  if (!jobs.length) return null;
  const content=<div className="hm-job-list">      {jobs.slice(0, 5).map((j) => (
        <p key={j.id}>
          <span
            className={
              "hm-state " + (j.status === "failed" ? "hm-warning" : "")
            }
          >
            {
              {
                queued: "等待处理",
                waiting: "等待预算",
                running: "处理中",
                completed: "已完成",
                partial: "部分完成",
                failed: "失败",
                unconfigured: "待配置",
              }[j.status]
            }
          </span>
          {j.message}
          <time>{date(j.updatedAt)}</time>
        </p>
      ))}</div>;
  if(inline)return content;
  const issue=jobs.some(j=>["failed","partial","unconfigured","waiting"].includes(j.status));
  return <InfoDialog label={waiting?"任务处理中":issue?"任务需关注":"处理记录"} title="后台任务记录" warning={issue}>{content}</InfoDialog>;
}

export function LocalScoreTag({event}:{event:Pick<Event,"score"|"scoreStatus"|"scoreMethod">}) {
  return event.scoreStatus==="scored" && event.score!==null
    ? <Tag tone="score" title="猿大侠对事件的独立评分，与上游参考分、自采文章分分别保存">{event.scoreMethod==="manual"?"本站人工评分":"本站AI评分"} <b>{event.score}</b></Tag>
    : <Tag tone={event.scoreStatus==="failed"?"warning":"neutral"}>{event.scoreStatus==="failed"?"本站评分失败":"本站待评分"}</Tag>;
}
export function SelfScoreTag({score}:{score:number|null|undefined}) {
  if(score==null) return null;
  return <Tag tone="score" title="自采文章在框架精选流程中的评分；事件聚合时显示最高分，不替代事件独立评分">自采文章评分 <b>{score}</b></Tag>;
}
export function EventActions({event,modelReady,jobs}:{event:Pick<Event,"id"|"scoreMethod">;modelReady:boolean;jobs:Job[]}) {
  const action=useAdminAction();
  const pending=jobs.find(j=>j.eventId===event.id && ["score","translate"].includes(j.kind) && ["queued","running"].includes(j.status));
  const latest=jobs.filter(j=>j.eventId===event.id&&["score","translate"].includes(j.kind)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const failed=!pending&&latest&&["failed","waiting","unconfigured"].includes(latest.status)?latest:undefined;
  return <aside className="hm-row-tools" aria-label="本条资讯操作">
    <div className="hm-inline-actions">
      <button type="button" disabled={action.busy||!modelReady||!!pending} title={modelReady?"按需翻译此事件的外文标题和摘要；已有中文时不重复调用模型":"模型待配置，请先填写模型凭证"} onClick={()=>action.run("POST",API+"/events/"+event.id+"/translate",{},{success:"已安排本条资讯翻译"})}>{pending?.kind==="translate"?"翻译中…":"翻译"}</button>
      <button type="button" className="hm-primary" disabled={action.busy||!modelReady||!!pending||event.scoreMethod==="manual"} title={event.scoreMethod==="manual"?"保留已有人工评分；请进入详情调整":modelReady?"按需对本事件独立AI评分两次，结果写入本站评分标签；会消耗模型额度":"模型待配置，请先填写模型凭证"} onClick={()=>action.run("POST",API+"/events/"+event.id+"/score",{},{success:"已安排本条资讯AI评分"})}>{pending?.kind==="score"?"评分中…":"打分"}</button>
    </div>
    <small className={failed?"hm-warning":undefined} role={failed?"status":undefined}>{pending?pending.kind==="score"?"正在准备材料并评分":"正在准备材料并翻译":failed?failed.message:!modelReady?"模型待配置":event.scoreMethod==="manual"?"已有人工评分":"按需调用模型"}</small>
  </aside>;
}
export function CandidateAction({event}:{event:Pick<Event,"id"|"candidate"|"priority">}) {
  const action=useAdminAction();
  const included=event.candidate?event.candidate.status==="active":event.priority?.rank===0;
  return <button type="button" className={included?"hm-candidate-remove":"hm-candidate-restore"} disabled={action.busy} title={included?"手动移出推荐候选；保留分数、原文、案例和全部事件记录":"加入推荐候选，之后不会因评分低于门槛而自动移出"} onClick={()=>action.run("POST",API+"/events/"+event.id+"/candidate",{included:!included},{success:included?"已取消候选，原文与分数仍可在全部事件查看":"已加入推荐候选，等待人工取舍"})}>{included?"取消候选":"加入候选"}</button>;
}
export function Score({ event }: { event: Event }) {
  return (
    <div className="hm-score">
      {event.scoreStatus === "scored" ? (
        <>
          <strong>{event.score}</strong>
          <span>{event.scoreMethod === "manual" ? "人工评分" : "AI评分"}</span>
        </>
      ) : (
        <>
          <span className="hm-score-empty">待评分</span>
          <span>
            {event.scoreStatus === "unconfigured"
              ? "待评分 · 可人工评"
              : event.scoreStatus === "failed"
                ? "评分失败"
                : "待独立评分"}
          </span>
        </>
      )}
    </div>
  );
}
export function CaseCriteria({saved=false,inline=false}:{saved?:boolean;inline?:boolean}) {
  const content=<section className="hm-view-explanation" aria-label="案例入选说明"><strong>{saved?"这些案例怎样进入素材库？":"候选案例怎样产生？"}</strong><p>{saved?"来自编辑手动保存的链接、批量勾选后直接保存的材料，或从检索候选中点击“收入案例库”的材料。保存仅代表值得继续研究，不会自动标成作者实测、效果有效或团队复现。":"围绕已确认选题检索公众号/X、打开平台搜索或粘贴链接；编辑可勾选直接存入案例库，也可先放候选，按原文链接去重。外部脚本结果始终先进入候选。当前没有按效果好坏自动评分；搜索意图也不等于已验证的案例类型。"} 保存后自动提取原标题、作者、封面和摘要。优先读取公开页面；公众号受限时使用已配置的极致了接口，按原有预算和回执计费。采用前仍需核对版本、原作者、输入条件、完整输出与失败边界。</p><Link to="/admin/monitor/rules#cases">查看搜寻词、时间范围、实际参数和采用标准 →</Link></section>;
  return inline?content:<InfoDialog label={saved?"材料标准":"案例标准"} title={saved?"案例入库与采用标准":"候选案例的产生与核对"}>{content}</InfoDialog>;
}
export function CaseCard({
  item,
  assets = [],
}: {
  item: Case;
  assets?: Asset[];
}) {
  const action = useAdminAction();
  const [sp]=useSearchParams();
  const context=sp.get("eventId")===item.eventId?caseContext(sp,item.eventId):"";
  const thumbnail = assets.find(
    (a) => a.caseId === item.id && a.mime.startsWith("image/"),
  );
  const remotePoster = item.media.find(
    (m) => m.kind === "image" || m.kind === "poster",
  );
  const extracting=item.metadata?.status==="queued";
  const poster = item.metadata?.coverUrl ?? (thumbnail
    ? API + "/assets/" + thumbnail.id
    : remotePoster?.url);
  return (
    <article className="hm-case-card">
      {poster ? (
        <img
          className="hm-case-image"
          src={poster}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="hm-case-placeholder">
          {CASE_PLATFORM_LABELS[casePlatform(item.url)]}案例
        </div>
      )}
      <div className="hm-case-content">
        <div className="hm-meta">
          <span>{item.author || "作者待核对"}</span>
          <span>{date(item.publishedAt)}</span>
        </div>
        <h3>
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        </h3>
        <div className="hm-badges">
          <span className="hm-state">{CASE_PLATFORM_LABELS[casePlatform(item.url)]}</span>
          {item.captureMethod&&<span className="hm-state">{{api:"API搜索",manual:"手动保存",batch:"批量收集",external:"脚本导入",browser:"浏览器采集"}[item.captureMethod]}</span>}
          <span
            className={
              "hm-state " +
              (item.verification === "mismatch" ? "hm-warning" : "")
            }
          >
            {
              {
                pending: "版本待确认",
                matched: "版本字符串匹配",
                mismatch: "版本不一致",
              }[item.verification]
            }
          </span>
          <span className="hm-state">
            {
              {
                unknown: "实测身份待核对",
                author_test: "作者实测",
                repost: "转述",
              }[item.evidence]
            }
          </span>
          {item.reviewed && <span className="hm-state">已人工检查</span>}
        </div>
        <p className="hm-caption">{item.searchIntent&&item.searchIntent!=="keywords" ? "检索意图："+({keywords:"仅关键词",example:"实践与创作",comparison:"对比评测",failure:"失败与限制"}[item.searchIntent])+"（尚未核实类型）" : "材料仍需人工核对"} · {item.saved?"编辑已保存":"已收集，待挑选"}</p>
        {item.metadata&&<div className="hm-case-extraction" data-state={item.metadata.status} role={extracting?"status":undefined}><span>{{queued:"正在提取原文信息…",ready:"原文信息已提取",partial:"已提取部分原文信息",failed:"原文信息提取失败"}[item.metadata.status]}</span>{item.metadata.method==="browser"&&<small>从当前网页提取</small>}{item.metadata.method==="wechat_api"&&<small>公众号接口补全 · 按原采集预算计费</small>}{item.metadata.error&&<p>{item.metadata.error}</p>}</div>}
        <p className="hm-summary">
          {item.summary || (extracting?"正在读取原文标题、作者、封面和摘要，请稍候。":item.metadata?.status==="failed"?"公开页面暂时无法读取，可打开原文，或稍后重新提取。":"公开页面尚未提供可用摘要，可先打开原文；需要时可手动修正信息。")}
        </p>
        {item.versionEvidence && (
          <p className="hm-caption">{item.versionEvidence}</p>
        )}
        <details className="hm-data-note"><summary>材料核对：{caseGaps(item,assets).length}项待补或待核验</summary><ul>{caseGaps(item,assets).map(k=><li key={k}>{CASE_GAP_LABELS[k]}</li>)}</ul><p className="hm-caption">仅检查已填字段和本机附件，不是质量分。填写完整不等于真实有效，作者实测也不等于团队复现；文字案例可忽略附件项。{item.media.length>0&&!assets.some(a=>a.caseId===item.id)?"已有媒体链接仍不算本机归档文件。":""}</p></details>
        <div className="hm-actions">
          <button
            disabled={action.busy}
            onClick={() =>
              action.run(
                "PATCH",
                API + "/cases/" + item.id,
                { saved: !item.saved },
                { success: item.saved ? "已移出案例库" : "已收入案例库" },
              )
            }
          >
            {item.saved ? "移出案例库" : "收入案例库"}
          </button>
          <button type="button" disabled={action.busy||extracting} title="自动提取原标题、作者、封面和摘要；公众号页面受限时使用已配置接口，按请求计费，不调用AI" onClick={()=>action.run("POST",API+"/cases/"+item.id+"/hydrate",{mode:"public"},{success:"已安排原文信息提取，后台完成后自动更新"})}>{extracting?"提取中…":"重新提取信息"}</button>
          {casePlatform(item.url)==="wechat"&&<button type="button" disabled={action.busy} title="通过公众号接口读取正文，可能产生接口费用；不会自动下载视频" onClick={()=>action.run("POST",API+"/cases/"+item.id+"/hydrate",{mode:"full"},{success:"已安排公众号正文读取；可能消耗采集接口额度"})}>读取公众号正文（付费）</button>}
          <Link to={"/admin/monitor/events/" + item.eventId+context}>查看选题</Link>
        </div>
      </div>
    </article>
  );
}

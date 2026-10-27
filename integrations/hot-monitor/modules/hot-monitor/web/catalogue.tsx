import { useState } from "react";
import {
  Form,
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { FIELDS, SOURCE_METHODS, sourcePlatform, type Candidate, type CatalogueData, type CatalogueGroup } from "../contracts.ts";
import { API, date, Panel, ProviderNote, Workspace, Jobs, Empty } from "./shared.tsx";
import { SourceCreate } from "./source-create.tsx";
import { Pagination } from "./list-controls.tsx";
import { SourceMethods, ExternalPush } from "./source-methods.tsx";
export async function loader({ request }: LoaderFunctionArgs) {
  return adminGet<CatalogueData>(request, API+"/catalogue"+new URL(request.url).search);
}
export const meta = () => [{ title: "来源目录 · 热点监测" }];
function Source({ source: c }: { source: Candidate }) {
  const action = useAdminAction();
  const [kind,setKind]=useState(c.kind);
  const status = {
    candidate: c.kind==="external"?"等待有效推送与核验":"候选，未试采",
    verified: "已验证入口",
    collectable: "已接入采集",
    active: "近期有产出",
  }[c.status];
  return (
    <article className="hm-source-row">
      <div className="hm-source-title">
        <strong>{c.name}</strong>
        <span className="hm-state">{status}</span>
        {c.priority && <span className="hm-state">优先核验</span>}
        {c.handle && <span className="hm-caption">@{c.handle}</span>}
      </div>
      <div className="hm-badges"><span className="hm-state">{sourcePlatform(c)}</span><span className="hm-state">{SOURCE_METHODS.find(x=>x.kind===c.kind)?.label??"采集方式待确认"}</span><span className="hm-state">{c.sourceRole}</span>{c.fields?.length ? c.fields.map(f=><span className="hm-state" key={f}>{f}</span>) : <span className="hm-state">领域待分类</span>}</div>
      <p className="hm-caption">{c.classificationMethod === "manual" ? "已人工分类" : "标签为建议分类，可展开下方手动修改"}{c.sourceId ? ` · ${c.enabled ? c.awaitingActivation?"隔离接收推送，待核验启用":c.kind==="external"?"正在接收推送":"正在采集" : "已暂停"} · 近7天取得${c.recentCount??0}条文章` : ""}</p>
      <details><summary>账号、别名与入口信息</summary><p className="hm-caption">目录ID：{c.id} · 采集配置ID：{c.sourceId??"未接入"}</p><p className="hm-caption">别名：{c.aliases?.join("；")||"暂无已确认别名"}</p><p className="hm-caption">账号或检索式：{c.handle?"@"+c.handle:String(c.config?.ghid??c.config?.query??"待核验")}</p><p className="hm-caption">采集方式：{c.kind}；入口：{String(c.config?.feedUrl??c.config?.url??c.originalExample??"待核验")}</p></details>
      {c.lastTestError && (
        <p className="hm-caption hm-warning">{c.lastTestError}</p>
      )}
      {c.verifiedAt && (
        <p className="hm-caption">验证时间：{date(c.verifiedAt)}</p>
      )}
      <div className="hm-actions">
        {c.example && (
          <a
            className="hm-inline-link"
            href={c.example}
            target="_blank"
            rel="noreferrer"
          >
            查看发现依据
          </a>
        )}
        {c.originalExample && (
          <a
            className="hm-inline-link"
            href={c.originalExample}
            target="_blank"
            rel="noreferrer"
          >
            原文示例
          </a>
        )}
        {c.sourceId && !c.awaitingActivation && (
          <button title="只控制后续采集，不删除已经发现的新闻和素材" disabled={action.busy} onClick={()=>action.run("POST",API+"/catalogue/"+c.id+"/enabled",{enabled:!c.enabled},{success:c.enabled?"已暂停后续采集":"已恢复采集"})}>{c.enabled?"暂停采集":"恢复采集"}</button>
        )}
      </div>
      <details className="hm-editor-form"><summary>修改这个来源的分类</summary><Form className="hm-form" key={JSON.stringify([c.fields,c.sourceRole])} onSubmit={async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);await action.run("PATCH",API+"/catalogue/"+c.id+"/classification",{fields:f.getAll("field"),sourceRole:f.get("role")},{success:"来源分类已保存"});}}>
        <fieldset><legend>关注领域（可多选）</legend><div className="hm-source-fields">{FIELDS.map(f=><label key={f}><input type="checkbox" name="field" value={f} defaultChecked={c.fields?.includes(f)}/>{f}</label>)}</div></fieldset>
        <label>来源角色<select name="role" defaultValue={c.sourceRole??"待分类"}>{["官方一手","媒体","个人创作者","社区与综合","待分类"].map(r=><option key={r}>{r}</option>)}</select></label>
        <button disabled={action.busy}>保存来源分类</button>
      </Form></details>
      <details>
        <summary>{c.kind==="external"?"外部推送：查看接入示例与核验收到的文章":"试采与接入：确认这个来源能否取得文章"}</summary>
        <Form
          className="hm-form mt-3"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const f = new FormData(ev.currentTarget);
            let config:Record<string,unknown>=kind==="external"?{}:{...(c.config??{})};
            try {
              const advanced=String(f.get("config")??"").trim();
              if(advanced) config=JSON.parse(advanced);
              else if(kind==="rss" && f.get("feedUrl"))config.feedUrl=String(f.get("feedUrl"));
              else if(kind==="mp_account" && f.get("ghid"))config.ghid=String(f.get("ghid"));
              else if(kind==="x_search")Object.assign(config,{query:String(f.get("query")||(c.handle?"from:"+c.handle+" -filter:replies":"")),searchType:"Latest"});
            } catch {
              alert("采集配置必须为合法JSON");
              return;
            }
            await action.run(
              "POST",
              API + "/catalogue/" + c.id + "/check",
              {
                kind: f.get("kind"),
                config,
                tier: f.get("tier"),
                activate: f.get("activate") === "on",
              },
              { success: kind==="external"?"已安排核验收到的推送，结果可在运行记录和此目录查看":"已安排试采，结果可在运行记录和此目录查看" },
            );
          }}
        >
          <div className="hm-form-row">
            <label>
              采集类型
              <select
                name="kind"
                value={kind} onChange={ev=>setKind(ev.target.value)}
              >
                <option value="unknown">仅登记，待选择可用采集方式</option>
                {SOURCE_METHODS.map(x=><option key={x.kind} value={x.kind}>{x.label}（{x.kind}）</option>)}
              </select>
            </label>
            <label>
              来源分级
              <select name="tier" defaultValue={c.tier ?? "T2"}>
                <option value="T2">媒体或个人</option>
                <option value="T1_5">官方账号</option>
                <option value="T1">官方一手</option>
              </select>
            </label>
          </div>
          {kind==="rss"&&<label>RSS订阅地址<input name="feedUrl" type="url" defaultValue={String(c.config?.feedUrl??"")} placeholder="https://example.com/feed"/><span className="hm-caption">这是订阅入口，不是某一篇文章的链接。留空时会尝试从原文示例寻找订阅。</span></label>}
          {kind==="mp_account"&&<label>公众号原始ID（有的话填写）<input name="ghid" defaultValue={String(c.config?.ghid??"")} placeholder="gh_...；不知道可留空"/><span className="hm-caption">已有原文示例时，可尝试自动识别。</span></label>}
          {kind==="x_search"&&<label>X检索式<input name="query" defaultValue={String(c.config?.query??(c.handle?"from:"+c.handle+" -filter:replies":""))} placeholder="from:账号 -filter:replies"/></label>}
          {kind==="external"&&(c.sourceId&&c.kind!=="external"?<p className="hm-warning">这个入口已经接入其他采集方式，请另行添加一个外部脚本来源，避免混用采集配置。</p>:<ExternalPush id={c.sourceId??c.id} name={c.name}/>)}
          {kind!=="external"&&<details><summary>高级采集配置（通常不用填）</summary><label>
            仅网页列表或JSON接口等特殊入口需要JSON配置
            <textarea
              name="config"
              defaultValue=""
              placeholder={JSON.stringify(c.config??{},null,2)}
            />
          </label></details>}
          {kind==="unknown"&&<p className="hm-caption">当前只登记了入口。先选择并配置可用的采集方式；没有接口时保持候选，可先手动收集案例。</p>}
          {kind!=="external"&&<p className="hm-caption">
            公众号可通过已有原文示例识别原始ID；X需要对应服务配置。仅在取得带日期的有效条目后验证成功。
          </p>}
          <label className="hm-form-row">
            <input name="activate" type="checkbox" />
            {kind==="external"?"验证成功后启用，纳入本站自采同步":"验证成功后启用采集"}
          </label>
          <button title={kind==="external"?"只核验数据库实际收到的文章，不替脚本抓取内容，也不调用模型":"请求来源取得少量文章用于验证；公众号和X可能产生接口费用"} disabled={action.busy||kind==="unknown"||Boolean(kind==="external"&&c.sourceId&&c.kind!=="external")}>{kind==="external"?"核验已收到的推送":"测试是否能采集"}</button>
        </Form>
      </details>
    </article>
  );
}
function PlatformGroup({group,expanded}:{group:CatalogueGroup;expanded:boolean}) {
  const [open,setOpen]=useState(expanded);
  const [loaded,setLoaded]=useState(expanded);
  return <details aria-label={group.platform+"来源分组"} className="hm-platform-group" open={open} onToggle={ev=>{const next=ev.currentTarget.open;setOpen(next);if(next)setLoaded(true);}}>
    <summary><strong>{group.platform}</strong><span>{group.total} 个符合条件的来源</span><span className="hm-platform-disclosure">{open?"收起":"展开"}</span></summary>
    {loaded && <div className="hm-platform-body"><Pagination page={group.page} pageParam={group.pageParam} unit="个来源"/><div className="hm-feed">{group.sources.map(c=><Source key={c.id} source={c}/>)}</div><Pagination page={group.page} pageParam={group.pageParam} unit="个来源"/></div>}
  </details>;
}
export default function Catalogue() {
  const d=useLoaderData<typeof loader>();const [sp]=useSearchParams();
  const filtersKey=["q","platform","kind","status","connection","field","role"].map(k=>sp.get(k)??"").join("|");
  return <Workspace title="来源目录" subtitle="按平台查找、登记、核验来源；每个平台独立折叠和翻页。" actions={<Link className="hm-button" to="/admin/monitor/connections">API配置 →</Link>}>
    <div id="add-source"><SourceCreate/></div>
    <SourceMethods/>
    <div className="hm-source-stats"><span>目录来源 <b>{d.totals.all}</b></span><span>符合筛选 <b>{d.totals.matched}</b></span><Link to="?connection=connected" aria-label="查看已接入来源">采集配置已接入 <b>{d.totals.connected}</b></Link><Link to="?connection=enabled" aria-label="查看启用中的来源">启用中 <b>{d.totals.enabled}</b></Link><Link to="?status=active" aria-label="查看近期活跃来源">近7天有产出且启用 <b>{d.totals.active}</b></Link></div>
    <details className="hm-data-note"><summary>这些数量怎样统计？</summary><p>{d.note}</p><p>总数按归一化后的来源入口计数，不等于独立发布方数量；已接入、启用和活跃按采集配置ID去重。近期产出只统计本站实际采集的文章，不把AIHOT转载当成本机自采成功。</p><ProviderNote providers={d.providers}/><Link to="/admin/monitor/rules#platforms">查看各平台接入能力与验证标准 →</Link></details>
    <Jobs jobs={d.jobs}/>
    <Panel><Form method="get" className="hm-catalogue-filters" key={filtersKey+sp.get("pageSize")}>
      <label>搜索来源<input aria-label="搜索来源" name="q" placeholder="名称、别名、账号、ID或入口地址" defaultValue={sp.get("q")??""}/></label>
      <label>平台<select aria-label="来源平台" name="platform" defaultValue={sp.get("platform")??""}><option value="">全部平台（{d.totals.all}）</option>{d.platforms.filter(p=>p.count).map(p=><option key={p.name} value={p.name}>{p.name}（{p.count}）</option>)}</select></label>
      <label>验证状态<select name="status" aria-label="来源验证状态" defaultValue={sp.get("status")??""}><option value="">全部状态</option><option value="candidate">待验证候选</option><option value="verified">已验证入口</option><option value="collectable">已接入采集</option><option value="active">近期有产出</option></select></label>
      <label>采集方式<select name="kind" aria-label="来源采集方式" defaultValue={sp.get("kind")??""}><option value="">全部方式</option>{SOURCE_METHODS.map(x=><option key={x.kind} value={x.kind}>{x.label}（{x.kind}）</option>)}<option value="unknown">仅登记，待核验</option></select></label>
      <label>关注领域<select name="field" aria-label="来源领域" defaultValue={sp.get("field")??""}><option value="">全部领域</option>{[...FIELDS,"待分类"].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>采集状态<select name="connection" aria-label="来源采集状态" defaultValue={sp.get("connection")??""}><option value="">全部接入情况</option><option value="unconnected">尚未接入</option><option value="connected">已接入配置</option><option value="enabled">启用中</option><option value="paused">已暂停</option></select></label>
      <label>来源角色<select name="role" aria-label="来源角色" defaultValue={sp.get("role")??""}><option value="">全部角色</option>{["官方一手","媒体","个人创作者","社区与综合","待分类"].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>每组每页<select name="pageSize" aria-label="来源每页条数" defaultValue={sp.get("pageSize")??"20"}>{[20,50,100].map(n=><option key={n} value={n}>{n} 个</option>)}</select></label>
      <div className="hm-actions"><button className="hm-primary">查找来源</button><Link className="hm-button" to="/admin/monitor/catalogue">清空筛选</Link></div>
    </Form></Panel>
    <p className="hm-caption">点击平台栏展开；每组有独立页码。搜索匹配名称、别名、账号、ID和入口地址；修改筛选会回到各组首页。来源只登记后不会发起采集，试采成功后才可启用。</p>
    {d.groups.length?d.groups.map(g=><PlatformGroup key={g.platform+filtersKey} group={g} expanded={Boolean(sp.get("q")||sp.get("platform")||sp.get("kind")||sp.get("connection")||sp.get("status")||sp.has(g.pageParam))}/>):<Empty>没有符合条件的来源。可以调整条件，或点击“添加来源”登记新入口。</Empty>}
  </Workspace>;
}

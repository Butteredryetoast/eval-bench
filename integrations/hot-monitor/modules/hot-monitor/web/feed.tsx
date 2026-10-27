import {feedView} from "./navigation.ts";
import {InfoDialog} from "./info-dialog.tsx";
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs,type MetaFunction } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { FeedReport, MonitorData } from "../contracts.ts";
import { API, date, Empty, ORIGIN, Tag, EventActions,CandidateAction, LocalScoreTag, SelfScoreTag, Jobs, useLiveRefresh, Workspace } from "./shared.tsx";
import { Filters, Pagination } from "./list-controls.tsx";
export async function loader({request}: LoaderFunctionArgs) {
  return adminGet<{reports:FeedReport[];providers:MonitorData["providers"];jobs:MonitorData["jobs"];page:MonitorData["page"];filters:MonitorData["filters"];syncHealth:MonitorData["syncHealth"]}>(request,API+"/feed"+new URL(request.url).search);
}
export const meta:MetaFunction=({location})=>[{title:feedView(new URLSearchParams(location.search)).label+" · 热点监测"}];
export default function Feed(){
  const data=useLoaderData<typeof loader>();const [sp]=useSearchParams();const selected=sp.get("mode")==="selected";const view=feedView(sp);
  useLiveRefresh(data.jobs);
  return <Workspace title={view.label} subtitle={view.description+(view.key==="sync"&&selected?" 当前仍保留精选筛选条件。":"")}>
    <InfoDialog label="数据范围" title="数据范围与计数说明"><p>按上游文章记录计数；相同原文经 AIHOT、自采分别进入时，渠道各保留一条。动态接口覆盖最近7天，本机此前保存的内容可查存档。摘要超过上游缓存期限时暂隐藏，刷新后恢复。</p></InfoDialog>
    {data.syncHealth && <p className="hm-caption">每分钟自动更新 · 上游最新页检查：{date(data.syncHealth.checkedAt)} · 最新{data.syncHealth.count}篇，未入库{data.syncHealth.missing}篇。上游发现时间：{date(data.syncHealth.newestDiscoveredAt)}。</p>}
    <Jobs jobs={data.jobs}/>
    <Filters filters={data.filters} mode={selected?"selected":"all"} events={false}/><Pagination page={data.page} unit="篇报道"/>
    <section className="hm-feed hm-article-list" aria-label="逐条动态">{data.reports.length?data.reports.map(r=><article className="hm-feed-row hm-action-row" key={r.id}><div>
      <div className="hm-article-meta"><Tag tone="origin">{r.platform}</Tag><span className="hm-source-name">{r.source}</span><span className="hm-origin-note">{ORIGIN[r.origin]}</span><time title={"来源发现 "+date(r.discoveredAt)+"；本机首次入库 "+(r.receivedAt?date(r.receivedAt):"旧记录未记录")}>发布 {date(r.publishedAt)}</time></div>
      <h2><Link to={"/admin/monitor/events/"+r.eventId}>{r.title}</Link></h2><p className="hm-summary">{r.summary}</p>
      <div className="hm-card-footer"><div className="hm-badges"><Tag tone={r.field==="待归类"?"neutral":"field"}>{r.field??"待归类"}</Tag><Tag tone="type">{r.format??"待分类"}</Tag>{r.upstreamScore!==null&&<Tag tone="score">AIHOT参考 <b>{r.upstreamScore}</b></Tag>}{r.origin==="self"&&<SelfScoreTag score={r.localScore}/>}<LocalScoreTag event={r.eventScore}/>{r.upstreamSelected&&<Tag tone="selected">AIHOT精选</Tag>}</div><div className="hm-read-links"><Link to={"/admin/monitor/events/"+r.eventId}>事件详情 →</Link><a href={r.url} target="_blank" rel="noreferrer">原文 ↗</a>{r.origin==="aihot"&&<a href={"https://aihot.news/items/"+encodeURIComponent(r.externalId)} target="_blank" rel="noreferrer">AIHOT ↗</a>}</div></div>
    </div><div className="hm-topic-tools"><EventActions event={r.eventScore} modelReady={data.providers.model} jobs={data.jobs}/><CandidateAction event={r.eventScore}/></div></article>):<Empty>当前条件下没有文章。可扩大日期范围，或到热点监测刷新。</Empty>}</section>
    <Pagination page={data.page} unit="篇报道"/>
  </Workspace>;
}

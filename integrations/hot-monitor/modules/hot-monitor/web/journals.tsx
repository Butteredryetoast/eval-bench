import {journalView} from "./navigation.ts";
import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs,type MetaFunction } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import type { Job } from "../contracts.ts";
import { API, date, Empty, Jobs, Panel, Workspace } from "./shared.tsx";
interface Entry { title:string;summary:string;source?:{name:string};links?:{original?:string;aihot?:string} }
interface Journal {date?:string;week?:string;month?:string;generatedAt:string;leadTitle?:string;headline?:string;leadParagraph?:string;overview?:string;lead?:{title:string;leadParagraph:string};links?:{aihot:string};sections?:{label:string;summary?:string;items:Entry[]}[]}
export async function loader({request}:LoaderFunctionArgs){return adminGet<{items:Journal[];report:Journal|null;jobs:Job[]}>(request,API+"/journals"+new URL(request.url).search);}
export const meta:MetaFunction=({location})=>[{title:journalView(new URLSearchParams(location.search)).label+" · 热点监测"}];
export default function Journals(){
  const data=useLoaderData<typeof loader>();const [sp]=useSearchParams();const action=useAdminAction();const kind=journalView(sp).key;const key=sp.get("key")??"latest";const r=data.report;
  const label=journalView(sp).label;
  return <Workspace title={label} subtitle="统一查看 AIHOT 公开日报、周报、月报及归档，保留每条出处。" actions={<><button className="hm-primary" disabled={action.busy} onClick={()=>action.run("POST",API+"/journals",{kind,key},{success:"已安排读取本期报告；不调用模型"})}>同步本期报告</button></>}>
    <Jobs jobs={data.jobs}/>
    <Form method="get" className="hm-filters"><input type="hidden" name="kind" value={kind}/><label>期号 <input aria-label="报告期号" name="key" placeholder={kind==="weeklies"?"2026-W42":kind==="monthlies"?"2026-09":"2026-10-21"} defaultValue={key} key={kind+key}/></label><button>查看</button><span className="hm-caption">输入期号查看缓存；未缓存或已过期时点击“同步本期报告”。</span></Form>
    {r?<><Panel><div className="hm-meta"><span>AIHOT · {r.date??r.week??r.month}</span><span>生成 {date(r.generatedAt)}</span>{r.links?.aihot&&<a href={r.links.aihot} target="_blank" rel="noreferrer">报告出处 ↗</a>}</div><h2 className="hm-detail-title">{r.lead?.title??r.headline}</h2><p className="hm-prose">{r.lead?.leadParagraph??r.overview}</p></Panel>{r.sections?.map(section=><Panel key={section.label} title={section.label}>{section.summary&&<p>{section.summary}</p>}{section.items.map((e,i)=><article className="hm-feed-row" key={i}><div><h3>{e.title}</h3><p className="hm-summary">{e.summary}</p><div className="hm-meta"><span>{e.source?.name}</span>{e.links?.original&&<a href={e.links.original} target="_blank" rel="noreferrer">原文 ↗</a>}{e.links?.aihot&&<a href={e.links.aihot} target="_blank" rel="noreferrer">AIHOT出处 ↗</a>}</div></div></article>)}</Panel>)}</>:<Empty>本期报告尚未缓存或缓存已过期。点击上方“同步本期报告”，后台完成后自动刷新。</Empty>}
    <Panel title="最近30期目录">{data.items.length?data.items.map(x=><p key={x.date??x.week??x.month}><Link to={"?kind="+kind+"&key="+(x.date??x.week??x.month)}>{x.date??x.week??x.month} · {x.leadTitle??x.headline??"查看本期"}</Link></p>):<p className="hm-caption">目录将在下一轮新闻同步时更新。</p>}</Panel>
  </Workspace>;
}

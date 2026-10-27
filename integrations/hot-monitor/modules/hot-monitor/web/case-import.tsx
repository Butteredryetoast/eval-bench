import {useState} from "react";
import {Form,Link,useSearchParams} from "react-router";
import {useAdminAction} from "@aihot/web/features/admin/action";
import {caseContext} from "./navigation.ts";
import {API,Panel} from "./shared.tsx";
import {CASE_PLATFORMS,CASE_PLATFORM_LABELS,casePlatform} from "../contracts.ts";
export function CaseImport({eventId}:{eventId:string}){
  const [sp]=useSearchParams();const action=useAdminAction();const [text,setText]=useState("");const [error,setError]=useState("");const [excluded,setExcluded]=useState<string[]>([]);
  const intent=["keywords","example","comparison","failure"].includes(sp.get("intent")??"")?sp.get("intent")!:"keywords";
  const links=Array.from(new Set((text.match(/https?:\/\/[^\s<>"“”]+/g)??[]).map(x=>x.replace(/[，。；、）)]+$/, ""))));
  const picked=links.filter(url=>!excluded.includes(url));
  return <Panel title="2. 粘贴找到的案例"><p className="hm-caption">粘贴帖子链接或平台分享文案，勾选想保留的材料。保存后后台自动提取原标题、作者、封面和摘要；版本与效果仍待核对。</p><Form className="hm-form" onSubmit={async ev=>{ev.preventDefault();setError("");if(!picked.length||picked.length>50){setError("请勾选1–50条HTTP/HTTPS原文链接。");return;}
    const form=new FormData(ev.currentTarget);const destination=((ev.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null)?.value||"library";
    const r=await action.run<{created:number;existing:number;adopted:number;metadataQueued:number;metadataFailed:number}>("POST",API+"/cases/import",{schemaVersion:1,eventId,intent:form.get("intent"),destination,note:form.get("note"),items:picked.map(url=>({url}))},{success:destination==="library"?"所选链接已存入案例库，原文信息将在后台自动提取":"链接已收集到待挑选结果"});
    if(r){setText("");setExcluded([]);setError(`新收集${r.created}条，已有${r.existing}条${destination==="library"?`，本次收入案例库${r.adopted}条`:""}；${r.metadataQueued>0?`已安排${r.metadataQueued}条原文信息提取，完成后自动更新` : "已有信息与备注保留"}${r.metadataFailed>0?`；${r.metadataFailed}条提取任务未排入，链接已保存，可在案例库重试`:""}。`);}}}>
    <label>粘贴多平台链接或分享文案<textarea rows={3} value={text} onChange={ev=>setText(ev.target.value)} placeholder="X、Reddit、YouTube、公众号、小红书、抖音等，一次粘贴即可。"/></label>
    {!!links.length&&<div className="hm-import-preview" aria-label="待收集链接预览">{links.slice(0,60).map(url=><label key={url}><input type="checkbox" checked={!excluded.includes(url)} onChange={ev=>setExcluded(ev.target.checked?excluded.filter(x=>x!==url):[...excluded,url])}/><span><strong>{CASE_PLATFORM_LABELS[casePlatform(url)]}</strong><span>{url}</span></span></label>)}</div>}
    <input type="hidden" name="intent" value={intent}/><label>发现价值或视频时间点（可选）<input name="note" maxLength={2000} placeholder="例如：02:30开始演示，值得复现"/></label>
    {!!links.length&&<p className="hm-caption">已勾选{picked.length}/{links.length}条：{CASE_PLATFORMS.map(p=>({p,n:picked.filter(l=>casePlatform(l)===p).length})).filter(x=>x.n).map(x=>CASE_PLATFORM_LABELS[x.p]+" "+x.n).join(" · ")}</p>}
    <p role="status" className="hm-caption">{error}</p><div className="hm-actions"><button className="hm-primary" name="destination" value="library" disabled={action.busy||!picked.length||picked.length>50}>保存所选到案例库</button><Link className="hm-button" to={"/admin/monitor/handoff"+caseContext(sp,eventId)}>交接这个选题 →</Link></div>
    <details className="hm-data-note"><summary>更多保存方式</summary><button type="submit" name="destination" value="candidates" disabled={action.busy||!picked.length||picked.length>50}>先放待挑选结果</button><p className="hm-caption">暂时不确定是否采用时使用；平时直接保存到案例库即可。</p></details>
    <p className="hm-caption">自动提取不调用AI；公众号公开页受限时使用已配置接口补全，按请求计费并遵守采集预算。其他受限页面会说明原因，不读取评论、不下载视频。Reddit可粘贴具体评论的永久链接；YouTube时间点也建议记在备注中。</p>
  </Form><details className="hm-data-note"><summary>脚本与同事工具接入（高级）</summary><p>脚本向 <code>{API}/cases/ingest</code> 推送版本1案例包，需后端INGEST_TOKEN。外部推送只进候选；入口、原作者和媒体仍需核对。</p></details></Panel>;
}

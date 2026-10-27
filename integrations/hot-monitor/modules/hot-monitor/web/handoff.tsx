import {caseContext} from "./navigation.ts";
import {TopicDatePicker} from "./topic-date-picker.tsx";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { copyText } from "@aihot/web/lib/clipboard";
import { CASE_PLATFORM_LABELS,casePlatform,type Event,type Case,type Asset } from "../contracts.ts";
import { API, Panel, Workspace, Empty } from "./shared.tsx";
import "./handoff.css";
export async function loader({request}:LoaderFunctionArgs){
  const id=new URL(request.url).searchParams.get("eventId");
  return adminGet<{events:Event[];cases:Case[];assets:Asset[];topicDates?:{date:string;count:number}[]}>(request,API+"/cases?saved=true"+(id?"&eventId="+encodeURIComponent(id):""));
}
export const meta=()=>[{title:"交接导出 · 案例工作台"}];
function Selection({event:e,cases,assets,chooser}:{event:Event;cases:Case[];assets:Asset[];chooser:ReactNode}){
  const [sp]=useSearchParams();
  const [selected,setSelected]=useState(cases.map(c=>c.id));
  const [message,setMessage]=useState(""),[copying,setCopying]=useState(false);
  const [previewOpen,setPreviewOpen]=useState(false),[preview,setPreview]=useState(""),[previewError,setPreviewError]=useState(""),[loading,setLoading]=useState(false),[previewFor,setPreviewFor]=useState(""),[previewAttempt,setPreviewAttempt]=useState(0);
  const picked=cases.filter(c=>selected.includes(c.id));
  const params=new URLSearchParams({cases:picked.map(c=>c.id).join(",")});
  const suffix="?"+params,url=API+"/events/"+e.id;
  const textParams=new URLSearchParams(params);textParams.set("format","txt");
  const textUrl=url+"/handoff?"+textParams;
  const previewUrl=textUrl+"&preview=true";
  const selectedAssets=assets.filter(a=>picked.some(c=>c.id===a.caseId));
  useEffect(()=>{
    if(!previewOpen)return;
    const controller=new AbortController();setLoading(true);setPreviewError("");setPreview("");
    fetch(previewUrl,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.text();}).then(text=>{setPreview(text);setPreviewFor(previewUrl);}).catch(error=>{if(error.name!=="AbortError")setPreviewError("预览暂时未能读取，可重试或下载文字。");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[previewOpen,previewUrl,previewAttempt]);
  async function copy(){
    setCopying(true);setMessage("");
    try{
      let text=previewFor===previewUrl?preview:"";
      if(!text){const r=await fetch(previewUrl);if(!r.ok)throw Error();text=await r.text();}
      await copyText(text);setMessage("已复制"+picked.length+"条案例的交接文字，可以粘贴给同事。");
    }catch{setMessage("复制未完成，请下载文字TXT。");}finally{setCopying(false);}
  }
  return <div className="hm-handoff">
    <Panel>
      <div className="hm-handoff-topic"><div><span className="hm-handoff-eyebrow">当前交接选题</span><h2>{e.title}</h2></div><Link className="hm-handoff-edit" to={"/admin/monitor/events/"+e.id+caseContext(sp,e.id)+"#writing"}>编辑选题与写作方向 →</Link></div>
      <p className="hm-handoff-angle">{e.classification?.angle||"写作方向待补充，也可以先把现有线索交给同事讨论。"}</p>
      <div className="hm-handoff-switch">{chooser}</div>
    </Panel>
    <Panel title="选择要交接的案例">
      <div className="hm-handoff-selection"><span>已选<strong>{picked.length}</strong>条案例 · <strong>{selectedAssets.length}</strong>份归档素材</span><div className="hm-actions"><button type="button" onClick={()=>setSelected(cases.map(c=>c.id))}>全选案例</button><button type="button" onClick={()=>setSelected([])}>清空本次选择</button></div></div>
      {cases.length?<div className="hm-handoff-choices">{cases.map(c=><label className="hm-handoff-choice" data-selected={selected.includes(c.id)} key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={ev=>setSelected(ev.target.checked?[...selected,c.id]:selected.filter(id=>id!==c.id))}/><span className="hm-handoff-case-copy"><strong>{c.title}</strong><span className="hm-handoff-case-meta"><span>{CASE_PLATFORM_LABELS[casePlatform(c.url)]}</span><span>{c.author||"作者待核对"}</span><span data-warning={c.verification!=="matched"}>{c.verification==="matched"?"版本字符串匹配":c.verification==="mismatch"?"版本不一致":"版本待确认"}</span><span>{c.reviewed?"已人工检查":"尚未人工检查"}</span><span>{assets.filter(a=>a.caseId===c.id).length}份附件</span></span>{c.notes&&<span className="hm-handoff-case-note">{c.notes}</span>}</span></label>)}</div>:<Empty>还没有保存案例。<Link to={"/admin/monitor/research?eventId="+e.id}>先去寻找案例</Link>，也可直接导出选题。</Empty>}
      <p className="hm-caption">勾选仅影响本次导出；不选案例时，仍可交接选题、方向和出处。版本匹配不等于效果已验证。</p>
    </Panel>
    <section className="hm-handoff-output" aria-label="下载或复制交接">
      <div><strong>把这份交接单给同事</strong><p>文字便于讨论；需要图片和录屏时下载素材包。</p></div>
      <div className="hm-actions"><button type="button" className="hm-primary" disabled={copying} onClick={copy}>{copying?"正在复制…":"复制交接文字"}</button><a className="hm-button" href={textUrl}>下载文字TXT</a><a className="hm-button" title="含文字交接单、所选案例的实际图片录屏，以及程序用JSON" href={url+"/bundle"+suffix}>下载所选素材包</a></div>
      {message&&<p role="status" className="hm-handoff-message">{message}</p>}
    </section>
    <details className="hm-handoff-preview" onToggle={ev=>setPreviewOpen(ev.currentTarget.open)}>
      <summary>预览这次的交接文字</summary>
      {loading?<p role="status" className="hm-caption">正在读取交接文字…</p>:previewError?<div><p role="status" className="hm-caption">{previewError}</p><button type="button" onClick={()=>setPreviewAttempt(n=>n+1)}>重试预览</button></div>:<pre>{preview}</pre>}
    </details>
    <details className="hm-handoff-advanced"><summary>更多格式与程序对接</summary><p className="hm-caption">以下格式沿用当前勾选范围；人工交接使用上方文字即可。</p><div className="hm-actions"><a className="hm-button" href={url+"/handoff"+suffix}>下载Markdown交接单</a><a className="hm-button" href={url+"/export"+suffix}>下载事件JSON</a></div></details>
  </div>;
}
export default function Handoff(){
  const d=useLoaderData<typeof loader>();const [sp]=useSearchParams();const id=sp.get("eventId")??"";const e=d.events.find(e=>e.id===id);
  const chooser=<TopicDatePicker events={d.events} dates={d.topicDates} currentId={e?.id} destination="/admin/monitor/handoff"/>;
  return <Workspace title="交接导出" subtitle="勾选材料，复制给同事；选题、出处和核对状态会一起保留。">
    {e?<Selection key={e.id} event={e} cases={d.cases.filter(c=>c.eventId===e.id&&c.saved)} assets={d.assets} chooser={chooser}/>:<Panel title="选择要交接的选题">{chooser}</Panel>}
  </Workspace>;
}

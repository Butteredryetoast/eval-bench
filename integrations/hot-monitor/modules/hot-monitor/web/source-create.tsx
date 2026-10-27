import {useState} from "react";
import {Form,useNavigate} from "react-router";
import {useAdminAction} from "@aihot/web/features/admin/action";
import {FIELDS,SOURCE_PLATFORMS,SOURCE_METHODS,type Candidate} from "../contracts.ts";
import {API,Panel} from "./shared.tsx";
export function SourceCreate(){
  const action=useAdminAction();const navigate=useNavigate();
  const [open,setOpen]=useState(false),[platform,setPlatform]=useState<string>("网站 / RSS"),[kind,setKind]=useState("rss"),[message,setMessage]=useState("");
  return <><button className="hm-primary" onClick={()=>setOpen(!open)}>{open?"收起添加来源":"＋ 添加来源"}</button>{open&&<Panel title="添加来源（先登记，不自动采集）"><Form className="hm-form" onSubmit={async ev=>{
    ev.preventDefault();setMessage("");const f=new FormData(ev.currentTarget);let config:Record<string,unknown>={};
    try {if(f.get("config"))config=JSON.parse(String(f.get("config")));}catch{setMessage("高级配置不是合法JSON，请检查后提交。");return;}
    if(kind==="rss"&&f.get("feedUrl"))config.feedUrl=f.get("feedUrl");
    if(kind==="mp_account"&&f.get("ghid"))config.ghid=f.get("ghid");
    if(kind==="x_search"&&f.get("query"))Object.assign(config,{query:f.get("query"),searchType:"Latest"});
    const result=await action.run<{created:boolean;source:Candidate}>("POST",API+"/catalogue",{name:f.get("name"),platform,kind,config,tier:f.get("tier"),fields:f.getAll("field"),sourceRole:f.get("role"),priority:f.get("priority")==="on",...(f.get("handle")?{handle:f.get("handle")} :{}),...(f.get("example")?{originalExample:f.get("example")} :{})});
    if(result){setMessage(result.created?(kind==="external"?"已登记。展开来源卡片，按推送示例接入脚本；收到真实文章后核验启用。":"已登记。展开来源卡片进行试采；成功后再启用。"):"这个来源已经存在，已定位到原记录。");setOpen(false);navigate("?q="+encodeURIComponent(result.source.id));}
  }}>
    <div className="hm-form-row"><label>来源名称<input name="name" required maxLength={200} placeholder="账号、媒体或网站名称"/></label><label>平台<select value={platform} onChange={ev=>{setPlatform(ev.target.value);setKind(ev.target.value==="公众号"?"mp_account":ev.target.value==="X / 推特"?"x_search":ev.target.value==="网站 / RSS"?"rss":"unknown");}}>{SOURCE_PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></label></div>
    <div className="hm-form-row"><label>采集方式<select value={kind} onChange={ev=>setKind(ev.target.value)}><option value="unknown">仅登记入口，待核验接入</option>{SOURCE_METHODS.map(x=><option key={x.kind} value={x.kind}>{x.label}（{x.kind}）</option>)}</select></label><label>原文示例或公开主页<input type="url" name="example" placeholder="https://…"/></label></div>
    {kind==="external"&&<p className="hm-caption">适合已有采集脚本或第三方工具。登记后提供专属sourceId和推送示例；令牌只放后端，不填进本表。收到有效文章后再核验启用。</p>}
    {kind==="rss"&&<label>RSS订阅地址<input type="url" name="feedUrl" placeholder="公开RSS/Atom入口，可留空待核验"/></label>}
    {kind==="mp_account"&&<label>公众号原始ID<input name="ghid" placeholder="gh_…，未知时可先填原文示例"/></label>}
    {kind==="x_search"&&<div className="hm-form-row"><label>X账号<input name="handle" placeholder="账号，不含链接" pattern="@?[A-Za-z0-9_]{1,50}"/></label><label>检索式<input name="query" placeholder="from:账号 -filter:replies"/></label></div>}
    <fieldset><legend>关注领域（可多选）</legend><div className="hm-source-fields">{FIELDS.map(x=><label key={x}><input type="checkbox" name="field" value={x}/>{x}</label>)}</div></fieldset>
    <div className="hm-form-row"><label>来源角色<select name="role"><option>待分类</option>{["官方一手","媒体","个人创作者","社区与综合"].map(x=><option key={x}>{x}</option>)}</select></label><label>来源分级<select name="tier" defaultValue="T2"><option value="T2">媒体或个人（T2）</option><option value="T1_5">官方账号（T1.5）</option><option value="T1">官方一手（T1）</option></select></label></div>
    {kind!=="external"&&<details><summary>高级配置：网页/JSON字段与选择器</summary><label>配置JSON<textarea name="config" placeholder={kind==="json_list" ? JSON.stringify({url:"https://example.com/api/news",mode:"json_api",itemsPath:"data.items",titlePaths:["title"],urlTemplate:"{raw:url}",publishedAtPath:"published_at"},null,2) : JSON.stringify({url:"https://example.com/news",parseMode:"html",itemSelector:".news-item",linkSelector:"a",titleSelector:"a",publishedAtSelector:"time"},null,2)}/></label><p className="hm-caption">接口凭证放在后端配置，不填进这里。具体字段取决于所选采集适配器，先登记后再试采。</p></details>}
    <label className="hm-form-row"><input type="checkbox" name="priority"/>优先核验这个来源</label><p className="hm-caption">登记不代表已验证，不发起付费请求；公众号/X试采可能产生接口费用。其他平台没有专用适配时可先登记和手动收集。</p><button disabled={action.busy}>登记来源</button>
  </Form></Panel>}<p role="status" className="hm-caption">{message}</p></>;
}

import {caseContext} from "./navigation.ts";
import {CollectorControls} from "./browser-collector.tsx";
import {TitleKeywordPicker} from "./title-keyword-picker.tsx";
import {SearchMethod} from "./search-method.tsx";
import {useEffect,useRef,useState} from "react";
import {Form,Link,useSearchParams,useNavigationType} from "react-router";
import {copyText} from "@aihot/web/lib/clipboard";
import {useAdminAction} from "@aihot/web/features/admin/action";
import {CASE_KEYWORD_LIMIT,extractCaseKeywords,platformCaseSearch,type SearchIntent,type SearchPrecision,type KeywordSource} from "../case-search.ts";
import {CASE_PLATFORMS,CASE_PLATFORM_LABELS,type CasePlatform,type Event,type MonitorData} from "../contracts.ts";
import {API} from "./shared.tsx";
export function PlatformSearch({event:e,providers}:{event:Event;providers:MonitorData["providers"]}){
  const action=useAdminAction();const [sp,setSp]=useSearchParams();const draft=extractCaseKeywords(e);
  const platform=(CASE_PLATFORMS.includes(sp.get("searchPlatform") as CasePlatform)?sp.get("searchPlatform"):"x") as CasePlatform;
  const savedQuery=sp.get("keywords")??draft.keywords;
  const savedSource=(["auto","manual","title"].includes(sp.get("keywordSource")??"")?sp.get("keywordSource"):sp.has("keywords")?"manual":"auto") as KeywordSource;
  const [query,setQuery]=useState(savedQuery),[source,setSource]=useState<KeywordSource>(savedSource),[message,setMessage]=useState("");
  const pendingEdit=useRef<{query:string;source:KeywordSource}|null>(null),navigationType=useNavigationType();
  useEffect(()=>{
    if(navigationType==="POP")pendingEdit.current=null;
    if(pendingEdit.current){if(pendingEdit.current.query!==savedQuery||pendingEdit.current.source!==savedSource)return;pendingEdit.current=null;}
    setQuery(savedQuery);setSource(savedSource);
  },[savedQuery,savedSource,navigationType]);
  const role=(["keywords","example","comparison","failure"].includes(sp.get("intent")??"")?sp.get("intent"):"keywords") as SearchIntent;
  const precision=(sp.get("precision")==="broad"?"broad":"precise") as SearchPrecision;
  function remember(values:Record<string,string>){if(values.keywords!==undefined)pendingEdit.current={query:values.keywords,source:(values.keywordSource??source) as KeywordSource};const next=new URLSearchParams(sp);for(const [key,value] of Object.entries(values))next.set(key,value);setSp(next,{replace:true,preventScrollReset:true});}
  const plan=(p:CasePlatform)=>platformCaseSearch(e,p,role,query,precision,Date.now(),source);
  const automatic=platform==="wechat"||platform==="x",ready=platform==="wechat"?providers.wechat:platform==="x"?providers.x:false;
  const selected=plan(platform);
  return <>
    <TitleKeywordPicker title={e.title} value={query} onChange={value=>{setQuery(value);setSource("title");remember({keywords:value,keywordSource:"title"});}}/>
    <SearchMethod/>
    <div className="hm-search-draft" aria-label="自动提取的关键词"><span>自动提取</span><strong>{draft.subject||"主体待填写"}</strong>{draft.version&&<span className="hm-state">版本：{draft.version}</span>}{draft.task&&<span className="hm-state">任务：{draft.task}</span>}<small>本机规则生成，不消耗模型用量；仍可手动改词。</small></div>
    {draft.warnings.length>0&&<p className="hm-caption hm-search-warning">{draft.warnings.join("；")}。</p>}
    <div className="hm-search-query-row"><label>关键词，可加入别名和具体任务<input name="query" minLength={2} maxLength={CASE_KEYWORD_LIMIT} value={query} onChange={ev=>{pendingEdit.current={query:ev.target.value,source:"manual"};setQuery(ev.target.value);setSource("manual");}} onBlur={()=>remember({keywords:query,keywordSource:source})} placeholder="输入或点选关键词，默认不加任何后缀"/></label><button type="button" className="hm-search-reset" onClick={()=>{setQuery(draft.keywords);setSource("auto");remember({keywords:draft.keywords,keywordSource:"auto"});}}>恢复自动关键词</button></div>
    <p className="hm-caption">{role==="keywords"?"默认只搜索输入框中的词，不自动添加案例、demo、任务或日期。":"已启用用途条件，可在优化搜索里改回仅关键词。"}</p>
    <CollectorControls/>
    <div className="hm-search-cards" aria-label="常用平台搜索">{(["x","reddit","youtube","wechat","xiaohongshu","douyin"] as CasePlatform[]).map(p=>{const current=plan(p);return <div className="hm-search-card" key={p}>{query.trim().length>=2?<a target="_blank" rel="noreferrer" href={current.url}>去{CASE_PLATFORM_LABELS[p]}找案例 ↗</a>:<strong>{CASE_PLATFORM_LABELS[p]}：先填关键词</strong>}{role!=="keywords"&&<p title={current.explanation}>{current.query||"等待关键词"}</p>}</div>;})}</div>
    <details className="hm-data-note"><summary>优化搜索与接口（按需）</summary>
      <div className="hm-form-row"><label>希望寻找的材料<select name="role" value={role} onChange={ev=>remember({keywords:query,keywordSource:source,intent:ev.target.value})}><option value="keywords">仅关键词（不加后缀）</option><option value="example">实践与创作案例（加用途词）</option><option value="comparison">对比与评测（加用途词）</option><option value="failure">失败案例与限制（加用途词）</option></select></label><label>检索平台<select aria-label="检索平台" value={platform} onChange={ev=>remember({keywords:query,keywordSource:source,searchPlatform:ev.target.value})}>{CASE_PLATFORMS.map(p=><option key={p} value={p}>{CASE_PLATFORM_LABELS[p]} · {p==="wechat"||p==="x"?"API":"手动"}</option>)}</select></label></div>
      {role!=="keywords"&&<div className="hm-search-options"><div role="group" aria-label="搜索范围"><button type="button" aria-pressed={precision==="precise"} onClick={()=>remember({keywords:query,keywordSource:source,precision:"precise"})}>精确搜索</button><button type="button" aria-pressed={precision==="broad"} onClick={()=>remember({keywords:query,keywordSource:source,precision:"broad"})}>放宽搜索</button></div><span className="hm-caption">{precision==="precise"?"补充用途、任务与可用日期条件":"放宽自动条件，保留手动词"}</span></div>}
      <p className="hm-prose">{selected.explanation}</p><pre className="hm-rule-code">{selected.query}</pre>
      <div className="hm-actions"><button type="button" disabled={query.trim().length<2} onClick={async()=>{try{await copyText(selected.query);setMessage("已复制当前平台的搜索词，可粘贴到平台搜索框。");}catch{setMessage("复制失败，可从上方选中搜索词。");}}}>复制平台搜索词</button>{query.trim().length>=2&&<a className="hm-button" target="_blank" rel="noreferrer" href={selected.url}>打开{CASE_PLATFORM_LABELS[platform]}搜索 ↗</a>}</div>
      <p role="status" className="hm-caption">{message}</p>
      {automatic?<Form className="hm-form" onSubmit={async ev=>{ev.preventDefault();if(!ready)return;await action.run("POST",API+"/events/"+e.id+"/search",{platform,query,role,precision,keywordSource:source},{success:"案例检索已进入后台队列"});}}><p className="hm-caption">{ready?"接口已配置；点击才会发起付费搜索，结果进入待挑选结果区。":"接口凭证待配置，可以先打开平台搜索。"}</p><button className="hm-primary" disabled={action.busy||!ready||query.trim().length<2}>搜索案例</button></Form>:<p className="hm-caption">当前为平台搜索入口＋链接收集；自动API尚待接入。</p>}
      <p className="hm-caption">X包含回复，Reddit可在站内切换评论；打开网页不会自动回传结果或下载媒体。各平台语法不混用，YouTube和中文平台的日期需在站内筛选。</p><Link to={"/admin/monitor/events/"+e.id+caseContext(sp,e.id)}>修改主体、版本与研究范围 →</Link>
    </details>
  </>;
}

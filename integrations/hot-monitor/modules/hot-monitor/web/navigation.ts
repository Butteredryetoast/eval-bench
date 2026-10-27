import { VIEW_HELP } from "../contracts.ts";
export const MONITOR = "/admin/monitor";
export const WORKSPACE_LINKS = [
  {to:MONITOR,label:"选题台",group:"工作",icon:"m3 12 4-7 4 14 4-14 4 7h2"},
  {to:MONITOR+"/cases",label:"案例工作台",group:"工作",icon:"M4 5h16v15H4zM8 2v6m8-6v6M8 12h8m-8 4h5"},
  {to:MONITOR+"/feed",label:"资讯流",group:"信息",icon:"M4 5h16M4 12h16M4 19h16"},
  {to:MONITOR+"/journals",label:"日报汇总",group:"信息",icon:"M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"},
  {to:MONITOR+"/catalogue",label:"信源管理",group:"其他",icon:"M3 4h7l2 3h9v13H3zM7 12h10m-10 4h7"},
  {to:MONITOR+"/rules",label:"规则与标准",group:"其他",icon:"M5 4h14v16H5zM9 8h6M9 12h6M9 16h4"},
  {to:MONITOR+"/usage",label:"用量与预算",group:"其他",icon:"M4 20V10m8 10V4m8 16v-7M2 20h20"},
  {to:MONITOR+"/help",label:"使用说明",group:"其他",icon:"M12 17v-5m0-4v-.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"},
];
export const WORKSPACE_GROUPS=["工作","信息","其他"].map(label=>({label,items:WORKSPACE_LINKS.filter(entry=>entry.group===label)}));
export const MONITOR_VIEWS = ["all","priority","hot","selected","confirmed","bookmarked","observe","rejected"].map(key=>({key,...VIEW_HELP[key]!}));
export function monitorViewKey(search:URLSearchParams) {
  const state=search.get("state");
  if(state==="confirmed"||state==="bookmarked")return state;
  const mode=search.get("mode")??(search.has("state")?"all":"priority");
  return MONITOR_VIEWS.some(v=>v.key===mode)&&mode!=="confirmed"&&mode!=="bookmarked"?mode:"all";
}
export function monitorView(search:URLSearchParams) {
  return MONITOR_VIEWS.find(v=>v.key===monitorViewKey(search))!;
}
export function monitorViewHref(key:string,search=new URLSearchParams()) {
  const q=new URLSearchParams(search);
  q.delete("page");q.delete("state");
  if(key==="confirmed"||key==="bookmarked"){
    q.set("mode","all");q.set("state",key);q.set("window","all");q.delete("from");q.delete("to");
  }else q.set("mode",MONITOR_VIEWS.some(v=>v.key===key)?key:"priority");
  return MONITOR+"?"+q;
}
export const CASE_STEPS = [
  {to:MONITOR+"/research",label:"寻找案例"},
  {to:MONITOR+"/cases",label:"案例库"},
  {to:MONITOR+"/handoff",label:"交接导出"},
];
export const FEED_VIEWS=[
  {key:"all",label:"全部报道",to:MONITOR+"/feed",description:"逐条查看已接收文章，不因事件合并而隐藏报道。"},
  {key:"selected",label:"AIHOT精选",to:MONITOR+"/feed?mode=selected",description:"AIHOT精选文章逐条展示；本站独立精选在选题台查看。"},
  {key:"sync",label:"同步核对",to:MONITOR+"/feed?origin=aihot&sort=upstream&timeBy=discovered",description:"按AIHOT动态顺序核对接收情况，日期采用来源发现时间。"},
];
export function feedView(search:URLSearchParams) {
  const key=search.get("sort")==="upstream"?"sync":search.get("mode")==="selected"?"selected":"all";
  return FEED_VIEWS.find(view=>view.key===key)!;
}
export const JOURNAL_VIEWS=[
  {key:"dailies",label:"日报",to:MONITOR+"/journals?kind=dailies"},
  {key:"weeklies",label:"周报",to:MONITOR+"/journals?kind=weeklies"},
  {key:"monthlies",label:"月报",to:MONITOR+"/journals?kind=monthlies"},
];
export function journalView(search:URLSearchParams) {
  return JOURNAL_VIEWS.find(view=>view.key===search.get("kind"))??JOURNAL_VIEWS[0]!;
}
export function activeWorkspace(path:string) {
  const current=path.replace(/\/+$/,"");
  if(current===MONITOR+"/connections")return MONITOR+"/catalogue";
  if(current.startsWith(MONITOR+"/policy/"))return MONITOR+"/help";
  if(CASE_STEPS.some(step=>step.to===current))return MONITOR+"/cases";
  return WORKSPACE_LINKS.find(link=>link.to!==MONITOR&&(current===link.to||current.startsWith(link.to+"/")))?.to??MONITOR;
}
export function caseContext(search:URLSearchParams,eventId=search.get("eventId")) {
  const q=new URLSearchParams();if(eventId)q.set("eventId",eventId);
  for(const key of ["keywords","searchPlatform","intent","precision","keywordSource"]){const value=search.get(key);if(value)q.set(key,value);}
  return q.size?"?"+q:"";
}
export interface WorkspaceChild {key:string;label:string;to:string;active:boolean}
export function workspaceChildren(primary:string,path:string,search:URLSearchParams):WorkspaceChild[] {
  const current=path.replace(/\/+$/,"");
  if(primary===MONITOR)return MONITOR_VIEWS.map(view=>({key:view.key,label:view.label,to:monitorViewHref(view.key,current===MONITOR?search:undefined),active:current===MONITOR&&view.key===monitorViewKey(search)}));
  if(primary===MONITOR+"/cases"){
    const eventId=search.get("eventId")??(/\/events\/([^/]+)/.exec(current)?.[1]);
    const context=caseContext(search,eventId);
    return CASE_STEPS.map(step=>({key:step.to,label:step.label,to:step.to+context,active:current===step.to}));
  }
  if(primary===MONITOR+"/feed")return FEED_VIEWS.map(view=>({...view,active:current===MONITOR+"/feed"&&view.key===feedView(search).key}));
  if(primary===MONITOR+"/journals")return JOURNAL_VIEWS.map(view=>({...view,active:current===MONITOR+"/journals"&&view.key===journalView(search).key}));
  if(primary===MONITOR+"/catalogue")return [{key:"directory",label:"来源目录",to:MONITOR+"/catalogue",active:current===MONITOR+"/catalogue"},{key:"connections",label:"API配置",to:MONITOR+"/connections",active:current===MONITOR+"/connections"}];
  const label=({[MONITOR+"/catalogue"]:"来源目录",[MONITOR+"/rules"]:"全部规则",[MONITOR+"/usage"]:"费用与自动处理",[MONITOR+"/help"]:"使用指南"})[primary]??"打开页面";
  return [{key:primary,label,to:primary,active:current===primary}];
}
export function workspacePageLabel(path:string,search:URLSearchParams) {
  const current=path.replace(/\/+$/,"");
  if(current.startsWith(MONITOR+"/events/"))return "选题详情";
  if(current===MONITOR+"/policy/terms")return "使用规则";
  if(current===MONITOR+"/policy/privacy")return "隐私说明";
  const primary=activeWorkspace(current);
  return workspaceChildren(primary,current,search).find(child=>child.active)?.label??WORKSPACE_LINKS.find(entry=>entry.to===primary)?.label??"编辑工作区";
}

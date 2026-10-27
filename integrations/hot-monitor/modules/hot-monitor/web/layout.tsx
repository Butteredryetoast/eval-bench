import { useEffect,useId,useRef,useState } from "react";
import {createPortal} from "react-dom";
import { WORKSPACE_LINKS,WORKSPACE_GROUPS, MONITOR, activeWorkspace,caseContext,workspaceChildren,workspacePageLabel } from "./navigation.ts";
import { Link, NavLink, Outlet, useNavigation, useLocation, useRouteError, isRouteErrorResponse } from "react-router";
import { RingMark } from "@aihot/site/brand/Logo.tsx";
import { NavigationProgress } from "@aihot/web/components/shell/Chrome";
import { useModal } from "@aihot/web/components/ui/modal";
import { Toaster } from "@aihot/web/features/admin/toast";
import "./skin.css";
import "./navigation.css";
export const headers = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
export default function SharedLayout() {
  const navigation=useNavigation(),location=useLocation();
  const search=new URLSearchParams(location.search),active=activeWorkspace(location.pathname);
  const currentEventId=search.get("eventId")??(/\/events\/([^/]+)/.exec(location.pathname)?.[1]);
  const liveCaseContext=caseContext(search,currentEventId),caseMemory=useRef("");
  const inCaseArea=active===MONITOR+"/cases"||location.pathname.startsWith(MONITOR+"/events/");
  const caseSearch=new URLSearchParams((inCaseArea||currentEventId?liveCaseContext:caseMemory.current).replace(/^\?/,""));
  useEffect(()=>{if(inCaseArea||currentEventId)caseMemory.current=liveCaseContext;},[inCaseArea,currentEventId,liveCaseContext]);
  const caseWorkspace=active===MONITOR+"/cases";
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set(caseWorkspace?[MONITOR+"/cases"]:[])),[drawerOpen,setDrawerOpen]=useState(false);
  const drawerPanel=useRef<HTMLDivElement>(null),drawerTitle=useId();
  const primaryLabel=WORKSPACE_LINKS.find(entry=>entry.to===active)?.label??"编辑工作区";
  const pageLabel=workspacePageLabel(location.pathname,search);
  useModal({open:drawerOpen,panel:drawerPanel,onClose:()=>setDrawerOpen(false)});
  const navigationScope=location.pathname+"|"+pageLabel+(caseWorkspace?"|"+(currentEventId??""):""),previousScope=useRef(navigationScope);
  useEffect(()=>{
    if(previousScope.current===navigationScope)return;previousScope.current=navigationScope;
    setExpanded(current=>current.has(active)?current:new Set([...current,active]));setDrawerOpen(false);
  },[active,navigationScope]);
  useEffect(()=>{
    const media=window.matchMedia("(min-width:1024px)");
    const close=()=>{if(media.matches)setDrawerOpen(false);};
    media.addEventListener("change",close);
    return ()=>media.removeEventListener("change",close);
  },[]);
  function togglePrimary(entry:(typeof WORKSPACE_LINKS)[number]) {setExpanded(current=>{const next=new Set(current);if(next.has(entry.to))next.delete(entry.to);else next.add(entry.to);return next;});}
  function navigationTree(mobile=false) {
    return <nav aria-label="工作区导航" className="hm-nav-scroll">{WORKSPACE_GROUPS.map(group=><section className="hm-nav-section" key={group.label} aria-label={group.label}><p className="hm-nav-label">{group.label}</p>{group.items.map(entry=>{
      const open=expanded.has(entry.to),children=workspaceChildren(entry.to,location.pathname,entry.to===MONITOR+"/cases"?caseSearch:search);
      const contentId=(mobile?"mobile-":"desktop-")+entry.to.slice(MONITOR.length+1).replace(/\W/g,"")+"-children";
      return <div className="hm-nav-folder" key={entry.to}><button type="button" className="hm-nav-primary" aria-expanded={open} aria-controls={contentId} data-active={active===entry.to} data-area={entry.to.slice(MONITOR.length+1)||"monitor"} onClick={()=>togglePrimary(entry)}><svg className="hm-nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={entry.icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg><span>{entry.label}</span><svg className="hm-nav-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>{open&&<nav id={contentId} className="hm-subnav" aria-label={entry.label+"子栏目"}>{children.map(child=><Link key={child.key} to={child.to} data-view={child.key} aria-current={child.active?"page":undefined} className="hm-subnav-link" onClick={()=>setDrawerOpen(false)}><span className="hm-subnav-dot"/>{child.label}</Link>)}</nav>}</div>;
    })}</section>)}</nav>;
  }
  return <div className="hm-shell flex min-h-dvh bg-bg">
    <NavigationProgress active={navigation.state==="loading"}/>
    <aside className="hm-sidebar sticky top-0 hidden h-dvh w-[216px] shrink-0 flex-col border-r border-line bg-bg-sunk/50 px-3 py-4 lg:flex">
      <NavLink to={MONITOR} className="hm-brand"><span className="hm-brand-mark"><RingMark/></span><span>热点监测<small>猿大侠 · 内容研究</small></span></NavLink>
      {navigationTree()}
      <div className="hm-sidebar-note"><span className="hm-status-dot"/>共享工作区<small>发现线索，留下值得写的题。</small><span className="hm-access-label">免登录使用 ↗</span></div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="hm-mobile-header sticky top-0 z-40 border-b border-line bg-bg/95 px-3 pt-3 lg:hidden">
        <div className="hm-mobile-brand-row"><Link to={MONITOR} className="hm-mobile-brand"><RingMark className="size-5 text-accent"/><span>热点监测</span></Link><button type="button" className="hm-mobile-nav-trigger" aria-label="打开导航" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={()=>setDrawerOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>导航</button></div>
        <p className="hm-mobile-current">{primaryLabel}<span aria-hidden="true">／</span>{pageLabel}</p>
      </header>
      <div className="hm-topline"><span>猿大侠 <span className="hm-breadcrumb-divider">/</span>{primaryLabel}<span className="hm-breadcrumb-divider">/</span>{pageLabel}</span><span><i className="hm-status-dot"/>本机 · 免登录</span></div>
      <main id="workspace-content" className="hm-shell-main min-w-0 flex-1"><Outlet/></main>
    </div>
    {drawerOpen&&typeof document!=="undefined"&&createPortal(<div className="hm-shell hm-nav-drawer-layer"><button type="button" className="hm-nav-drawer-backdrop" aria-label="关闭导航遮罩" tabIndex={-1} onClick={()=>setDrawerOpen(false)}/><div className="hm-nav-drawer-panel" ref={drawerPanel} role="dialog" aria-modal="true" aria-labelledby={drawerTitle} tabIndex={-1}><header className="hm-nav-drawer-header"><h2 id={drawerTitle}>工作区导航</h2><button type="button" aria-label="关闭导航" onClick={()=>setDrawerOpen(false)}><span aria-hidden="true">×</span>关闭</button></header>{navigationTree(true)}<p className="hm-nav-drawer-note">先点一级栏目展开，再选择要使用的页面。</p></div></div>,document.body)}
    <Toaster/>
  </div>;
}
export function ErrorBoundary() {
  const error=useRouteError(),location=useLocation();
  return <div className="hm-shell"><main className="hm-workspace"><p className="hm-owner">猿大侠 · 热点监测</p><h1 className="hm-detail-title">暂时无法加载工作区</h1><p className="hm-prose">请重新载入页面；页面加载失败不会删除已保存的选题、案例或素材。</p>{isRouteErrorResponse(error)&&<p className="hm-caption">状态：{error.status}</p>}<div className="hm-actions"><a className="hm-button hm-primary" href={location.pathname+location.search}>重新加载</a><Link className="hm-button" to={MONITOR}>返回选题台</Link><Link className="hm-button" to={MONITOR+"/help"}>使用说明</Link></div></main></div>;
}

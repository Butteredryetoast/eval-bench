'use client';
import {createContext,useContext,useEffect,useState,type ReactNode,type Dispatch,type SetStateAction} from 'react';
import {createPortal} from 'react-dom';
import {usePathname,useRouter} from 'next/navigation';
import {Settings2} from './tone-icon';
import {SidebarToggleIcon,TaxonomyIcon} from './taxonomy-icon';

type ModuleItem={label:string;href:string;on:boolean};
export function workspaceNavigation(path:string){
 const content=path.startsWith('/write'),results=['/instances','/materials','/runs'].includes(path)||path.startsWith('/a/')||path.startsWith('/r/');
 const hotspots=path.startsWith('/hotspots')||path==='/topics';
 const active=hotspots?'hotspots':content?'content':results?'results':'testing';
 const items:ModuleItem[]=hotspots?[{label:'选题',href:'/hotspots',on:path==='/hotspots'||path==='/topics'||path.includes('/events/')},{label:'寻找案例',href:'/hotspots/research',on:/\/(cases|research|handoff)/.test(path)}]:content?[{label:'我的文章',href:'/write',on:true}]:results?[{label:'案例结果',href:'/instances',on:path!=='/materials'},{label:'演示素材',href:'/materials',on:path==='/materials'}]:[{label:'测试案例库',href:'/',on:path!=='/launch'},{label:'发起测试',href:'/launch',on:path==='/launch'}];
 return {active,items};
}
// Retain each view's choices across module navigation, without persisting business data.
export function useWorkspaceMemory<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
 const [state,setState]=useState<{key:string;value:T}>({key,value:initial});
 useEffect(()=>{try{const saved=sessionStorage.getItem('casebench.ui.'+key);setState({key,value:saved===null?initial:JSON.parse(saved)});}catch{setState({key,value:initial});}},[key]);
 const value=state.key===key?state.value:initial;
 const setValue:Dispatch<SetStateAction<T>>=next=>setState(previous=>{const old=previous.key===key?previous.value:initial,value=typeof next==='function'?(next as (v:T)=>T)(old):next;try{sessionStorage.setItem('casebench.ui.'+key,JSON.stringify(value));}catch{}return {key,value};});
 return [value,setValue];
}
const SidebarContext=createContext<{target:HTMLDivElement|null;collapsed:boolean;setCollapsed:(v:boolean)=>void}>({target:null,collapsed:false,setCollapsed:()=>{}});
export const useWorkspaceSidebar=()=>useContext(SidebarContext);
export function SecondaryContent({children}:{children:ReactNode}){const {target}=useWorkspaceSidebar();return target?createPortal(children,target):null;}
export function ModuleNavigation(){
 const path=usePathname(),router=useRouter(),{items}=workspaceNavigation(path),{setCollapsed}=useWorkspaceSidebar();
 return <nav className="ws-content-modules" aria-label="模块导航">{items.map(i=><button key={i.href} className={i.on?'on':''} aria-current={i.on?'page':undefined} onClick={()=>{if(window.matchMedia('(max-width:1000px)').matches)setCollapsed(true);router.push(i.href);}}>{i.label}</button>)}</nav>;
}
export function WorkspaceFrame({children,className,settings}:{children:ReactNode;className:string;settings:()=>void}){
 const path=usePathname(),{active}=workspaceNavigation(path),[target,setTarget]=useState<HTMLDivElement|null>(null),[primaryCollapsed,setPrimaryCollapsed]=useWorkspaceMemory('primary-compact',true),[collapsed,setCollapsed]=useWorkspaceMemory('context-collapsed.'+active,false);
 useEffect(()=>{const mq=window.matchMedia('(max-width:1000px)');if(mq.matches)setCollapsed(true);const resize=()=>{if(mq.matches)setCollapsed(true);};mq.addEventListener('change',resize);return()=>mq.removeEventListener('change',resize);},[active]);
 useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))setCollapsed(true);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[active]);
 return <SidebarContext.Provider value={{target,collapsed,setCollapsed}}><div className={className+' sidebar-workspaces '+(primaryCollapsed?'rail-compact':'rail-expanded')+(collapsed?' context-collapsed':' context-open')}>
  <WorkspaceNavigation settings={settings} collapsed={primaryCollapsed} toggle={()=>setPrimaryCollapsed(v=>!v)}/>
  {!collapsed&&<button className="context-backdrop" aria-label="关闭次级侧栏" onClick={()=>setCollapsed(true)}/>}
  <aside id="workspace-context-panel" className="context-sidebar" aria-label="次级侧栏" hidden={collapsed}>
   <div className="context-switcher"><ModuleNavigation/></div>
   <div className="context-content" ref={setTarget}/>
  </aside>
  <button className="context-toggle" aria-label={collapsed?'展开次级侧栏':'收起次级侧栏'} title={collapsed?'展开次级侧栏':'收起次级侧栏'} aria-expanded={!collapsed} aria-controls="workspace-context-panel" onClick={()=>setCollapsed(!collapsed)}><SidebarToggleIcon collapsed={collapsed}/></button>
  {children}
 </div></SidebarContext.Provider>;
}
function WorkspaceNavigation({settings,collapsed,toggle}:{settings:()=>void;collapsed:boolean;toggle:()=>void}){
 const path=usePathname(),router=useRouter(),{active}=workspaceNavigation(path);
 const groups=[{id:'hotspots',label:'热点检测与选题',short:'选题',href:'/hotspots',icon:'research'},{id:'testing',label:'案例测试',short:'测试',href:'/',icon:'all'},{id:'results',label:'结果与素材',short:'结果',href:'/instances',icon:'image'},{id:'content',label:'文章创作',short:'写作',href:'/write',icon:'document'}];
 return <aside className="workspace-rail" aria-label="主侧栏"><button className="rail-brand" aria-label="测写 · 返回案例库" onClick={()=>router.push('/')}><img src="/brand/writing-smile-256.png" width={34} height={34} alt=""/>{!collapsed&&<strong>测写</strong>}</button><button className="rail-toggle" aria-label={collapsed?'展开主侧栏':'收起主侧栏'} title={collapsed?'展开主侧栏':'收起主侧栏'} aria-expanded={!collapsed} onClick={toggle}><SidebarToggleIcon collapsed={collapsed}/></button><nav aria-label="工作区导航">{groups.map(g=><button key={g.id} aria-label={g.label} aria-current={active===g.id?'page':undefined} className={active===g.id?'on':''} title={g.label} onClick={()=>router.push(g.href)}>{<TaxonomyIcon name={g.icon} size={21} selected={active===g.id}/>}<span>{collapsed?g.short:g.label}</span></button>)}</nav><button className="rail-settings" aria-label="执行配置" title="执行配置" onClick={settings}><Settings2 size={19}/>{!collapsed&&<span>执行配置</span>}</button></aside>;
}

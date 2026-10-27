import {useEffect,useId,useRef,useState} from "react";
import {InfoDialog} from "./info-dialog.tsx";
import {API} from "./shared.tsx";
import {copyText} from "@aihot/web/lib/clipboard";

export function BrowserCollector({label="浏览器采集助手"}:{label?:string}) {
  const [message,setMessage]=useState("");
  async function copy(address:string) {
    try{await copyText(address);setMessage("已复制，粘贴到浏览器地址栏打开。");}
    catch{setMessage("可手动将下面的扩展管理地址粘贴到地址栏。");}
  }
  return <InfoDialog label={label} title="在原文页一键保存案例">
    <p className="hm-prose">适用于Chrome和Edge。悬浮窗显示当前选题，点击「确认并提取案例」直接保存当前网页；点击「回到案例库」才切回工作台。</p>
    <div className="hm-actions"><a className="hm-button hm-primary" href={API+"/collector/extension.zip"} download="hot-monitor-collector.zip" onClick={event=>event.stopPropagation()}>下载采集助手</a></div>
    <ol className="hm-help-steps">
      <li>下载并解压，得到「hot-monitor-collector」文件夹。</li>
      <li>打开浏览器的扩展管理页，开启「开发者模式」，点击「加载已解压的扩展程序」，选择该文件夹。</li>
      <li>安装后刷新工作台页面。已安装旧版时，在扩展管理页点一次「刷新」，再刷新本站。</li>
      <li>在寻找案例的搜索区点击「启动插件」，首次允许浏览器请求的网站显示权限。随后打开支持的平台，悬浮窗自动显示；确认选题后点击「确认并提取案例」即可保存。</li>
    </ol>
    <div className="hm-actions"><button type="button" onClick={()=>void copy("chrome://extensions")}>复制Chrome扩展管理地址</button><button type="button" onClick={()=>void copy("edge://extensions")}>复制Edge扩展管理地址</button></div>
    <p className="hm-caption"><code>chrome://extensions</code> ／ <code>edge://extensions</code></p><p className="hm-caption" role="status">{message}</p>
    <p className="hm-caption">v1.1支持X、Reddit、YouTube、公众号、小红书、抖音等平台自动展开；普通网站仍可点工具栏图标手动打开。停止采集后不再自动展开；关闭浏览器后，下次研究时重新启动即可。公众号补读沿用现有接口预算。</p>
  </InfoDialog>;
}

export function CollectorControls() {
  const id=useId(),statusId="hm-status-"+id,controlId="hm-control-"+id;
  const [installed,setInstalled]=useState<boolean|null>(null),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const pending=useRef(false),responded=useRef(false);
  useEffect(()=>{
    const probe=()=>window.postMessage({source:"hot-monitor-workspace",type:"HM_COLLECTOR_STATUS",requestId:statusId},window.location.origin);
    const receive=(event:MessageEvent)=>{
      const data=event.data;
      if(event.source!==window||event.origin!==window.location.origin||data?.source!=="hot-monitor-extension")return;
      if(data.type==="HM_COLLECTOR_READY"){probe();return;}
      if(data.type!=="HM_COLLECTOR_STATUS"||![statusId,controlId].includes(data.requestId)||data.installed!==true||typeof data.enabled!=="boolean")return;
      responded.current=true;setInstalled(true);
      if(data.requestId===controlId){pending.current=false;setBusy(false);setEnabled(data.enabled);setMessage(typeof data.error==="string"?data.error.slice(0,300):data.enabled?"已启动。从下方打开平台，悬浮窗会自动展开。":"已停止自动展开，需要时可再次启动。");}
      else if(!pending.current){setEnabled(data.enabled);if(typeof data.error==="string")setMessage(data.error.slice(0,300));}
    };
    window.addEventListener("message",receive);window.addEventListener("focus",probe);probe();
    const timer=setTimeout(()=>{if(!responded.current)setInstalled(false);},1200);
    return()=>{clearTimeout(timer);window.removeEventListener("message",receive);window.removeEventListener("focus",probe);};
  },[statusId,controlId]);
  return <section className="hm-collector-controls" aria-label="浏览器采集控制">
    <div><strong>浏览器采集助手</strong><span className="hm-collector-state" data-enabled={enabled}>{installed===null?"正在检测插件…":!installed?"请先安装／刷新新版插件":enabled?"运行中 · 支持平台自动展开":"已连接 · 可以启动"}</span><p>启动一次，从下方打开平台及原文时自动显示采集窗。</p></div>
    <div className="hm-actions"><BrowserCollector label="安装插件"/><button className="hm-primary" type="button" disabled={busy||installed!==true} data-hm-collector-action={enabled?"stop":"start"} data-hm-collector-request-id={controlId} onClick={()=>{pending.current=true;setBusy(true);setMessage(enabled?"正在停止自动展开…":"正在启动；首次请在浏览器弹窗中允许网站显示权限。");}}>{busy?"处理中…":enabled?"停止插件":"启动插件"}</button></div>
    {message&&<p className="hm-collector-message" role="status">{message}</p>}
  </section>;
}

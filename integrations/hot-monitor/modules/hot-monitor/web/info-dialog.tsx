import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {useLocation} from "react-router";
import {useModal} from "@aihot/web/components/ui/modal";

export function InfoDialog({label,title,children,description,warning=false,primary=false}:{label:string;title:string;children:ReactNode;description?:string;warning?:boolean;primary?:boolean}) {
  const [open,setOpen]=useState(false),id=useId(),panel=useRef<HTMLDivElement>(null);
  const location=useLocation();
  useModal({open,panel,onClose:()=>setOpen(false)});
  const search=new URLSearchParams(location.search);
  const topic=search.get("eventId"),mode=search.get("mode"),state=search.get("state");
  useEffect(()=>setOpen(false),[location.pathname,topic,mode,state]);
  return <div className={"hm-info-dialog"+(primary?" hm-info-dialog-primary":"")}><button type="button" className={"hm-dialog-trigger"+(primary?" hm-primary":"")+(warning?" hm-dialog-warning":"")} aria-haspopup="dialog" aria-expanded={open} title={description} onClick={()=>setOpen(true)}>{label}</button>
    {open&&typeof document!=="undefined"&&createPortal(<div className="hm-shell hm-dialog-layer">
      <button type="button" className="hm-dialog-backdrop" aria-label="关闭弹窗遮罩" tabIndex={-1} onClick={()=>setOpen(false)}/>
      <div className="hm-dialog-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="hm-dialog-header"><h2 id={id}>{title}</h2><button type="button" aria-label="关闭弹窗" onClick={()=>setOpen(false)}><span aria-hidden="true">×</span>关闭</button></header>
        <div className="hm-workspace hm-dialog-body" onClick={ev=>{if((ev.target as Element).closest('a[href]'))setOpen(false);}}>{children}</div>
      </div>
    </div>,document.body)}
  </div>;
}

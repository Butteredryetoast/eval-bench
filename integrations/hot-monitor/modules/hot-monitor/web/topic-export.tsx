import {useState} from "react";
import {copyText} from "@aihot/web/lib/clipboard";
import {useAdminAction} from "@aihot/web/features/admin/action";
import {API} from "./shared.tsx";
export function TopicExport({ids,onClear}:{ids:string[];onClear:()=>void}) {
  const action=useAdminAction();const [message,setMessage]=useState("");
  async function output(format:"copy"|"text"|"csv") {
    const result=await action.run<{count:number;text:string;csv:string}>("POST",API+"/topics/export",{ids});if(!result)return;
    if(format==="copy"){try{await copyText(result.text);setMessage(`已复制${result.count}个选题，可以粘贴给同事。`);}catch{setMessage("复制未完成，请下载文字清单。");}return;}
    const blob=new Blob([format==="csv"?result.csv:result.text],{type:format==="csv"?"text/csv;charset=utf-8":"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="猿大侠-选题清单."+(format==="csv"?"csv":"txt");a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(`已导出${result.count}个选题，选题状态未改变。`);
  }
  return <section className="hm-topic-export" aria-label="选题清单导出"><div><strong>已选{ids.length}个选题</strong><p className="hm-caption">勾选只用于本次导出，最多50条；包含摘要、关注理由、方向和原始出处。</p></div><div className="hm-actions"><button className="hm-primary" disabled={!ids.length||action.busy} onClick={()=>output("copy")}>复制选题清单</button><button disabled={!ids.length||action.busy} onClick={()=>output("text")}>下载文字</button><button disabled={!ids.length||action.busy} onClick={()=>output("csv")}>下载表格</button><button disabled={!ids.length} onClick={onClear}>清空勾选</button></div>{message&&<p role="status" className="hm-caption">{message}</p>}</section>;
}

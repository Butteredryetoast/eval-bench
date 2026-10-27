import {useRef,useState} from "react";
import {Link} from "react-router";
import {useAdminAction} from "@aihot/web/features/admin/action";
import type {Job,MonitorData} from "../contracts.ts";
import {InfoDialog} from "./info-dialog.tsx";
import {API,date,Jobs} from "./shared.tsx";
const inProgress=(job?:Job)=>Boolean(job&&["queued","running"].includes(job.status));
function Refresh({data}:{data:MonitorData}) {
  const action=useAdminAction(),submitting=useRef(false);
  const [submitted,setSubmitted]=useState<Job|null>(null),[error,setError]=useState("");
  const syncJobs=data.jobs.filter(j=>j.kind==="sync");
  const latest=submitted?syncJobs.find(j=>j.id===submitted.id):syncJobs[0];
  const current=submitted&&(!latest||latest.updatedAt<submitted.updatedAt)?submitted:latest;
  const active=syncJobs.some(inProgress)||inProgress(current);
  const label=current?({queued:"等待开始",running:"正在刷新",completed:"刷新完成",partial:"部分完成，请核对说明",failed:"刷新失败",unconfigured:"需要配置",waiting:"等待预算"}[current.status]):"可以开始刷新";
  async function start(){
    if(submitting.current||active)return;
    submitting.current=true;setError("");
    try{const job=await action.run<Job>("POST",API+"/sync",{},{success:"已安排热点同步，进度在弹窗内更新"});if(job)setSubmitted(job);else setError("未能提交刷新，请稍后重试。");}finally{submitting.current=false;}
  }
  return <>
    <p className="hm-prose">读取AIHOT动态和已接入的本机来源，核对新增报道、更正与撤回。</p>
    <div className="hm-refresh-times"><div><span>最近动态检查</span><strong>{date(data.lastHead??data.lastSync)}</strong></div><div><span>最近同步尝试</span><strong>{date(data.lastSync)}</strong></div></div>
    {data.syncHealth&&<p className="hm-caption">上次最新页核对{data.syncHealth.count}条，未入库{data.syncHealth.missing}条。这是该次检查结果。</p>}
    <section className="hm-refresh-progress" aria-label="刷新进度"><strong role="status">{label}</strong>{current&&<Jobs jobs={[current]} inline/>}</section>
    {error&&<p className="hm-caption hm-warning" role="alert">{error}</p>}
    <div className="hm-actions"><button type="button" className="hm-primary" disabled={action.busy||active} onClick={start}>{active?"刷新任务进行中…":action.busy?"正在安排…":"开始刷新"}</button><Link to="/admin/monitor/feed?origin=aihot&sort=upstream&timeBy=discovered">核对逐条动态 →</Link></div>
    <p className="hm-caption">进度会自动更新，进行中无需重复提交。关闭弹窗后，后台任务会继续。</p>
  </>;
}
export function SyncDialog({data}:{data:MonitorData}) {
  return <InfoDialog label="刷新新闻" title="手动刷新新闻" primary><Refresh data={data}/></InfoDialog>;
}

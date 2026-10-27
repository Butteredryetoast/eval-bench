import {Form,Link,useLoaderData,type LoaderFunctionArgs} from "react-router";
import {adminGet} from "@aihot/web/lib/admin.server";
import {useAdminAction} from "@aihot/web/features/admin/action";
import type {ModelUsageData} from "../contracts.ts";
import {API,Panel,Workspace,useLiveRefresh} from "./shared.tsx";
export async function loader({request}:LoaderFunctionArgs){return adminGet<ModelUsageData>(request,API+"/usage");}
export const meta=()=>[{title:"费用与自动处理 · 热点监测"}];
const money=(n:number)=>"¥"+n.toFixed(3);
export default function Usage(){
  const d=useLoaderData<typeof loader>(),action=useAdminAction();useLiveRefresh();
  return <Workspace title="费用与自动处理" subtitle="查看本站评分和标题摘要翻译的用量，控制后续自动处理。">
    <div className="hm-usage-metrics" aria-label="今日模型用量">
      <Panel title="今日调用"><strong>{d.today.calls}次</strong><p className="hm-caption">北京时间{d.today.date}</p></Panel>
      <Panel title="今日预计费用"><strong>{money(d.today.estimated)}</strong><p className="hm-caption">按高峰价估算，不是官方账单</p></Panel>
      <Panel title="剩余可用预算"><strong>{money(d.remaining)}</strong><p className="hm-caption">每日{money(d.settings.dailyBudget)}，已扣除预留额度</p></Panel>
      <Panel title="已预留额度"><strong>{money(d.reserved)}</strong><p className="hm-caption">{d.reservations}个处理中或待核对任务；{d.waiting}个任务等待预算</p></Panel>
    </div>
    <Panel title="自动处理范围">
      <Form className="hm-form" key={d.settings.updatedAt??"initial"} onSubmit={async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);await action.run("POST",API+"/usage/settings",{dailyBudget:Number(f.get("dailyBudget")),autoMode:f.get("autoMode"),translate:f.get("translate")==="on"},{success:"预算和自动处理范围已保存，下个后台周期生效"});}}>
        <label>每日模型预算（元）<input name="dailyBudget" type="number" min="0" max="1000" step="0.01" required defaultValue={d.settings.dailyBudget}/></label>
        <label>自动评分范围<select name="autoMode" defaultValue={d.settings.autoMode}><option value="off">关闭自动处理，仅手动操作</option><option value="recommended">推荐候选（建议）</option><option value="all">全部相关事件（推荐与观察）</option></select></label>
        <label className="hm-usage-toggle"><input name="translate" type="checkbox" defaultChecked={d.settings.translate}/>同时翻译范围内尚无中文的标题和摘要</label>
        <p className="hm-caption">开启后只处理新收到、近24小时发布的事件；回填存档和已过滤内容跳过。评分仍做两轮，人工评分保留。已完成的同版本请求复用回执，正文全文翻译不在此范围。</p>
        <p className="hm-caption">预算同时约束手动与自动操作，设为0暂停新的评分与翻译。额度不足的任务等待次日或提高预算后继续；关闭自动处理也会停止尚未开始的自动任务，已发出的请求会完成。</p>
        <button className="hm-primary" disabled={action.busy}>保存预算与范围</button>
      </Form>
    </Panel>
    <Panel title="最近7天的调用记录">
      <div className="hm-usage-table"><table><thead><tr><th>日期</th><th>调用次数</th><th>输入Token</th><th>其中缓存命中</th><th>输出Token</th><th>预计费用</th><th>无用量回执</th></tr></thead><tbody>{[...d.days].reverse().map(day=><tr key={day.date}><th>{day.date}</th><td>{day.calls}</td><td>{day.input.toLocaleString()}</td><td>{day.cached.toLocaleString()}</td><td>{day.output.toLocaleString()}</td><td>{money(day.estimated)}</td><td>{day.missingUsage}</td></tr>)}</tbody></table></div>
      <p className="hm-caption">无用量回执可能是请求被拒绝或结果未确认，不能据此认定免费。预留额度会在已知结果后释放；结果不明或进程中断时继续保留，需核对回执。</p>
    </Panel>
    <Panel title="费用怎么算，怎样节省">
      <p className="hm-prose">当前评分模型：{d.models.score}；翻译模型：{d.models.translate}。预算支持DeepSeek Flash，按每百万Token输入未命中2元、缓存命中0.04元、输出8元估算。全天使用高峰价格，空闲时段实际扣费通常更低。计价参考日期：2026年10月23日。</p>
      <p className="hm-prose">调用前按文本大小和最大输出预留额度，完成后按回执Token估算；两轮评分合并预留。预留期间和费用不明时，可用预算可能暂时偏低。实际收费以服务商账单为准。</p>
      <p className="hm-prose">本页仅统计本站事件评分与摘要翻译。公众号、X搜索费用，以及框架的文章采集处理调用不包含在此预算内。</p>
      <p className="hm-prose">建议先选推荐候选，复用已有中文与评分结果，确认选题后再处理全文。每天只需关注预计费用、剩余额度和等待任务。</p>
      <div className="hm-actions"><a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/" target="_blank" rel="noreferrer">DeepSeek官方价格 ↗</a><Link to="/admin/monitor/rules">查看评分与候选规则 →</Link></div>
    </Panel>
  </Workspace>;
}

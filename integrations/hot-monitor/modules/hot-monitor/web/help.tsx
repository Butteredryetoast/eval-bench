import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { MonitorData } from "../contracts.ts";
import {SearchConnections} from "./search-connections.tsx";
import {BrowserCollector} from "./browser-collector.tsx";
import { API, date, Panel, ProviderNote, Workspace } from "./shared.tsx";
export async function loader({request}:LoaderFunctionArgs) {
  const d=await adminGet<MonitorData>(request,API+"/overview?mode=all&pageSize=20");
  return {providers:d.providers,lastSync:d.lastSync,lastHead:d.lastHead,syncHealth:d.syncHealth};
}
export const meta=()=>[{title:"使用指南 · 热点监测"}];
export default function Help() {
  const d=useLoaderData<typeof loader>();
  return <Workspace title="使用指南" subtitle="一个工作区，完成发现热点、确认选题、寻找案例和交接素材。">
    <BrowserCollector/>
    <SearchConnections providers={d.providers}/>
    <Panel title="从这里开始">
      <ol className="hm-help-steps"><li><Link to="/admin/monitor">选题台</Link>：看推荐、观察、热榜和收藏；可勾选复制选题单或下载表格，点击“确定并找案例”直接开始研究。</li><li><Link to="/admin/monitor/feed">资讯流</Link>：按文章核对收录，切换全部报道、AIHOT精选和同步核对。它保留宽收录，不代表每一篇都值得写。</li><li><Link to="/admin/monitor/research">案例工作台</Link>：填写一次关键词打开各平台搜索，粘贴链接后勾选直接保存；选题与检索词会随流程保留，再到交接页复制文字或下载素材。</li><li><Link to="/admin/monitor/journals">日报汇总</Link>：同一入口切换日报、周报和月报；<Link to="/admin/monitor/catalogue">信源管理</Link>负责入口核验、试采和启停。</li></ol>
    </Panel>
    <Panel title="分数与标注怎么看"><Link to="/admin/monitor/rules">完整规则、参数与案例搜寻标准 →</Link>
      <p className="hm-prose">AIHOT参考分来自上游；自采文章评分来自框架的文章评审；本站AI/人工评分针对当前事件，分别保存。推荐候选只是筛选后的研究线索，助理初标也不等于事实验证或已确认选题。</p>
      <p className="hm-prose">“翻译”和“打分”可手动提交后台；也可在用量与预算中开启自动处理，均消耗模型额度。已有人工评分会保留；尚未评分时明确显示待评分。原作者演示、团队复现和编辑判断也分开记录。</p>
    </Panel>
    <Panel title="控制模型费用"><p className="hm-prose">打开<Link to="/admin/monitor/usage">用量与预算</Link>查看Token、预计费用、预留额度和等待任务；每日默认5元，自动处理默认关闭，可选择推荐候选或全部相关事件。打开页面只读取统计。</p></Panel>
    <Panel title="同步与模型状态"><ProviderNote providers={d.providers}/><p className="hm-caption">最新页检查 {date(d.lastHead??d.lastSync)}；完整核对 {date(d.lastSync)}。{d.syncHealth?`该次最新页检查 ${d.syncHealth.count} 篇，未入库 ${d.syncHealth.missing} 篇。`:"尚无有效的最新页核对记录。"}</p><p className="hm-prose">列表每分钟只读更新，切回标签页时也会检查。电脑休眠、关机或服务停止时不会持续采集。上游动态接口主要覆盖最近7天，已保存的历史资料可用“全部存档”查询。</p><p className="hm-prose">摘要超过上游缓存期限时暂时隐藏，重新核对后恢复；已保存的案例和附件仍保留。筛选可能隐藏文章，核对是否收到时请打开资讯流的“同步核对”。</p></Panel>
    <Panel title="交接与数据保存"><p className="hm-prose">选题详情是写作方向的统一编辑入口。交接步骤只负责核对、选案例、下载文字交接单或素材包；程序使用的事件JSON也集中在那里。</p><p className="hm-prose">素材、备注和共享收藏保存在本机数据库及附件目录中。浏览器个人收藏与旧版资讯首页不再作为工作入口。</p><div className="hm-native-links"><Link to="/admin/monitor/policy/terms">使用规则</Link><Link to="/admin/monitor/policy/privacy">隐私说明</Link></div><p className="hm-caption">当前用于本机内部协作；对外上线前，仍需由运营者确认条款模板和隐私说明。</p></Panel>
  </Workspace>;
}

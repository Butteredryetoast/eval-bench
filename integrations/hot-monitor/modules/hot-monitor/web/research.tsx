import {TopicDatePicker} from "./topic-date-picker.tsx";
import {InfoDialog} from "./info-dialog.tsx";
import {caseContext} from "./navigation.ts";
import {CaseStandards} from "./case-standards.tsx";
import {SearchConnections} from "./search-connections.tsx";
import {CaseImport} from "./case-import.tsx";
import {PlatformSearch} from "./case-platform-search.tsx";
import {CaseFilters} from "./case-list-controls.tsx";
import {Pagination} from "./list-controls.tsx";
import {
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { Event, Case, Asset, Job, MonitorData, CaseListData } from "../contracts.ts";
import {
  API,
  CaseCard,
  CaseCriteria,
  Empty,
  Jobs,
  Panel,
  ProviderNote,
  Workspace,
} from "./shared.tsx";
type ResearchData = {
  events: Event[];
  topicDates?: {date:string;count:number}[];
  cases: Case[];
  assets: Asset[];
  jobs: Job[];
  providers: MonitorData["providers"];
  caseList:CaseListData;
};
export async function loader({ request }: LoaderFunctionArgs) {
  const q=new URL(request.url).searchParams;q.set("browse","candidates");
  return adminGet<ResearchData>(request,API+"/cases?"+q);
}
export const meta = () => [{ title: "寻找案例 · 案例工作台" }];
export default function Research() {
  const d = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const id = sp.get("eventId") ?? "";
  const e = d.events.find((e) => e.id === id);
  const candidates=d.cases;
  const caseFiltered=["q","platform","gap","verification","evidence","reviewed","captureMethod"].some(key=>Boolean(sp.get(key)));
  return (
    <Workspace
      title="寻找案例"
      subtitle="围绕一个已确定的选题，找出有出处、有条件、值得亲手验证的案例。"
      actions={<InfoDialog label="案例与接入说明" title="案例标准与平台接入"><CaseCriteria inline/><CaseStandards inline/><p>公众号和X可调用已接入的搜索接口；其他平台先打开搜索并收集链接。添加新闻来源不会自动开通案例搜索。</p><ProviderNote providers={d.providers}/><SearchConnections providers={d.providers} inline/></InfoDialog>}

    >
      <Jobs jobs={d.jobs} />
      <TopicDatePicker events={d.events} dates={d.topicDates} currentId={e?.id}/>
      {e?.confirmed ? (
        <>
          <Panel title="1. 打开平台找案例"><div className="hm-current-topic"><span className="hm-caption">当前选题 · 点选下方标题字格组词</span><div className="hm-actions"><Link to={"/admin/monitor/events/"+e.id+caseContext(sp,e.id)}>核对选题</Link><Link to={"/admin/monitor/cases"+caseContext(sp,e.id)}>整理已存案例（{d.caseList.savedCount}）</Link><Link to={"/admin/monitor/handoff"+caseContext(sp,e.id)}>交接导出 →</Link></div></div>
            <div className="hm-badges">
              <span className="hm-state">版本：{e.version ?? "待确认"}</span>
              <span className="hm-state">
                {e.classification?.category ?? "分类待返回"}
              </span>
            </div>
            {e.classification?.angle && (
              <p className="hm-caption">写作方向：{e.classification.angle}</p>
            )}
            <PlatformSearch key={e.id} event={e} providers={d.providers}/>
          </Panel>
          <CaseImport key={e.id+"import"} eventId={e.id}/>

          {(d.caseList.scopeCount>0||caseFiltered)&&<details className="hm-inbox" aria-label="待挑选结果区" open={caseFiltered}><summary>待挑选结果 · {d.caseList.scopeCount}</summary><p className="hm-caption">接口搜索、外部脚本或暂存的链接先放在这里；挑中后保存到案例库。你手动选好的链接可直接保存，不必再走这一层。</p>
          <CaseFilters data={d.caseList}/><Pagination page={d.caseList.page} unit="条待挑选结果"/>
          <div className="hm-case-grid">{candidates.map(c=><CaseCard key={c.id} item={c} assets={d.assets}/>)}</div>
          {!candidates.length&&<Empty>当前筛选下没有待挑选结果，可清空筛选。</Empty>}
          <Pagination page={d.caseList.page} unit="条待挑选结果"/></details>}

        </>
      ) : (
        <Panel>
          <Empty>选择一个已经确认的题目开始研究。</Empty>
        </Panel>
      )}
    </Workspace>
  );
}

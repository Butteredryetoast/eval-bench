import {TopicDatePicker} from "./topic-date-picker.tsx";
import {BrowserCollector} from "./browser-collector.tsx";
import {Link} from "react-router";
import {caseContext} from "./navigation.ts";
import { useEffect, useRef, useState } from "react";
import {
  Form,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import {CaseFilters} from "./case-list-controls.tsx";
import {Pagination} from "./list-controls.tsx";
import type { Event, Case, Asset, Job, CaseListData } from "../contracts.ts";
import { API, CaseCard, CaseCriteria, Empty, Jobs, Panel, Workspace,useLiveRefresh } from "./shared.tsx";
export async function loader({ request }: LoaderFunctionArgs) {
  const q=new URL(request.url).searchParams;q.set("browse","saved");
  return adminGet<{
    events: Event[];
    cases: Case[];
    assets: Asset[];
    jobs: Job[];
    caseList:CaseListData;
    topicDates?:{date:string;count:number}[];
  }>(
    request,
    API+"/cases?"+q,
  );
}
export const meta = () => [{ title: "案例库 · 案例工作台" }];
function Editor({ item, assets }: { item: Case; assets: Asset[] }) {
  const action = useAdminAction();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  const editedMetadata=useRef(new Set<string>());
  const metadataInputs=useRef<Record<string,HTMLInputElement|HTMLTextAreaElement|null>>({});
  useEffect(()=>{
    for(const [name,value] of Object.entries({title:item.title,author:item.author,publishedAt:item.publishedAt??"",summary:item.summary})){
      const input=metadataInputs.current[name];if(input&&!editedMetadata.current.has(name))input.value=value;
    }
  },[item.title,item.author,item.publishedAt,item.summary]);
  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function upload(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      setMessage("素材超过25MB，请截取较短片段。");
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const result = await action.run(
      "POST",
      API + "/cases/" + item.id + "/assets",
      { name: file.name, base64 },
      { success: "素材已保存" },
    );
    if (result) setMessage("已归入当前案例，素材内容尚待人工核对。");
  }
  async function record() {
    try {
      if (
        !navigator.mediaDevices?.getDisplayMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setMessage("当前浏览器不支持录屏，请上传已有录屏文件。");
        return;
      }
      stream.current = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const mime = MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";
      const rec = new MediaRecorder(stream.current, {
        mimeType: mime,
        videoBitsPerSecond: 800000,
      });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let bytes = 0;
      let tooLarge = false;
      const timer = setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, 120000);
      rec.ondataavailable = (ev) => {
        bytes += ev.data.size;
        if (bytes > 25 * 1024 * 1024) {
          tooLarge = true;
          if (rec.state === "recording") rec.stop();
        } else chunks.push(ev.data);
      };
      rec.onstop = () => {
        clearTimeout(timer);
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (tooLarge) {
          setMessage("录屏超过25MB，请录制更短片段。");
          return;
        }
        void upload(
          new File(
            chunks,
            "录屏-" + Date.now() + (mime.includes("webm") ? ".webm" : ".mp4"),
            { type: mime },
          ),
        );
      };
      stream.current.getVideoTracks()[0].onended = () => {
        if (rec.state === "recording") rec.stop();
      };
      rec.start(1000);
      setRecording(true);
      setMessage("正在录制你选择的窗口。最多2分钟；停止后保存到当前案例。");
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      setRecording(false);
      setMessage("未开始录屏。可以重新选择窗口，或上传已有文件。");
    }
  }
  return (
    <details className="hm-case-editor">
      <summary>整理备注、核对证据与收集素材</summary>
      <Form
        className="hm-form"
        onSubmit={async (ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          const updated=await action.run(
            "PATCH",
            API + "/cases/" + item.id,
            {
              ...Object.fromEntries([...editedMetadata.current].map(name=>[name,name==="publishedAt"?String(f.get(name)??"").trim()||null:f.get(name)])),
              notes: f.get("notes"),
              conditions: f.get("conditions"),
              evidence: f.get("evidence"),
              role: f.get("role"),
              verification: f.get("verification"),
              version: f.get("version") || null,
              versionEvidence: f.get("versionEvidence"),
              reviewed: f.get("reviewed") === "on",
            },
            { success: "已保存案例判断" },
          );
          if(updated)editedMetadata.current.clear();
        }}
      >
        <details className="hm-data-note" onChangeCapture={ev=>{const target=ev.target;if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement)editedMetadata.current.add(target.name);}}><summary>修改自动提取的信息（可选）</summary><p className="hm-caption">原标题、作者、日期和摘要会在保存链接后自动尝试读取，无需手工填写。公开页面缺信息或识别有误时再修改；仅提交你编辑过的字段。</p><label>案例标题<input name="title" ref={element=>{metadataInputs.current.title=element;}} maxLength={300} defaultValue={item.title}/></label><label>原作者<input name="author" ref={element=>{metadataInputs.current.author=element;}} maxLength={200} defaultValue={item.author}/></label><label>原文发布日期（含时区，可留空）<input name="publishedAt" ref={element=>{metadataInputs.current.publishedAt=element;}} placeholder="2026-10-25T12:00:00+08:00" defaultValue={item.publishedAt??""}/></label><label>案例摘要<textarea name="summary" ref={element=>{metadataInputs.current.summary=element;}} maxLength={30000} defaultValue={item.summary}/></label><p className="hm-caption">修改信息不会自动改变版本匹配、作者实测或核验状态。</p></details>
        <label>
          为什么值得采用
          <textarea name="notes" defaultValue={item.notes} />
        </label>
        <label>
          提示词、工具和测试条件
          <textarea name="conditions" defaultValue={item.conditions} />
        </label>
        <div className="hm-form-row">
          <label>
            证据来源
            <select name="evidence" defaultValue={item.evidence}>
              <option value="unknown">尚未核对</option>
              <option value="author_test">原作者实测</option>
              <option value="repost">转述或转载</option>
            </select>
          </label>
          <label>
            版本核对
            <select name="verification" defaultValue={item.verification}>
              <option value="pending">待确认</option>
              <option value="matched">版本匹配</option>
              <option value="mismatch">版本不一致</option>
            </select>
          </label>
        </div>
        <label>
          案例用途
          <select name="role" defaultValue={item.role}>
            <option value="unknown">尚未判断</option>
            <option value="example">实践或创作案例</option>
            <option value="comparison">对比评测</option>
            <option value="failure">失败与限制</option>
          </select>
        </label>
        <label>
          案例精确版本
          <input name="version" defaultValue={item.version ?? ""} />
        </label>
        <label>
          版本依据
          <textarea
            name="versionEvidence"
            defaultValue={item.versionEvidence}
          />
        </label>
        <label className="hm-form-row">
          <input
            name="reviewed"
            type="checkbox"
            defaultChecked={item.reviewed}
          />
          已人工核对材料（不等于团队已复现）
        </label>
        <button disabled={action.busy}>保存判断</button>
      </Form>
      <div
        className="hm-panel mt-4"
        onDragOver={(ev) => ev.preventDefault()}
        onDrop={(ev) => {
          ev.preventDefault();
          const file = ev.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        onPaste={(ev) => {
          const file = ev.clipboardData.files[0];
          if (file) {
            ev.preventDefault();
            void upload(file);
          }
        }}
      >
        <h3>收集截图与录屏</h3>
        <p className="hm-caption">
          可上传、拖入或粘贴图片。录屏由你选择窗口，最多2分钟，不录音；单个文件不超过25MB。
        </p>
        <div className="hm-actions">
          <input
            type="file"
            aria-label="上传案例素材"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            disabled={action.busy || recording}
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              if (file) void upload(file);
              ev.target.value = "";
            }}
          />
          {recording ? (
            <button onClick={() => recorder.current?.stop()}>
              停止并保存录屏
            </button>
          ) : (
            <button disabled={action.busy} onClick={() => void record()}>
              开始录屏
            </button>
          )}
        </div>
        {message && (
          <p className="hm-caption" role="status">
            {message}
          </p>
        )}
      </div>
      {item.platform === "wechat" && (
        <button
          disabled={action.busy}
          onClick={() =>
            action.run(
              "POST",
              API + "/cases/" + item.id + "/video",
              {},
              { success: "已安排视频入口解析；能否归档以实际文件为准" },
            )
          }
        >
          解析视频入口
        </button>
      )}
      {item.media.length > 0 && (
        <div className="hm-timeline">
          {item.media.map((m, i) => (
            <article key={i}>
              <div className="hm-actions">
                <span className="hm-state">
                  {
                    {
                      image: "图片",
                      video: "视频",
                      poster: "视频封面",
                      link: "原文入口",
                    }[m.kind]
                  }
                </span>
                <span className="hm-caption">
                  {m.status === "verified"
                    ? "文件已验证并归档"
                    : m.status === "failed"
                      ? m.error
                      : "候选地址，尚未验证文件"}
                </span>
                {m.kind !== "link" && (
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      action.run(
                        "POST",
                        API + "/cases/" + item.id + "/archive",
                        { index: i },
                        { success: "已安排媒体读取与验证" },
                      )
                    }
                  >
                    验证并归档
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="hm-assets">
        {assets
          .filter((a) => a.caseId === item.id)
          .map((a) => (
            <figure key={a.id}>
              {a.mime.startsWith("image/") ? (
                <a
                  href={API + "/assets/" + a.id}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={API + "/assets/" + a.id} alt={a.name} />
                </a>
              ) : (
                <video controls preload="none" src={API + "/assets/" + a.id} />
              )}
              <figcaption className="hm-caption">
                {a.name} · {Math.ceil(a.bytes / 1024)} KB
              </figcaption>
            </figure>
          ))}
      </div>
    </details>
  );
}
export default function Library() {
  useLiveRefresh();
  const d = useLoaderData<typeof loader>();
  const [sp]=useSearchParams();
  const cases=d.cases;
  return (
    <Workspace
      title="案例库"
      subtitle="保存链接后自动提取原文信息，保留出处、你的判断与团队复现。"
      actions={<BrowserCollector/>}

    >
      <CaseCriteria saved/>
      <Jobs jobs={d.jobs} />
      <section className="hm-current-topic" aria-label="当前案例选题"><strong>{d.events.find(e=>e.id===(sp.get("eventId")??""))?.title??"全部已保存素材"}</strong><div className="hm-actions"><TopicDatePicker events={d.events} dates={d.topicDates} currentId={sp.get("eventId")??undefined} destination="/admin/monitor/cases" alwaysDialog label={sp.get("eventId")?"切换选题":"按选题筛选"}/>{sp.get("eventId")&&<><Link to="/admin/monitor/cases">全部案例</Link><Link to={"/admin/monitor/handoff"+caseContext(sp)}>交接导出 →</Link></>}</div></section>
      <CaseFilters data={d.caseList} saved/>
      <Pagination page={d.caseList.page} unit="条案例"/>
      {cases.length ? (
        <div className="hm-case-grid hm-library-list">
          {cases.map((c) => (
            <div key={c.id} className="hm-library-entry">
              <CaseCard item={c} assets={d.assets} />
              <Editor item={c} assets={d.assets} />
            </div>
          ))}
        </div>
      ) : (
        <Panel>
          <Empty>
            当前选题或平台下没有已保存案例。可以调整筛选，或到“寻找案例”直接粘贴并保存链接。
          </Empty>
        </Panel>
      )}
      <Pagination page={d.caseList.page} unit="条案例"/>
    </Workspace>
  );
}

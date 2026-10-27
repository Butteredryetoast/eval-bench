import { Form } from "react-router";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { FORMATS, SCORE_AXES as AXES, SCORE_TYPES, type Event } from "../contracts.ts";
import { API } from "./shared.tsx";
export {AXES, SCORE_TYPES};
export function ManualScore({event:e}:{event:Event}) {
  const action=useAdminAction();
  const typeByFormat:Record<string,string>={"模型":"model_release","产品":"product_launch","行业":"industry_event","论文":"research_paper","观点":"opinion_analysis","教程":"tutorial_explainer","评测/体验":"tutorial_explainer"};
  return <details className="hm-editor-form"><summary>人工评分：按五个维度给出判断</summary>
    <p className="hm-caption">每项0–10分，系统按内容类型使用原有权重换算为100分。人工分会明确标注，自动评分不会覆盖它；入选门槛未改动。</p>
    <Form className="hm-form" onSubmit={async ev=>{ev.preventDefault(); const f=new FormData(ev.currentTarget);await action.run("POST",API+"/events/"+e.id+"/manual-score",{type:f.get("type"),axes:Object.fromEntries(AXES.map(([k])=>[k,Number(f.get(k))])),reason:f.get("reason")},{success:"已保存人工评分，满足原有门槛后会进入精选"});}}>
      <label>这条内容属于哪种形式<select name="type" defaultValue={e.scoreType??typeByFormat[e.format]??"product_launch"}>{SCORE_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {AXES.map(([key,label,help])=><label key={key}>{label}<span className="hm-caption">{help}</span><input type="number" name={key} min={0} max={10} step={1} required defaultValue={e.scoreMethod==="manual"?e.scoreAxes?.[0]?.[key]:undefined} placeholder="0–10"/></label>)}
      <label>为什么给这个分数<textarea name="reason" required maxLength={1500} defaultValue={e.scoreMethod==="manual"?e.scoreReason:""} placeholder="说明价值、证据和还需要核对的内容"/></label>
      <button disabled={action.busy}>保存人工评分</button>
    </Form>
  </details>;
}
export function ClassificationForm({event:e}:{event:Event}) {
  const action=useAdminAction();
  return <Form className="hm-form" key={e.id+JSON.stringify(e.classification)} onSubmit={async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);await action.run("POST",API+"/classifications",{schemaVersion:1,eventId:e.id,category:f.get("category"),angle:f.get("angle"),researchRequirements:String(f.get("requirements")).split("\n").map(v=>v.trim()).filter(Boolean)},{success:"已保存分类和写作方向，不需要填写JSON"});}}>
    <p className="hm-caption">你或同事都可以直接填写。保存后会同步到选题详情与交接单。</p>
    <label>准备写成哪一类<select name="category" defaultValue={e.classification?.category??e.format}>{[...new Set([...FORMATS,...(e.classification?[e.classification.category]:[])])].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>这篇文章准备怎么写<textarea name="angle" defaultValue={e.classification?.angle??""} maxLength={2000} placeholder="例如：从三个视频创作任务切入，展示效率提升及失败边界。"/></label>
    <label>还需要补充哪些材料（一行一条）<textarea name="requirements" defaultValue={e.classification?.researchRequirements.join("\n")??""} placeholder="寻找旧版本对比\n拿到原始提示词\n团队复现一次"/></label>
    <button disabled={action.busy}>保存分类与写作方向</button>
  </Form>;
}
export function ExperimentForm({event:e}:{event:Event}) {
  const action=useAdminAction();
  return <details className="hm-editor-form"><summary>手动填写一次团队实测</summary><Form className="hm-form" onSubmit={async ev=>{ev.preventDefault(); const f=new FormData(ev.currentTarget);await action.run("POST",API+"/experiments",{schemaVersion:1,eventId:e.id,experimentId:f.get("id"),version:f.get("version"),environment:f.get("environment"),input:f.get("input"),output:f.get("output"),conclusion:f.get("conclusion")},{success:"已保存团队实测记录"});}}>
    <p className="hm-caption">只填写你们真正做过的实验。同一编号再次提交会更新该记录，不会新增重复项。</p>
    <label>实测记录编号<input name="id" required placeholder="例如 deepseek-video-01" maxLength={100}/></label>
    <label>实际使用的模型或产品版本<input name="version" required defaultValue={e.version??""}/></label>
    <label>工具、设备和环境<textarea name="environment" required placeholder="客户端、Harness版本、设备与参数"/></label>
    <label>输入了什么提示词或材料<textarea name="input" required/></label>
    <label>实际得到的结果<textarea name="output" required/></label>
    <label>结论与限制<textarea name="conclusion" required placeholder="哪些有效、哪些失败；不要把未完成测试写成已验证。"/></label>
    <button disabled={action.busy}>保存团队实测</button>
  </Form></details>;
}

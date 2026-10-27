import { CASE_PLATFORM_LABELS,casePlatform,type Event,type Case,type Report,type Asset,type Experiment } from "../contracts.ts";
import { safeExport } from "./domain.ts";
import { extractCaseKeywords,platformCaseSearch } from "../case-search.ts";

function continueCaseSearch(event:Event,clean:(value:string)=>string) {
  const draft=extractCaseKeywords(event);
  return [
    "建议关键词："+clean(draft.keywords||"待补充具体产品名"),
    ...(draft.task?["任务方向："+clean(draft.task)]:[]),
    "提取说明：关键词仅用于继续搜寻，不代表主体、版本或效果已经确认。",
    ...draft.warnings.map(warning=>"待核对："+clean(warning)),
    "X继续搜索："+clean(platformCaseSearch(event,"x").url),
    "Reddit继续搜索："+clean(platformCaseSearch(event,"reddit").url),
  ];
}

// One selection drives the readable document and the attached material bundle.
export function selectCases(cases: Case[], ids?: string[]) {
  if (ids === undefined) return cases.filter(c=>c.saved);
  if (ids.some(id=>!cases.some(c=>c.id===id && c.saved)))
    throw Object.assign(new Error("所选案例不属于当前选题或尚未保存"), {statusCode:400});
  return cases.filter(c=>ids.includes(c.id) && c.saved);
}
export function handoffMarkdown(event: Event, reports: Report[], cases: Case[], assets: Array<Asset & {file?:string}>, experiments: Experiment[]) {
  const e = safeExport(event) as Event;
  const clean = (v: string) => String(safeExport(v)).replace(/^#/gm,"\\#");
  return [
    `# 选题交接：${clean(e.title)}`, "", `- 事件ID：${e.id}`, `- 领域 / 内容类型：${e.field} / ${e.format}`,
    `- 主体 / 版本：${e.product || "待确认"} / ${e.version || "待确认"}`,
    `- 选题状态：${e.confirmed ? "已确认" : "待确认"}`,
    `- 评分：${e.scoreStatus === "scored" ? `${e.score}（${e.scoreMethod === "manual" ? "人工评分" : "AI两次独立评分"}）` : "尚未评分"}`,
    "", "## 核心事实", clean(e.summary || "摘要待更新，请核对下列原始出处。"),
    "", "## 写作方向", clean(e.classification?.angle || "尚未填写，由编辑与同事讨论确认。"),
    ...(e.classification?.researchRequirements ?? []).map(v=>`- 待研究：${clean(v)}`),
    "", "## 案例继续搜寻", ...continueCaseSearch(e,clean).map(line=>"- "+line),
    "", "## 原始出处", ...reports.map(r=>`- ${clean(r.source)}：${clean(r.title)}\n  ${clean(r.url)}`),
    "", "## 本次选中的案例", ...cases.flatMap((c,i)=>[
      `### ${i+1}. ${clean(c.title)}`, `- 作者：${clean(c.author || "待核对")}`, `- 原文：${clean(c.url)}`,
      `- 版本：${clean(c.version || "待确认")}；${c.verification === "matched" ? "版本匹配" : c.verification === "mismatch" ? "版本不一致" : "仍需确认"}`,
      `- 证据：${c.evidence === "author_test" ? "作者自述实测" : c.evidence === "repost" ? "转述" : "来源待核对"}；${c.reviewed ? "已人工核对材料" : "尚未人工核对"}`,
      `- 案例主张：${clean(c.summary)}`, `- 编辑备注：${clean(c.notes || "未填写")}`, `- 测试条件：${clean(c.conditions || "待补充")}`,
      ...assets.filter(a=>a.caseId===c.id).map(a=>`- 素材：${clean(a.file || "/api/admin/monitor/assets/"+a.id)}（${clean(a.name)}）`), "",
    ]),
    "## 团队复现", ...(experiments.length ? experiments.map(x=>`- ${clean(x.version)}：${clean(x.conclusion)}\n  环境：${clean(x.environment)}`) : ["尚未提交团队复现；作者演示、编辑判断均不能替代团队实测。"]), "",
  ].join("\n");
}

// Plain text is the everyday handoff; long source text stays in the case library.
export function handoffText(event: Event, reports: Report[], cases: Case[], assets: Array<Asset & {file?:string}>, experiments: Experiment[]) {
  const clean=(value:unknown)=>String(safeExport(String(value??""))).replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").trim();
  const brief=(value:unknown,limit:number)=>{const s=clean(value).replace(/\s+/g," ");return s.length>limit?s.slice(0,limit)+"…（节录，完整内容见案例库）":s;};
  const e=safeExport(event) as Event;
  const sources=reports.filter(r=>r.active&&(!r.expiresAt||Date.parse(r.expiresAt)>Date.now())).filter((r,i,all)=>all.findIndex(x=>x.url===r.url)===i);
  return [
    "猿大侠｜选题交接",clean(e.title),"",
    "领域："+clean(e.field)+"｜类型："+clean(e.format)+"｜"+(e.confirmed?"已确认选题":"待确认选题"),
    "主体／版本："+clean(e.product||"待确认")+"／"+clean(e.version||"待确认"),
    "本站评分："+(e.scoreStatus==="scored"&&e.score!==null?String(e.score)+"（"+(e.scoreMethod==="manual"?"人工":"AI两轮")+"）":"尚未评分"),
    "事件ID："+clean(e.id),"",
    "核心信息",brief(e.summary||"摘要待更新，请核对原始出处。",800),"",
    "写作方向",brief(e.classification?.angle||"待讨论，可在选题详情补充。",600),
    ...(e.classification?.researchRequirements??[]).map(v=>"待研究："+brief(v,300)),"",
    "案例继续搜寻",...continueCaseSearch(e,clean),"",
    "原始出处",
    ...(sources.length?sources.slice(0,8).flatMap(r=>[brief(r.source,120)+"｜"+brief(r.title,200),clean(r.url)]):["暂无有效摘要出处，请回选题详情核对。"]),
    ...(sources.length>8?["其余"+(sources.length-8)+"条出处保留在选题详情。"]:[]),"",
    "本次案例："+cases.length+"条",
    ...(cases.length?cases.flatMap((c,i)=>{
      const missing=[
        !c.author?.trim()?"原作者":null,
        !c.publishedAt?"发布日期":null,
        !c.version||c.verification!=="matched"?"精确版本":null,
        !c.conditions?.trim()||/待核对|待补充|未知/.test(c.conditions)?"测试条件":null,
        c.evidence==="unknown"?"实测身份":null,
        !c.reviewed?"人工核对":null,
      ].filter(Boolean);
      return [
        (i+1)+". "+brief(c.title,250),
        "平台／作者："+CASE_PLATFORM_LABELS[casePlatform(c.url)]+"／"+clean(c.author||"待核对"),
        "原帖："+clean(c.url),
        "发布："+clean(c.publishedAt||"未知"),
        "版本："+clean(c.version||"待确认")+"；"+(c.verification==="matched"?"版本字符串匹配":c.verification==="mismatch"?"版本不一致":"版本待确认"),
        "版本依据："+brief(c.versionEvidence||"尚未填写",300),
        "证据与审核："+(c.evidence==="author_test"?"作者自述实测":c.evidence==="repost"?"转述":"身份待核对")+"；"+(c.reviewed?"已人工检查材料":"尚未人工检查"),
        "案例主张："+brief(c.summary||"待补充",500),
        "编辑备注："+brief(c.notes||"未填写",800),
        "测试条件："+brief(c.conditions||"待补充",800),
        "待补／待核对："+(missing.length?missing.join("、"):"字段已填写，效果仍以复现结果为准"),
        ...assets.filter(a=>a.caseId===c.id).map(a=>"归档素材："+clean(a.name)+" "+clean(a.file||"/api/admin/monitor/assets/"+a.id)),
        ...(assets.some(a=>a.caseId===c.id)?[]:["归档素材：暂无本机附件；媒体入口不等于已归档文件。"]),"",
      ];
    }):["本次只交接选题、方向和出处。",""]),
    "团队复现",
    ...(experiments.length?experiments.flatMap(x=>[clean(x.version)+"："+brief(x.conclusion,800),"环境："+brief(x.environment,500)]):["尚未提交团队复现。"]),
    "",
    "采用前核对：作者演示、人工检查与团队复现分别记录；保存材料不代表效果已验证。",
    "说明：长摘要已节录；本机附件路径需在热点监测中打开，交给同事时可下载素材包。","",
  ].join("\n");
}

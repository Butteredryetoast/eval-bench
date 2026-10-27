export const FIELDS = [
  "AI与大模型",
  "苹果与软件",
  "国产手机",
  "商业资本",
  "汽车",
  "游戏文娱",
  "职场社会",
] as const;
export const FORMATS = [
  "模型",
  "产品",
  "行业",
  "论文",
  "教程",
  "观点",
  "评测/体验",
] as const;
export type Origin = "aihot" | "self" | "manual";
export interface ChineseText {
  title: string;
  summary: string;
  sourceDigest: string;
}
export interface Report {
  receivedAt?: string;
  upstreamPosition?: number;
  screening?: "pass" | "block" | "unknown";
  origins?: Origin[];
  duplicateCount?: number;
  id: string;
  eventId: string;
  origin: Origin;
  externalId: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string | null;
  discoveredAt: string;
  upstreamScore: number | null;
  upstreamSelected?: boolean;
  upstreamReason?: string | null;
  localScore: number | null;
  active: boolean;
  expiresAt: string | null;
  tier: string;
  backfill?: boolean;
  chinese?: ChineseText;
}
export interface Classification {
  schemaVersion: 1;
  eventId: string;
  category: string;
  angle: string;
  researchRequirements: string[];
}
export interface Event {
  candidate?: {status:"active"|"removed";at:string;by:"rules"|"editor"};
  fieldMethod?: "rule" | "editor";
  editorialReview?: {decision:"select"|"reject"|"observe";reason:string;by:"assistant"|"editor";at:string;materialDigest:string};
  bookmarked?: boolean;
  selfArticleScore?: number | null;
  summaryExpiresAt?: string | null;
  priority?: {label:string;reasons:string[];rank:number};
  aihotScore?: number | null;
  chinese?: ChineseText;
  originalTitle?: string;
  originalSummary?: string;
  chineseStatus?: "original" | "translated" | "related" | "pending";
  freshness?: "fresh" | "refreshing" | "withdrawn";
  latestAt?: string;
  originalUrl?:string;
  originalSource?:string;
  mergedInto?: string;
  id: string;
  title: string;
  summary: string;
  field: string;
  format: string;
  product: string;
  version: string | null;
  aliases: string[];
  publishedAt: string | null;
  discoveredAt: string;
  confirmed: boolean;
  score: number | null;
  scoreStatus: "pending" | "unconfigured" | "scored" | "failed";
  scoreReason: string;
  scoreAxes?: Record<string, number>[];
  scoreMethod?: "ai" | "manual";
  scoreType?: string;
  scoreThreshold: number;
  origins: Origin[];
  sourceCount: number;
  hotRank: number | null;
  classification: Classification | null;
  upstreamStory: string | null;
  updatedAt: string;
}
export interface Medium {
  kind: "image" | "video" | "poster" | "link";
  url: string;
  status: "candidate" | "verified" | "failed";
  error?: string;
}
export interface Case {
  id: string;
  eventId: string;
  url: string;
  title: string;
  author: string;
  platform: CasePlatform;
  captureMethod?: "api" | "manual" | "batch" | "external" | "browser";
  publishedAt: string | null;
  collectedAt: string;
  summary: string;
  version: string | null;
  versionEvidence: string;
  verification: "pending" | "matched" | "mismatch";
  evidence: "unknown" | "author_test" | "repost";
  role: "unknown" | "example" | "comparison" | "failure";
  searchIntent?: "keywords" | "example" | "comparison" | "failure";
  conditions: string;
  notes: string;
  saved: boolean;
  reviewed: boolean;
  media: Medium[];
  metadata?: {
    status: "queued" | "ready" | "partial" | "failed";
    updatedAt: string;
    error?: string;
    method?: "public" | "wechat_api" | "browser";
    coverUrl?: string;
  };
}
export const CASE_PLATFORMS = ["x","reddit","youtube","wechat","xiaohongshu","douyin","bilibili","weibo","web"] as const;
export type CasePlatform = typeof CASE_PLATFORMS[number];
export const CASE_PLATFORM_LABELS:Record<CasePlatform,string>={wechat:"公众号",x:"X / 推特",reddit:"Reddit",bilibili:"B站",xiaohongshu:"小红书",weibo:"微博",douyin:"抖音",youtube:"YouTube",web:"网页"};
export const CASE_GAP_LABELS={title:"标题待补",author:"作者待补",date:"发布日期未知",version:"版本未匹配",conditions:"测试条件待补",evidence:"实测身份待核对",review:"尚未人工检查",assets:"本机附件未归档"} as const;
export function caseGaps(c:Case,assets:Pick<Asset,"caseId">[]=[]):Array<keyof typeof CASE_GAP_LABELS>{
  const out:Array<keyof typeof CASE_GAP_LABELS>=[];
  if(!c.title?.trim()||c.title==="待补充案例标题")out.push("title");
  if(!c.author?.trim())out.push("author");
  if(!c.publishedAt||!Number.isFinite(Date.parse(c.publishedAt)))out.push("date");
  if(!c.version||c.verification!=="matched")out.push("version");
  if(!c.conditions?.trim()||/^(?:原文未提供，待核对|待核对原文测试条件|待核对|未知|待补充)$/.test(c.conditions.trim()))out.push("conditions");
  if(!c.evidence||c.evidence==="unknown")out.push("evidence");
  if(!c.reviewed)out.push("review");
  if(!assets.some(a=>a.caseId===c.id))out.push("assets");
  return out;
}
export interface CaseListData {page:MonitorData["page"];scopeCount:number;savedCount:number;candidateCount:number;platforms:Array<{platform:CasePlatform;count:number}>}
export const CASE_COLLECTION_STANDARDS=[
  ["研究顺序","重点：X、Reddit；其次：YouTube、公众号；补充：小红书、抖音。B站、微博与网页继续保留。这个顺序是编辑搜寻优先级，不是自动质量排名。"],
  ["收集什么","以原帖或具体评论的永久链接为出处，关联选题；尽量补齐作者、发布时间、精确版本、案例主张、输入/提示词、测试条件、输出和限制。截图、录屏及实际下载的媒体是附件，不替代原帖。"],
  ["优先采用","与选题的主体和版本对应；原作者亲自操作；有具体任务、可看见的输入与输出，或可复现代码/提示词。正面演示、同条件对比、失败与限制都找，不只找夸赞。"],
  ["暂缓采用","只有结论/宣传图、缺版本或条件、匿名转述、搬运合集、模型自评。可以保存为线索，但不能据此写成独立测评或已验证效果；点赞、播放和评论数只参考热度。"],
  ["Reddit与X核对","优先原作者发帖及后续更新；有价值的评论保存具体评论链接，同时保留所属讨论上下文。评论里的断言仍须核对，一条讨论串的多个回复不自动算多个独立实验。"],
  ["当前怎样执行","自动搜索结果、批量链接和脚本导入先成为未审核候选，按事件＋规范链接去重。上述是编辑采用标准，当前没有自动内容质量打分或自动核实视频；收入案例库、人工检查与团队复现分别记录。"],
] as const;
export function casePlatform(url:string):CasePlatform {
  let host:string;try{host=new URL(url).hostname.toLowerCase();}catch{return "web";}
  const on=(domain:string)=>host===domain||host.endsWith("."+domain);
  if(host==="mp.weixin.qq.com")return "wechat";
  if(on("x.com")||on("twitter.com"))return "x";
  if(on("reddit.com")||host==="redd.it")return "reddit";
  if(on("bilibili.com")||host==="b23.tv")return "bilibili";
  if(on("xiaohongshu.com")||host==="xhslink.com")return "xiaohongshu";
  if(on("weibo.com")||on("weibo.cn"))return "weibo";
  if(on("douyin.com")||host==="iesdouyin.com")return "douyin";
  if(on("youtube.com")||host==="youtu.be")return "youtube";
  return "web";
}
export interface Experiment {
  schemaVersion: 1;
  experimentId: string;
  eventId: string;
  caseId?: string;
  version: string;
  environment: string;
  input: string;
  output: string;
  conclusion: string;
}
export interface Asset {
  id: string;
  caseId: string;
  name: string;
  mime: string;
  bytes: number;
  createdAt: string;
  originUrl: string | null;
}
export interface Job {
  id: string;
  eventId: string | null;
  kind: string;
  status: "queued" | "running" | "completed" | "failed" | "unconfigured" | "partial" | "waiting";
  automatic?: boolean;
  message: string;
  createdAt: string;
  updatedAt: string;
}
export const SOURCE_PLATFORMS = ["公众号","X / 推特","网站 / RSS","小红书","微博","抖音","B站","YouTube","其他 / 待确认"] as const;
export const SOURCE_KINDS = ["rss","web_list","json_list","x_search","mp_account","external"] as const;
export const SOURCE_METHODS = [
  {kind:"rss",label:"RSS订阅",suitable:"博客、媒体、Substack、公众号转RSS",needs:"公开RSS / Atom地址；通常无需凭证"},
  {kind:"web_list",label:"网页列表",suitable:"没有RSS的新闻页、博客列表、更新日志",needs:"列表地址、选择器、日期提取；需要渲染时另配Jina Reader"},
  {kind:"json_list",label:"JSON接口",suitable:"返回JSON的列表、GitHub Releases等",needs:"接口地址、条目路径、标题/链接/时间字段"},
  {kind:"x_search",label:"X账号 / 检索式",suitable:"X（推特）账号与关键词动态",needs:"SocialData凭证；按请求计费"},
  {kind:"mp_account",label:"公众号账号历史",suitable:"微信公众号",needs:"公众号原始ID或文章示例、极致了凭证；按请求计费"},
  {kind:"external",label:"外部脚本推送",suitable:"自己的采集脚本、其他平台已有采集工具",needs:"后端INGEST_TOKEN；脚本调用推送接口，收到有效文章后核验启用"},
] as const;
export interface Candidate {
  awaitingActivation?: boolean;
  platform?: string;
  registered?: boolean;
  enabled?: boolean;
  recentCount?: number;
  fields?: string[];
  sourceRole?: string;
  classificationMethod?: "manual" | "suggested";
  aliases?: string[];
  id: string;
  name: string;
  kind: string;
  handle: string | null;
  originalExample: string | null;
  example: string;
  priority: boolean;
  status: "candidate" | "verified" | "collectable" | "active";
  config?: Record<string, unknown>;
  tier?: string;
  verifiedAt?: string | null;
  lastTestError?: string | null;
  sourceId?: string | null;
}
export function sourcePlatform(c: Pick<Candidate,"kind"|"name"|"originalExample"> & {platform?:string}) {
  if(c.platform) return c.platform;
  const text=c.name+" "+(c.originalExample??"");
  if(c.kind==="mp_account"||/微信公众号|mp.weixin/.test(text)) return "公众号";
  if(c.kind==="x_search"||/(?:twitter|x)\.com|^X[：:]/i.test(text)) return "X / 推特";
  if(/bilibili|b站/i.test(text)) return "B站";
  if(/xiaohongshu|小红书|xhslink/i.test(text)) return "小红书";
  if(/weibo|微博/i.test(text)) return "微博";
  if(/douyin|抖音/i.test(text)) return "抖音";
  if(/youtube|youtu\.be/i.test(text)) return "YouTube";
  if(["rss","web_list","json_list"].includes(c.kind)||/网页|官网|博客|\bBlog\b|RSS|https?:\/\//i.test(text)) return "网站 / RSS";
  return "其他 / 待确认";
}
export interface FeedReport extends Report {
  platform: string;
  field: string;
  format: string;
  eventScore: Pick<Event,"id"|"score"|"scoreStatus"|"scoreMethod"|"candidate"|"priority">;
}
export interface MonitorData {
  events: Event[];
  jobs: Job[];
  providers: {
    wechat: boolean;
    x: boolean;
    model: boolean;
    collecting: boolean;
  };
  totals: { events: number; confirmed: number; sources: number; cases: number };
  lastSync: string | null;
  lastHead?: string | null;
  syncHealth?: {checkedAt:string|null;newestDiscoveredAt:string|null;count:number;missing:number}|null;
  page: { number: number; total: number; count: number; size: number };
  filters: { platforms: string[]; sources: string[] };
  coverage?: { imported: number; checked?: number; pages?: number; errors?: string[] };
}

export interface CatalogueGroup { platform:string; total:number; sources:Candidate[]; page:MonitorData["page"]; pageParam:string }
export interface CatalogueData {
  groups:CatalogueGroup[];
  totals:{all:number;matched:number;connected:number;enabled:number;active:number};
  platforms:{name:string;count:number}[];
  providers:MonitorData["providers"];
  jobs:Job[];
  note:string;
}
export const SCORE_AXES = [["sig","变化有多重要","是否改变能力、成本或行业格局"],["nov","有没有新信息","相对已有报道是否有实质增量"],["cred","证据是否可靠","一手出处、测试条件和可复现材料是否充分"],["reson","读者会不会关心","与普通科技读者、职场人和创作者的关联"],["act","能否实际使用","读者能否动手体验、应用或创作"]] as const;
export const SCORE_TYPES = [["model_release","新模型发布"],["product_launch","产品发布"],["tool_or_prompt","工具与创作玩法"],["research_paper","研究论文"],["industry_event","行业与商业事件"],["opinion_analysis","观点分析"],["tutorial_explainer","教程与体验"]] as const;

export const VIEW_HELP:Record<string,{label:string;description:string}> = {
  priority:{label:"推荐候选",description:"进入候选后保留，评分低于门槛也不会自动移出。编辑用红色按钮手动取消；原文、分数和案例始终保留，可从全部事件重新加入。日期和其他筛选仍然生效；候选不等于已核实效果。"},
  observe:{label:"观察",description:"暂不优先写：例行更新、争议/预告、评分未达标、意义或证据待补，以及被标为观察的内容。补出新证据后可重新判断。"},
  rejected:{label:"已过滤",description:"不进入推荐：有效的不建议写标注、明确无关的预筛结果、促销/常规商品或范围外消息。原始报道仍保留，可在详情修改标注。"},
  selected:{label:"本站精选",description:"本站独立评分已完成，平均分达到该事件保存的入选门槛。AIHOT参考分不能直接入选；精选也不等于已经确认写作或验证效果。"},
  all:{label:"全部事件",description:"同一事件的多篇报道合并展示，保留观察、过滤和未评分事件；每篇原始文章可在资讯流核对。"},
  hot:{label:"热榜",description:"展示当前有AIHOT热榜名次的事件，按上游名次排列；它是讨论热度参考，不是本站评分排名。"},
  confirmed:{label:"已确认",description:"编辑在详情明确确认要研究或写作的选题，可进入案例搜索；这个状态不会由高分自动生成。"},
  bookmarked:{label:"收藏",description:"编辑主动收藏的共享选题，不代表已通过评分、已确认选题或已经验证。"},
};
export interface MonitorRules {
  version:string; scoreMaterial:{maxReports:number;maxSummaryChars:number;passes:number}; weights:Record<string,number[]>; thresholds:Record<string,number>;
  axes:typeof SCORE_AXES; types:typeof SCORE_TYPES; recencyHours:number;
  patterns:Record<string,string>;newSourceIntervalMinutes:number;
  models:{score:string;translate:string};
  search:{keywordLimit:number;receiptWindowMinutes:number;xFallbackDays:number;mpRecentDays:number;mpHistoryDays:number;wechat:Record<string,number>;comparison:string;failure:string;xComparison:string;xFailure:string};
}
export const PLATFORM_CAPABILITIES = [
  {platform:"Reddit",collect:"可通过已有脚本external接入；尚无本站专用拉取适配",search:"已提供平台搜索、帖子/评论链接收集、脚本导入；自动API待接入",next:"先保存原帖/具体评论链接和上下文；自动搜索需核实可用API权限与凭证，不把网页搜索入口当成后台采集。"},
  {platform:"公众号",collect:"已实现：极致了账号历史",search:"已实现：极致了关键词搜索",next:"填写公众号ID或原文示例，后端配置极致了凭证，试采成功再启用。"},
  {platform:"X / 推特",collect:"已实现：SocialData账号/检索式",search:"已实现：SocialData全站关键词搜索",next:"后端配置SocialData凭证；新闻源可填from:账号，案例搜索围绕事件关键词进行。"},
  {platform:"网站 / RSS",collect:"已实现：RSS、网页列表、JSON列表",search:"平台搜索入口、手动/批量收集、脚本导入；无通用全网自动搜索",next:"可接公开订阅或许可的列表接口，需配置字段/时间提取；案例可先手动粘贴链接。"},
  {platform:"小红书 / 微博 / 抖音 / B站 / YouTube",collect:"可登记候选；RSS/网页/JSON逐源试采，已有脚本也可用external推送",search:"平台搜索入口＋批量链接收集＋案例脚本导入；自动搜索适配待接入",next:"有许可的API或自己的采集工具时，推送带原文与日期的文章，核验后纳入自采；案例可批量收集或向已确认选题导入脚本结果；自动案例搜索需另接适配器。"},
] as const;

export interface ModelSpendingSettings {
  dailyBudget: number;
  autoMode: "off" | "recommended" | "all";
  translate: boolean;
  enabledAt: string | null;
  updatedAt: string | null;
}
export interface ModelUsageDay {
  date: string; calls: number; input: number; output: number; cached: number;
  estimated: number; missingUsage: number;
}
export interface ModelUsageData {
  settings: ModelSpendingSettings;
  today: ModelUsageDay;
  days: ModelUsageDay[];
  reserved: number;
  reservations: number;
  remaining: number;
  waiting: number;
  models: {score:string;translate:string};
}


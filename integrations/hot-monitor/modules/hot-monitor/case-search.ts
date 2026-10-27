import type {Event,CasePlatform} from "./contracts.ts";
export const CASE_KEYWORD_LIMIT=140;
export const CASE_SEARCH_TERMS={comparison:"实测",failure:"问题",xComparison:"(test OR review OR comparison OR 实测 OR 对比)",xFailure:"(fail OR failure OR limitations OR 失败 OR 问题)",xExample:"(demo OR showcase OR example OR 案例 OR 实测)"};
export type KeywordSource="auto"|"manual"|"title";
export type SearchIntent="keywords"|"example"|"comparison"|"failure";
export type SearchPrecision="precise"|"broad";
type Subject={name:string;zh:string;aliases:string[]};
const subjects:Subject[]=[
  ["DeepSeek","DeepSeek",["DeepSeek","深度求索"]],["Claude","Claude",["Claude","克劳德"]],["ChatGPT","ChatGPT",["ChatGPT"]],
  ["GPT","GPT",["GPT"]],["Codex","Codex",["Codex"]],["Gemini","Gemini",["Gemini"]],["Grok","Grok",["Grok"]],
  ["Kimi","Kimi",["Kimi"]],["Qwen","通义千问",["Qwen","通义千问","千问"]],["MiniMax","MiniMax",["MiniMax"]],
  ["GLM","GLM",["GLM","智谱"]],["Hunyuan","腾讯混元",["Hunyuan","混元"]],["Kling","可灵",["Kling","可灵"]],
  ["Seedance","Seedance",["Seedance"]],["Midjourney","Midjourney",["Midjourney"]],["ElevenLabs","ElevenLabs",["ElevenLabs"]],
  ["Runway","Runway",["Runway"]],["Sora","Sora",["Sora"]],["Doubao","豆包",["Doubao","豆包"]],["Jimeng","即梦",["Jimeng","即梦"]],
  ["vLLM","vLLM",["vLLM"]],["SGLang","SGLang",["SGLang"]],["DeepInfer","DeepInfer",["DeepInfer"]],
  ["Dessa","Dessa",["Dessa"]],["Conductor","Conductor",["Conductor"]],["Cursor","Cursor",["Cursor"]],["元宝","元宝",["元宝"]],
  ["iPhone","iPhone",["iPhone","苹果手机"]],["MacBook","MacBook",["MacBook"]],["Apple Vision Pro","Apple Vision Pro",["Apple Vision Pro","Vision Pro"]],
  ["Apple","苹果",["Apple","苹果"]],["OpenAI","OpenAI",["OpenAI"]],["Anthropic","Anthropic",["Anthropic"]],
  ["Tesla","特斯拉",["Tesla","特斯拉"]],["Xiaomi","小米",["Xiaomi","小米"]],["Huawei","华为",["Huawei","华为"]],
].map(([name,zh,aliases])=>({name:name as string,zh:zh as string,aliases:aliases as string[]}));
const tasks=[
  {zh:"3D",en:"3D",pattern:/3D|三维|建模/i},
  {zh:"视频",en:"video",pattern:/视频|video|动效|\bMV\b/i},
  {zh:"编程",en:"coding",pattern:/编程|代码|coding|code generation|程序开发/i},
  {zh:"图像",en:"image",pattern:/图像|生图|绘图|画图|image generation/i},
  {zh:"语音",en:"voice",pattern:/语音|voice|音色|配音|speech/i},
  {zh:"游戏",en:"game",pattern:/游戏|game/i},
  {zh:"可视化",en:"visualization",pattern:/可视化|visualization/i},
  {zh:"搜索",en:"search",pattern:/搜索|检索|search/i},
  {zh:"办公",en:"workflow",pattern:/办公|工作流|workflow|Excel|PPT|演示文稿/i},
  {zh:"电影",en:"film",pattern:/电影|短剧|film/i},
];
const normal=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
const clean=(s:string)=>s.replace(/[“”"‘’]/g,"").replace(/\s+/g," ").trim();
const present=(value:string,text:string)=>Boolean(value.trim())&&normal(text).includes(normal(value));
const stop=/^(?:AI|API|SDK|CEO|RSS|IT|SOTA|Token|Tokens|New|The|This|Introducing|Official|Update|Release|Blog|Max|Pro|Flash)$/i;
export interface CaseKeywordDraft {subject:string;version:string|null;task:string|null;keywords:string;confidence:"matched"|"inferred"|"uncertain";broadKeywords:string;warnings:string[]}
export function extractCaseKeywords(e:Pick<Event,"product"|"title"|"summary"|"version">):CaseKeywordDraft {
  const title=e.title.normalize("NFKC"),material=title+" "+e.summary.slice(0,4000);
  const found=subjects.flatMap(s=>{const positions=s.aliases.map(a=>{const i=title.toLowerCase().indexOf(a.toLowerCase());if(i<0)return -1;if(/^[a-z]+$/i.test(a)&&/[a-z]/i.test(title[i-1]??""))return -1;return i;}).filter(i=>i>=0);return positions.length?[{...s,at:Math.min(...positions)}]:[];}).sort((a,b)=>a.at-b.at||b.name.length-a.name.length);
  const releaseText=/(?:发布|推出|开源|上线|介绍)([^，,。；;：:]{0,80})/.exec(title)?.[1]??"";
  const release=[...releaseText.matchAll(/[A-Za-z][A-Za-z0-9.+_-]*(?:\s+(?:mini|pro|flash|code|sdk|bot|opus|sonnet|agent|agents|glimmer|astra|scanner)){0,2}/gi)].map(m=>m[0]).find(s=>!stop.test(s));
  const quoted=/《([^》]{2,32})》/.exec(title)?.[1];
  const explicit=e.product?.trim()&&e.product.length<=70&&present(e.product,material)?clean(e.product):null;
  let subject=explicit||(release&&!stop.test(release)?clean(release):null)||found[0]?.name||quoted||"";
  let confidence:CaseKeywordDraft["confidence"]=subject?"matched":"inferred";
  if(!subject){
    const latin=title.match(/[A-Za-z][A-Za-z0-9_-]{2,}(?:\s+(?:mini|pro|flash|SDK|Agent|Bot)){0,2}/g)?.find(s=>!stop.test(s));
    const words=[...new Intl.Segmenter("zh-CN",{granularity:"word"}).segment(title)].filter(v=>v.isWordLike&&v.segment.length>=2&&!/发布|推出|上线|更新|正式|全新|模型|产品|工具|实测|体验|今天|最新|重磅|终于|首次|支持|能力|宣布|一个|如何|这个|已经|可以|作者|网友|分享|有关|消息|新闻|人工智能/.test(v.segment)).map(v=>v.segment);
    subject=clean(latin||quoted||words.slice(0,2).join(" ")).slice(0,40);
    if(!subject)confidence="uncertain";
  }
  // Only a version adjacent to the chosen subject, or explicitly stored and present in the material, is suggested.
  const known=subjects.find(s=>s.aliases.some(a=>present(a,subject)));
  const spellings=[subject,...(known?.aliases??[])].filter(Boolean);
  const nearby:string[]=[];
  for(const spelling of spellings){let offset=0;while(offset<title.length){const at=title.toLowerCase().indexOf(spelling.toLowerCase(),offset);if(at<0)break;nearby.push(title.slice(at+spelling.length,at+spelling.length+70));offset=at+spelling.length;}}
  const adjacent=/^\s*[-–—]?\s*((?:(?:Opus|Sonnet|Haiku|Bot|Code)\s+)?[vVkK]?\d+\.\d+(?:\.\d+)?(?:[- ](?:Flash|Pro|mini|Max|Astra|Sol|Thinking)){0,2}(?:[- ]\d{4})?)\b/i;
  let version=e.version&&e.version.length<=70&&present(e.version,material)?clean(e.version):nearby.map(t=>t.match(adjacent)?.[1]).find(Boolean)??null;
  if(!version&&/^(?:GPT|iPhone|Gemini|Sora|Qwen|GLM|Grok|Kling|Midjourney|Voxtral|Llama)$/i.test(known?.name??subject))version=nearby.map(t=>t.match(/^\s*[- ]?\s*(\d{1,2}(?![\d.])(?:[- ](?:Pro|Max|mini|Astra|Sol|[0-9.]+B)){0,2})\b/i)?.[1]).find(Boolean)??null;
  if(version&&nearby.some(t=>{const at=t.indexOf(version!);return at>=0&&/^(?:周|天|小时|分钟|倍|元|万|亿|%|个|款|条|美元|人民币)/.test(t.slice(at+version!.length));}))version=null;
  const task=tasks.find(t=>t.pattern.test(title))?.zh??null;
  const warnings:string[]=[];
  if(e.version&&!present(e.version,material))warnings.push("已存版本未出现在当前标题摘要，未用于搜索");
  const distinct=found.filter((s,i)=>!found.slice(0,i).some(p=>p.at===s.at||p.name.includes(s.name)||s.name.includes(p.name)));
  if(distinct.length>1||/日报|早报|周报|盘点|汇总/.test(title))warnings.push("标题涉及多个主体或汇总信息，请核对本次要研究的对象");
  if(confidence!=="matched")warnings.push("主体为规则建议，请确认或改成具体产品名");
  const keywords=version&&present(version,subject)?subject:version&&present(subject,version)?version:[subject,version].filter(Boolean).join(" ");
  const broadKeywords=version&&present(version,subject)?(known?.name??clean(subject.replace(version,"").replace(/[-_.]+$/,""))):subject;
  return {subject,version,task,keywords,broadKeywords,confidence,warnings};
}
function platformSubject(text:string,platform:CasePlatform) {
  const overseas=["x","reddit","youtube"].includes(platform);
  let out=clean(text);
  for(const s of subjects){for(const alias of s.aliases){if(present(alias,out)){
    const wanted=overseas?s.name:s.zh;if(alias!==wanted)out=out.replace(new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"ig"),wanted);
    break;
  }}}
  return out;
}
const intentWords={example:{zh:"案例",en:"demo"},comparison:{zh:"实测",en:"review"},failure:{zh:"问题",en:"limitations"}};
export function platformCaseSearch(e:Pick<Event,"product"|"title"|"summary"|"version"|"publishedAt">,platform:CasePlatform,intent:SearchIntent="keywords",customQuery?:string,precision:SearchPrecision="precise",now=Date.now(),keywordSource?:KeywordSource) {
  const draft=extractCaseKeywords(e),base=clean(customQuery===undefined?draft.keywords:customQuery).slice(0,CASE_KEYWORD_LIMIT);
  const automatic=(keywordSource===undefined||keywordSource==="auto")&&(customQuery===undefined||normal(customQuery)===normal(draft.keywords));
  const plain=intent==="keywords";
  const core=plain?base:platformSubject(precision==="broad"&&automatic?draft.broadKeywords:base,platform);
  const overseas=["x","reddit","youtube"].includes(platform),task=!plain&&precision==="precise"&&automatic&&draft.task?tasks.find(t=>t.zh===draft.task):null;
  const taskWord=task?(overseas?task.en:task.zh):"";
  const terms=[core,...(taskWord&&!present(taskWord,core)?[taskWord]:[])].filter(Boolean);
  let query=terms.join(" ");
  const published=e.publishedAt?Date.parse(e.publishedAt):NaN;
  const since=new Date(Number.isFinite(published)&&published<=now?published-86400000:now-7*86400000).toISOString().slice(0,10);
  let explanation="使用短关键词，不发送X的日期或布尔语法；时间和排序需在平台内调整。";
  if(platform==="x"){
    const words=intent==="failure"?CASE_SEARCH_TERMS.xFailure:intent==="comparison"?CASE_SEARCH_TERMS.xComparison:CASE_SEARCH_TERMS.xExample;
    const known=subjects.find(s=>normal(core).startsWith(normal(s.name))||normal(core).startsWith(normal(s.zh)));
    if(!plain&&known&&known.aliases.length>1){const alias=known.aliases.find(a=>core.toLowerCase().startsWith(a.toLowerCase()));if(alias)query='('+known.aliases.slice(0,2).map(a=>'"'+a+'"').join(" OR ")+') '+query.slice(alias.length).replace(/^[-–—]+/,"").trimStart();}
    query+=!plain&&precision==="precise"?" "+words+" since:"+since:"";
    explanation=plain?"默认只使用输入框关键词，不自动添加用途、任务、日期或别名；需要时再选择优化搜索。":precision==="precise"?"X使用同义意图词OR组与since日期；包含回复，避免遗漏原帖下的实测。使用现有最新搜索入口，实际排序以平台页面为准。":"X放宽模式不自动限定日期和用途，保留手动关键词；在平台内按需筛选。";
  }else if(platform==="reddit"){
    const words=intent==="failure"?"(failure OR problem OR limitations)":intent==="comparison"?"(review OR test OR comparison)":"(demo OR showcase OR experience)";
    query=terms.flatMap(t=>t.split(/\s+/)).filter(Boolean).map(t=>'"'+t.replaceAll('"',"")+'"').join(" AND ")+(!plain&&precision==="precise"?" AND "+words:"");
    explanation=plain?"Reddit将所选词用AND组合，不追加用途或日期；可在站内切换帖子和评论。":"Reddit使用AND与意图词OR组，按相关性找帖子；可切换评论。未强制最近一周，避免漏掉旧版本材料。";
  }else{
    const word=plain?"":overseas?intentWords[intent].en:intentWords[intent].zh;
    if(!plain&&precision==="precise"&&!present(word,query))query+=" "+word;
    if(platform==="youtube")explanation=plain?"YouTube默认只搜输入框关键词，日期和排序在站内筛选。":"YouTube使用短英文任务词与一个意图词；不套用API参数，日期与排序在站内筛选。";
    if(platform==="wechat")explanation="公众号使用短中文关键词；手动入口为搜狗微信，接口搜索为极致了，覆盖与排序不完全相同。";
  }
  query=query.trim();const q=encodeURIComponent(query);
  const url=({wechat:"https://weixin.sogou.com/weixin?type=2&query="+q,x:"https://x.com/search?f=live&q="+q,reddit:"https://www.reddit.com/search/?sort=relevance&q="+q,bilibili:"https://search.bilibili.com/all?keyword="+q,xiaohongshu:"https://www.xiaohongshu.com/search_result?keyword="+q,weibo:"https://s.weibo.com/weibo?q="+q,douyin:"https://www.douyin.com/search/"+q,youtube:"https://www.youtube.com/results?search_query="+q,web:"https://www.bing.com/search?q="+q})[platform];
  return {draft,base,query,url,since,explanation};
}

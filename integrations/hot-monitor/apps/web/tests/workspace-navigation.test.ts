import {topicDay,topicDateCounts} from "../../../modules/hot-monitor/topic-dates.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser,type Page } from "@playwright/test";
import { fakeApi, startWebServer, visit, type WebServer } from "./web-server.ts";
import {CASE_PLATFORMS,casePlatform} from "../../../modules/hot-monitor/contracts.ts";
let web:WebServer;
let browser:Browser;
let failOverview=false;let showTopics=false;let exportedIds:string[]=[];
let candidateIncluded=true,scoreStarted=0;
const connectionRows=[{provider:"dajiala",name:"极致了 · 公众号",hasKey:true,enabled:true,baseUrl:"https://www.dajiala.com",managedBy:"file",editable:true,capabilities:["公众号关键词搜索"]},{provider:"socialdata",name:"SocialData · X",hasKey:false,enabled:false,baseUrl:"https://api.socialdata.tools",managedBy:"file",editable:true,capabilities:["X账号与关键词搜索"]}];
let connectionSaved:any=null;
let refreshJobs:any[]=[];let refreshRequests=0;
let pickerTopics:any[]=[];let dateReads:Record<string,number>={};let failTopicDate=false;
let remotePickerTopics:Record<string,any[]>={};
const providers={wechat:false,x:false,model:false,collecting:false};
const caseRows:any[]=[];
const hydrationRequests:Array<{id:string;mode:string}>=[],caseEdits:any[]=[];
let spendingSettings={dailyBudget:5,autoMode:"off",translate:true,enabledAt:null,updatedAt:null as string|null};
const directorySources=Array.from({length:45},(_,i)=>({id:"source-"+i,name:"公众号：账号"+String(i+1).padStart(2,"0"),platform:"公众号",kind:"mp_account",handle:null,originalExample:null,example:"",priority:false,status:"candidate",fields:[],sourceRole:"待分类",aliases:["别名"+i]}));
const event={product:"DeepSeek",aliases:[],scoreThreshold:76,id:"event-demo",title:"DeepSeek测试选题",summary:"真实测试素材摘要",field:"AI与大模型",format:"模型",confirmed:true,classification:null,version:null,origins:["aihot"],score:null,scoreStatus:"pending",scoreReason:"待评分",scoreMethod:null,sourceCount:1,hotRank:null,discoveredAt:new Date().toISOString(),publishedAt:new Date().toISOString()};
async function navigateWorkspace(page:Page,primary:string,child:string){
  const opener=page.getByRole("button",{name:"打开导航",exact:true});
  const drawer=page.getByRole("dialog",{name:"工作区导航",exact:true});
  if(await opener.isVisible()&&!await drawer.isVisible())await opener.click();
  const nav=await drawer.isVisible()?drawer.getByRole("navigation",{name:"工作区导航",exact:true}):page.getByRole("navigation",{name:"工作区导航",exact:true});
  const parent=nav.getByRole("button",{name:primary,exact:true});if(await parent.getAttribute("aria-expanded")!=="true")await parent.click();
  const link=nav.getByRole("link",{name:child,exact:true});const href=await link.getAttribute("href");await link.click();if(href)await expect(page).toHaveURL(url=>url.pathname===new URL(href,web.origin).pathname);
}
async function openInbox(page:Page){const area=page.getByLabel("待挑选结果区",{exact:true});await expect(area).toBeVisible();if(!await area.getByRole("combobox",{name:"结果平台",exact:true}).isVisible())await area.getByText(/^待挑选结果 · \d+$/).click();}
before(async()=>{
  web=await startWebServer(fakeApi(async(url,res,req)=>{
    if(url.pathname==="/api/admin/monitor/connections")return {connections:connectionRows};
    if(url.pathname.startsWith("/api/admin/monitor/connections/")&&req.method==="POST"){let body="";for await(const chunk of req)body+=String(chunk);connectionSaved=JSON.parse(body);const c=connectionRows.find(c=>c.provider===url.pathname.split("/").at(-1))!;c.hasKey=Boolean(connectionSaved.key)||c.hasKey;c.enabled=c.hasKey;c.baseUrl=connectionSaved.baseUrl||c.baseUrl;return c;}
    if(url.pathname==="/api/admin/monitor/events/event-demo/candidate"&&req.method==="POST"){let body="";for await(const chunk of req)body+=String(chunk);candidateIncluded=JSON.parse(body).included;return {...event,candidate:{status:candidateIncluded?"active":"removed"}};}
    if(url.pathname==="/api/admin/monitor/events/event-demo/score"&&req.method==="POST"){scoreStarted=Date.now();refreshJobs=[{id:"score-live",eventId:event.id,kind:"score",status:"queued",message:"等待评分",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];return refreshJobs[0];}
    if(url.pathname==="/api/admin/monitor/collector/extension.zip"){res.setHeader("content-type","application/zip");res.setHeader("content-disposition",'attachment; filename="hot-monitor-collector.zip"');res.end("fixture extension download");return;}
    if(url.pathname==="/api/admin/monitor/sync"&&req.method==="POST"){refreshRequests++;const now=new Date().toISOString();const job={id:"refresh-fixture",eventId:null,kind:"sync",status:"queued",message:"等待后台任务处理",createdAt:now,updatedAt:now};refreshJobs=[job];return job;}
    if(url.pathname==="/api/admin/monitor/usage/settings") {let body="";for await(const chunk of req)body+=String(chunk);spendingSettings={...spendingSettings,...JSON.parse(body),updatedAt:new Date().toISOString()};return spendingSettings;}
    if(url.pathname==="/api/admin/monitor/usage") {const today={date:"2026-10-23",calls:20,input:20896,output:3215,cached:9851,estimated:.05,missingUsage:1};return {settings:spendingSettings,today,days:[today],reserved:.1,reservations:1,remaining:Math.max(0,spendingSettings.dailyBudget-.15),waiting:2,models:{score:"deepseek-flash",translate:"deepseek-flash"}};}
    if(url.pathname==="/api/admin/monitor/topics") {const date=url.searchParams.get("date")??"unknown";dateReads[date]=(dateReads[date]??0)+1;if(failTopicDate){res.statusCode=503;return {detail:"fixture date unavailable"};}return {events:remotePickerTopics[date]??[event,...pickerTopics].filter(e=>topicDay(e)===date)};}
    if(url.pathname==="/api/admin/monitor/topics/export"){let body="";for await(const chunk of req)body+=String(chunk);exportedIds=JSON.parse(body).ids;return {count:exportedIds.length,text:"猿大侠选题清单\nDeepSeek测试选题",csv:"选题\nDeepSeek测试选题"};}
    if(url.pathname==="/api/admin/monitor/events/event-demo/handoff") {res.setHeader("content-type","text/plain; charset=utf-8");const ids=(url.searchParams.get("cases")??"").split(",");res.end("测试交接文字\n"+caseRows.filter(c=>ids.includes(c.id)).map(c=>c.title).join("\n"));return;}
    if(url.pathname==="/api/admin/monitor/events/event-demo"&&req.method==="PATCH")return {...event,confirmed:true};
    if(url.pathname==="/api/admin/monitor/events/event-demo"&&req.method==="GET")return {event,reports:[{id:"early",eventId:event.id,origin:"aihot",active:true,title:"最早的事实报道",source:"官网",url:"https://example.com/early",summary:"首条报道",publishedAt:"2026-01-01T00:00:00Z",discoveredAt:"2026-01-01T01:00:00Z"},{id:"late",eventId:event.id,origin:"aihot",active:true,title:"后续的事实报道",source:"媒体",url:"https://example.com/late",summary:"后续报道",publishedAt:"2026-01-02T00:00:00Z",discoveredAt:"2026-01-02T01:00:00Z"}],cases:[],assets:[],experiments:[],jobs:[],providers};
    if(url.pathname==="/api/admin/monitor/overview" && failOverview) {res.statusCode=503;return {detail:"fixture unavailable"};}
    if(url.pathname==="/api/admin/monitor/overview") {const done=Boolean(scoreStarted&&Date.now()-scoreStarted>2200);if(done)refreshJobs=refreshJobs.map(j=>j.id==="score-live"?{...j,status:"completed"}:j);const visible=showTopics&&(url.searchParams.get("mode")!=="priority"||candidateIncluded);return {events:visible?[{...event,confirmed:false,candidate:{status:candidateIncluded?"active":"removed"},originalUrl:"https://example.org/original-topic",...(done?{score:51,scoreStatus:"scored",scoreMethod:"ai"}:{})}]:[],jobs:refreshJobs,providers,page:{number:1,total:1,count:visible?1:0,size:20},filters:{platforms:[],sources:[]},totals:{events:1,confirmed:1,cases:0,sources:0},lastSync:null};}
    if(url.pathname==="/api/admin/monitor/feed") return {reports:[],jobs:[],providers,page:{number:1,total:1,count:0,size:20},filters:{platforms:[],sources:[]}};
    if(url.pathname==="/api/admin/monitor/cases/import") {
      let body="";for await(const chunk of req)body+=String(chunk);const b=JSON.parse(body);
      for(const [i,item] of b.items.entries())caseRows.push({...item,id:"case-"+(caseRows.length+i),eventId:b.eventId,title:"待补充案例标题",author:"",summary:"",publishedAt:null,collectedAt:new Date().toISOString(),version:null,versionEvidence:"未确认",verification:"pending",evidence:"unknown",role:"unknown",searchIntent:b.intent,notes:b.note??"",saved:b.destination==="library",reviewed:false,media:[],captureMethod:"batch"});
      return {created:b.items.length,existing:0,adopted:b.destination==="library"?b.items.length:0,metadataQueued:b.destination==="library"?b.items.length:0};
    }
    if(/^\/api\/admin\/monitor\/cases\/[^/]+\/hydrate$/.test(url.pathname)&&req.method==="POST") {
      let body="";for await(const chunk of req)body+=String(chunk);const {mode}=JSON.parse(body),id=url.pathname.split("/").at(-2)!;hydrationRequests.push({id,mode});
      const c=caseRows.find(c=>c.id===id);if(mode==="public")Object.assign(c,{title:"自动读取的原标题",author:"原文作者",summary:"这是原网页提供的简介",media:[{kind:"image",url:web.origin+"/favicon.ico",status:"candidate"},{kind:"poster",url:web.origin+"/icon.png",status:"candidate"}],metadata:{status:"ready",coverUrl:web.origin+"/icon.png",updatedAt:new Date().toISOString()}});
      return {id:"metadata-fixture",status:"completed"};
    }
    if(url.pathname.startsWith("/api/admin/monitor/cases/")&&req.method==="PATCH") {
      let body="";for await(const chunk of req)body+=String(chunk);const b=JSON.parse(body);caseEdits.push(b);const c=caseRows.find(c=>c.id===url.pathname.split("/").at(-1));Object.assign(c,b);return c;
    }
    if(url.pathname==="/api/admin/monitor/cases") {
      const browse=url.searchParams.get("browse");const scope=caseRows.filter(c=>browse==="saved"||url.searchParams.get("saved")==="true"?c.saved:browse==="candidates"?!c.saved:true);
      const words=(url.searchParams.get("q")??"").toLowerCase().split(/\s+/).filter(Boolean);
      const rows=scope.filter(c=>(!url.searchParams.get("platform")||casePlatform(c.url)===url.searchParams.get("platform"))&&words.every(w=>[c.title,c.author,c.version,c.notes,c.url].join(" ").toLowerCase().includes(w)));
      const number=Number(url.searchParams.get("page"))||1;
      return {events:[event,...pickerTopics],topicDates:topicDateCounts([event,...pickerTopics]),cases:browse?rows.slice((number-1)*20,number*20):rows,caseList:{page:{number,total:Math.max(1,Math.ceil(rows.length/20)),count:rows.length,size:20},scopeCount:scope.length,savedCount:caseRows.filter(c=>c.saved).length,candidateCount:caseRows.filter(c=>!c.saved).length,platforms:CASE_PLATFORMS.map(platform=>({platform,count:scope.filter(c=>casePlatform(c.url)===platform).length}))},assets:[],jobs:[],providers};
    }
    if(url.pathname==="/api/admin/monitor/catalogue" && req.method==="POST") {
      let body="";for await(const chunk of req)body+=String(chunk);const b=JSON.parse(body);
      const source={...b,id:b.kind==="external"?"external-fixture":"registered-fixture",name:b.platform+"："+b.name,handle:null,originalExample:null,example:"",priority:false,status:"candidate",fields:[],sourceRole:"待分类",aliases:[]};
      directorySources.push(source);return {created:true,source};
    }
    if(url.pathname==="/api/admin/monitor/catalogue") {
      const q=url.searchParams.get("q")??"";
      const rows=directorySources.filter(c=>(c.name+" "+c.id+" "+c.aliases.join(" ")).includes(q));
      const platforms=[...new Set(directorySources.map(c=>c.platform))];
      const groups=platforms.map(platform=>{const all=rows.filter(c=>c.platform===platform);const pageParam="page_"+platform;const number=Number(url.searchParams.get(pageParam))||1;return {platform,total:all.length,pageParam,sources:all.slice((number-1)*20,number*20),page:{number,total:Math.max(1,Math.ceil(all.length/20)),count:all.length,size:20}};}).filter(g=>g.total);
      return {groups,totals:{all:directorySources.length,matched:rows.length,connected:0,enabled:0,active:0},platforms:platforms.map(name=>({name,count:directorySources.filter(c=>c.platform===name).length})),providers,jobs:[],note:"本地假服务来源目录"};
    }
    if(url.pathname==="/api/admin/monitor/rules") return {version:"fixture",scoreMaterial:{maxReports:8,maxSummaryChars:1500,passes:2},recencyHours:48,patterns:{noise:"/促销/"},newSourceIntervalMinutes:60,models:{score:"fixture-model",translate:"fixture-model"},weights:{product_launch:[2,2,1,2,3]},thresholds:{T1:60,T1_5:65,T2:76},axes:[["sig","变化有多重要","实质变化"],["nov","有没有新信息","信息增量"],["cred","证据是否可靠","证据"],["reson","读者会不会关心","相关性"],["act","能否实际使用","可用性"]],types:[["product_launch","产品发布"]],search:{keywordLimit:140,receiptWindowMinutes:10,xFallbackDays:7,mpRecentDays:7,mpHistoryDays:180,comparison:"实测",failure:"问题",wechat:{currentPage:1}}};
    if(url.pathname==="/api/admin/monitor/journals") return {items:[],report:null,jobs:[]};
  }),{},{site:"installed"});
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await web?.stop();});
test("installed-site legacy pages lead to the single workspace",async()=>{
  const links=[
    ["/","/admin/monitor"],["/all","/admin/monitor/feed"],["/hot","/admin/monitor?mode=hot"],
    ["/daily/2026-10-21","/admin/monitor/journals?kind=dailies&key=2026-10-21"],
    ["/starred","/admin/monitor?mode=all&state=bookmarked&window=all"],
    ["/topics","/admin/monitor?mode=all&window=all"],["/admin/monitor/topics","/admin/monitor?mode=all&window=all"],
    ["/agent","/admin/monitor/help"],["/admin/login","/admin/monitor/help"],
  ];
  for(const [path,location] of links){const r=await fetch(web.origin+path,{redirect:"manual"});assert.equal(r.status,302,path);assert.equal(r.headers.get("location"),location,path);}
  const home=await fetch(web.origin+"/");assert.equal(new URL(home.url).pathname,"/admin/monitor");
  const html=await home.text();assert.ok(html.includes("选题台"));assert.ok(html.includes("案例工作台"));assert.ok(!html.includes("框架原生功能"));
});
test("case workflow retains the selected event across search, library and handoff",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");
  await navigateWorkspace(page,"案例工作台","案例库");
  await expect(page).toHaveURL(/\/cases\?eventId=event-demo$/);
  await expect(page.getByRole("region",{name:"当前案例选题",exact:true})).toContainText(event.title);
  await navigateWorkspace(page,"案例工作台","交接导出");
  await expect(page).toHaveURL(/\/handoff\?eventId=event-demo$/);
  await expect(page.getByRole("link",{name:"编辑选题与写作方向"})).toHaveAttribute("href","/admin/monitor/events/event-demo?eventId=event-demo#writing");
  await page.setViewportSize({width:390,height:844});
  await navigateWorkspace(page,"案例工作台","寻找案例");await expect(page).toHaveURL(/eventId=event-demo/);
  await page.close();
});

test("workspace navigation and single-fetch refresh are not redirected to the retired admin",async()=>{
  const r=await fetch(web.origin+"/admin/monitor.data?mode=all&state=confirmed",{redirect:"manual"});
  assert.equal(r.status,200);assert.equal(r.headers.get("location"),null);
  const page=await browser.newPage();
  await visit(page,web.origin+"/admin/monitor");
  await navigateWorkspace(page,"选题台","已确认");
  await expect(page).toHaveURL(/state=confirmed/);
  await expect(page.getByRole("heading",{name:"已确认",exact:true})).toBeVisible();
  await page.close();
});
test("workspace errors recover inside the same workspace",async()=>{
  failOverview=true;
  const page=await browser.newPage();
  try {
    await page.goto(web.origin+"/admin/monitor");
    await expect(page.getByRole("heading",{name:"暂时无法加载工作区"})).toBeVisible();
    await expect(page.getByRole("link",{name:"返回选题台"})).toHaveAttribute("href","/admin/monitor");
    await expect(page.getByRole("link",{name:"回到精选"})).toHaveCount(0);
  } finally {failOverview=false;await page.close();}
});

test("source directory folds groups, changes each group's page and searches aliases",async()=>{
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor/catalogue");
  const group=page.getByLabel("公众号来源分组",{exact:true});
  await expect(page.getByText("公众号：账号01",{exact:true})).toHaveCount(0);
  await group.locator("summary").click();await expect(group.getByText("公众号：账号01",{exact:true})).toBeVisible();
  await group.getByRole("link",{name:"下一页",exact:true}).first().click();
  await expect(group.getByText("公众号：账号21",{exact:true})).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("page_公众号"),"2");
  await page.getByRole("textbox",{name:"搜索来源",exact:true}).fill("别名30");await page.getByRole("button",{name:"查找来源",exact:true}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe("别名30");
  await expect(page.getByText("公众号：账号31",{exact:true})).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("page_公众号"),null);
  await page.close();
});
test("adding a source only registers it and locates the new platform record",async()=>{
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor/catalogue");
  await page.getByRole("button",{name:"＋ 添加来源",exact:true}).click();
  await page.getByRole("textbox",{name:"来源名称",exact:true}).fill("新平台账号");
  await page.getByRole("combobox",{name:"平台",exact:true}).selectOption("B站");
  await expect(page.getByRole("combobox",{name:"采集方式",exact:true})).toHaveValue("unknown");
  await page.getByRole("button",{name:"登记来源",exact:true}).click();
  await expect(page.getByText("B站：新平台账号",{exact:true})).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("q"),"registered-fixture");
  await expect(page.getByText("候选，未试采",{exact:true}).first()).toBeVisible();await page.close();
});
test("rule explanations and case criteria are readable inside the workspace",async()=>{
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor");
  await expect(page.getByRole("heading",{name:"推荐候选",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"栏目说明",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"推荐候选说明",exact:true})).toContainText("评分低于门槛也不会自动移出");
  await page.keyboard.press("Escape");
  await navigateWorkspace(page,"规则与标准","全部规则");
  await expect(page.getByRole("table").first()).toContainText("产品发布");
  await expect(page.getByText("公众号：调用关键词搜索的第1页，不自动翻页。",{exact:false})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("heading",{name:"全部规则",exact:true})).toBeVisible();await page.close();
});
test("external registration exposes all six methods and instructions without pretending to fetch the platform",async()=>{
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor/catalogue");
  await page.getByRole("button",{name:"＋ 添加来源",exact:true}).click();
  const methods=page.getByRole("combobox",{name:"采集方式",exact:true});
  for(const kind of ["rss","web_list","json_list","x_search","mp_account","external"]) {
    await methods.selectOption(kind);await expect(methods).toHaveValue(kind);
  }
  await page.getByRole("textbox",{name:"来源名称",exact:true}).fill("自己的采集脚本");
  await page.getByRole("button",{name:"登记来源",exact:true}).click();
  await expect(page.getByText("等待有效推送与核验",{exact:true})).toBeVisible();
  await page.getByText("外部推送：查看接入示例与核验收到的文章",{exact:true}).click();
  await expect(page.getByText("POST /api/ingest/items",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"核验已收到的推送",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"测试是否能采集",exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("button",{name:"核验已收到的推送",exact:true})).toBeVisible();
  await page.close();
});
test("multi-platform case collection labels capabilities, filters candidates and adopts materials for handoff",async()=>{
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");
  await page.getByText("优化搜索与接口（按需）",{exact:true}).click();
  await expect(page.getByRole("combobox",{name:"检索平台",exact:true})).toHaveValue("x");
  await page.getByRole("button",{name:"案例与接入说明",exact:true}).click();
  await expect(page.getByRole("link",{name:"SocialData注册页",exact:true})).toHaveAttribute("href","https://socialdata.tools/signup");
  await expect(page.getByText("Reddit：先申请访问权限，自动搜索尚未接入",{exact:true})).toBeVisible();
  await expect(page.getByText("重点：X、Reddit；其次：YouTube、公众号；补充：小红书、抖音。",{exact:false})).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox",{name:"检索平台",exact:true}).selectOption("reddit");
  await expect(page.getByRole("link",{name:"打开Reddit搜索 ↗",exact:true})).toHaveAttribute("href",/www\.reddit\.com\/search\/\?sort=relevance&q=/);
  await page.getByRole("combobox",{name:"检索平台",exact:true}).selectOption("bilibili");
  await expect(page.getByRole("link",{name:"打开B站搜索 ↗",exact:true})).toHaveAttribute("href",/search\.bilibili\.com\/all\?keyword=/);
  await expect(page.getByText("当前为平台搜索入口＋链接收集",{exact:false})).toBeVisible();
  await page.getByRole("textbox",{name:"粘贴多平台链接或分享文案",exact:true}).fill("B站分享 https://www.bilibili.com/video/BVfixture\n小红书 https://www.xiaohongshu.com/explore/fixture");
  await page.getByRole("combobox",{name:"希望寻找的材料",exact:true}).selectOption("failure");
  await page.getByText("更多保存方式",{exact:true}).click();await page.getByRole("button",{name:"先放待挑选结果",exact:true}).click();await openInbox(page);
  await expect(page.getByRole("button",{name:"收入案例库",exact:true})).toHaveCount(2);
  await expect(page.getByText("检索意图：失败与限制（尚未核实类型）",{exact:false})).toHaveCount(2);
  await page.getByRole("combobox",{name:"结果平台",exact:true}).selectOption("bilibili");
  await page.getByRole("button",{name:"筛选案例",exact:true}).click();
  await expect(page.getByRole("button",{name:"收入案例库",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"收入案例库",exact:true}).click();
  await navigateWorkspace(page,"案例工作台","案例库");
  await page.getByRole("combobox",{name:"案例平台",exact:true}).selectOption("bilibili");
  await page.getByRole("button",{name:"筛选案例",exact:true}).click();
  await expect(page.getByRole("button",{name:"移出案例库",exact:true})).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole("combobox",{name:"案例平台",exact:true})).toBeVisible();
  await page.close();
});

test("case library pagination keeps the event and keyword search resets the page",async()=>{
  for(let i=0;i<45;i++)caseRows.push({id:"paged-case-"+i,eventId:"event-demo",url:"https://www.reddit.com/r/test/comments/item"+i+"/",platform:"reddit",title:"分页材料"+String(i).padStart(2,"0"),author:i===44?"Late Tester":"",notes:i===44?"v2026 full context":"",summary:"",version:null,versionEvidence:"待确认",publishedAt:null,collectedAt:new Date().toISOString(),verification:"pending",evidence:"unknown",conditions:"待核对",saved:true,reviewed:false,media:[]});
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor/cases?eventId=event-demo&platform=reddit");
  await expect(page.getByRole("button",{name:"移出案例库",exact:true})).toHaveCount(20);
  await page.getByRole("link",{name:"下一页",exact:true}).first().click();await expect(page).toHaveURL(/page=2/);
  assert.equal(new URL(page.url()).searchParams.get("eventId"),"event-demo");
  await page.getByRole("textbox",{name:"查找案例",exact:true}).fill("Late Tester");await page.getByRole("button",{name:"筛选案例",exact:true}).click();
  await expect(page.getByRole("button",{name:"移出案例库",exact:true})).toHaveCount(1);await expect(page.getByRole("heading",{name:"分页材料44",exact:true})).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("page"),null);
  await page.getByText(/^材料核对：/).click();await expect(page.getByText("测试条件待补",{exact:true}).last()).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole("textbox",{name:"查找案例",exact:true})).toBeVisible();await page.close();
});


test("model usage settings save the budget and automatic scope on desktop and mobile",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await visit(page,web.origin+"/admin/monitor/usage");
  await expect(page.getByRole("heading",{name:"费用与自动处理",exact:true})).toBeVisible();
  await expect(page.getByText("¥4.850",{exact:true})).toBeVisible();
  await page.getByLabel("每日模型预算（元）").fill("3");
  await page.getByLabel("自动评分范围").selectOption("recommended");
  await page.getByRole("button",{name:"保存预算与范围"}).click();
  await expect(page.getByText("¥2.850",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel("每日模型预算（元）")).toHaveValue("3");
  await expect(page.getByLabel("自动评分范围")).toHaveValue("recommended");
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel("每日模型预算（元）")).toBeVisible();
  await page.getByLabel("自动评分范围").selectOption("off");await page.getByRole("button",{name:"保存预算与范围"}).click();
  await expect(page.getByLabel("自动评分范围")).toHaveValue("off");
  await page.close();
});


test("shortlist exports and direct case collection keep the editorial context",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});showTopics=true;
  try{
    await visit(page,web.origin+"/admin/monitor");
    await page.getByRole("checkbox",{name:"勾选选题：DeepSeek测试选题",exact:true}).check();
    const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"下载文字",exact:true}).click();const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),"猿大侠-选题清单.txt");assert.deepEqual(exportedIds,[event.id]);
    await page.getByRole("button",{name:"确定并找案例",exact:true}).click();await expect(page).toHaveURL(/research\?eventId=event-demo/);
    const keywords=page.getByRole("textbox",{name:"关键词，可加入别名和具体任务",exact:true});await keywords.fill("DeepSeek creative task");await keywords.press("Tab");
    await expect(page.getByRole("link",{name:"去Reddit找案例 ↗",exact:true})).toHaveAttribute("href",/DeepSeek.*creative.*task/);
    await page.getByRole("link",{name:"核对选题",exact:true}).click();await expect(page.getByRole("heading",{name:"选题详情",exact:true})).toBeVisible();
    await navigateWorkspace(page,"案例工作台","寻找案例");await expect(keywords).toHaveValue("DeepSeek creative task");
    await navigateWorkspace(page,"案例工作台","案例库");await expect(page).toHaveURL(/keywords=DeepSeek/);
    await expect(page.getByRole("navigation",{name:"案例工作台子栏目",exact:true}).getByRole("link",{name:"寻找案例",exact:true})).toHaveAttribute("href",/eventId=event-demo/);
    await navigateWorkspace(page,"案例工作台","寻找案例");await expect(keywords).toHaveValue("DeepSeek creative task");
    await openInbox(page);await page.getByRole("link",{name:"清空案例筛选",exact:true}).click();await expect(page).toHaveURL(/keywords=DeepSeek/);await expect(keywords).toHaveValue("DeepSeek creative task");
    await page.getByRole("textbox",{name:"粘贴多平台链接或分享文案",exact:true}).fill("https://www.reddit.com/r/test/comments/direct/ https://youtu.be/skip-this");
    await page.locator('[aria-label="待收集链接预览"]').getByRole("checkbox").nth(1).uncheck();
    await page.getByRole("textbox",{name:"发现价值或视频时间点（可选）",exact:true}).fill("先复现这个案例");
    await page.getByRole("button",{name:"保存所选到案例库",exact:true}).click();
    assert.ok(caseRows.some(c=>c.url.includes('/direct/')&&c.saved&&c.notes==="先复现这个案例"&&!c.reviewed));assert.ok(!caseRows.some(c=>c.url.includes('skip-this')));
    await page.setViewportSize({width:390,height:844});await expect(page.getByRole("link",{name:"去Reddit找案例 ↗",exact:true})).toBeVisible();
  }finally{showTopics=false;await page.close();}
});


test("topic sidebar and phone selector share titles and preserve filter semantics",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await visit(page,web.origin+"/admin/monitor?mode=priority&page=3&q=DeepSeek&from=2026-10-01");
  await page.getByRole("button",{name:"选题台",exact:true}).click();const nav=page.getByRole("navigation",{name:"选题台子栏目",exact:true});
  await nav.getByRole("link",{name:"观察",exact:true}).click();
  await expect(page.getByRole("heading",{name:"观察",exact:true})).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("page"),null);assert.equal(new URL(page.url()).searchParams.get("q"),"DeepSeek");
  await expect(nav.getByRole("link",{name:"观察",exact:true})).toHaveAttribute("aria-current","page");
  await nav.getByRole("link",{name:"已确认",exact:true}).click();
  await expect(page.getByRole("heading",{name:"已确认",exact:true})).toBeVisible();
  let q=new URL(page.url()).searchParams;assert.equal(q.get("mode"),"all");assert.equal(q.get("state"),"confirmed");assert.equal(q.get("from"),null);assert.equal(q.get("window"),"all");
  await page.getByRole("link",{name:"重置",exact:true}).click();await expect(page).toHaveURL(/mode=all&state=confirmed&window=all$/);assert.equal(new URL(page.url()).searchParams.get("state"),"confirmed");
  await nav.getByRole("link",{name:"收藏",exact:true}).click();await expect(page.getByRole("heading",{name:"收藏",exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await navigateWorkspace(page,"选题台","热榜");
  await expect(page.getByRole("heading",{name:"热榜",exact:true})).toBeVisible();q=new URL(page.url()).searchParams;assert.equal(q.get("mode"),"hot");assert.equal(q.get("state"),null);
  await page.goBack();await expect(page.getByRole("heading",{name:"收藏",exact:true})).toBeVisible();
  await visit(page,web.origin+"/admin/monitor?mode=observe&state=confirmed&q=DeepSeek");
  await expect(page.getByRole("heading",{name:"已确认",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"应用筛选",exact:true}).click();await expect(page).toHaveURL(/mode=all&state=confirmed/);
  await page.getByRole("link",{name:"重置",exact:true}).click();await expect(page).toHaveURL(/mode=all&state=confirmed&window=all$/);
  await page.close();
});

test("standards, status and help open accessible dialogs without losing selection",async()=>{
  showTopics=true;const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor");
    const selected=page.getByRole("checkbox",{name:"勾选选题：DeepSeek测试选题",exact:true});await selected.check();
    const trigger=page.getByRole("button",{name:"选题标准",exact:true});await trigger.click();
    const dialog=page.getByRole("dialog",{name:"猿大侠选题标准",exact:true});await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("模型重大变化");
    await page.keyboard.press("Tab");assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))),true);
    await page.keyboard.press("Shift+Tab");assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))),true);
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();await expect(selected).toBeChecked();
    await page.getByRole("button",{name:"运行状态",exact:true}).click();await expect(page.getByRole("dialog",{name:"同步与运行状态",exact:true})).toContainText("同步尝试");
    await page.getByRole("dialog").getByRole("button",{name:"关闭弹窗",exact:true}).click();await expect(selected).toBeChecked();
    await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"使用帮助",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"使用帮助 · 按钮与标签说明",exact:true})).toBeVisible();
    await page.getByRole("dialog").getByRole("button",{name:"关闭弹窗",exact:true}).click();await expect(page.getByRole("button",{name:"使用帮助",exact:true})).toBeFocused();await expect(selected).toBeChecked();
  }finally{showTopics=false;await page.close();}
});


test("automatic case keywords adapt per platform, preserve edits and widen without repeating the full title",async()=>{
  const previous={title:event.title,summary:event.summary,version:event.version};
  Object.assign(event,{title:"DeepSeek V4.1 Flash新版本发布：许愿式编程一键成真",summary:"创作测试",version:null});
  const page=await browser.newPage();
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");
    const input=page.getByRole("textbox",{name:"关键词，可加入别名和具体任务",exact:true});await expect(input).toHaveValue("DeepSeek V4.1 Flash");
    const x=new URL((await page.getByRole("link",{name:"去X / 推特找案例 ↗",exact:true}).getAttribute("href"))!);assert.equal(x.searchParams.get("q"),"DeepSeek V4.1 Flash");assert.ok(!x.searchParams.get("q")!.includes("一键成真"));
    const reddit=new URL((await page.getByRole("link",{name:"去Reddit找案例 ↗",exact:true}).getAttribute("href"))!);assert.match(reddit.searchParams.get("q")!,/AND/);assert.ok(!reddit.searchParams.get("q")!.includes("since:"));
    await page.getByText("优化搜索与接口（按需）",{exact:true}).click();await page.getByRole("combobox",{name:"希望寻找的材料",exact:true}).selectOption("comparison");await page.getByRole("button",{name:"放宽搜索",exact:true}).click();await expect(page.getByRole("button",{name:"放宽搜索",exact:true})).toHaveAttribute("aria-pressed","true");
    let wide=new URL((await page.getByRole("link",{name:"去YouTube找案例 ↗",exact:true}).getAttribute("href"))!);assert.equal(wide.searchParams.get("search_query"),"DeepSeek");
    await input.fill("ManualResearch Product");await input.press("Tab");
    await page.getByRole("combobox",{name:"希望寻找的材料",exact:true}).selectOption("failure");await expect(input).toHaveValue("ManualResearch Product");
    await expect(page.getByRole("combobox",{name:"希望寻找的材料",exact:true})).toHaveValue("failure");
    await page.getByRole("button",{name:"恢复自动关键词",exact:true}).click();await expect(input).toHaveValue("DeepSeek V4.1 Flash");
    await page.setViewportSize({width:390,height:844});await expect(page.getByRole("button",{name:"精确搜索",exact:true})).toBeVisible();
  }finally{Object.assign(event,previous);await page.close();}
});

test("handoff text preview and all download formats follow the selected cases",async()=>{
  const page=await browser.newPage();
  await visit(page,web.origin+"/admin/monitor/handoff?eventId=event-demo");
  await expect(page.getByRole("link",{name:"下载文字TXT",exact:true})).toBeVisible();
  await page.getByText("预览这次的交接文字",{exact:true}).click();
  await expect(page.getByText("测试交接文字",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"清空本次选择",exact:true}).click();
  await expect(page.getByRole("link",{name:"下载文字TXT",exact:true})).toHaveAttribute("href",/cases=&format=txt/);
  await expect(page.getByRole("link",{name:"下载所选素材包",exact:true})).toHaveAttribute("href",/cases=$/);
  await page.getByText("更多格式与程序对接",{exact:true}).click();
  await expect(page.getByRole("link",{name:"下载事件JSON",exact:true})).toHaveAttribute("href",/cases=$/);
  await expect(page.locator(".hm-handoff-preview pre")).toHaveText("测试交接文字\n");
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole("button",{name:"复制交接文字",exact:true})).toBeVisible();
  await page.close();
});


test("manual news refresh uses a dialog and keeps queued work when it closes",async()=>{
  refreshJobs=[{id:"other-score",eventId:event.id,kind:"score",status:"running",message:"评分中",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];refreshRequests=0;showTopics=true;const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor");
    const picked=page.getByRole("checkbox",{name:"勾选选题：DeepSeek测试选题",exact:true});await picked.check();
    const trigger=page.getByRole("button",{name:"刷新新闻",exact:true});await trigger.click();
    let dialog=page.getByRole("dialog",{name:"手动刷新新闻",exact:true});await expect(dialog).toBeVisible();assert.equal(refreshRequests,0,"opening refresh only reads status");
    await expect(dialog).toContainText("最近同步尝试");await expect(dialog.getByRole("button",{name:"开始刷新",exact:true})).toBeEnabled();await dialog.getByRole("button",{name:"开始刷新",exact:true}).click();
    await expect(dialog.getByRole("button",{name:"刷新任务进行中…",exact:true})).toBeDisabled();assert.equal(refreshRequests,1);
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();await expect(picked).toBeChecked();assert.equal(refreshJobs[0].status,"queued");
    await trigger.click();await expect(dialog.getByRole("button",{name:"刷新任务进行中…",exact:true})).toBeDisabled();assert.equal(refreshRequests,1,"reopening cannot submit a second refresh");
    refreshJobs=[{...refreshJobs[0],status:"completed",message:"动态核对完成",updatedAt:new Date(Date.now()+1000).toISOString()}];
    await expect(dialog.getByRole("status")).toHaveText("刷新完成",{timeout:10000});assert.equal(refreshRequests,1);
    await dialog.getByRole("button",{name:"关闭弹窗",exact:true}).click();await expect(picked).toBeChecked();
    await page.setViewportSize({width:390,height:844});await trigger.click();await expect(dialog).toBeVisible();
    await dialog.getByRole("button",{name:"关闭弹窗",exact:true}).click();await expect(trigger).toBeFocused();assert.equal(refreshRequests,1);
  }finally{showTopics=false;refreshJobs=[];await page.close();}
});


test("title tiles compose keywords and search help explains generated operators",async()=>{
  const previous={title:event.title,summary:event.summary,version:event.version};
  Object.assign(event,{title:"猫王音乐版权方起诉Anthropic，指控其用274首歌训练AI模型",summary:"报道内容",version:null});
  const page=await browser.newPage();
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");
    const input=page.getByRole("textbox",{name:"关键词，可加入别名和具体任务",exact:true});
    await page.getByRole("button",{name:"清空选字",exact:true}).click();await expect(input).toHaveValue("");
    await page.getByRole("button",{name:/^选字：Anthropic，/}).click();
    await page.getByRole("button",{name:/^选字：乐，/}).click();await page.getByRole("button",{name:/^选字：音，/}).click();
    await expect(input).toHaveValue("音乐 Anthropic");assert.equal(new URL(page.url()).searchParams.get("keywordSource"),"title");
    await expect(page.getByRole("link",{name:"去公众号找案例 ↗",exact:true})).toHaveAttribute("href",/query=%E9%9F%B3%E4%B9%90%20Anthropic$/);
    await input.fill("手动新词");await page.getByRole("button",{name:/^选字：Anthropic，/}).click();await expect(input).toHaveValue("Anthropic");
    await input.fill("音乐 Anthropic");await page.getByRole("button",{name:"搜索关键词的方法",exact:true}).click();
    const help=page.getByRole("dialog",{name:"多个关键词怎么搜索？",exact:true});await expect(help).toBeVisible();await expect(help).toContainText("OR：任意一个");await expect(help).toContainText("AND：同时包含");
    await page.keyboard.press("Escape");await expect(input).toHaveValue("音乐 Anthropic");
    await page.setViewportSize({width:390,height:844});await expect(page.getByRole("group",{name:"选题标题字格",exact:true})).toBeVisible();
  }finally{Object.assign(event,previous);await page.close();}
});

test("date hover previews topics without changing current work, selecting a topic clears old search context",async()=>{
  const other={...event,id:"other-date-topic",title:"另一日的已确认选题",publishedAt:"2026-01-02T05:00:00Z"};pickerTopics=[other];dateReads={};
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo&keywords=KeepMyWords&precision=broad&page=2");
    const original=page.url();const pasted=page.getByRole("textbox",{name:"粘贴多平台链接或分享文案",exact:true});await pasted.fill("https://example.com/not-yet-saved");
    await page.getByRole("button",{name:"切换选题",exact:true}).click();const dialog=page.getByRole("dialog",{name:"按日期选择选题",exact:true});await expect(dialog).toBeVisible();
    const day=dialog.getByRole("button",{name:/2026-01-02/});await day.hover();
    await expect(dialog.getByRole("button",{name:"选用选题：另一日的已确认选题",exact:true})).toBeVisible();await expect.poll(()=>dateReads['2026-01-02']??0).toBe(1);
    await day.focus();await day.click();assert.equal(dateReads['2026-01-02'],1);assert.equal(page.url(),original);
    await page.keyboard.press("Escape");await expect(pasted).toHaveValue("https://example.com/not-yet-saved");await expect(page.getByRole("textbox",{name:"关键词，可加入别名和具体任务",exact:true})).toHaveValue("KeepMyWords");
    await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"切换选题",exact:true}).click();
    await dialog.getByLabel("按日期定位选题",{exact:true}).fill("2026-01-02");
    await dialog.getByRole("button",{name:"选用选题：另一日的已确认选题",exact:true}).click();await expect(page).toHaveURL(/research\?eventId=other-date-topic$/);
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),{eventId:other.id});
  }finally{pickerTopics=[];failTopicDate=false;await page.close();}
});


test("workspace folders are grouped, collapsed on entry and replace horizontal subnavigation",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await visit(page,web.origin+"/admin/monitor");const nav=page.getByRole("navigation",{name:"工作区导航",exact:true});
  await expect(nav.getByRole("region",{name:"工作",exact:true}).getByRole("button")).toHaveText(["选题台","案例工作台"]);
  await expect(nav.getByRole("region",{name:"信息",exact:true}).getByRole("button")).toHaveText(["资讯流","日报汇总"]);
  await expect(nav.getByRole("button",{name:"选题台",exact:true})).toHaveAttribute("aria-expanded","false");
  await nav.getByRole("button",{name:"选题台",exact:true}).click();await expect(nav.getByRole("link",{name:"推荐候选",exact:true})).toBeVisible();
  await expect(nav.getByRole("navigation",{name:"选题台子栏目",exact:true}).getByRole("link")).toHaveText(["全部事件","推荐候选","热榜","本站精选","已确认","收藏","观察","已过滤"]);
  await nav.getByRole("button",{name:"选题台",exact:true}).click();await expect(nav.getByRole("link",{name:"推荐候选",exact:true})).toHaveCount(0);
  await navigateWorkspace(page,"资讯流","AIHOT精选");await expect(page.getByRole("heading",{name:"AIHOT精选",exact:true})).toBeVisible();await expect(page.getByRole("navigation",{name:"资讯流视图",exact:true})).toHaveCount(0);
  await navigateWorkspace(page,"日报汇总","周报");await expect(page.getByRole("heading",{name:"周报",exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"打开导航",exact:true}).click();const drawer=page.getByRole("dialog",{name:"工作区导航",exact:true});await expect(drawer).toBeVisible();
  await drawer.getByRole("button",{name:"关闭导航",exact:true}).click();await expect(page.getByRole("button",{name:"打开导航",exact:true})).toBeFocused();
  await navigateWorkspace(page,"案例工作台","案例库");await expect(page.getByRole("heading",{name:"案例库",exact:true})).toBeVisible();await expect(page.getByRole("navigation",{name:"案例工作流程",exact:true})).toHaveCount(0);await expect(drawer).toHaveCount(0);
  await page.close();
});

test("fact reports and timeline stay in a dialog and sorting does not navigate",async()=>{
  const page=await browser.newPage();await visit(page,web.origin+"/admin/monitor/events/event-demo");const original=page.url();
  await expect(page.getByRole("link",{name:"最早的事实报道",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:/^事实报道与时间线/}).click();const dialog=page.getByRole("dialog",{name:"事实报道与时间线",exact:true});await expect(dialog).toBeVisible();
  const stories=dialog.getByRole("link").filter({hasText:/事实报道/});await expect(stories).toHaveText(["最早的事实报道","后续的事实报道"]);
  await dialog.getByRole("combobox",{name:"时间线顺序",exact:true}).selectOption("desc");await expect(stories).toHaveText(["后续的事实报道","最早的事实报道"]);assert.equal(page.url(),original);
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(page.getByRole("link",{name:"最早的事实报道",exact:true})).toHaveCount(0);await page.close();
});

test("case metadata fills cards automatically and original fields stay optional",async()=>{
  const row={id:"metadata-ui",eventId:event.id,url:"https://example.com/article-auto",platform:"web",title:"待补充案例标题",author:"",summary:"",publishedAt:null,collectedAt:new Date().toISOString(),version:null,versionEvidence:"未确认",verification:"pending",evidence:"unknown",role:"unknown",notes:"保留编辑备注",conditions:"",saved:true,reviewed:false,media:[]};caseRows.push(row);
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try {
    await visit(page,web.origin+"/admin/monitor/cases?eventId=event-demo&q=article-auto");
    const card=page.getByRole("article").filter({has:page.getByRole("link",{name:"待补充案例标题",exact:true}).and(page.locator('a[href="https://example.com/article-auto"]'))});
    await card.getByRole("button",{name:"重新提取信息",exact:true}).click();
    const filled=page.getByRole("article").filter({has:page.getByRole("link",{name:"自动读取的原标题",exact:true})});
    await expect(filled.getByRole("img",{name:"自动读取的原标题",exact:true})).toHaveAttribute("src",web.origin+"/icon.png");
    assert.deepEqual(hydrationRequests.at(-1),{id:row.id,mode:"public"});
    await expect(filled).toContainText("原文作者");await expect(filled).toContainText("原文信息已提取");
    const entry=filled.locator("..");await entry.getByText("整理备注、核对证据与收集素材",{exact:true}).click();
    await expect(entry.getByRole("textbox",{name:"案例标题",exact:true})).not.toBeVisible();
    await entry.getByRole("textbox",{name:"为什么值得采用",exact:true}).fill("只写编辑判断");await entry.getByRole("button",{name:"保存判断",exact:true}).click();
    await expect(page.getByText("已保存案例判断",{exact:true})).toBeVisible();assert.equal(caseEdits.at(-1).title,undefined);assert.equal(caseEdits.at(-1).author,undefined);
    await entry.getByText("修改自动提取的信息（可选）",{exact:true}).click();await expect(entry.getByRole("textbox",{name:"案例标题",exact:true})).toHaveValue("自动读取的原标题");
    Object.assign(row,{url:"https://mp.weixin.qq.com/s/metadata-ui",platform:"wechat"});
    await visit(page,web.origin+"/admin/monitor/cases?eventId=event-demo&q=metadata-ui");await page.getByRole("button",{name:"读取公众号正文（付费）",exact:true}).click();await expect(page.getByText("已安排公众号正文读取；可能消耗采集接口额度",{exact:true})).toBeVisible();assert.deepEqual(hydrationRequests.at(-1),{id:row.id,mode:"full"});
  }finally{caseRows.splice(caseRows.indexOf(row),1);await page.close();}
});

test("topic switching keeps the current query, searches a day locally and corrects a located day's count",async()=>{
  pickerTopics=Array.from({length:14},(_v,i)=>({...event,id:"day-topic-"+i,title:"当天新选题 第"+i}));dateReads={};
  remotePickerTopics={"2026-01-09":Array.from({length:3},(_v,i)=>({...event,id:"remote-day-"+i,title:"目录外选题"+i,publishedAt:"2026-01-09T04:00:00Z"}))};
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo&keywords=PreserveMe");const original=page.url();
    await page.getByRole("button",{name:"切换选题",exact:true}).click();const dialog=page.getByRole("dialog",{name:"按日期选择选题",exact:true});
    await expect(dialog.getByLabel("当前选题",{exact:true})).toContainText(event.title);await expect(dialog.getByRole("button",{name:/^选用选题：/})).toHaveCount(15);
    const day=topicDay(event),reads=dateReads[day];await dialog.getByRole("searchbox",{name:"查找当天选题",exact:true}).fill("第12");await expect(dialog.getByRole("button",{name:/^选用选题：/})).toHaveCount(1);assert.equal(dateReads[day],reads);
    await dialog.getByRole("button",{name:"清空查找",exact:true}).click();await dialog.getByRole("button",{name:"选用选题："+event.title,exact:true}).click();assert.equal(page.url(),original);
    await dialog.getByLabel("按日期定位选题",{exact:true}).fill("2026-01-09");await expect(dialog.getByRole("button",{name:/2026-01-09.*3题/})).toBeVisible();await expect(dialog.getByRole("button",{name:/^选用选题：目录外选题/})).toHaveCount(3);
    await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole("searchbox",{name:"查找当天选题",exact:true})).toBeVisible();
  }finally{pickerTopics=[];remotePickerTopics={};await page.close();}
});

test("collector installation stays open after the extension download",async()=>{
  const page=await browser.newPage();
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");await page.getByRole("button",{name:"安装插件",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"在原文页一键保存案例",exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText("加载已解压的扩展程序");
    const downloading=page.waitForEvent("download");await dialog.getByRole("link",{name:"下载采集助手",exact:true}).click();const file=await downloading;assert.equal(file.suggestedFilename(),"hot-monitor-collector.zip");await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
  }finally{await page.close();}
});

test("case library returns keep its sidebar open while keyword filtering respects a manual collapse",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor/cases?eventId=event-demo");const parent=page.getByRole("navigation",{name:"工作区导航",exact:true}).getByRole("button",{name:"案例工作台",exact:true});
    await expect(parent).toHaveAttribute("aria-expanded","true");await page.reload();await expect(parent).toHaveAttribute("aria-expanded","true");
    await parent.click();await expect(parent).toHaveAttribute("aria-expanded","false");await page.getByRole("textbox",{name:"查找案例",exact:true}).fill("不存在的案例");await page.getByRole("button",{name:"筛选案例",exact:true}).click();await expect(parent).toHaveAttribute("aria-expanded","false");
    await page.getByRole("link",{name:"全部案例",exact:true}).click();await expect(parent).toHaveAttribute("aria-expanded","true");
    await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"打开导航",exact:true}).click();await expect(page.getByRole("dialog",{name:"工作区导航",exact:true}).getByRole("navigation",{name:"案例工作台子栏目",exact:true})).toBeVisible();
  }finally{await page.close();}
});

test("collector controls start and stop an installed session from the search area",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.addInitScript(()=>{
    let enabled=false;
    const report=(requestId:string)=>window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_STATUS",requestId,installed:true,enabled,version:"1.1.0"},location.origin);
    window.addEventListener("message",event=>{if(event.source===window&&event.data?.source==="hot-monitor-workspace"&&event.data.type==="HM_COLLECTOR_STATUS")report(event.data.requestId);});
    document.addEventListener("click",event=>{const button=(event.target as Element)?.closest<HTMLButtonElement>("button[data-hm-collector-action]");if(!event.isTrusted||!button)return;enabled=button.dataset.hmCollectorAction==="start";report(button.dataset.hmCollectorRequestId!);},true);
  });
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");const controls=page.getByRole("region",{name:"浏览器采集控制",exact:true});
    await expect(controls.getByRole("button",{name:"安装插件",exact:true})).toBeVisible();const start=controls.getByRole("button",{name:"启动插件",exact:true});await expect(start).toBeEnabled();
    await start.click();await expect(controls.getByRole("button",{name:"停止插件",exact:true})).toBeEnabled();await expect(controls).toContainText("支持平台自动展开");
    await controls.getByRole("button",{name:"停止插件",exact:true}).click();await expect(start).toBeEnabled();await expect(controls.getByRole("status")).toContainText("已停止自动展开");
    await page.setViewportSize({width:390,height:844});await expect(start).toBeVisible();
  }finally{await page.close();}
});

test("collector READY recovers a late content script and unrelated replies cannot change installed state",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor/research?eventId=event-demo");
    const controls=page.getByRole("region",{name:"浏览器采集控制",exact:true});
    const start=controls.getByRole("button",{name:"启动插件",exact:true});
    await expect(controls).toContainText("请先安装／刷新新版插件");await expect(start).toBeDisabled();
    await page.evaluate(()=>new Promise<void>(resolve=>{
      const marker="hm-test-before-ready";
      const done=(event:MessageEvent)=>{if(event.source===window&&event.data?.type===marker){window.removeEventListener("message",done);resolve();}};
      window.addEventListener("message",done);
      window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_STATUS",requestId:"unrelated-status",installed:true,enabled:true},location.origin);
      window.postMessage({type:marker},location.origin);
    }));
    await expect(controls).toContainText("请先安装／刷新新版插件");await expect(start).toBeDisabled();
    await page.evaluate(()=>{
      const state={probes:0,statusId:""};
      (window as typeof window&{__hmLateCollector?:typeof state}).__hmLateCollector=state;
      window.addEventListener("message",event=>{
        if(event.source!==window||event.origin!==location.origin||event.data?.source!=="hot-monitor-workspace"||event.data.type!=="HM_COLLECTOR_STATUS")return;
        state.probes++;state.statusId=event.data.requestId;
        window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_STATUS",requestId:state.statusId,installed:true,enabled:false,version:"1.1.0"},location.origin);
      });
      window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_READY"},location.origin);
    });
    await expect(controls).toContainText("已连接 · 可以启动");await expect(start).toBeEnabled();
    assert.equal(await page.evaluate(()=>(window as typeof window&{__hmLateCollector:{probes:number}}).__hmLateCollector.probes),1);
    await page.evaluate(()=>new Promise<void>(resolve=>{
      const marker="hm-test-after-ready";
      const done=(event:MessageEvent)=>{if(event.source===window&&event.data?.type===marker){window.removeEventListener("message",done);resolve();}};
      window.addEventListener("message",done);
      window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_STATUS",requestId:"unrelated-control",installed:true,enabled:true},location.origin);
      window.dispatchEvent(new MessageEvent("message",{source:window,origin:"https://untrusted.example",data:{source:"hot-monitor-extension",type:"HM_COLLECTOR_READY"}}));
      window.dispatchEvent(new MessageEvent("message",{origin:location.origin,data:{source:"hot-monitor-extension",type:"HM_COLLECTOR_READY"}}));
      window.postMessage({source:"different-extension",type:"HM_COLLECTOR_READY"},location.origin);
      window.postMessage({type:marker},location.origin);
    }));
    await expect(controls).toContainText("已连接 · 可以启动");await expect(start).toBeEnabled();
    await expect(controls.getByRole("button",{name:"停止插件",exact:true})).toHaveCount(0);
    assert.equal(await page.evaluate(()=>(window as typeof window&{__hmLateCollector:{probes:number}}).__hmLateCollector.probes),1);
  }finally{await page.close();}
});

test("multiple sidebar folders stay expanded across navigation and expose collector API settings",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await visit(page,web.origin+"/admin/monitor");const nav=page.getByRole("navigation",{name:"工作区导航",exact:true});
    await nav.getByRole("button",{name:"选题台",exact:true}).click();await nav.getByRole("button",{name:"案例工作台",exact:true}).click();await nav.getByRole("button",{name:"信源管理",exact:true}).click();
    await expect(nav.getByRole("navigation",{name:"选题台子栏目",exact:true})).toBeVisible();await expect(nav.getByRole("navigation",{name:"案例工作台子栏目",exact:true})).toBeVisible();
    await nav.getByRole("link",{name:"API配置",exact:true}).click();await expect(page.getByRole("heading",{name:"API配置",exact:true})).toBeVisible();await expect(nav.getByRole("navigation",{name:"选题台子栏目",exact:true})).toBeVisible();
    const form=page.locator("section.hm-panel").filter({has:page.getByRole("heading",{name:"SocialData · X",exact:true})});
    const key=form.getByLabel("API Key",{exact:true});await expect(key).toHaveValue("");await key.fill("fixture-new-key");await form.getByRole("button",{name:"保存API配置",exact:true}).click();await expect(key).toHaveValue("");await expect(form).toContainText("已配置密钥");assert.equal(connectionSaved.key,"fixture-new-key");
    await page.reload();await expect(key).toHaveValue("");assert.ok(!(await page.content()).includes("fixture-new-key"));
    await page.setViewportSize({width:390,height:844});await expect(form.getByRole("button",{name:"保存API配置",exact:true})).toBeVisible();
  }finally{connectionSaved=null;await page.close();}
});

test("low scores update without a page reload and the candidate stays until manually removed",async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});showTopics=true;candidateIncluded=true;providers.model=true;scoreStarted=0;
  refreshJobs=[{id:"failed-score",eventId:event.id,kind:"score",status:"failed",message:"上游连接超时，未调用评分模型，可重试",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
  try{
    await visit(page,web.origin+"/admin/monitor?mode=priority");const card=page.getByRole("article").filter({has:page.getByRole("heading",{name:event.title,exact:true})});
    await expect(card.getByRole("link",{name:"查看原帖 ↗",exact:true})).toHaveAttribute("href","https://example.org/original-topic");
    await expect(card.getByRole("status")).toHaveText("上游连接超时，未调用评分模型，可重试");await expect(card.getByRole("button",{name:"打分",exact:true})).toBeEnabled();
    await card.getByRole("button",{name:"打分",exact:true}).click();await expect(card.getByRole("button",{name:"评分中…",exact:true})).toBeVisible();
    await expect(card).toContainText("本站AI评分",{timeout:10000});await expect(card).toContainText("51");await expect(card.getByRole("button",{name:"取消候选",exact:true})).toBeVisible();
    await card.getByRole("button",{name:"取消候选",exact:true}).click();await expect(card).toHaveCount(0);
    await navigateWorkspace(page,"选题台","全部事件");await expect(card).toContainText("51");await card.getByRole("button",{name:"加入候选",exact:true}).click();await navigateWorkspace(page,"选题台","推荐候选");await expect(card).toContainText("51");
  }finally{showTopics=false;candidateIncluded=true;scoreStarted=0;providers.model=false;refreshJobs=[];await page.close();}
});

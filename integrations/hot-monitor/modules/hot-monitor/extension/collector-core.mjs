export const CONTEXT_KEY = "hotMonitorCollectorContext";
export const AUTO_SESSION_KEY = "hotMonitorCollectorSession";
export const AUTO_DIAGNOSTIC_KEY = "hotMonitorCollectorDiagnostic";
export const AUTO_SCRIPT_ID = "hot-monitor-auto-v1";
export const AUTO_ORIGINS = [
  "https://*.x.com/*", "https://*.twitter.com/*", "https://*.reddit.com/*",
  "https://*.youtube.com/*", "https://youtu.be/*", "https://mp.weixin.qq.com/*",
  "https://weixin.sogou.com/*", "https://*.xiaohongshu.com/*", "https://*.xhslink.com/*",
  "https://*.douyin.com/*", "https://*.bilibili.com/*", "https://*.weibo.com/*", "https://weibo.cn/*",
];
const EVENT_ID = /^[A-Za-z0-9_-]{1,120}$/;
const ORIGINS = ["http://localhost:43110", "http://127.0.0.1:43110"];
const clamp = (value, limit) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
const blockedTitle=/^(?:(?:小红书|抖音|微博|X|Twitter|YouTube|Reddit|微信公众平台)\s*[-–—|:]\s*)?(?:access denied|just a moment[.!…]*|page not found|404(?:\s*[-–—|:]?\s*(?:not found|page not found))?|安全验证|环境异常|请完成(?:安全)?验证|(?:请先)?登录(?:注册)?|sign in(?: to continue)?|log in(?: to (?:X|Twitter))?|你访问的页面不见了|页面不存在|内容不存在|内容已删除)(?:\s*[-–—|/]\s*(?:X|Twitter|YouTube|Reddit|Google Accounts|微信公众平台|小红书|抖音|微博))?$/i;

export function pageUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("只能收集公开HTTP/HTTPS网页，不能收集浏览器内部页面或带登录信息的链接。");
  return url;
}

export function workspacePage(raw) {
  try {
    const url = pageUrl(raw);
    if (!ORIGINS.includes(url.origin) || !/^\/hotspots(?:\/|$)/.test(url.pathname)) return null;
    const match = /^\/hotspots\/events\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    const query = /^\/hotspots\/(?:research|cases|handoff)\/?$/.test(url.pathname) ? url.searchParams.get("eventId") : null;
    const id = match?.[1] ?? query;
    return {origin:url.origin,eventId:id && EVENT_ID.test(id) ? id : null};
  } catch { return null; }
}

export function platformPermission(raw) {
  try {
    const url = pageUrl(raw);
    if (url.protocol !== "https:") return null;
    return AUTO_ORIGINS.find(pattern => {
      const host = pattern.slice(8,-2);
      return host.startsWith("*.") ? url.hostname === host.slice(2) || url.hostname.endsWith("." + host.slice(2)) : url.hostname === host;
    }) ?? null;
  } catch { return null; }
}

function validContext(value) {
  return value && ORIGINS.includes(value.origin) && EVENT_ID.test(value.eventId ?? "") && Number.isInteger(value.workspaceTabId) && typeof value.title === "string" ? value : null;
}

function coverUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = pageUrl(new URL(value, base).toString());
    const host = url.hostname.toLowerCase();
    if (host.includes(":") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a,b] = host.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))) return null;
    }
    if ([...url.searchParams.keys()].some(key => /token|secret|password|cookie|session|signature|^sign$|^sig$|auth|ticket|(?:^|_)key$|^x-amz-/i.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function caseItem(raw, actualUrl) {
  const actual = pageUrl(actualUrl), supplied = pageUrl(raw?.url);
  if (actual.href !== supplied.href) throw new Error("网页地址已变化，请重新点击扩展后再保存，避免归错案例。");
  if([raw.title,raw.pageTitle,raw.heading].some(value=>blockedTitle.test(clamp(value,300))))throw new Error("当前页面是登录、验证或失效页，请打开具体原文后再收集。");
  const item = {url:actual.href};
  // Match the existing ingest's removal of temporary authentication and tracking parameters.
  const clean = new URL(item.url);
  for (const key of [...clean.searchParams.keys()]) if (/token|secret|password|cookie|session|signature|^sign$|^sig$|auth|ticket|(?:^|_)key$|^x-amz-|^utm_/i.test(key)) clean.searchParams.delete(key);
  item.url = clean.href;
  const title = clamp(raw.title, 300);
  if (title && !/^(?:X|Twitter|YouTube|Reddit(?:\s*[-–—:]\s*Dive into anything)?|微信公众平台|小红书|抖音|微博|安全验证|Just a moment[.!…]*)$/i.test(title)) item.title = title;
  const author = clamp(raw.author, 200), summary = clamp(raw.summary, 30000);
  if (author) item.author = author;
  if (summary) item.summary = summary;
  const date = typeof raw.publishedAt === "string" ? raw.publishedAt.trim() : "";
  const day = date.slice(0,10), calendar = new Date(day + "T00:00:00Z");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(date) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0,10) === day && Number.isFinite(Date.parse(date))) item.publishedAt = new Date(date).toISOString();
  const cover = coverUrl(raw.cover, actual.href);
  if (cover) item.media = [{kind:"image",url:cover}];
  return item;
}

// Serialized into the existing workbench tab. Only these two fixed operations can reach the API.
export async function workspaceBridge(request) {
  const allowed = ["http://localhost:43110", "http://127.0.0.1:43110"];
  if (!allowed.includes(location.origin) || location.origin !== request.origin || !/^\/hotspots(?:\/|$)/.test(location.pathname) || !/^[A-Za-z0-9_-]{1,120}$/.test(request.eventId ?? "")) throw new Error("工作台标签页地址已变化，请回工作台重新选择选题。");
  let path, options;
  if (request.operation === "event") {
    path = "/api/hotspots/events/" + encodeURIComponent(request.eventId);
    options = {method:"GET",credentials:"same-origin",headers:{accept:"application/json"}};
  } else if (request.operation === "import") {
    const current = /^\/hotspots\/events\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1] ?? (/^\/hotspots\/(?:research|cases|handoff)\/?$/.test(location.pathname) ? new URL(location.href).searchParams.get("eventId") : null);
    if (current && current !== request.eventId) return {contextChanged:true};
    const raw = request.item;
    if (!raw || typeof raw.url !== "string") throw new Error("案例缺少原文链接。");
    const url = new URL(raw.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("原文链接无效。");
    const item = {url:url.href};
    for (const [key, limit] of [["title",300],["author",200],["summary",30000]]) if (typeof raw[key] === "string") item[key] = raw[key].slice(0, limit);
    if (typeof raw.publishedAt === "string" && Number.isFinite(Date.parse(raw.publishedAt))) item.publishedAt = new Date(raw.publishedAt).toISOString();
    if (Array.isArray(raw.media)) item.media = raw.media.slice(0,1).filter(m => m?.kind === "image" && typeof m.url === "string").map(m => ({kind:"image",url:m.url}));
    path = "/api/hotspots/cases/import";
    options = {method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({schemaVersion:1,eventId:request.eventId,destination:"library",intent:"keywords",source:"browser",items:[item]})};
  } else throw new Error("不支持的工作台操作。");
  const response = await fetch(path, options);
  let result;
  try { result = await response.json(); } catch { throw new Error("工作台未返回有效数据，请确认本机服务已启动。"); }
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error.slice(0,240) : "工作台保存失败（HTTP " + response.status + "）。");
  return result;
}

export function createCollectorController(api) {
  let autoRevision = 0, autoStopped = false;
  const pendingAutoShows = new Set();
  const getContext = async () => validContext((await api.storage.local.get(CONTEXT_KEY))[CONTEXT_KEY]);
  const isEnabled = async () => (await api.storage.session.get(AUTO_SESSION_KEY))[AUTO_SESSION_KEY]?.enabled === true;
  const diagnosticError = error => clamp(error instanceof Error ? error.message : String(error),2000).replace(/(?:https?|chrome-extension):\/\/[^\s<>"'`]+/gi,"[链接]").slice(0,180);
  const hostOf = raw => { try { return new URL(raw).hostname; } catch { return "未知站点"; } };
  const diagnose = async diagnostic => api.storage.session.set({[AUTO_DIAGNOSTIC_KEY]:diagnostic});
  const status = async () => {
    const stored = await isEnabled();
    const scripts = await api.scripting.getRegisteredContentScripts({ids:[AUTO_SCRIPT_ID]});
    const autoRegistered = scripts.some(script => script.id === AUTO_SCRIPT_ID);
    const diagnostic = (await api.storage.session.get(AUTO_DIAGNOSTIC_KEY))[AUTO_DIAGNOSTIC_KEY];
    const error = stored && !autoRegistered ? "自动浮窗脚本尚未注册，请在工作台重新启动采集助手。" : diagnostic?.error ? "自动浮窗未显示（"+diagnostic.host+"）："+diagnostic.error : undefined;
    return {installed:true,enabled:stored&&autoRegistered,autoRegistered,version:api.runtime.getManifest?.().version ?? "1.1.0",...(diagnostic?{diagnostic}:{}),...(error?{error}:{})};
  };
  async function unregisterAuto() {
    const scripts = await api.scripting.getRegisteredContentScripts({ids:[AUTO_SCRIPT_ID]});
    if (scripts.length) await api.scripting.unregisterContentScripts({ids:[AUTO_SCRIPT_ID]});
  }
  async function stopAuto() {
    autoRevision++;
    autoStopped = true;
    await api.storage.session.set({[AUTO_SESSION_KEY]:{enabled:false},[AUTO_DIAGNOSTIC_KEY]:null});
    await unregisterAuto();
    // A started injection cannot be cancelled. Hide after it finishes, never before its HM_SHOW.
    await Promise.allSettled([...pendingAutoShows]);
    const tabs = await api.tabs.query({url:AUTO_ORIGINS});
    await Promise.allSettled(tabs.filter(tab => platformPermission(tab.url)).map(tab => api.tabs.sendMessage(tab.id,{type:"HM_HIDE"})));
  }
  async function localTab(context) {
    if (context) {
      try { const tab = await api.tabs.get(context.workspaceTabId); if (workspacePage(tab.url)?.origin === context.origin) return tab; } catch { /* A closed tab is recoverable by selecting another already open workbench tab. */ }
    }
    const tabs = await api.tabs.query({url:["http://localhost:43110/hotspots*","http://127.0.0.1:43110/hotspots*"]});
    return tabs.find(tab => workspacePage(tab.url) && (!context || workspacePage(tab.url).origin === context.origin)) ?? null;
  }
  async function bridge(tabId, request) {
    const results = await api.scripting.executeScript({target:{tabId},func:workspaceBridge,args:[request]});
    if (!results?.[0] || results[0].result === undefined) throw new Error("工作台未响应，请重新打开热点监测标签页。");
    return results[0].result;
  }
  async function verifiedContext(tab, eventId) {
    const workspace = workspacePage(tab.url);
    if (!workspace || !EVENT_ID.test(eventId ?? "")) return null;
    const result = await bridge(tab.id,{operation:"event",origin:workspace.origin,eventId});
    if (!result?.event?.confirmed || result.event.id !== eventId) return null;
    const context = {origin:workspace.origin,eventId,title:clamp(result.event.title,300),workspaceTabId:tab.id,updatedAt:new Date().toISOString()};
    await api.storage.local.set({[CONTEXT_KEY]:context});
    return context;
  }
  async function refreshContext() {
    const stored = await getContext();
    if (stored) {
      const tab = await localTab(stored);
      if (tab) {
        const current = workspacePage(tab.url);
        const context = await verifiedContext(tab,current.eventId ?? stored.eventId);
        if (context) return context;
        await api.storage.local.set({[CONTEXT_KEY]:null});
        return null;
      }
    }
    const tabs = await api.tabs.query({url:["http://localhost:43110/hotspots*","http://127.0.0.1:43110/hotspots*"]});
    for (const tab of tabs.filter(tab => workspacePage(tab.url)?.eventId).sort((a,b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))) {
      const context = await verifiedContext(tab,workspacePage(tab.url).eventId);
      if (context) return context;
    }
    await api.storage.local.set({[CONTEXT_KEY]:null});
    return null;
  }
  async function show(tabId, context, error = "", onInjected) {
    await api.scripting.executeScript({target:{tabId},files:["content.js"]});
    if (onInjected) await onInjected();
    await api.tabs.sendMessage(tabId,{type:"HM_SHOW",context,error});
  }
  async function autoBoot(sender, revision) {
    let host = hostOf(sender.url ?? sender.tab.url), stage = "boot_received";
    const skipped = async reason => {
      const error = reason === "no-confirmed-topic" ? "没有可用的已确认选题，请在工作台打开选题后重试。" : reason === "no-platform-permission" ? "当前平台未获访问权限，请在工作台重新启动并允许平台访问。" : undefined;
      await diagnose({stage,host,reason,...(error?{error}:{})});
      return {ok:true,shown:false,reason};
    };
    try {
      await diagnose({stage,host});
      if (revision !== autoRevision || autoStopped) return skipped("stopped");
      const actual = await api.tabs.get(sender.tab.id);
      host = hostOf(actual.url);
      pageUrl(actual.url);
      const permission = platformPermission(actual.url);
      if (revision !== autoRevision || autoStopped) return skipped("stopped");
      if (!await isEnabled()) return skipped("not-enabled");
      if (!permission || !await api.permissions.contains({origins:[permission]})) return skipped("no-platform-permission");
      const context = await refreshContext();
      if (revision !== autoRevision || autoStopped) return skipped("stopped");
      if (!context) return skipped("no-confirmed-topic");
      stage = "context_ready"; await diagnose({stage,host});
      if (!await isEnabled() || revision !== autoRevision || autoStopped) return skipped("stopped");
      const showing = show(actual.id,context,"",async () => { stage = "injected"; await diagnose({stage,host}); });
      pendingAutoShows.add(showing);
      try {
        await showing;
        if (revision !== autoRevision || autoStopped) return skipped("stopped");
        stage = "shown"; await diagnose({stage,host});
        return {ok:true,shown:true};
      } finally { pendingAutoShows.delete(showing); }
    } catch (error) {
      await diagnose({stage,host,error:diagnosticError(error)});
      throw error;
    }
  }
  async function toolbar(clicked) {
    if (!Number.isInteger(clicked?.id)) return;
    const tab = await api.tabs.get(clicked.id);
    const workspace = workspacePage(tab.url);
    if (workspace) {
      if (!workspace.eventId) { await show(tab.id, null, "请在工作台打开一个已确认选题，再点击扩展设置本次收集目标。"); return; }
      const context = await verifiedContext(tab,workspace.eventId);
      if (!context) { await api.storage.local.set({[CONTEXT_KEY]:null}); throw new Error("请先在工作台确认这个选题，再开启案例收集。"); }
      await show(tab.id,context);
    } else { pageUrl(tab.url); await show(tab.id,await refreshContext()); }
  }
  async function handleMessage(message, sender) {
    if (sender?.id !== api.runtime.id || !Number.isInteger(sender.tab?.id)) throw new Error("无效的采集助手请求。");
    const revision = autoRevision;
    if (message?.type === "HM_AUTO_BOOT") return autoBoot(sender,revision);
    // Runtime messages carry the original click gesture, but an await would lose it. Chrome-supplied
    // document URLs gate the permission prompt; actual tab and confirmed topic are checked afterwards.
    let requestedGrant;
    if (message?.type === "HM_WORKSPACE_CONTROL" && message.action === "start") {
      const document = workspacePage(sender.url), tab = workspacePage(sender.tab.url);
      if (sender.frameId !== 0 || !document || !tab || document.origin !== tab.origin) throw new Error("只能从本机热点监测工作台的启动按钮申请平台权限。");
      requestedGrant = api.permissions.request({origins:AUTO_ORIGINS}).then(granted => ({granted}), error => ({error}));
    }
    const actual = await api.tabs.get(sender.tab.id);
    pageUrl(actual.url);
    if (message?.type === "HM_WORKSPACE_STATUS" || message?.type === "HM_WORKSPACE_CONTROL") {
      const workspace = workspacePage(actual.url);
      if (!workspace || sender.frameId !== 0) throw new Error("只能在本机热点监测工作台控制采集助手。");
      if (message.type === "HM_WORKSPACE_STATUS") return {ok:true,...await status()};
      if (message.action === "stop") { await stopAuto(); return {ok:true,...await status()}; }
      if (message.action !== "start" || !requestedGrant) throw new Error("不支持的采集助手控制操作。");
      if (!workspace.eventId || !await verifiedContext(actual,workspace.eventId)) throw new Error("请在工作台打开一个已确认选题后再启动采集助手。");
      const permission = await requestedGrant;
      if (!permission.granted) { await stopAuto(); return {ok:false,...await status(),error:permission.error?.message || "平台访问权限未获允许，自动浮窗尚未启动；仍可逐页点击工具栏手动收集。"}; }
      const origins = (await Promise.all(AUTO_ORIGINS.map(async origin => await api.permissions.contains({origins:[origin]}) ? origin : null))).filter(Boolean);
      if (!origins.length) { await stopAuto(); return {ok:false,...await status(),error:"没有已授予的平台权限，自动浮窗尚未启动。"}; }
      try {
        await unregisterAuto();
        await api.scripting.registerContentScripts([{id:AUTO_SCRIPT_ID,matches:origins,js:["auto.js"],runAt:"document_idle",allFrames:false,persistAcrossSessions:false}]);
        await api.storage.session.set({[AUTO_SESSION_KEY]:{enabled:true},[AUTO_DIAGNOSTIC_KEY]:null});
        autoStopped = false;
      } catch (error) { await stopAuto(); throw error; }
      return {ok:true,...await status()};
    }
    if (message?.type === "HM_CONTEXT") return {ok:true,context:await refreshContext()};
    if (message?.type === "HM_SAVE") {
      const context = await refreshContext();
      if (!context) throw new Error("请先在热点监测中打开已确认选题，再到原文网页点击采集助手。");
      if (message.expectedEventId !== context.eventId) return {ok:false,code:"context-changed",context,error:"工作台选题已变化，请核对上方新选题后再次点击保存。"};
      if (workspacePage(actual.url)) throw new Error("请在案例原文网页点击保存，工作台页面不能收集为案例。");
      const item = caseItem(message.item,actual.url);
      const tab = await localTab(context);
      if (!tab) throw new Error("工作台标签页已关闭，请先打开热点监测并重新选择选题。");
      const result = await bridge(tab.id,{operation:"import",origin:context.origin,eventId:context.eventId,item});
      if (result.contextChanged) return {ok:false,code:"context-changed",context:await refreshContext(),error:"工作台选题刚刚变化，尚未保存；请核对新选题再试。"};
      return {ok:true,created:Number(result.created)||0,existing:Number(result.existing)||0,metadataQueued:Number(result.metadataQueued)||0,metadataFailed:Number(result.metadataFailed)||0,adopted:Number(result.adopted)||0};
    }
    if (message?.type === "HM_OPEN_LIBRARY") {
      const context = await getContext(), tab = await localTab(context);
      const url = (context?.origin ?? "http://localhost:43110") + "/hotspots" + (context ? "/cases?eventId=" + encodeURIComponent(context.eventId) : "");
      if (tab) await api.tabs.update(tab.id,{url,active:true}); else await api.tabs.create({url,active:true});
      return {ok:true};
    }
    throw new Error("不支持的采集助手操作。");
  }
  return {toolbar,handleMessage,status};
}

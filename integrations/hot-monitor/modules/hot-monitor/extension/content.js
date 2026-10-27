(() => {
  if (globalThis.__hotMonitorCollector) { globalThis.__hotMonitorCollector.open(); return; }
  const host = document.createElement("div");
  host.id = "hot-monitor-collector-overlay";
  host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;display:block";
  const root = host.attachShadow({mode:"closed"});
  root.innerHTML = `<style>
    :host{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937;font-size:14px;line-height:1.5}
    *{box-sizing:border-box}section{width:min(360px,calc(100vw - 36px));background:white;border:1px solid #dbe3ef;border-radius:16px;box-shadow:0 12px 45px #11224435;overflow:hidden}
    header{display:flex;align-items:center;gap:8px;background:#eef4ff;padding:12px 14px}header strong{flex:1;font-size:14px}button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:9px 12px;color:#1f2937;min-height:40px}header button{min-height:32px;padding:3px 9px}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #7aa9f8;outline-offset:2px}.body{padding:14px}h2{font-size:16px;margin:0 0 10px;overflow-wrap:anywhere}p{margin:7px 0;font-size:12px;color:#64748b;overflow-wrap:anywhere}.page{font-size:13px;color:#374151;max-height:65px;overflow:hidden}.actions{display:flex;gap:8px;margin-top:13px}.actions button{flex:1}.save{background:#2563eb;border-color:#2563eb;color:white}.status{color:#1d4ed8;min-height:18px}.error{color:#b42318}.body[hidden]{display:none}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
  </style><section aria-label="热点监测采集助手"><header><strong>热点监测 · 采集助手</strong><button type="button" class="collapse" aria-label="收起采集助手" aria-expanded="true">−</button><button type="button" class="close" aria-label="关闭采集助手">×</button></header><div class="body"><p>当前收集选题</p><h2 class="topic"></h2><p class="page"></p><p class="hint"></p><div class="actions"><button type="button" class="save">确认并提取案例</button><button type="button" class="library">回案例库</button></div><p class="status" role="status" aria-live="polite"></p><p>保存后留在当前网页；不自动下载视频。封面仅登记链接，缺少信息时后端继续补全。</p></div></section>`;
  const $ = selector => root.querySelector(selector);
  let context = null, busy = false, saved = false;
  const isWorkbench = () => ["http://localhost:43110","http://127.0.0.1:43110"].includes(location.origin) && /^\/hotspots(?:\/|$)/.test(location.pathname);
  function render(error = "") {
    $(".topic").textContent = context?.title || "尚未设置选题";
    $(".page").textContent = isWorkbench() ? "当前选题已设为收集目标。到外站点击工具栏扩展即可继续收集。" : document.title || location.hostname;
    $(".hint").textContent = context ? "外站材料会归入上面的选题。若要更换，先在工作台切换选题，再回外站打开采集助手。" : "先回工作台打开一个已确认选题，再到原文网页点击采集助手。";
    $(".save").disabled = busy || !context || isWorkbench();
    $(".save").textContent = busy ? "正在保存…" : saved ? "再次保存当前案例" : "确认并提取案例";
    $(".library").textContent = context ? "回到案例库" : "回工作台选题";
    if (error) { $(".status").textContent = error; $(".status").classList.add("error"); }
  }
  function xPostMetadata() {
    if (!/^(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com$/i.test(location.hostname)) return null;
    const current = /^\/[^/]+\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/.exec(location.pathname);
    if (!current) return null;
    const belongsToPost = anchor => {
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        const post = /^\/[^/]+\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/.exec(url.pathname);
        return /^(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com$/i.test(url.hostname) && post?.[1] === current[1];
      } catch { return false; }
    };
    // A reply may link or quote the original; use the article's own timestamp/author permalink.
    const article = [...document.querySelectorAll("article")].find(node => [...node.querySelectorAll("a[href]")].some(anchor => belongsToPost(anchor) && (anchor.querySelector("time") || anchor.closest('[data-testid="User-Name"]'))));
    const text = article?.querySelector('[data-testid="tweetText"]')?.textContent?.trim();
    if (!article || !text) throw new Error("当前原帖文字尚未加载，请等待原帖显示完整后再点击保存，避免收集到回复或通用X页面。");
    const authorNode = article.querySelector('[data-testid="User-Name"]');
    const author = (authorNode?.innerText || authorNode?.textContent || "").replace(/\s+/g," ").trim();
    const time = [...article.querySelectorAll("a[href]")].find(anchor => belongsToPost(anchor) && anchor.querySelector("time"))?.querySelector("time")?.getAttribute("datetime") || "";
    const photo = [...article.querySelectorAll('[data-testid="tweetPhoto"] img[src]')].map(image => image.getAttribute("src")).find(value => {
      try { const url = new URL(value,location.href); return url.protocol === "https:" && url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/"); } catch { return false; }
    });
    const cover = photo || article.querySelector("video[poster]")?.getAttribute("poster") || "";
    return {url:location.href,title:text.slice(0,300),summary:text,author,publishedAt:time,cover};
  }
  function metadata() {
    const post = xPostMetadata();
    if (post) return post;
    const meta = key => [...document.querySelectorAll("meta")].find(node => [node.getAttribute("property"),node.getAttribute("name")].some(value => value?.toLowerCase() === key))?.getAttribute("content")?.trim() || "";
    return {url:location.href,pageTitle:document.title,heading:document.querySelector("h1")?.textContent??"",title:meta("og:title") || meta("twitter:title") || document.title,author:meta("author") || meta("article:author"),summary:meta("og:description") || meta("description") || meta("twitter:description"),publishedAt:meta("article:published_time"),cover:meta("og:image") || meta("twitter:image")};
  }
  $(".save").addEventListener("click",async event => {
    if (!event.isTrusted || busy || !context || isWorkbench()) return;
    busy = true; $(".status").textContent = "正在保存原文链接与可用标题封面…"; $(".status").classList.remove("error"); render();
    try {
      const result = await chrome.runtime.sendMessage({type:"HM_SAVE",expectedEventId:context.eventId,item:metadata()});
      if (result?.code === "context-changed") { context = result.context || null; saved = false; }
      if (!result?.ok) throw new Error(result?.error || "保存未完成。");
      saved = true;
      $(".status").textContent = (result.existing ? "案例已存在，原有人工备注和核验状态保留。" : "已保存到案例库，继续浏览即可。") + (result.metadataQueued ? " 正在后台补全原文信息。" : "") + (result.metadataFailed ? " 链接已保存，后台提取未排入；可到案例库重新提取。" : "");
    } catch (error) { $(".status").textContent = error.message || "保存失败，请重新打开扩展。"; $(".status").classList.add("error"); }
    finally { busy = false; render(); }
  });
  $(".library").addEventListener("click",async event => {
    if (!event.isTrusted) return;
    try { const result = await chrome.runtime.sendMessage({type:"HM_OPEN_LIBRARY"}); if (!result?.ok) throw new Error(result?.error); }
    catch (error) { $(".status").textContent = error.message || "请手动打开热点监测工作台。"; $(".status").classList.add("error"); }
  });
  $(".close").addEventListener("click",() => { host.style.display = "none"; });
  $(".collapse").addEventListener("click",() => { const collapsed = !$(".body").hidden; $(".body").hidden = collapsed; $(".collapse").textContent = collapsed ? "+" : "−"; $(".collapse").setAttribute("aria-expanded",String(!collapsed)); $(".collapse").setAttribute("aria-label",collapsed ? "展开采集助手" : "收起采集助手"); });
  function open() { host.style.display = "block"; $(".body").hidden = false; $(".collapse").textContent = "−"; $(".collapse").setAttribute("aria-expanded","true"); $(".collapse").setAttribute("aria-label","收起采集助手"); }
  globalThis.__hotMonitorCollector = {open};
  let pageAddress=location.href,pageTitle=document.title;
  const updatePage=()=>{
    if(location.href===pageAddress&&document.title===pageTitle)return;
    if(location.href!==pageAddress){saved=false;$(".status").textContent="";$(".status").classList.remove("error");}
    pageAddress=location.href;pageTitle=document.title;render();
  };
  window.addEventListener("popstate",updatePage);
  if(document.head)new MutationObserver(updatePage).observe(document.head,{childList:true,subtree:true,characterData:true});
  chrome.runtime.onMessage.addListener((message,sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "HM_HIDE") { host.style.display = "none"; return; }
    if (message.type !== "HM_SHOW") return;
    context = message.context || null; saved = false; $(".status").textContent = ""; $(".status").classList.remove("error"); open(); render(message.error);
  });
  document.documentElement.append(host);
  render();
})();

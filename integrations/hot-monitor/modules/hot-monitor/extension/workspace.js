(() => {
  if (globalThis.__hotMonitorWorkspaceCollector) return;
  const local = () => ["http://localhost:43110","http://127.0.0.1:43110"].includes(location.origin) && /^\/hotspots(?:\/|$)/.test(location.pathname);
  if (!local()) return;
  globalThis.__hotMonitorWorkspaceCollector = true;
  const validId = value => typeof value === "string" && value.length > 0 && value.length <= 160;
  async function send(message, requestId) {
    let reply;
    try { reply = await chrome.runtime.sendMessage(message); }
    catch { reply = {enabled:false,error:"扩展连接已更新，请在扩展管理页刷新采集助手，再刷新工作台。"}; }
    if (!local()) return;
    window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_STATUS",requestId,installed:true,enabled:reply?.enabled === true,version:reply?.version || chrome.runtime.getManifest().version,...(reply?.error ? {error:String(reply.error).slice(0,300)} : {})},location.origin);
  }
  window.addEventListener("message",event => {
    if (event.source !== window || event.origin !== location.origin || !local()) return;
    const data = event.data;
    if (data?.source !== "hot-monitor-workspace" || data.type !== "HM_COLLECTOR_STATUS" || !validId(data.requestId)) return;
    void send({type:"HM_WORKSPACE_STATUS"},data.requestId);
  });
  document.addEventListener("click",event => {
    if (!event.isTrusted || !local() || !(event.target instanceof Element)) return;
    const button = event.target.closest("button[data-hm-collector-action]");
    if (!button || button.disabled) return;
    const action = button.getAttribute("data-hm-collector-action"), requestId = button.getAttribute("data-hm-collector-request-id");
    if (!["start","stop"].includes(action) || !validId(requestId)) return;
    void send({type:"HM_WORKSPACE_CONTROL",action},requestId);
  },true);
  window.postMessage({source:"hot-monitor-extension",type:"HM_COLLECTOR_READY"},location.origin);
})();

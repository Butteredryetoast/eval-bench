(() => {
  if (globalThis.__hotMonitorAutoBoot) return;
  globalThis.__hotMonitorAutoBoot = true;
  const mark = value => { if (document.documentElement) document.documentElement.dataset.hmCollectorAuto = value; };
  mark("booting");
  // No page text, metadata, credentials or account state is read during automatic activation.
  const warning = error => {
    const message = String(error?.message || error || "自动浮窗连接未完成，请到工作台查看状态。").replace(/(?:https?|chrome-extension):\/\/[^\s<>"'`]+/gi,"[链接]").slice(0,180);
    console.warn("[热点监测] "+message);
  };
  void chrome.runtime.sendMessage({type:"HM_AUTO_BOOT"}).then(result => {
    mark(result?.ok === false ? "failed" : result?.shown ? "shown" : "skipped");
    if (result?.ok === false && result.error) warning(result.error);
  }).catch(error => { mark("failed"); warning(error); });
})();

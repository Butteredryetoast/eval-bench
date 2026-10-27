import {createCollectorController} from "./collector-core.mjs";

const controller = createCollectorController(chrome);
chrome.action.onClicked.addListener(tab => {
  void controller.toolbar(tab).then(() => chrome.action.setBadgeText({tabId:tab.id,text:""})).catch(async error => {
    if (!Number.isInteger(tab?.id)) return;
    try {
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});
      await chrome.tabs.sendMessage(tab.id,{type:"HM_SHOW",context:null,error:error.message || "无法打开采集助手，请回工作台检查当前选题。"});
    } catch {
      await chrome.action.setBadgeText({tabId:tab.id,text:"!"});
      await chrome.action.setTitle({tabId:tab.id,title:error.message || "这个页面不支持采集，请在普通网页使用。"});
    }
  });
});
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  controller.handleMessage(message,sender).then(respond,async error => {
    const status = await controller.status().catch(() => ({installed:true,enabled:false,version:chrome.runtime.getManifest().version}));
    const message = String(error?.message || "操作未完成，请稍后重试。").replace(/(?:https?|chrome-extension):\/\/[^\s<>"'`]+/gi,"[链接]").slice(0,180);
    respond({ok:false,...status,error:status.error || message});
  });
  return true;
});

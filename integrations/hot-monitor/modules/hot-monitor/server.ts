import {runModelAutomation} from "./backend/automation.ts";
import { defineServerModule } from "@aihot/backend/modules";
import { registerMonitor } from "./backend/http.ts";
import { submitWork, workQueue, syncQueue, editorialQueue, reconcileInterruptedJobs } from "./backend/jobs.ts";
import { expireRemoteCache } from "./backend/sync.ts";
export default defineServerModule({
  name: "hot-monitor",
  http: registerMonitor,
  models: {
    monitorTranslate: {label: "热点标题与摘要中文翻译", env: "MONITOR_TRANSLATE_MODEL", purposes: ["monitor_translate"]},
    monitorScore: {
      label: "猿大侠选题评分（五轴，两次独立评估）",
      env: "MONITOR_SCORE_MODEL",
      purposes: ["monitor_score"],
    },
  },
  queues: [workQueue, syncQueue, editorialQueue],
  schedules: [
    {name:"monitor.job-state",cron:"* * * * *",run:reconcileInterruptedJobs},
    {name:"monitor.model-auto",cron:"* * * * *",run:runModelAutomation},
    {
      name: "monitor.sync",
      cron: "* * * * *",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => submitWork({ kind: "sync" }),
    },
    { name: "monitor.retention", cron: "35 3 * * *", run: expireRemoteCache },
  ],
});

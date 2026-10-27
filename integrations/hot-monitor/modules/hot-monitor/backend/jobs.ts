import {reserveModelJob,settleModelJob,ModelBudgetReached,spendingSettings} from "./spending.ts";
import {reportsFor,retainCandidate} from "./store.ts";
import { randomUUID } from "node:crypto";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { translateEvent, needsChinese, textDigest } from "./chinese.ts";
import { syncAihot, syncSelf, remotePage } from "./sync.ts";
import {
  discoverVideoLinks,
  hydrateCase,
  redactProviderError,
  NotConfigured,
  scoreEvent,
  searchCases,
} from "./providers.ts";
import { archiveMedia } from "./media.ts";
import { checkSource } from "./catalogue.ts";
import { digest } from "./domain.ts";
import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { modelMaterial } from "./material.ts";
import { providerStatus } from "./providers.ts";
import { eventById, jobById, setJob,caseById } from "./store.ts";
import type { Job } from "../contracts.ts";
export interface Work {
  jobId: string;
  kind:
    "journal" | "sync" | "score" | "translate" | "search" | "hydrate" | "video" | "archive" | "source";
  eventId?: string;
  caseId?: string;
  readMode?: "public" | "full";
  platform?: "wechat" | "x";
  role?: "keywords" | "example" | "comparison" | "failure";
  query?: string;
  precision?:"precise"|"broad";
  keywordSource?:"auto"|"manual"|"title";
  index?: number;
  sourceId?: string;
  draft?: Record<string, unknown>;
  activate?: boolean;
  actor?: string;
  automatic?: boolean;
}
export async function perform(w: Work) {
  const j = await jobById(w.jobId);
  if (!j) return;
  j.status = "running";
  j.message=w.kind==="sync"?"正在读取AIHOT与本机来源":w.kind==="score"?"正在更新报道材料并评分":w.kind==="translate"?"正在更新报道材料并翻译":"正在后台处理";
  j.updatedAt = new Date().toISOString();
  await setJob(j);
  let reserved=false;
  try {
    let result: unknown;
    if (w.kind === "sync") {
      const aihot = await syncAihot();
      result = { self: await syncSelf(), aihot };
      if (!(await providerStatus()).model)
        await sql`UPDATE hm_events SET data=data||'{"scoreStatus":"unconfigured","scoreReason":"模型待配置，未进行独立评分"}'::jsonb WHERE data->>'scoreStatus'='pending'`;
      else
        await sql`UPDATE hm_events SET data=data||'{"scoreStatus":"pending","scoreReason":"模型已配置，可按需点击AI评分；刷新新闻不会自动调用模型"}'::jsonb WHERE data->>'scoreStatus'='unconfigured'`;
    } else if (w.kind === "journal") {
      result=await remotePage("/api/v1/"+w.draft!.kind+"/"+w.draft!.key);
    } else if (w.kind === "hydrate") result = await hydrateCase(w.caseId!,w.readMode??"full");
    else if (w.kind === "video") result = await discoverVideoLinks(w.caseId!);
    else if (w.kind === "archive")
      result = await archiveMedia(w.caseId!, w.index!);
    else if (w.kind === "source")
      result = await checkSource(
        w.sourceId!,
        w.draft ?? {},
        !!w.activate,
        w.actor ?? "monitor",
      );
    else {
      let e = await eventById(w.eventId!);
      if (!e) throw new Error("事件不存在");
      if(w.kind==="score")e=await retainCandidate(e);
      if(w.automatic){
        const settings=await spendingSettings();
        const {automaticCandidate}=await import("./automation.ts");
        if(!automaticCandidate(e,await reportsFor(e.id),settings)||(w.kind==="translate"&&!settings.translate)){j.status="completed";j.message="自动处理已关闭或不再符合范围，未调用模型";await setJob(j);return j;}
      }
      if((w.kind==="score"&&e.scoreMethod!=="manual")||w.kind==="translate"){
        const material=config.modelCallsEnabled?await modelMaterial(e):{event:e,reports:await reportsFor(e.id)};
        reserved=await reserveModelJob(j.id,w.kind,material.event,material.reports);
      }
      result =
        w.kind === "score"
          ? await scoreEvent(e)
          : w.kind === "translate" ? await translateEvent(e) : await searchCases(e, w.platform!, w.role ?? "keywords", w.query,w.precision,w.keywordSource);
      if(w.kind==="score" && (result as any)?.scoreStatus==="scored" && (result as any)?.scoreMethod==="ai") {
        const scored=result as typeof e;
        if((needsChinese(scored.title)||needsChinese(scored.summary)) && scored.chinese?.sourceDigest!==textDigest(scored))
          await submitWork({kind:"translate",eventId:scored.id,automatic:w.automatic},"translate:"+scored.id+":"+textDigest(scored));
      }
    }
    if (w.kind === "source" && (result as any)?.lastTestError)
      throw new Error((result as any).lastTestError);
    const unconfigured =
      (w.kind === "score" && (result as any)?.scoreStatus === "unconfigured") || (w.kind === "translate" && (result as any)?.status === "unconfigured");
    const partial = (w.kind === "sync" && (result as any)?.aihot?.errors?.length) || (w.kind==="hydrate" && (result as any)?.metadata?.status==="partial");
    j.status = unconfigured ? "unconfigured" : partial ? "partial" : "completed";
    j.message = unconfigured
      ? "请先填写模型API凭证，才能自动评分或翻译"
      : w.kind === "score" && (result as any)?.scoreMethod === "manual" ? "保留人工评分，未调用模型"
      : w.kind === "search"
        ? "已取得 " + (result as any).count + " 条待挑选结果；尚未核验效果"
        : w.kind === "hydrate" && w.readMode==="public" ? "已提取案例原文信息"+((result as any)?.metadata?.error?"；"+(result as any).metadata.error:"")
        : w.kind === "sync" ? "动态核对 " + (result as any).aihot.checked + " 篇；" + ((result as any).aihot.errors.join("；") || "各接口同步完成") : "处理完成";
  } catch (error) {
    if (w.kind === "score" && w.eventId && !(error instanceof ModelBudgetReached)) {
      const e = await eventById(w.eventId);
      if (e) {
        e.scoreStatus = "failed";
        e.scoreReason = "独立评分未完成，请检查模型配置和运行状态";
        await (await import("./store.ts")).saveEvent(e);
      }
    }
    j.status = error instanceof ModelBudgetReached ? "waiting" : error instanceof NotConfigured ? "unconfigured" : "failed";
    j.message =
      error instanceof ModelBudgetReached || error instanceof NotConfigured
        ? error.message
        : w.kind === "source"
          ? redactProviderError(error)
          : w.kind === "sync" &&
              error instanceof Error &&
              /^AIHOT/.test(error.message)
            ? error.message
            : "处理失败：" + redactProviderError(error);
  }
  if(reserved)await settleModelJob(j.id);
  j.updatedAt = new Date().toISOString();
  await setJob(j);
  return j;
}
export const workQueue = defineQueue<Work>({
  name: "hot-monitor.work",
  options: { retryLimit: 0, expireInSeconds: 1200 },
  worker: { batchSize: 1 },
  run: async (batch) => {
    for (const w of batch) await perform(w);
  },
});
export const editorialQueue = defineQueue<Work>({
  name: "hot-monitor.editorial",
  options: { retryLimit: 0, expireInSeconds: 1200 },
  worker: { batchSize: 1 },
  run: async (batch) => { for (const w of batch) await perform(w); },
});
export const syncQueue = defineQueue<Work>({
  name: "hot-monitor.sync",
  options: { retryLimit: 0, expireInSeconds: 1200 },
  worker: { batchSize: 1 },
  run: async (batch) => {
    for (const w of batch) await perform(w);
  },
});
export async function reconcileInterruptedJobs() {
  if (!(await sql`SELECT to_regclass('pgboss.job') AS relation`)[0]?.relation) return 0;
  // A stopped worker can leave the display record running after pg-boss expires its job.
  // Respect live queue work; absence only counts after the enqueue transaction has had time to finish.
  const interrupted = await sql`
    UPDATE hm_jobs h SET data=h.data||jsonb_build_object('status','failed',
      'message','上次后台任务已中断，可重新发起；未自动重试付费调用',
      'updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),updated_at=now()
    WHERE h.data->>'status' IN ('queued','running')
      AND NOT EXISTS (SELECT 1 FROM pgboss.job q WHERE q.name IN ('hot-monitor.work','hot-monitor.sync','hot-monitor.editorial')
        AND q.data->>'jobId'=h.id AND q.state IN ('created','retry','active'))
      AND (EXISTS (SELECT 1 FROM pgboss.job q WHERE q.name IN ('hot-monitor.work','hot-monitor.sync','hot-monitor.editorial')
        AND q.data->>'jobId'=h.id AND q.state IN ('completed','failed','cancelled'))
        OR h.updated_at<now()-interval '2 minutes')
    RETURNING h.id,h.data`;
  for (const row of interrupted) if (['score','translate'].includes(row.data.kind)) await settleModelJob(row.id);
  return interrupted.length;
}
export async function submitWork(
  work: Omit<Work, "jobId">,
  requestKey?: string,
) {
  if (work.kind === "sync")
    requestKey = "sync:" + Math.floor(Date.now() / 60000);
  const id = requestKey
    ? digest(JSON.stringify([work, requestKey]))
    : randomUUID();
  const now = new Date().toISOString();
  const j: Job = {
    id,
    kind: work.kind,
    automatic: work.automatic,
    eventId: work.eventId ?? null,
    status: "queued",
    message: "等待后台任务处理",
    createdAt: now,
    updatedAt: now,
  };
  const inserted =
    await sql`INSERT INTO hm_jobs(id,data) VALUES(${id},${sql.json(j as never)}) ON CONFLICT(id) DO NOTHING RETURNING id`;
  if (!inserted.length) return (await jobById(id))!;
  try {
    await enqueueOn(work.kind === "sync" ? syncQueue : ["score", "translate"].includes(work.kind) ? editorialQueue : workQueue, {
      ...work,
      jobId: id,
    });
  } catch (error) {
    j.status = "failed";
    j.message = "未能加入后台队列，请确认worker和数据库状态";
    await setJob(j);
    throw error;
  }
  return j;
}
export async function queueCaseMetadata(caseId:string,force=false) {
  const c=await caseById(caseId);
  if(!c||c.metadata?.status==="queued"||(!force&&c.metadata))return null;
  const pending={status:"queued",updatedAt:new Date().toISOString()};
  const changed=await sql`UPDATE hm_cases SET data=jsonb_set(data,'{metadata}',${sql.json(pending)}),updated_at=now() WHERE id=${caseId} AND data->'metadata'->>'status' IS DISTINCT FROM 'queued' AND (${force} OR data->'metadata' IS NULL) RETURNING id`;
  if(!changed.length)return null;
  try {return await submitWork({kind:"hydrate",caseId,eventId:c.eventId,readMode:"public"},randomUUID());}
  catch(error) {
    const failed={status:"failed",updatedAt:new Date().toISOString(),error:"未能安排自动提取，可点击重新提取信息"};
    await sql`UPDATE hm_cases SET data=jsonb_set(data,'{metadata}',${sql.json(failed)}),updated_at=now() WHERE id=${caseId}`;
    throw error;
  }
}

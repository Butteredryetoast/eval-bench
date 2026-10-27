import {topicDateCounts} from "../topic-dates.ts";
import {getConnections,saveConnection} from "./connections.ts";
import {collectorExtension} from "./extension.ts";
import {topicsOnDate} from "./topic-dates.ts";
import {isValidDate} from "@aihot/contracts/time";
import {topicExport} from "./topic-export.ts";
import {modelUsage,saveSpending,spendingSettings} from "./spending.ts";
import { currentReview, reviewDigest } from "./priority.ts";
import { queryEvents, timeline, reportMatcher, reportPlatform, reportTime, paginate, filterOptions } from "./query.ts";
import { createReadStream } from "node:fs";
import { buildBundle } from "./bundle.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { sql } from "@aihot/backend/db";
import { audit } from "@aihot/backend/audit";
import { sharedHandler } from "./access.ts";
import { displayEvent, displayReport } from "./chinese.ts";
import { selectCases, handoffMarkdown,handoffText } from "./handoff.ts";
import { weightedScore, TYPE_WEIGHTS } from "./domain.ts";
import { updateSource } from "@aihot/backend/admin/sources";
import { sendFile } from "@aihot/api/routes/static";
import { monitorRules } from "./rules.ts";
import { catalogue, cataloguePage, addCandidate } from "./catalogue.ts";
import {
  canonicalUrl,
  caseVersion,
  exportEvent,
  safeExport,
} from "./domain.ts";
import { assetPath, MAX_ASSET_BYTES, storeAsset } from "./media.ts";
import { providerStatus } from "./providers.ts";
import {
  assetsFor,
  caseById,
  casesFor,
  eventById,
  ingestReport,
  reportsFor,
  saveCase,
  saveClassification,
  saveEvent,
  retainCandidate,
  setCandidate,
  updateCase,
} from "./store.ts";
import { submitWork,queueCaseMetadata,reconcileInterruptedJobs } from "./jobs.ts";
import { authorized, unauthorized } from "@aihot/api/routes/ingest";
import { importCaseCandidates } from "./case-intake.ts";
import {queryCases} from "./case-query.ts";
import {
  FIELDS,
  FORMATS,
  SOURCE_PLATFORMS,
  SOURCE_KINDS,
  casePlatform,
  type Event,
  type Job,
  type Report,
  type Asset,
  type Case,
} from "../contracts.ts";
const P = "/api/admin/monitor";
const idOf = (req: any) => String(req.params.id);
const bad = (s: string) => Object.assign(new Error(s), { statusCode: 400 });
const classification = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().min(1),
    category: z.string().min(1).max(100),
    angle: z.string().max(2000),
    researchRequirements: z.array(z.string().max(500)).max(20),
  })
  .strict();
const experiment = z
  .object({
    schemaVersion: z.literal(1),
    experimentId: z.string().min(1).max(100),
    eventId: z.string().min(1),
    caseId: z.string().optional(),
    version: z.string().min(1).max(200),
    environment: z.string().max(3000),
    input: z.string().max(15000),
    output: z.string().max(15000),
    conclusion: z.string().max(10000),
  })
  .strict();
async function requireEvent(id: string) {
  const e = await eventById(id);
  if (!e) throw bad("事件不存在");
  return e;
}
async function syncHealth() {
  const head=(await sql`SELECT data FROM hm_sync_cache WHERE path='last-head'`)[0]?.data;
  if(!head?.ids) return null;
  const rows=await sql`SELECT data->>'externalId' AS id FROM hm_reports WHERE data->>'origin'='aihot' AND data->>'active'='true' AND data->>'externalId'=ANY(${head.ids as string[]})`;
  return {checkedAt:head.at,newestDiscoveredAt:head.newestDiscoveredAt,count:head.count,missing:head.ids.length-rows.length};
}
export function registerMonitor(app: FastifyInstance) {
  app.get(P+"/connections",sharedHandler(async()=>getConnections()));
  app.post(P+"/connections/:provider",sharedHandler(async(req)=>saveConnection((req.params as {provider:string}).provider,req.body)));
  app.post(P+"/events/:id/candidate",sharedHandler(async(req,_reply,actor)=>{
    const {included}=z.object({included:z.boolean()}).strict().parse(req.body);
    const e=await requireEvent(idOf(req));await setCandidate(e.id,included);
    await audit(actor,"monitor.candidate",e.id,null,null,{included});
    return await requireEvent(e.id);
  }));
  app.get(P+"/collector/extension.zip",sharedHandler(async(_req,reply)=>reply.header("Content-Disposition",'attachment; filename="hot-monitor-collector.zip"').type("application/zip").send(await collectorExtension())));
  app.get(P+"/topics",sharedHandler(async(req)=>{
    const q=z.object({date:z.string().refine(value=>value==="unknown"||isValidDate(value),"日期必须为YYYY-MM-DD或unknown"),currentId:z.string().min(1).max(100).optional()}).strict().parse(req.query);
    return topicsOnDate(q.date,q.currentId);
  }));
  app.post(P+"/topics/export",sharedHandler(async(req)=>{
    const {ids}=z.object({ids:z.array(z.string().min(1).max(100)).min(1).max(50)}).strict().parse(req.body);
    const entries=[];const seen=new Set<string>();
    for(const id of ids){const e=await requireEvent(id);if(seen.has(e.id))continue;seen.add(e.id);const reports=await reportsFor(e.id);entries.push({event:displayEvent(e,reports),reports});}
    return topicExport(entries);
  }));
  app.get(P+"/usage",sharedHandler(async()=>modelUsage()));
  app.post(P+"/usage/settings",sharedHandler(async(req,_reply,actor)=>{
    const before=await spendingSettings();const result=await saveSpending(req.body);
    await audit(actor,"monitor.spending-settings","model",null,before,result);return result;
  }));
  app.post(P+"/cases/ingest",async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    if(!authorized(req))return unauthorized(reply);
    try{return await importCaseCandidates(req.body,"external");}
    catch(error){return reply.code(error instanceof z.ZodError?400:(error as any)?.statusCode??500).send({error:error instanceof z.ZodError?"案例包字段不正确；每次1–50条，需有效HTTP链接与选题ID":"案例导入失败，请检查已确认选题与字段"});}
  });
  app.post(P+"/cases/import",sharedHandler(async(req)=>{
    const result=await importCaseCandidates(req.body,"batch");let metadataQueued=0,metadataFailed=0;
    if((req.body as {destination?:string}).destination==="library")for(const id of result.caseIds){try{if(await queueCaseMetadata(id))metadataQueued++;}catch{metadataFailed++;}}
    return {...result,metadataQueued,metadataFailed};
  }));
  app.post(P+"/catalogue/:id/enabled",sharedHandler(async(req,_reply,actor)=>{
    const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);
    const c=(await catalogue()).find(s=>s.id===idOf(req)); if(!c?.sourceId)throw bad("请先完成试采再启用");
    if(enabled&&c.awaitingActivation) throw bad("请先核验收到的外部推送，并勾选验证成功后启用");
    const [current]=await sql`SELECT updated_at FROM sources WHERE id=${c.sourceId}`;
    await updateSource(c.sourceId,{patch:{enabled},version:new Date(current.updated_at).toISOString(),reason:"共享工作区调整采集状态"},actor);
    return {enabled};
  }));
  app.post(P+"/events/:id/manual-score", sharedHandler(async(req,_reply,actor)=>{
    const b=z.object({type:z.enum(Object.keys(TYPE_WEIGHTS) as [string,...string[]]),axes:z.object({sig:z.number().int().min(0).max(10),nov:z.number().int().min(0).max(10),cred:z.number().int().min(0).max(10),reson:z.number().int().min(0).max(10),act:z.number().int().min(0).max(10)}),reason:z.string().trim().min(1).max(1500)}).parse(req.body);
    const e=await retainCandidate(await requireEvent(idOf(req)));
    Object.assign(e,{score:weightedScore(b.type,b.axes),scoreAxes:[b.axes],scoreStatus:"scored",scoreMethod:"manual",scoreType:b.type,scoreReason:b.reason});
    await saveEvent(e); await audit(actor,"monitor.manual-score",e.id,null,null,b); return e;
  }));
  app.post(P+"/events/:id/translate",sharedHandler(async(req)=>{
    await requireEvent(idOf(req)); return submitWork({kind:"translate",eventId:idOf(req)},String(req.headers["idempotency-key"]??randomUUID()));
  }));
  app.get(P+"/events/:id/handoff",sharedHandler(async(req,reply)=>{
    const e=await requireEvent(idOf(req)); const q=req.query as Record<string,string>;
    const cases=selectCases(await casesFor(e.id,true), q.cases===undefined?undefined:q.cases.split(",").filter(Boolean));
    const reports=(await reportsFor(e.id)).filter(r=>r.active && (!r.expiresAt||Date.parse(r.expiresAt)>Date.now()));
    const assets=(await assetsFor()).filter(a=>cases.some(c=>c.id===a.caseId));
    const experiments=(await sql`SELECT data FROM hm_experiments WHERE event_id=${e.id}`).map(r=>r.data).filter(x=>!x.caseId||cases.some(c=>c.id===x.caseId));
    const format=z.enum(["md","txt"]).parse(q.format??"md");
    reply.type(format==="txt"?"text/plain; charset=utf-8":"text/markdown; charset=utf-8");
    if(q.preview!=="true")reply.header("Content-Disposition",'attachment; filename="handoff-'+e.id+'.'+format+'"');
    return (format==="txt"?handoffText:handoffMarkdown)(displayEvent(e,reports),reports,cases,assets,experiments as never);
  }));
  app.patch(P+"/catalogue/:id/classification",sharedHandler(async(req)=>{
    const b=z.object({fields:z.array(z.enum(FIELDS)).max(7),sourceRole:z.enum(["官方一手","媒体","个人创作者","社区与综合","待分类"])}).parse(req.body);
    const c=(await catalogue()).find(s=>s.id===idOf(req)); if(!c)throw bad("来源不存在");
    const data={...c,...b,classificationMethod:"manual"};
    await sql`INSERT INTO hm_source_checks(id,data) VALUES(${c.id},${sql.json(data as never)}) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`;
    return data;
  }));
  app.get(P+"/legacy/:kind/:id",sharedHandler(async(req)=>{
    const {kind,id}=z.object({kind:z.enum(["item","story"]),id:z.string().max(300)}).parse(req.params);
    const row=kind==="item" ? (await sql`SELECT event_id FROM hm_reports WHERE data->>'externalId'=${id} LIMIT 1`)[0]
      : (await sql`SELECT event_id FROM hm_aliases WHERE alias=ANY(${["story:self:"+id,"story:aihot:"+id]}) LIMIT 1`)[0];
    const e=row ? await eventById(row.event_id) : null;
    return {location:e ? "/admin/monitor/events/"+e.id : "/admin/monitor/feed?window=all"};
  }));
  app.get(P+"/feed",sharedHandler(async(req)=>{
    await reconcileInterruptedJobs();
    const q={...req.query as Record<string,string>};
    if(q.sort==="upstream") q.origin="aihot";
    const reports=(await sql`SELECT data FROM hm_reports`).map(r=>r.data as Report);
    const events=new Map((await sql`SELECT id,data FROM hm_events WHERE NOT(data ? 'mergedInto')`).map(r=>[r.id,r.data as Event]));
    const matches=reportMatcher(q);
    const words=(q.q??"").toLowerCase().trim().split(/\s+/).filter(Boolean);
    const rows=reports.filter(matches).filter(r=>q.mode!=="selected" || r.upstreamSelected).map(r=>({...displayReport(r),platform:reportPlatform(r),field:events.get(r.eventId)?.field,format:events.get(r.eventId)?.format,eventScore:{id:r.eventId,score:events.get(r.eventId)?.score??null,scoreStatus:events.get(r.eventId)?.scoreStatus??"pending",scoreMethod:events.get(r.eventId)?.scoreMethod,candidate:events.get(r.eventId)?.candidate,priority:events.get(r.eventId)?displayEvent(events.get(r.eventId)!,reports.filter(x=>x.eventId===r.eventId)).priority:undefined}})).filter(r=>(!q.field || r.field===q.field)&&(!q.format || r.format===q.format)&&words.every(w=>(r.title+" "+r.summary).toLowerCase().includes(w))).sort((a,b)=>reportTime(b,q.timeBy)-reportTime(a,q.timeBy)||a.id.localeCompare(b.id));
    if(q.sort==="upstream") rows.sort((a,b)=>(a.upstreamPosition??Number.MAX_SAFE_INTEGER)-(b.upstreamPosition??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id));
    const result=paginate(rows,q);
    return {reports:result.items,page:result.page,filters:filterOptions(reports),syncHealth:await syncHealth(),providers:await providerStatus(),jobs:(await sql`SELECT data FROM hm_jobs ORDER BY updated_at DESC LIMIT 20`).map(r=>r.data)};
  }));
  app.get(P+"/journals",sharedHandler(async(req)=>{
    const q=z.object({kind:z.enum(["dailies","weeklies","monthlies"]).default("dailies"),key:z.string().regex(/^(latest|\d{4}-(?:\d{2}(?:-\d{2})?|W\d{2}))$/).default("latest")}).parse(req.query);
    const [list]=await sql`SELECT data FROM hm_sync_cache WHERE path=${"/api/v1/"+q.kind+"?limit=30"} AND valid_until>now()`;
    const [report]=await sql`SELECT data FROM hm_sync_cache WHERE path=${"/api/v1/"+q.kind+"/"+q.key} AND valid_until>now()`;
    return {items:list?.data?.items??[],report:report?.data?.report??null,jobs:(await sql`SELECT data FROM hm_jobs WHERE data->>'kind'='journal' ORDER BY updated_at DESC LIMIT 3`).map(r=>r.data)};
  }));
  app.post(P+"/journals",sharedHandler(async(req)=>{
    const draft=z.object({kind:z.enum(["dailies","weeklies","monthlies"]),key:z.string().regex(/^(latest|\d{4}-(?:\d{2}(?:-\d{2})?|W\d{2}))$/)}).strict().parse(req.body);
    return submitWork({kind:"journal",draft},"journal:"+draft.kind+":"+draft.key+":"+Math.floor(Date.now()/60000));
  }));
  app.get(
    P + "/overview",
    sharedHandler(async (req) => {
      await reconcileInterruptedJobs();
      const q = req.query as Record<string, string>;
      const events = (
        await sql`SELECT data FROM hm_events WHERE NOT(data ? 'mergedInto') ORDER BY updated_at DESC`
      ).map((r) => r.data as Event);
      const reports = (await sql`SELECT data FROM hm_reports`).map(
        (r) => r.data as Report,
      );
      const result = queryEvents(events,reports,q);
      const jobs = (
        await sql`SELECT data FROM hm_jobs ORDER BY (data->>'status' IN ('queued','running')) DESC,updated_at DESC LIMIT 100`
      ).map((r) => r.data as Job);
      const [totals] =
        await sql`SELECT (SELECT count(*) FROM hm_events)::int AS events,(SELECT count(*) FROM hm_events WHERE data->>'confirmed'='true')::int AS confirmed,(SELECT count(*) FROM hm_cases WHERE data->>'saved'='true')::int AS cases`;
      const last = (
        await sql`SELECT data FROM hm_sync_cache WHERE path='last-sync'`
      )[0]?.data;
      return {
        ...result,
        jobs,
        coverage: last,
        syncHealth: await syncHealth(),
        providers: await providerStatus(),
        totals: { ...totals, sources: (await catalogue()).length },
        lastSync: last?.at ?? null,
        lastHead: (await sql`SELECT data FROM hm_sync_cache WHERE path='last-head'`)[0]?.data?.at ?? null,
      };
    }),
  );
  app.get(
    P + "/events/:id",
    sharedHandler(async (req) => {
      const e = await requireEvent(idOf(req));
      const cases = await casesFor(e.id);
      const reports = await reportsFor(e.id);
      return {
        event: {...displayEvent(e,reports),editorialReview:currentReview(e)??undefined},
        providers: await providerStatus(),
        reports: timeline(reports, (req.query as Record<string,string>).order),
        jobs:(await sql`SELECT data FROM hm_jobs WHERE data->>'eventId'=${e.id} ORDER BY updated_at DESC LIMIT 10`).map(r=>r.data),
        cases,
        assets: (await assetsFor()).filter((a) =>
          cases.some((c) => c.id === a.caseId),
        ),
        experiments: (
          await sql`SELECT data FROM hm_experiments WHERE event_id=${e.id}`
        ).map((r) => r.data),
      };
    }),
  );
  app.post(
    P + "/events",
    sharedHandler(async (req, _reply, actor) => {
      const v = z
        .object({
          title: z.string().min(1).max(300),
          summary: z.string().max(30000).default(""),
          url: z.string().url(),
          source: z.string().max(200).default("人工提交"),
          publishedAt: z
            .string()
            .datetime({ offset: true })
            .nullable()
            .default(null),
        })
        .parse(req.body);
      const e = await ingestReport({
        origin: "manual",
        externalId: canonicalUrl(v.url),
        ...v,
      });
      await audit(actor, "monitor.event.create", e.id, null, null, {
        title: e.title,
      });
      return e;
    }),
  );
  app.patch(
    P + "/events/:id",
    sharedHandler(async (req, _reply, actor) => {
      const b = z
        .object({
          confirmed: z.boolean().optional(),
          bookmarked: z.boolean().optional(),
          editorialReview: z.object({decision:z.enum(["select","reject","observe"]),reason:z.string().trim().min(1).max(1500)}).optional(),
          field: z.enum(FIELDS).optional(),
          format: z.enum(FORMATS).optional(),
          product: z.string().max(100).optional(),
          version: z.string().max(200).nullable().optional(),
          aliases: z.array(z.string().max(100)).max(15).optional(),
        })
        .strict()
        .parse(req.body);
      const e = await requireEvent(idOf(req));
      const oldVersion = e.version;
      const {editorialReview,...patch}=b;
      Object.assign(e, patch);
      if(b.field) e.fieldMethod="editor";
      if(editorialReview) e.editorialReview={...editorialReview,by:"editor",at:new Date().toISOString(),materialDigest:reviewDigest(e)};
      await saveEvent(e);
      if (oldVersion !== e.version) {
        for (const c of await casesFor(e.id)) {
          c.verification = "pending";
          c.versionEvidence = "选题版本已变更，请重新核对该案例";
          c.reviewed = false;
          await updateCase(c);
        }
      }
      await audit(actor, "monitor.event.update", e.id, null, null, b);
      return e;
    }),
  );
  app.post(
    P + "/sync",
    sharedHandler(async (req) =>
      submitWork(
        { kind: "sync" },
        String(req.headers["idempotency-key"] ?? randomUUID()),
      ),
    ),
  );
  app.post(
    P + "/events/:id/score",
    sharedHandler(async (req) => {
      await retainCandidate(await requireEvent(idOf(req)));
      return submitWork(
        { kind: "score", eventId: idOf(req) },
        String(req.headers["idempotency-key"] ?? randomUUID()),
      );
    }),
  );
  app.post(
    P + "/events/:id/search",
    sharedHandler(async (req) => {
      const e = await requireEvent(idOf(req));
      if (!e.confirmed) throw bad("请先确认选题");
      const b = z
        .object({
          platform: z.enum(["wechat", "x"]),
          role: z.enum(["keywords", "example", "comparison", "failure"]).default("keywords"),
          query: z.string().trim().min(2).max(140).optional(),
          precision:z.enum(["precise","broad"]).default("precise"),
          keywordSource:z.enum(["auto","manual","title"]).optional(),
        })
        .parse(req.body);
      return submitWork(
        { kind: "search", eventId: e.id, ...b },
        String(req.headers["idempotency-key"] ?? randomUUID()),
      );
    }),
  );
  app.post(
    P + "/classifications",
    sharedHandler(async (req, _reply, actor) => {
      const c = classification.parse(req.body);
      const e = await saveClassification(c);
      await audit(
        actor,
        "monitor.classification",
        c.eventId,
        null,
        null,
        c,
      );
      return e;
    }),
  );
  app.post(
    P + "/experiments",
    sharedHandler(async (req, _reply, actor) => {
      const e = experiment.parse(req.body);
      await requireEvent(e.eventId);
      if (e.caseId && (await caseById(e.caseId))?.eventId !== e.eventId)
        throw bad("案例不属于该事件");
      const existing = (
        await sql`SELECT event_id FROM hm_experiments WHERE id=${e.experimentId}`
      )[0];
      if (existing && existing.event_id !== e.eventId)
        throw bad("实验ID已属于其他事件");
      await sql`INSERT INTO hm_experiments(id,event_id,case_id,data) VALUES(${e.experimentId},${e.eventId},${e.caseId ?? null},${sql.json(e)}) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,case_id=EXCLUDED.case_id`;
      await audit(actor, "monitor.experiment", e.eventId, null, null, {
        experimentId: e.experimentId,
      });
      return { ok: true };
    }),
  );
  app.get(
    P + "/events/:id/export",
    sharedHandler(async (req, reply) => {
      const e = await requireEvent(idOf(req));
      const reports = (await reportsFor(e.id)).filter(
        (r) =>
          r.active && (!r.expiresAt || Date.parse(r.expiresAt) > Date.now()),
      );
      const q=req.query as Record<string,string>;
      const cases = selectCases(await casesFor(e.id,true),q.cases===undefined?undefined:q.cases.split(",").filter(Boolean));
      const assets = (await assetsFor()).filter((a) =>
        cases.some((c) => c.id === a.caseId),
      );
      const experiments = (
        await sql`SELECT data FROM hm_experiments WHERE event_id=${e.id}`
      ).map((r) => r.data).filter(x=>!x.caseId||cases.some(c=>c.id===x.caseId));
      reply.header(
        "Content-Disposition",
        'attachment; filename="event-' + e.id + '.json"',
      );
      return exportEvent(
        { ...e, summary: reports.length ? e.summary : "" },
        reports,
        cases,
        assets.map((a) => ({ ...a, url: P + "/assets/" + a.id })),
        experiments,
      );
    }),
  );
  app.get(
    P + "/events/:id/bundle",
    sharedHandler(async (req, reply) => {
      const q = req.query as Record<string,string>;
      const ids = q.cases === undefined ? undefined : q.cases.split(",").filter(Boolean);
      const bundle = await buildBundle(idOf(req),ids);
      const stream = createReadStream(bundle.file);
      stream.on("close", () => {
        void bundle.cleanup();
      });
      return reply
        .header(
          "Content-Disposition",
          'attachment; filename="materials-' + idOf(req) + '.tar.gz"',
        )
        .type("application/gzip")
        .send(stream);
    }),
  );
  app.get(
    P + "/cases",
    sharedHandler(async (req) => {
      const q = req.query as Record<string, string>;
      const events = (
        await sql`SELECT data FROM hm_events WHERE NOT(data ? 'mergedInto') AND (data->>'confirmed'='true' OR id=${q.eventId ?? null}) ORDER BY updated_at DESC`
      ).map((r) => r.data as Event);
      const browse=q.browse==="saved"||q.browse==="candidates";
      const allCases=await casesFor(q.eventId||undefined,browse?undefined:q.saved==="true"?true:undefined);
      const allAssets=await assetsFor();
      const list=browse?queryCases(allCases,allAssets,q):{cases:allCases};
      return {
        events,
        topicDates:topicDateCounts(events),
        ...list,
        assets: browse?allAssets.filter(a=>list.cases.some(c=>c.id===a.caseId)):allAssets,
        jobs: (
          await sql`SELECT data FROM hm_jobs ORDER BY (data->>'status' IN ('queued','running')) DESC,updated_at DESC LIMIT 15`
        ).map((r) => r.data as Job),
        providers: await providerStatus(),
      };
    }),
  );
  app.post(
    P + "/cases",
    sharedHandler(async (req) => {
      const b = z
        .object({
          eventId: z.string(),
          url: z.string().url(),
          title: z.string().max(300).default("待补充案例标题"),
          summary: z.string().max(30000).default(""),
          author: z.string().max(200).default(""),
          publishedAt: z
            .string()
            .datetime({ offset: true })
            .nullable()
            .default(null),
        })
        .parse(req.body);
      const e = await requireEvent(b.eventId);
      if (!e.confirmed) throw bad("请先确认选题");
      const c=await saveCase({
        id: randomUUID(),
        ...b,
        url: canonicalUrl(b.url),
        platform:casePlatform(b.url),
        captureMethod:"manual",
        collectedAt: new Date().toISOString(),
        ...caseVersion(e.version, b.title + " " + b.summary),
        evidence: "unknown",
        role: "unknown",
        conditions: "",
        notes: "",
        saved: true,
        reviewed: false,
        media: [],
      });
      try{await queueCaseMetadata(c.id);}catch{/* The link was saved; the case records the queue failure. */}
      return await caseById(c.id);
    }),
  );
  app.patch(
    P + "/cases/:id",
    sharedHandler(async (req, _reply, actor) => {
      const b = z
        .object({
          title: z.string().min(1).max(300).optional(),
          author:z.string().max(200).optional(),
          publishedAt:z.string().datetime({offset:true}).nullable().optional(),
          summary:z.string().max(30000).optional(),
          saved: z.boolean().optional(),
          reviewed: z.boolean().optional(),
          notes: z.string().max(10000).optional(),
          conditions: z.string().max(10000).optional(),
          evidence: z.enum(["unknown", "author_test", "repost"]).optional(),
          role: z
            .enum(["unknown", "example", "comparison", "failure"])
            .optional(),
          verification: z.enum(["pending", "matched", "mismatch"]).optional(),
          version: z.string().max(200).nullable().optional(),
          versionEvidence: z.string().max(2000).optional(),
        })
        .strict()
        .parse(req.body);
      const c = await caseById(idOf(req));
      if (!c) throw bad("案例不存在");
      const adopted=b.saved===true&&!c.saved;
      Object.assign(c, b);
      await updateCase(c);
      await audit(actor, "monitor.case.update", c.id, null, null, b);
      if(adopted)try{await queueCaseMetadata(c.id);}catch{/* The saved case exposes the failed extraction for retry. */}
      return await caseById(c.id);
    }),
  );
  app.post(P+"/cases/:id/hydrate",sharedHandler(async(req)=>{
    const c=await caseById(idOf(req));if(!c)throw bad("案例不存在");
    const {mode}=z.object({mode:z.enum(["public","full"]).default("public")}).strict().parse(req.body??{});
    if(mode==="public")return await queueCaseMetadata(c.id,true)??{message:"信息正在提取"};
    if(c.platform!=="wechat")throw bad("全文接口目前仅支持公众号；其他平台可提取公开信息");
    return submitWork({kind:"hydrate",caseId:c.id,eventId:c.eventId,readMode:"full"},String(req.headers["idempotency-key"]??randomUUID()));
  }));
  app.post(P+"/cases/:id/video",sharedHandler(async(req)=>{
    const c=await caseById(idOf(req));if(!c)throw bad("案例不存在");
    return submitWork({kind:"video",caseId:c.id,eventId:c.eventId},String(req.headers["idempotency-key"]??randomUUID()));
  }));
  app.post(
    P + "/cases/:id/archive",
    sharedHandler(async (req) => {
      const b = z
        .object({ index: z.number().int().min(0).max(100) })
        .parse(req.body);
      return submitWork(
        { kind: "archive", caseId: idOf(req), index: b.index },
        String(req.headers["idempotency-key"] ?? randomUUID()),
      );
    }),
  );
  app.post(
    P + "/cases/:id/assets",
    { bodyLimit: 36 * 1024 * 1024 },
    sharedHandler(async (req) => {
      const b = z
        .object({
          name: z.string().min(1).max(160),
          base64: z.string().max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 10),
        })
        .parse(req.body);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)) throw bad("素材编码不正确");
      return storeAsset(idOf(req), Buffer.from(b.base64, "base64"), b.name);
    }),
  );
  app.get(
    P + "/assets/:id",
    sharedHandler(async (req, reply) => {
      const a = (await sql`SELECT data FROM hm_assets WHERE id=${idOf(req)}`)[0]
        ?.data as Asset | undefined;
      if (!a) return reply.code(404).send({ detail: "素材不存在" });
      reply.header("X-Content-Type-Options", "nosniff");
      return sendFile(req, reply, assetPath(a.id), {
        type: a.mime,
        cacheControl: "private, no-store",
      });
    }),
  );
  app.get(
    P + "/catalogue",
    sharedHandler(async(req) => ({
      ...safeExport(cataloguePage(await catalogue(),req.query as Record<string,string>)) as object,
      providers:await providerStatus(),
      jobs:(await sql`SELECT data FROM hm_jobs WHERE data->>'kind'='source' ORDER BY updated_at DESC LIMIT 20`).map(r=>r.data),
      note:"目录包含候选与可采集入口；同一发布方可有多个入口。新增只登记，试采成功后才可启用，不代表已还原AIHOT全部配置。",
    })),
  );
  app.get(P+"/rules",sharedHandler(async()=>monitorRules()));
  app.post(P+"/catalogue",sharedHandler(async(req,_reply,actor)=>{
    const b=z.object({name:z.string().trim().min(1).max(200),platform:z.enum(SOURCE_PLATFORMS),kind:z.enum(["unknown",...SOURCE_KINDS]).default("unknown"),handle:z.string().regex(/^@?[a-zA-Z0-9_]{1,50}$/).optional(),originalExample:z.string().url().optional(),config:z.record(z.string(),z.unknown()).default({}),tier:z.enum(["T1","T1_5","T2"]).default("T2"),fields:z.array(z.enum(FIELDS)).max(7).default([]),sourceRole:z.enum(["官方一手","媒体","个人创作者","社区与综合","待分类"]).default("待分类"),priority:z.boolean().default(false)}).strict().parse(req.body);
    const credentialField=(v:unknown):boolean=>Boolean(v&&typeof v==="object"&&Object.entries(v).some(([k,value])=>/^(?:password|secret|cookie|token|access_token|refresh_token|authorization|api.?key)$/i.test(k)||credentialField(value)));
    if(credentialField(b.config)) throw bad("来源配置不要包含凭据字段；服务凭据请保存到后端配置");
    const result=await addCandidate(b);
    await audit(actor,"monitor.source.register",result.source.id,null,null,{name:result.source.name,kind:b.kind,created:result.created});
    return safeExport(result);
  }));
  app.post(
    P + "/catalogue/:id/check",
    sharedHandler(async (req, _reply, actor) => {
      const b = z
        .object({
          kind: z
            .enum(SOURCE_KINDS)
            .optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          tier: z.enum(["T1", "T1_5", "T2"]).optional(),
          activate: z.boolean().default(false),
        })
        .parse(req.body);
      return submitWork(
        {
          kind: "source",
          sourceId: idOf(req),
          draft: { kind: b.kind, config: b.config, tier: b.tier },
          activate: b.activate,
          actor: actor,
        },
        String(req.headers["idempotency-key"] ?? randomUUID()),
      );
    }),
  );
}

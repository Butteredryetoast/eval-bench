import { stub, Reply, gate } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildBundle } from "../backend/bundle.ts";
import Fastify from "fastify";
import sharp from "sharp";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { registerMonitor } from "../backend/http.ts";
import { registerIngest } from "../../../apps/api/src/routes/ingest.ts";
import {
  canonicalUrl,
  caseVersion,
  exportEvent,
  reportStats,
  safeExport,
  visibleToday,
  weightedScore,
} from "../backend/domain.ts";
import {
  eventById,
  ingestReport,
  reportsFor,
  saveCase,
  saveEvent,
  casesFor,
  updateCase,
} from "../backend/store.ts";
import { archiveMedia, storeAsset } from "../backend/media.ts";
import { parseCaseMetadata, readCaseMetadata } from "../backend/case-metadata.ts";
import {
  hydrateCase,
  mpCall,
  parseMpSearch,
  scoreEvent,
  searchCases,
} from "../backend/providers.ts";
import { remotePage, syncAihot } from "../backend/sync.ts";
import type { Case, Event } from "../contracts.ts";
import { displayEvent, displayReport, textDigest, translateEvent } from "../backend/chinese.ts";
import { priorityFor } from "../backend/priority.ts";
const P = "/api/admin/monitor";
const app = Fastify({ logger: false });
registerMonitor(app);
registerIngest(app);
const old = {
  allow: config.allowPrivateNetworkFetch,
  model: config.modelCallsEnabled,
};
before(async () => {
  config.allowPrivateNetworkFetch = true;
  config.modelCallsEnabled = false;
  await app.ready();
});
after(async () => {
  await app.close();
  await stopBoss();
  Object.assign(config, {
    allowPrivateNetworkFetch: old.allow,
    modelCallsEnabled: old.model,
  });
  await closeDb();
});
const now = () => new Date().toISOString();
const report = (
  id: string,
  url = "https://example.com/" + id,
  story?: string,
) => ({
  origin: "aihot" as const,
  externalId: id,
  title: "DeepSeek V4.1-Flash-1017 发布",
  summary: "新增游戏和创作任务能力",
  url,
  source: "测试来源",
  publishedAt: now(),
  upstreamScore: 88,
  story,
});
function candidate(e: Event, url: string): Case {
  return {
    id: randomUUID(),
    eventId: e.id,
    url,
    title: "案例",
    summary: "待核对演示",
    author: "测试作者",
    platform: "web",
    publishedAt: now(),
    collectedAt: now(),
    version: null,
    versionEvidence: "未确认",
    verification: "pending",
    evidence: "unknown",
    role: "example",
    conditions: "",
    notes: "",
    saved: true,
    reviewed: false,
    media: [],
  };
}
const request = (
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url,
    payload,

  });

test("URLs keep version chapters, deduplicate tracking and never export credentials", () => {
  assert.equal(
    canonicalUrl("https://twitter.com/author/status/123?utm_source=other#top"),
    "https://x.com/author/status/123",
  );
  assert.notEqual(
    canonicalUrl("https://example.com/updates#v1"),
    canonicalUrl("https://example.com/updates#v2"),
  );
  assert.throws(() => canonicalUrl("javascript:alert(1)"));
  const out = JSON.stringify(
    safeExport({
      apiKey: "private-key",
      notes: "https://example.com/a?token=secret&sign=secret&page=2",
      credential: "no",
    }),
  );
  assert.ok(!out.includes("private-key"));
  assert.ok(!out.includes("secret"));
  assert.ok(out.includes("page=2"));
  assert.equal(
    weightedScore("product_launch", {
      sig: 6,
      nov: 7,
      cred: 8,
      reson: 9,
      act: 10,
    }),
    82,
  );
  assert.throws(() =>
    weightedScore("product_launch", {
      sig: 11,
      nov: 7,
      cred: 8,
      reson: 9,
      act: 10,
    }),
  );
  assert.equal(
    caseVersion("V4.1-Flash-1017", "V4.1-Flash-1017 实测").verification,
    "matched",
  );
  assert.equal(
    caseVersion("V4.1-Flash-1017", "最新版好用").verification,
    "pending",
  );
  assert.equal(caseVersion("V4.1-Flash-1017", "DeepSeek 4.1 Flash 视频演示").verification, "pending");
  assert.equal(caseVersion("V4.1-Flash-1017", "DeepSeek V3.2 实测").verification, "mismatch");
  assert.equal(caseVersion("V4.1-Flash-1017", "DeepSeek 1017 实测").verification, "pending");
  const t = Date.now();
  assert.equal(
    visibleToday(
      {
        publishedAt: new Date(t - 4 * 86400000).toISOString(),
        discoveredAt: new Date(t).toISOString(),
        active: true,
        expiresAt: null,
      },
      t,
    ),
    false,
  );
  assert.equal(
    visibleToday({
      publishedAt: null,
      discoveredAt: now(),
      active: true,
      expiresAt: null,
    }),
    false,
  );
});

test("AIHOT and self collection converge on one event without replacing local scores", async () => {
  const a = await ingestReport(
    report("same-a", "https://example.com/same?utm_source=aihot"),
  );
  const b = await ingestReport({
    ...report("same-b", "https://example.com/same"),
    origin: "self",
    localScore: 52,
    upstreamScore: null,
  });
  assert.equal(a.id, b.id);
  const reports = await reportsFor(a.id);
  assert.equal(reports.length, 2);
  assert.equal(reportStats(reports).sourceCount, 1);
  assert.deepEqual(new Set(b.origins), new Set(["self", "aihot"]));
  assert.equal(b.score, null);
  assert.equal(reports.find((x) => x.origin === "aihot")!.upstreamScore, 88);
  assert.equal(reports.find((x) => x.origin === "self")!.localScore, 52);
  await scoreEvent(b);
  assert.equal((await eventById(b.id))!.scoreStatus, "unconfigured");
  assert.equal((await eventById(b.id))!.score, null);
  await saveEvent({...b,score:67,scoreStatus:"scored",scoreMethod:"ai"});
  const feed=await request("GET",P+"/feed?window=all");
  assert.equal(feed.statusCode,200);
  const self=feed.json().reports.find((r:any)=>r.externalId==="same-b");
  const upstream=feed.json().reports.find((r:any)=>r.externalId==="same-a");
  assert.equal(self.localScore,52);
  assert.equal(self.eventScore.score,67);
  assert.equal(upstream.upstreamScore,88);
  assert.equal(upstream.eventScore.id,b.id);
  const overview=await request("GET",P+"/overview?window=all");
  assert.equal(overview.json().events.find((e:any)=>e.id===b.id).selfArticleScore,52);
});

test("a later canonical cross-link merges story aliases and preserves saved cases", async () => {
  const a = await ingestReport({
    ...report("alias-a", "https://example.com/alias-a", "self-story"),
    origin: "self",
  });
  const b = await ingestReport(
    report("alias-b", "https://example.com/alias-b", "aihot-story"),
  );
  const c = await saveCase({
    ...candidate(b, "https://example.com/case-merge"),
    notes: "值得复现",
  });
  const merged = await ingestReport(
    report("alias-cross", "https://example.com/alias-a", "aihot-story"),
  );
  assert.equal(merged.id, a.id);
  assert.equal((await eventById(b.id))!.id, a.id);
  assert.equal(
    (await casesFor(a.id)).find((x) => x.id === c.id)!.notes,
    "值得复现",
  );
  const further = await ingestReport(
    report("alias-follow", "https://example.com/new-report", "aihot-story"),
  );
  assert.equal(further.id, a.id);
});

test("repeated case discovery preserves saved status, notes and stable identity", async () => {
  const e = await ingestReport(report("case-event"));
  const first = await saveCase({
    ...candidate(e, "https://example.com/repeated"),
    notes: "编辑判断",
  });
  const repeated = await saveCase({
    ...candidate(e, "https://example.com/repeated?utm_source=again"),
    saved: false,
    summary: "新增正文",
  });
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.saved, true);
  assert.equal(repeated.notes, "编辑判断");
  assert.equal((await casesFor(e.id)).length, 1);
});

test("shared editor and attachments work without login; cross-site writes are rejected", async () => {
  for (const path of [
    "/overview",
    "/cases",
    "/catalogue",
  ]) {
    assert.equal(
      (await request("GET", P + path)).statusCode,
      200,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: P + "/events",
        headers: { origin: "https://foreign.example" },
        payload: { title: "test", url: "https://example.com/auth" },
      })
    ).statusCode,
    403,
  );
  const created = await request("POST", P + "/events", {
    title: "私有选题",
    url: "https://example.com/auth",
  });
  assert.equal(created.statusCode, 200);
  const e = created.json();
  const c = {
    schemaVersion: 1,
    eventId: e.id,
    category: "体验",
    angle: "普通人怎么用",
    researchRequirements: ["找反例"],
  };
  assert.equal(
    (await request("POST", P + "/classifications", c)).statusCode,
    200,
  );
  assert.equal(
    (await request("POST", P + "/classifications", c)).statusCode,
    200,
  );
  assert.deepEqual((await eventById(e.id))!.classification, c);
  const png = await sharp({
    create: { width: 3, height: 3, channels: 3, background: "#176b75" },
  })
    .png()
    .toBuffer();
  const saved = await saveCase(
    candidate(
      (await eventById(e.id)) as Event,
      "https://example.com/auth-case",
    ),
  );
  const a = await storeAsset(saved.id, png, "screenshot.png");
  assert.equal(
    (await request("GET", P + "/assets/" + a.id)).statusCode,
    200,
  );
  const response = await request("GET", P + "/assets/" + a.id);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] as string, /image\/png/);
  assert.match(response.headers["cache-control"] as string, /no-store/);
  assert.equal(
    (
      await request("POST", P + "/experiments", {
        schemaVersion: 1,
        experimentId: "wrong-case",
        eventId: e.id,
        caseId: "wrong-case-id",
        version: "1",
        environment: "",
        input: "",
        output: "",
        conclusion: "",
      })
    ).statusCode,
    400,
  );
});

test("公众号搜索只解析真实文章，付费重试复用回执且正文不会自动视为实测", async () => {
  let rejected = false;
  const service = await stub(() => rejected ? { code: 20001 } : {
    code: 0,
    cost_money: 0.01,
    title: "DeepSeek V4.1-Flash-1017 实测",
    author: "测试作者",
    nickname: "测试公众号",
    post_time: 1780000000,
    content:
      '<p>DeepSeek V4.1-Flash-1017 作者声称完成演示</p><img src="https://example.com/poster.jpg">',
  });
  process.env.DAJIALA_KEY = "test-monitor-key";
  process.env.DAJIALA_BASE_URL = service.url;
  try {
    const identity = { test: "receipt" };
    await mpCall(
      "article_detail",
      { url: "https://example.com/receipt" },
      identity,
      "test",
    );
    await mpCall(
      "article_detail",
      { url: "https://example.com/receipt" },
      identity,
      "test",
    );
    assert.equal(service.hits(), 1);
    const e = await ingestReport(report("hydrate-event"));
    e.version = "V4.1-Flash-1017";
    await saveEvent(e);
    const c = await saveCase({
      ...candidate(
        e,
        "https://mp.weixin.qq.com/s?__biz=fixture&mid=1&idx=1&sn=one",
      ),
      platform: "wechat",
    });
    const hydrated = await hydrateCase(c.id);
    assert.equal(hydrated.evidence, "unknown");
    assert.equal(hydrated.verification, "matched");
    assert.equal(hydrated.media[0].status, "candidate");
    const parsed = parseMpSearch({
      advanceSearch: { title: "导航" },
      data: [
        {
          items: [
            {
              title: "模型 <em>实测</em>",
              doc_url: c.url,
              source: { title: "作者" },
              desc: "测试",
              timestamp: 1780000000,
            },
          ],
        },
        { items: [{ title: "导航", url: "not-an-article" }] },
      ],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "模型 实测");
    assert.equal(parsed[0].publishedAt, new Date(1780000000000).toISOString());
    const exported = JSON.stringify(
      exportEvent(e, await reportsFor(e.id), [hydrated], [], []),
    );
    assert.ok(!exported.includes("test-monitor-key"));
    rejected = true;
    await assert.rejects(mpCall("web_search", {}, { test: "insufficient" }, "test"), /余额不足/);
    const [failure] = await sql`SELECT status FROM receipts WHERE purpose='monitor_web_search' ORDER BY id DESC LIMIT 1`;
    assert.equal(failure.status, "failed");
  } finally {
    delete process.env.DAJIALA_KEY;
    delete process.env.DAJIALA_BASE_URL;
    await service.close();
  }
});

test("a video URL returning an image is a failed archive, never a verified video", async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.end(png);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as any).port;
    const e = await ingestReport(report("poster-event"));
    const c = await saveCase({
      ...candidate(e, "https://example.com/poster-case"),
      media: [
        {
          kind: "video",
          url: "http://127.0.0.1:" + port + "/video",
          status: "candidate",
        },
      ],
    });
    await assert.rejects(archiveMedia(c.id, 0), /不是所需媒体/);
    const row = (await casesFor(e.id))[0];
    assert.equal(row.media[0].status, "failed");
    assert.equal(
      (await sql`SELECT id FROM hm_assets WHERE case_id=${c.id}`).length,
      0,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("upstream ETag revalidation and Retry-After prevent stale or repeated reads", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/private") {
      res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
      res.end('{"private":"must-not-persist"}');
      return;
    }
    if (req.url === "/limited") {
      res.writeHead(429, {
        "Retry-After": "120",
        "Content-Type": "application/json",
      });
      res.end("{}");
      return;
    }
    if (req.headers["if-none-match"] === '"fixture"') {
      res.writeHead(304, { "Cache-Control": "max-age=60" });
      res.end();
      return;
    }
    res.writeHead(200, {
      ETag: '"fixture"',
      "Cache-Control": "max-age=60",
      "Content-Type": "application/json",
    });
    res.end('{"items":[]}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.MONITOR_AIHOT_BASE_URL =
    "http://127.0.0.1:" + (server.address() as any).port;
  try {
    await remotePage("/etag");
    await remotePage("/etag");
    assert.equal(hits, 1);
    await sql`UPDATE hm_sync_cache SET valid_until=now()-interval '1 minute',fetched_at=now()-interval '61 seconds' WHERE path='/etag'`;
    const page = await remotePage("/etag");
    assert.deepEqual(page.data, { items: [] });
    assert.equal(hits, 2);
    await assert.rejects(remotePage("/limited"), /限流/);
    await assert.rejects(remotePage("/limited"), /稍后重试/);
    assert.equal(hits, 3);
    await assert.rejects(remotePage("/private"), /禁止缓存/);
    const [privateCache] = await sql`SELECT data FROM hm_sync_cache WHERE path='/private'`;
    assert.deepEqual(privateCache.data, {});
    assert.equal(hits, 4);
  } finally {
    delete process.env.MONITOR_AIHOT_BASE_URL;
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("changing the event version invalidates old case checks; a bundle contains the actual screenshot", async () => {
  const e = await ingestReport(report("bundle-event"));
  const c = await saveCase({
    ...candidate(e, "https://example.com/bundle-case"),
    verification: "matched",
    reviewed: true,
    notes: "复现重点",
  });
  await request("PATCH", P + "/events/" + e.id, { version: "V4.2" });
  const changed = (await casesFor(e.id))[0];
  assert.equal(changed.verification, "pending");
  assert.equal(changed.reviewed, false);
  assert.equal(changed.notes, "复现重点");
  const png = await sharp({
    create: { width: 3, height: 3, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const asset = await storeAsset(
    c.id,
    png,
    "screen.png",
    "https://example.com/image?token=private&sign=private",
  );
  const bundle = await buildBundle(e.id);
  try {
    const files = execFileSync("tar", ["-tzf", bundle.file], {
      encoding: "utf8",
    });
    assert.ok(files.includes("assets/" + asset.id + ".png"));
    const text = execFileSync("tar", ["-xOzf", bundle.file, "manifest.json"], {
      encoding: "utf8",
    });
    assert.ok(text.includes("复现重点"));
    assert.ok(!text.includes("token=private"));
    assert.ok(!text.includes("sign=private"));
    const actual = execFileSync("tar", [
      "-xOzf",
      bundle.file,
      "assets/" + asset.id + ".png",
    ]);
    assert.deepEqual(actual, png);
  } finally {
    await bundle.cleanup();
  }
});

test("concurrent identical commands enqueue one task", async () => {
  const e = await ingestReport(report("idempotent-event"));
  const options = {
    method: "POST" as const,
    url: P + "/events/" + e.id + "/score",
    payload: {},
    headers: {
      "idempotency-key": "same-command",
    },
  };
  const [a, b] = await Promise.all([app.inject(options), app.inject(options)]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(a.json().id, b.json().id);
  assert.equal(
    (await sql`SELECT id FROM hm_jobs WHERE id=${a.json().id}`).length,
    1,
  );
});

test("two independent model passes score the event and reuse receipts on recovery", async () => {
  const { installModules } = await import("@aihot/backend/modules");
  const { invalidateModelCache } =
    await import("@aihot/backend/editorial/models");
  const service = await stub((hit) => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            type: "product_launch",
            axes: { sig: 6, nov: 7, cred: 8, reson: 9, act: 10 },
            reason: "有明确任务与实际结果，适合创作者继续验证",
            ...(hit===1?{zhTitle:"新产品支持创作者完成实际任务",zhSummary:"增加了可以实际体验的新功能，演示结果仍需核对。"}:{}),
          }),
        },
      },
    ],
    usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
  }));
  installModules([
    {
      name: "hot-monitor",
      models: {
        monitorScore: {
          label: "测试评分",
          env: "MONITOR_SCORE_MODEL",
          purposes: ["monitor_score"],
        },
      },
    },
  ]);
  const oldModel = {
    key: process.env.LLM_API_KEY,
    url: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };
  process.env.LLM_API_KEY = "local-model-key";
  process.env.LLM_BASE_URL = service.url + "/v1";
  process.env.LLM_MODEL = "local-fixture";
  config.modelCallsEnabled = true;
  invalidateModelCache();
  try {
    const e = await ingestReport({...report("model-event"),title:"A new creative product with practical workflows",summary:"Creators can use the new features in real tasks and inspect the demonstrations."});
    const scored = await scoreEvent(e);
    assert.equal(service.hits(), 2);
    assert.equal(scored.score, 82);
    assert.equal(scored.scoreStatus, "scored");
    assert.equal(scored.scoreAxes?.length, 2);
    assert.ok(scored.chinese);
    assert.equal((await reportsFor(e.id))[0].upstreamScore, 88);
    await scoreEvent(scored);
    assert.equal(service.hits(), 2);
    const collector=await stub(()=>({items:[],page:{hasMore:false}}));
    process.env.MONITOR_AIHOT_BASE_URL=collector.url;
    try {
      const {perform,submitWork}=await import("../backend/jobs.ts");
      const [before]=await sql`SELECT count(*)::int AS n FROM hm_jobs WHERE data->>'kind'='score'`;
      const job=await submitWork({kind:"sync"});
      await perform({jobId:job.id,kind:"sync"});
      const [after]=await sql`SELECT count(*)::int AS n FROM hm_jobs WHERE data->>'kind'='score'`;
      assert.equal(after.n,before.n,"syncing news must not enqueue paid AI scoring");
      assert.equal(service.hits(),2,"news sync must not call the model");
    } finally {delete process.env.MONITOR_AIHOT_BASE_URL;await sql`DELETE FROM hm_sync_cache WHERE path LIKE '/api/v1/%'`;await collector.close();}
  } finally {
    config.modelCallsEnabled = false;
    installModules([]);
    invalidateModelCache();
    for (const [k, v] of Object.entries({
      LLM_API_KEY: oldModel.key,
      LLM_BASE_URL: oldModel.url,
      LLM_MODEL: oldModel.model,
    }))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await service.close();
  }
});

test("scoring revalidates expired public material and never pays for unavailable or withdrawn summaries",async()=>{
  const {installModules}=await import("@aihot/backend/modules");
  const {invalidateModelCache}=await import("@aihot/backend/editorial/models");
  const oldEnv={LLM_API_KEY:process.env.LLM_API_KEY,LLM_BASE_URL:process.env.LLM_BASE_URL,LLM_MODEL:process.env.LLM_MODEL,MONITOR_AIHOT_BASE_URL:process.env.MONITOR_AIHOT_BASE_URL};
  const prompts:any[]=[];
  const model=await stub((_hit,req)=>{
    prompts.push(JSON.parse(JSON.parse(req.body).messages.at(-1).content));
    return {choices:[{message:{content:JSON.stringify({type:"product_launch",axes:{sig:6,nov:7,cred:8,reson:9,act:10},reason:"已按最新可用材料评分"})}}],usage:{prompt_tokens:30,completion_tokens:40,total_tokens:70}};
  });
  let status=304,items:any[]=[],etag:string|undefined,requestedPath="";
  const upstream=http.createServer((req,res)=>{
    etag=req.headers["if-none-match"];
    requestedPath=req.url??"";
    res.writeHead(status,{"content-type":"application/json","cache-control":"public, max-age=60","etag":"\"material-next\""});
    res.end(status===304?undefined:JSON.stringify({items,page:{hasMore:false}}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));
  const upstreamUrl="http://127.0.0.1:"+(upstream.address() as {port:number}).port;
  installModules([{name:"hot-monitor",models:{monitorScore:{label:"测试评分",env:"MONITOR_SCORE_MODEL",purposes:["monitor_score"]}}}]);
  process.env.LLM_API_KEY="local-material-key";process.env.LLM_BASE_URL=model.url+"/v1";process.env.LLM_MODEL="local-material";process.env.MONITOR_AIHOT_BASE_URL=upstreamUrl;
  config.modelCallsEnabled=true;invalidateModelCache();
  const paths:string[]=[];
  const seed=async(id:string)=>{
    const input={...report(id),expiresAt:new Date(Date.now()-1000).toISOString()};
    const e=await ingestReport(input);
    const item={id,title:input.title,summary:input.summary,source:{name:input.source},links:{original:input.url},publishedAt:input.publishedAt};
    const path="/api/v1/items?"+new URLSearchParams({mode:"all",window:"7d",limit:"100",q:id});paths.push(path);
    await sql`INSERT INTO hm_sync_cache(path,valid_until,data,etag,fetched_at) VALUES(${path},now()-interval '2 minutes',${sql.json({items:[item],page:{hasMore:false}})},'"material-before"',now()-interval '2 minutes')`;
    return {e,item,path};
  };
  try {
    const unchanged=await seed("material-304");
    await scoreEvent(unchanged.e);assert.equal(etag,'"material-before"');assert.equal(model.hits(),2);assert.ok(Date.parse((await reportsFor(unchanged.e.id))[0].expiresAt!)>Date.now());
    const corrected=await seed("material-corrected");status=200;items=[{...corrected.item,title:"DeepSeek 更正后的发布",summary:"新摘要包含修订条件"}];
    await scoreEvent(corrected.e);assert.equal(model.hits(),4);assert.equal(prompts.at(-1).reports[0].summary,"新摘要包含修订条件");assert.equal(prompts.at(-1).event.summary,"新摘要包含修订条件");
    const missing=await seed("material-withdrawn");items=[];
    await assert.rejects(scoreEvent(missing.e),/未在最新动态中核实/);assert.equal(model.hits(),4);assert.equal((await reportsFor(missing.e.id))[0].active,true,"one missing page does not establish withdrawal");
    const timeout=await seed("material-timeout");status=504;
    await assert.rejects(scoreEvent(timeout.e),/材料更新失败/);assert.equal(model.hits(),4);
    const fresh=await ingestReport({...report("material-fresh"),origin:"self",title:"DeepSeek 当前官方说明",summary:"当前可用摘要"});
    await saveEvent({...fresh,title:"旧事件标题",summary:"过期事件摘要不得发给模型",summaryExpiresAt:new Date(Date.now()-1000).toISOString()});
    await scoreEvent((await eventById(fresh.id))!);assert.equal(model.hits(),6);assert.equal(prompts.at(-1).event.title,"DeepSeek 当前官方说明");assert.equal(prompts.at(-1).event.summary,"当前可用摘要");
    assert.ok(!JSON.stringify(prompts).includes("过期事件摘要不得发给模型"));
    const noPage=await ingestReport({...report("material-no-page"),expiresAt:new Date(Date.now()-1000).toISOString()});
    status=200;items=[{id:"material-no-page",title:noPage.title,summary:noPage.summary,source:{name:"测试来源"},links:{original:"https://example.com/material-no-page"},publishedAt:noPage.publishedAt}];
    await scoreEvent(noPage);assert.equal(model.hits(),8);assert.ok(new URL(requestedPath,upstreamUrl).searchParams.has("q"));paths.push(requestedPath);
  } finally {
    config.modelCallsEnabled=false;installModules([]);invalidateModelCache();
    for(const [key,value]of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await sql`DELETE FROM hm_sync_cache WHERE path=ANY(${paths})`;
    await model.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));
  }
});

test("multiword event search matches the model and version across a title", async () => {
  const e = await ingestReport(
    report("search-event", "https://example.com/search-event"),
  );
  const r = await request("GET", P + "/overview?q=DeepSeek%201017&window=all");
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().events.some((x: Event) => x.id === e.id));
  assert.ok(r.json().events.length <= 50);
});


test("all and selected upstream feeds retain their separate reference score", async () => {
  const item = { id: "mixed-sync", title: "DeepSeek V4.1-Flash-1017 发布", summary: "上游摘要", source: {name: "原始来源"}, links: {original: "https://example.com/mixed-sync"}, publishedAt: now() };
  const service = await stub((_hit, req) => req.url?.includes("hot-topics") ? {items: []} : {items: [{...item, ...(req.url?.includes("mode=selected") ? {score: 88} : {})}], page: {hasMore:false}});
  process.env.MONITOR_AIHOT_BASE_URL = service.url;
  try {
    await syncAihot();
    const [row] = await sql`SELECT event_id,data FROM hm_reports WHERE data->>'externalId'='mixed-sync'`;
    assert.equal(row.data.upstreamScore, 88);
    await ingestReport({...report("mixed-sync", item.links.original), upstreamScore: undefined});
    assert.equal((await reportsFor(row.event_id))[0].upstreamScore, 88);
    assert.equal((await eventById(row.event_id))!.score, null);
  } finally {
    delete process.env.MONITOR_AIHOT_BASE_URL;
    await service.close();
  }
});

test("Chinese display reuses a related Chinese report and never displays expired or withdrawn summaries", async()=>{
  const e=await ingestReport({...report("zh-reuse"),title:"A new model is released for creative work",summary:"The release makes it easier for creators to build applications."});
  const r={...(await reportsFor(e.id))[0],title:"新模型发布，面向实际创作",summary:"官方公布新版本，应用效果仍需实测。"};
  const view=displayEvent(e,[r]);
  assert.equal(view.title,r.title);assert.equal(view.chineseStatus,"related");assert.equal(view.originalTitle,e.title);
  const expired={...r,expiresAt:new Date(Date.now()-1000).toISOString()};
  assert.ok(!displayReport(expired).summary.includes(r.summary));
  assert.equal(displayEvent(e,[expired]).freshness,"refreshing");
  assert.equal(displayEvent(e,[{...r,active:false}]).freshness,"withdrawn");
  assert.equal(priorityFor(e,[{...r,upstreamSelected:true}]).rank,0);
  assert.equal(priorityFor({...e,title:"报名课程领取优惠券"},[r]).rank,3);
});

test("manual score is usable without a model and stays separate from upstream references",async()=>{
  const e=await ingestReport(report("manual-score","https://example.com/manual-score"));
  const r=await request("POST",P+"/events/"+e.id+"/manual-score",{type:"product_launch",axes:{sig:6,nov:7,cred:8,reson:9,act:10},reason:"有实际创作方法，仍需核对条件"});
  assert.equal(r.statusCode,200);assert.equal(r.json().score,82);assert.equal(r.json().scoreMethod,"manual");
  const updated=await ingestReport({...report("manual-followup","https://example.com/manual-score"),upstreamScore:99});
  assert.equal(updated.score,82);assert.equal(updated.scoreStatus,"scored");
  assert.equal((await scoreEvent(updated)).scoreStatus,"scored");
  const invalid=await request("POST",P+"/events/"+e.id+"/manual-score",{type:"product_launch",axes:{sig:20,nov:7,cred:8,reson:9,act:10},reason:"bad"});assert.equal(invalid.statusCode,400);
});

test("source field and role classification survives directory reloads",async()=>{
  const d=(await request("GET",P+"/catalogue")).json();const c=d.groups.flatMap((g:any)=>g.sources)[0];
  const changed=await request("PATCH",P+"/catalogue/"+c.id+"/classification",{fields:["AI与大模型","汽车"],sourceRole:"媒体"});assert.equal(changed.statusCode,200);
  const saved=(await request("GET",P+"/catalogue")).json().groups.flatMap((g:any)=>g.sources).find((s:any)=>s.id===c.id);
  assert.deepEqual(saved.fields,["AI与大模型","汽车"]);assert.equal(saved.sourceRole,"媒体");assert.equal(saved.classificationMethod,"manual");
});

test("human handoff exports only chosen cases and includes a readable document with attachments",async()=>{
  const e=await ingestReport(report("human-handoff"));
  const a=await saveCase({...candidate(e,"https://example.com/chosen"),title:"选中的创作案例",notes:"采用这个演示"});
  const b=await saveCase({...candidate(e,"https://example.com/not-chosen"),title:"未选择的案例",notes:"不应进入本次交接"});
  const png=await sharp({create:{width:2,height:2,channels:3,background:"blue"}}).png().toBuffer();
  const asset=await storeAsset(a.id,png,"chosen.png");
  await storeAsset(b.id,png,"excluded.png");
  const doc=await request("GET",P+"/events/"+e.id+"/handoff?cases="+a.id);
  assert.equal(doc.statusCode,200);assert.match(doc.body,/选中的创作案例/);assert.ok(!doc.body.includes("不应进入本次交接"));
  const wrong=await request("GET",P+"/events/"+e.id+"/handoff?cases=unrelated");assert.equal(wrong.statusCode,400);
  const bundle=await buildBundle(e.id,[a.id]);try{
    const manifest=JSON.parse(execFileSync("tar",["-xOf",bundle.file,"manifest.json"],{encoding:"utf8"}));
    assert.deepEqual(manifest.cases.map((c:Case)=>c.id),[a.id]);assert.deepEqual(manifest.assets.map((a:any)=>a.id),[asset.id]);
    assert.match(execFileSync("tar",["-xOf",bundle.file,"交接单.md"],{encoding:"utf8"}),/选中的创作案例/);
    const plain=execFileSync("tar",["-xOf",bundle.file,"交接单.txt"],{encoding:"utf8"});assert.match(plain,/选中的创作案例/);assert.ok(!plain.includes("不应进入本次交接"));
  }finally{await bundle.cleanup();}
});

test("paid translation keeps originals, reuses receipts, and becomes stale after source correction",async()=>{
  const {installModules}=await import("@aihot/backend/modules");const {invalidateModelCache}=await import("@aihot/backend/editorial/models");
  const service=await stub((_n,req)=>{const body=JSON.parse(req.body);if(body.response_format?.type==="json_object"&&!body.messages.some((m:any)=>/json/i.test(m.content)))return new Reply(400,{error:{message:"Prompt must contain json for json_object"}});const input=JSON.parse(body.messages.at(-1).content);return {choices:[{message:{content:JSON.stringify({items:input.map((v:any)=>({id:v.id,title:"新模型开放创作能力 V5.2",summary:"官方发布 V5.2，实际效果需要核对。"}))})}}],usage:{prompt_tokens:30,completion_tokens:40,total_tokens:70}};});
  const previous={LLM_API_KEY:process.env.LLM_API_KEY,LLM_BASE_URL:process.env.LLM_BASE_URL,LLM_MODEL:process.env.LLM_MODEL};
  installModules([{name:"hot-monitor",models:{monitorTranslate:{label:"测试翻译",env:"MONITOR_TRANSLATE_MODEL",purposes:["monitor_translate"]}}}]);
  Object.assign(process.env,{LLM_API_KEY:"local-model-key",LLM_BASE_URL:service.url+"/v1",LLM_MODEL:"local-fixture"});config.modelCallsEnabled=true;invalidateModelCache();
  try{
    const e=await ingestReport({...report("translate-event"),title:"A new model V5.2 for creative applications",summary:"Official announcement with examples requiring independent testing."});
    await translateEvent(e);await translateEvent(e);assert.equal(service.hits(),1);
    const saved=(await eventById(e.id))!;assert.equal(saved.title,e.title);assert.equal(saved.chinese!.sourceDigest,textDigest(e));
    assert.equal(displayEvent(saved,await reportsFor(e.id)).chineseStatus,"translated");
    await ingestReport({...report("translate-event"),title:e.title,summary:e.summary});
    assert.ok((await reportsFor(e.id))[0].chinese);
    const corrected=await ingestReport({...report("translate-event"),title:e.title,summary:"Corrected announcement with materially different facts."});
    assert.notEqual(corrected.chinese!.sourceDigest,textDigest(corrected));
    assert.equal(displayEvent(corrected,await reportsFor(e.id)).chineseStatus,"pending");
  }finally{config.modelCallsEnabled=false;installModules([]);invalidateModelCache();for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;await service.close();}
});

test("date and platform filters match one report, pagination clamps, and timeline uses source time", async()=>{
  const { queryEvents, timeline, paginate }=await import("../backend/query.ts");
  const e=await ingestReport(report("query-order","https://example.com/query-order"));
  const base=(await reportsFor(e.id))[0];
  const old={...base,id:"old",source:"公众号：测试",url:"https://mp.weixin.qq.com/s?__biz=test&mid=1&idx=1&sn=a",publishedAt:"2026-10-19T15:59:59.000Z",discoveredAt:"2026-10-21T00:00:00.000Z"};
  const latest={...base,id:"latest",source:"X：test",url:"https://x.com/test/status/1",publishedAt:"2026-10-19T16:00:00.000Z",discoveredAt:"2026-10-21T00:00:00.000Z"};
  const day={from:"2026-10-20",to:"2026-10-20"};
  assert.equal(queryEvents([e],[old,latest],{...day,platform:"公众号"}).events.length,0,"date and platform cannot match different reports");
  assert.equal(queryEvents([e],[old,latest],{...day,platform:"X / 推特"}).events.length,1);
  assert.equal(queryEvents([e],[old],{from:"2026-10-21",to:"2026-10-21",timeBy:"discovered"}).events.length,1);
  assert.throws(()=>queryEvents([e],[old],{from:"2026-02-30"}),/日期/);
  assert.throws(()=>queryEvents([e],[old],{from:"2026-10-21",to:"2026-10-20"}),/开始/);
  const p=paginate(Array.from({length:51},(_,i)=>i),{page:"99",pageSize:"20"});
  assert.deepEqual(p.page,{number:3,total:3,count:51,size:20}); assert.equal(p.items[0],40);
  const unknown={...base,id:"unknown",publishedAt:null};
  const sorted=timeline([latest,unknown,old,{...latest,id:"copy",origin:"self"}]);
  assert.deepEqual(sorted.map(r=>r.id),["old","latest","unknown"]);
  assert.deepEqual(sorted[1].origins,["aihot","self"]);
  assert.equal(sorted[1].duplicateCount,2);
  assert.deepEqual(timeline([old,latest],"desc").map(r=>r.id),["latest","old"]);
});

test("fresh dynamics arrive before hot expansion and a failed cursor never withdraws unseen reports",async()=>{
  await sql`DELETE FROM hm_sync_cache WHERE path LIKE '/api/v1/%'`;
  const keep=await ingestReport(report("unseen-on-failed-page"));
  const calls:string[]=[];
  const item={id:"head-before-hot",title:"新动态",source:{name:"X：官方"},links:{original:"https://example.com/head-before-hot"},publishedAt:now()};
  const service=await stub((_hit,req)=>{
    calls.push(req.url);
    if(req.url.includes("mode=all"))return {items:[item],page:{hasMore:true,nextCursor:"repeat"}};
    if(req.url.includes("hot-topics"))return new Reply(503,{});
    return {items:[],page:{hasMore:false}};
  });
  process.env.MONITOR_AIHOT_BASE_URL=service.url;
  try{
    const result=await syncAihot();
    assert.ok(calls[0].includes("mode=all"));
    assert.ok(result.errors.some(e=>e.startsWith("all：")));
    assert.ok(result.errors.some(e=>e.includes("热点榜")));
    assert.ok((await reportsFor(keep.id))[0].active);
    assert.equal((await sql`SELECT count(*)::int n FROM hm_reports WHERE data->>'externalId'='head-before-hot'`)[0].n,1);
  }finally{delete process.env.MONITOR_AIHOT_BASE_URL;await service.close();await sql`DELETE FROM hm_sync_cache WHERE path LIKE '/api/v1/%'`;}
});

test("editorial triage suppresses commodity noise, respects annotation and does not invent AI relevance",async()=>{
  const {inferField}=await import("../backend/domain.ts");
  const {reviewDigest}=await import("../backend/priority.ts");
  const e=await ingestReport(report("editorial-filter"));const r=(await reportsFor(e.id))[0];
  const commodity={...e,title:"荣耀耳机发布，售价269元"};
  assert.equal(priorityFor(commodity,[{...r,origin:"self",title:commodity.title,summary:"常规降噪与价格"}]).rank,3);
  assert.equal(inferField("罗曼太空望远镜成像提升30%"),"待归类");
  assert.equal(inferField("用Claude制作3D游戏"),"AI与大模型");
  assert.equal(inferField("三星钱包车钥匙支持吉利银河"),"汽车");
  const outside={...e,title:"罗曼太空望远镜成像提升30%"};
  assert.equal(priorityFor(outside,[{...r,origin:"self",title:outside.title,summary:"天文设备变化"}]).rank,3);
  const review={decision:"select" as const,by:"assistant" as const,reason:"需要独特体验",at:now(),materialDigest:reviewDigest(commodity)};
  assert.equal(priorityFor({...commodity,editorialReview:review},[r]).rank,0);
  assert.equal(priorityFor({...commodity,editorialReview:{...review,materialDigest:"stale"}},[r]).rank,3);
  const res=await request("PATCH",P+"/events/"+e.id,{editorialReview:{decision:"reject",reason:"缺少实际体验"}});
  assert.equal(res.statusCode,200);assert.equal(res.json().editorialReview.by,"editor");
  assert.equal((await eventById(e.id))?.score,null,"annotation must not turn into a numeric score");
});

test("AIHOT positions survive story updates, old discovery time and repeated synchronization",async()=>{
  const early=await ingestReport({...report("position-1"),publishedAt:"2026-10-10T00:00:00Z",upstreamPosition:0});
  const second=await ingestReport({...report("position-2"),upstreamPosition:1});
  const first=(await reportsFor(early.id))[0];assert.ok(first.receivedAt);
  await ingestReport({...report("position-1"),publishedAt:"2026-10-10T00:00:00Z",story:"position-story"});
  const updated=(await reportsFor(early.id))[0];
  assert.equal(updated.upstreamPosition,0);assert.equal(updated.receivedAt,first.receivedAt);
  const result=await request("GET",P+"/feed?window=all&sort=upstream");
  assert.equal(result.statusCode,200);const ids=result.json().reports.map((r:any)=>r.externalId);
  assert.ok(ids.indexOf("position-1")<ids.indexOf("position-2"));
  assert.ok(result.json().reports.every((r:any)=>r.origin==="aihot"));
});

test("legacy article links resolve to the existing event and removed batch processing stays unavailable",async()=>{
  const e=await ingestReport(report("old-item-link"));
  const resolved=await request("GET",P+"/legacy/item/old-item-link");
  assert.equal(resolved.statusCode,200);assert.equal(resolved.json().location,"/admin/monitor/events/"+e.id);
  const absent=await request("GET",P+"/legacy/item/never-seen");
  assert.equal(absent.json().location,"/admin/monitor/feed?window=all");
  assert.equal((await request("POST",P+"/process",{eventIds:[e.id]})).statusCode,404);
});

test("source registration persists, deduplicates, and never enables collection or stores credential fields",async()=>{
  const [before]=await sql`SELECT count(*)::int n FROM sources`;
  const draft={name:"待接入案例研究账号",platform:"B站",kind:"unknown",originalExample:"https://www.bilibili.com/test-account",fields:["AI与大模型"]};
  const created=await request("POST",P+"/catalogue",draft);assert.equal(created.statusCode,200);assert.equal(created.json().created,true);
  const id=created.json().source.id;
  const directory=(await request("GET",P+"/catalogue?q="+id)).json();
  assert.equal(directory.totals.matched,1);assert.equal(directory.groups[0].platform,"B站");
  assert.equal(directory.groups[0].sources[0].status,"candidate");assert.equal(directory.groups[0].sources[0].enabled,false);
  const repeated=await request("POST",P+"/catalogue",draft);assert.equal(repeated.json().created,false);assert.equal(repeated.json().source.id,id);
  assert.equal((await sql`SELECT count(*)::int n FROM sources`)[0].n,before.n);
  const secret=await request("POST",P+"/catalogue",{...draft,name:"不可登记凭据",config:{headers:{Authorization:"fixture-private"}}});
  assert.equal(secret.statusCode,400);assert.ok(!secret.body.includes("fixture-private"));
});

test("source groups paginate independently and search aliases, handles and IDs",async()=>{
  const {cataloguePage}=await import("../backend/catalogue.ts");
  const rows=Array.from({length:45},(_,i)=>({id:"source-"+i,name:"公众号：账号"+String(i).padStart(2,"0"),platform:"公众号",kind:"mp_account",handle:null,originalExample:"https://mp.weixin.qq.com/s?mid="+i,example:"",priority:false,status:"candidate" as const,aliases:["别名"+i]}));
  const q=cataloguePage(rows,{"page_公众号":"2",pageSize:"20"});
  assert.deepEqual(q.groups[0].page,{number:2,total:3,count:45,size:20});assert.equal(q.groups[0].sources[0].id,"source-20");
  assert.equal(cataloguePage(rows,{q:"别名30"}).groups[0].sources[0].id,"source-30");
  assert.equal(cataloguePage(rows,{q:"source-44"}).totals.matched,1);
  assert.equal(cataloguePage([{...rows[0],config:{ghid:"gh_fixture_account"}}],{q:"gh_fixture_account"}).totals.matched,1);
  assert.equal(cataloguePage([{...rows[0],config:{query:"from:fixture_handle"}}],{q:"fixture_handle"}).totals.matched,1);
  assert.equal(cataloguePage(rows,{connection:"connected"}).totals.matched,0);
  assert.equal(cataloguePage(rows,{connection:"unconnected"}).totals.matched,45);
  assert.equal(cataloguePage(rows,{"page_公众号":"999"}).groups[0].page.number,3);
  assert.equal(cataloguePage([{...rows[0],kind:"external"},rows[1]],{kind:"external"}).totals.matched,1);
});

test("external sources require a dated push before activation and use the existing authenticated ingest route",async()=>{
  const {checkSource,catalogue}=await import("../backend/catalogue.ts");
  const {syncSelf}=await import("../backend/sync.ts");
  const registered=await request("POST",P+"/catalogue",{name:"外部脚本测试入口",platform:"B站",kind:"external"});
  assert.equal(registered.statusCode,200);const id=registered.json().source.id;
  assert.equal((await checkSource(id,{},true,"test")).status,"candidate");
  assert.equal((await sql`SELECT id FROM sources WHERE id=${id}`).length,0);
  const previous=process.env.INGEST_TOKEN;process.env.INGEST_TOKEN="fixture-ingest-secret-long-enough";
  const push=(items:unknown[],headers:Record<string,string>={authorization:"Bearer fixture-ingest-secret-long-enough"})=>app.inject({method:"POST",url:"/api/ingest/items",headers,payload:{sourceId:id,sourceName:"外部脚本测试入口",items}});
  try {
    const item={title:"DeepSeek外部脚本测试",url:"https://example.org/external-module-dated",publishedAt:now()};
    assert.equal((await push([item],{})).statusCode,401);
    assert.equal((await push([{title:"缺日期",url:"https://example.org/external-module-undated"}])).json().created,1);
    assert.equal((await checkSource(id,{},true,"test")).status,"candidate");
    assert.equal((await sql`SELECT participation_mode FROM sources WHERE id=${id}`)[0].participation_mode,"isolated");
    assert.equal((await request("POST",P+"/catalogue/"+id+"/enabled",{enabled:true})).statusCode,400);
    assert.equal((await push([item])).json().created,1);
    assert.equal((await push([item])).json().created,0);
    const waiting=(await catalogue()).find(c=>c.id===id)!;
    assert.equal(waiting.kind,"external");assert.equal(waiting.status,"candidate");assert.equal(waiting.awaitingActivation,true);
    await syncSelf();
    assert.equal((await sql`SELECT id FROM hm_reports WHERE data->>'url'=${item.url}`).length,0);
    const verified=await checkSource(id,{},false,"test");assert.equal(verified.status,"verified");assert.ok(verified.verifiedAt);
    assert.equal((await sql`SELECT participation_mode FROM sources WHERE id=${id}`)[0].participation_mode,"isolated");
    const activated=await checkSource(id,{},true,"test");assert.equal(activated.status,"collectable");
    assert.equal((await sql`SELECT participation_mode FROM sources WHERE id=${id}`)[0].participation_mode,"editorial");
    await syncSelf();assert.equal((await sql`SELECT id FROM hm_reports WHERE data->>'url'=${item.url}`).length,1);
    assert.equal((await request("POST",P+"/catalogue/"+id+"/enabled",{enabled:false})).statusCode,200);
    assert.equal((await push([item])).statusCode,409);
    const output=(await request("GET",P+"/catalogue?kind=external")).body;
    assert.ok(output.includes(id));assert.ok(!output.includes(process.env.INGEST_TOKEN));
  } finally {if(previous===undefined)delete process.env.INGEST_TOKEN;else process.env.INGEST_TOKEN=previous;}
});

test("published rules expose actual score/search parameters and case queries retain the intended limits",async()=>{
  const {extractCaseKeywords}=await import("../case-search.ts");
  const caseKeywords=(e:any)=>extractCaseKeywords(e).keywords;
  assert.equal(caseKeywords({product:"",title:"DeepSeek V4.1 Flash 新版本：许愿式编程一键成真",summary:"产品发布",version:"DeepSeek 150"}),"DeepSeek V4.1 Flash");
  assert.equal(caseKeywords({product:"DeepSeek V4.1",title:"DeepSeek V4.1 发布",summary:"",version:"V4.1"}),"DeepSeek V4.1");
  const {caseSearchPlan}=await import("../backend/case-search.ts");
  const e=await ingestReport(report("search-rules"));
  const since=Date.parse("2026-10-21T00:00:00Z");
  const old={...e,publishedAt:"2026-10-01T00:00:00Z"};
  const mp=caseSearchPlan(old,"wechat","comparison","DeepSeek",since);assert.equal(mp.keyword,"DeepSeek 实测");assert.equal(mp.publishTimeType,3);
  const x=caseSearchPlan({...e,publishedAt:null},"x","failure","DeepSeek",since);assert.match(x.xQuery,/fail OR failure/);assert.match(x.xQuery,/since:2026-10-14$/);
  const {installModules}=await import("@aihot/backend/modules");
  installModules([{name:"hot-monitor",models:{monitorScore:{label:"测试评分",env:"MONITOR_SCORE_MODEL",purposes:["monitor_score"]},monitorTranslate:{label:"测试翻译",env:"MONITOR_TRANSLATE_MODEL",purposes:["monitor_translate"]}}}]);
  try {
  const rules=await request("GET",P+"/rules");assert.equal(rules.statusCode,200);
  const d=rules.json();const axes={sig:7,nov:6,cred:8,reson:5,act:4};
  assert.equal(d.weights.product_launch.reduce((s:number,w:number,i:number)=>s+w*Object.values(axes)[i],0),weightedScore("product_launch",axes));
  assert.equal(d.search.keywordLimit,140);assert.equal(d.recencyHours,48);
  assert.ok(!JSON.stringify(d).includes("API_KEY"));
  } finally {installModules([]);}

});

test("multi-platform cases preserve platform, original evidence and editorial work across batch and authenticated script imports",async()=>{
  const e=await ingestReport(report("multi-platform-cases"));
  const items=[{url:"https://www.bilibili.com/video/BV1fixture",title:"B站案例"},{url:"https://www.xiaohongshu.com/explore/fixture",title:"小红书案例"},{url:"https://weibo.com/123/fixture",title:"微博案例"},{url:"https://www.douyin.com/video/123456",title:"抖音案例"},{url:"https://youtu.be/fixture",title:"YouTube案例"}];
  const body={schemaVersion:1,eventId:e.id,items};
  assert.equal((await request("POST",P+"/cases/import",body)).statusCode,400);
  e.confirmed=true;await saveEvent(e);
  const saved=await request("POST",P+"/cases/import",body);assert.equal(saved.statusCode,200);assert.equal(saved.json().created,5);
  let cases=await casesFor(e.id);assert.deepEqual(new Set(cases.map(c=>c.platform)),new Set(["bilibili","xiaohongshu","weibo","douyin","youtube"]));
  assert.ok(cases.every(c=>!c.saved&&!c.reviewed&&c.evidence==="unknown"&&c.publishedAt===null));
  const c=cases[0];Object.assign(c,{notes:"人工核对记录",saved:true,reviewed:true,evidence:"repost",conditions:"实测条件待补"});await updateCase(c);
  const repeated=await request("POST",P+"/cases/import",{...body,items:[...items,{...items[0],url:items[0].url+"?utm_source=copy"}]});
  assert.equal(repeated.json().created,0);assert.equal(repeated.json().existing,5);assert.equal(repeated.json().duplicates,1);
  const kept=(await casesFor(e.id)).find(x=>x.id===c.id)!;assert.equal(kept.notes,"人工核对记录");assert.equal(kept.saved,true);assert.equal(kept.evidence,"repost");assert.equal(kept.reviewed,true);
  const invalid=await request("POST",P+"/cases/import",{...body,items:[{url:"https://example.org/valid-before-invalid"},{url:"file:///secret"}]});assert.equal(invalid.statusCode,400);assert.equal((await casesFor(e.id)).length,5);
  assert.equal((await request("POST",P+"/cases/import",{...body,items:Array.from({length:51},()=>items[0])})).statusCode,400);
  assert.equal((await request("POST",P+"/cases/ingest",body)).statusCode,401);
  const oldToken=process.env.INGEST_TOKEN;process.env.INGEST_TOKEN="fixture-multi-platform-ingest-token";
  try {
    const r=await app.inject({method:"POST",url:P+"/cases/ingest",headers:{authorization:"Bearer "+process.env.INGEST_TOKEN},payload:{schemaVersion:1,eventId:e.id,items:[{url:"https://b23.tv/new-fixture",title:"脚本导入案例",media:[{kind:"poster",url:"https://example.org/poster.jpg"}]}]}});
    assert.equal(r.statusCode,200);assert.equal(r.json().created,1);
    cases=await casesFor(e.id);const imported=cases.find(c=>c.captureMethod==="external")!;assert.equal(imported.platform,"bilibili");assert.equal(imported.media[0].kind,"poster");assert.equal(imported.media[0].status,"candidate");assert.equal(imported.saved,false);
    assert.ok(!JSON.stringify(exportEvent(e,[],cases,[],[])).includes(process.env.INGEST_TOKEN));
    const manual=await request("POST",P+"/cases",{eventId:e.id,url:"https://xhslink.com/other-fixture"});assert.equal(manual.json().platform,"xiaohongshu");
    const {casePlatform}=await import("../contracts.ts");assert.equal(casePlatform("https://bilibili.com.attacker.example/video"),"web");
    const comment="https://www.reddit.com/r/LocalLLaMA/comments/abc123/demo/def456/";
    const reddit=await request("POST",P+"/cases/import",{schemaVersion:1,eventId:e.id,items:[{url:comment,title:"作者补充测试条件"},{url:"https://redd.it/abc123",title:"讨论短链接"}]});
    assert.equal(reddit.json().created,2);
    const redditCases=(await casesFor(e.id)).filter(c=>c.platform==="reddit");assert.equal(redditCases.length,2);assert.ok(redditCases.some(c=>c.url===comment));assert.ok(redditCases.every(c=>!c.saved&&!c.reviewed&&c.evidence==="unknown"));
    assert.equal(casePlatform("https://old.reddit.com/r/LocalLLaMA/comments/abc123/"),"reddit");assert.equal(casePlatform("https://reddit.com.attacker.example/post"),"web");
  } finally {if(oldToken===undefined)delete process.env.INGEST_TOKEN;else process.env.INGEST_TOKEN=oldToken;}
});

test("X case searches use the documented adapter, preserve media as candidates, reuse receipts and obey budgets",async()=>{
  const prior={key:process.env.SOCIALDATA_API_KEY,base:process.env.SOCIALDATA_BASE_URL};
  delete process.env.SOCIALDATA_API_KEY;
  const e=await ingestReport(report("x-search-connection"));e.confirmed=true;await saveEvent(e);
  await assert.rejects(searchCases(e,"x","example","DeepSeek connection"),/SOCIALDATA_API_KEY/);
  let hits=0;
  const api=http.createServer((req,res)=>{
    hits++;assert.equal(req.headers.authorization,"Bearer fixture-socialdata-private-key");
    const u=new URL(req.url!,"http://127.0.0.1");assert.equal(u.pathname,"/twitter/search");assert.equal(u.searchParams.get("type"),"Latest");assert.match(u.searchParams.get("query")!,/DeepSeek.*connection.*since:/);assert.ok(!u.searchParams.get("query")!.includes("-filter:replies"));
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({tweets:[{id_str:"1234567890123456789",tweet_created_at:now(),full_text:"DeepSeek V4.1-Flash-1017: my comparison test",user:{name:"Original tester",screen_name:"fixture_tester"},extended_entities:{media:[{type:"video",media_url_https:"https://example.org/cover.jpg",video_info:{variants:[{content_type:"video/mp4",url:"https://example.org/demo.mp4"}]}}]}}]}));
  });await new Promise<void>(r=>api.listen(0,"127.0.0.1",r));
  process.env.SOCIALDATA_BASE_URL="http://127.0.0.1:"+(api.address() as {port:number}).port;process.env.SOCIALDATA_API_KEY="fixture-socialdata-private-key";
  const [budget]=await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='socialdata'`;
  try {
    await searchCases(e,"x","comparison","DeepSeek connection");await searchCases(e,"x","comparison","DeepSeek connection");assert.equal(hits,1);
    const rows=await casesFor(e.id);assert.equal(rows.length,1);const c=rows[0];assert.equal(c.url,"https://x.com/fixture_tester/status/1234567890123456789");assert.equal(c.author,"Original tester");assert.equal(c.captureMethod,"api");assert.equal(c.saved,false);assert.equal(c.evidence,"unknown");assert.deepEqual(c.media.map(m=>[m.kind,m.status]),[["poster","candidate"],["video","candidate"]]);
    const receipts=await sql`SELECT status,request,response FROM receipts WHERE service='socialdata' AND subject=${e.id}`;assert.equal(receipts.length,1);assert.equal(receipts[0].status,"completed");assert.ok(!JSON.stringify(receipts).includes(process.env.SOCIALDATA_API_KEY));
    await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('socialdata',0,0,0) ON CONFLICT(service) DO UPDATE SET per_minute=0,per_hour=0,per_day=0`;
    await assert.rejects(searchCases(e,"x","failure","DeepSeek budget test"),/Budget/);assert.equal(hits,1);
  } finally {
    if(budget)await sql`UPDATE budgets SET per_minute=${budget.per_minute},per_hour=${budget.per_hour},per_day=${budget.per_day} WHERE service='socialdata'`;else await sql`DELETE FROM budgets WHERE service='socialdata'`;
    for(const [key,value] of [["SOCIALDATA_API_KEY",prior.key],["SOCIALDATA_BASE_URL",prior.base]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
    await new Promise<void>(r=>api.close(()=>r()));
  }
});

test("case browsing searches beyond 500 records, paginates after filtering and reports factual evidence gaps",async()=>{
  const {caseGaps}=await import("../contracts.ts");
  const e=await ingestReport(report("case-list-pagination"));e.confirmed=true;await saveEvent(e);
  const rows=Array.from({length:505},(_,i)=>({...candidate(e,"https://www.reddit.com/r/test/comments/case"+i+"/"),title:"材料"+String(i).padStart(3,"0"),author:i===504?"Late Tester":"",notes:i===504?"snapshot-2026 reproducible":"",conditions:"原文未提供，待核对",saved:i!==503,reviewed:false,collectedAt:new Date(Date.parse("2026-10-20T00:00:00Z")+i*1000).toISOString(),publishedAt:null}));
  for(let offset=0;offset<rows.length;offset+=100)await sql`INSERT INTO hm_cases ${sql(rows.slice(offset,offset+100).map(c=>({id:c.id,event_id:e.id,url:c.url,data:sql.json(c as never)})))}`;
  const d=(await request("GET",P+"/cases?browse=saved&eventId="+e.id+"&page=2")).json();assert.equal(d.cases.length,20);assert.equal(d.caseList.scopeCount,504);assert.equal(d.caseList.savedCount,504);assert.equal(d.caseList.candidateCount,1);assert.equal(d.caseList.page.number,2);
  const found=(await request("GET",P+"/cases?browse=saved&eventId="+e.id+"&q=Late%20Tester%20snapshot-2026&page=99")).json();assert.equal(found.cases.length,1);assert.equal(found.cases[0].id,rows[504].id);assert.equal(found.caseList.page.number,1);
  const candidates=(await request("GET",P+"/cases?browse=candidates&eventId="+e.id+"&platform=reddit")).json();assert.equal(candidates.cases.length,1);assert.equal(candidates.cases[0].id,rows[503].id);
  assert.ok(caseGaps(rows[504],[]).includes("conditions"));assert.ok(caseGaps({...rows[504],media:[{kind:"poster",url:"https://example.org/poster",status:"candidate"}]},[]).includes("assets"));
  const complete={...rows[504],version:"snapshot-2026",verification:"matched" as const,conditions:"输入固定提示词，模型温度0.2，输出附截图",evidence:"author_test" as const,reviewed:true,publishedAt:now()};
  await updateCase(complete);const asset=await storeAsset(complete.id,await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer(),"evidence.png",null);
  const gaps=caseGaps(complete,[asset]);assert.deepEqual(gaps,[]);assert.equal(complete.evidence,"author_test");
  const missing=(await request("GET",P+"/cases?browse=saved&eventId="+e.id+"&gap=conditions&reviewed=false&pageSize=100")).json();assert.equal(missing.caseList.page.count,503);assert.equal(missing.cases.length,100);assert.ok(!missing.cases.some((c:Case)=>c.id===complete.id));
  const verified=(await request("GET",P+"/cases?browse=saved&eventId="+e.id+"&verification=matched&evidence=author_test&reviewed=true")).json();assert.equal(verified.cases.length,1);assert.equal(verified.assets.length,1);
  const all=(await request("GET",P+"/cases?saved=true&eventId="+e.id)).json();assert.equal(all.cases.length,504);
});

test("model spending reserves concurrent calls, defers work at zero budget and releases only known outcomes",async()=>{
  const {saveSpending,spendingSettings,modelUsage,estimateUsage,cnyDate,reserveModelJob,settleModelJob,reservationAmount}=await import('../backend/spending.ts');
  const {perform}=await import('../backend/jobs.ts');const {setJob}=await import('../backend/store.ts');
  const {installModules}=await import('@aihot/backend/modules');const {invalidateModelCache}=await import('@aihot/backend/editorial/models');
  const previous={LLM_API_KEY:process.env.LLM_API_KEY,LLM_BASE_URL:process.env.LLM_BASE_URL,LLM_MODEL:process.env.LLM_MODEL};
  const before=await spendingSettings();
  const service=await stub(()=>({choices:[{message:{content:JSON.stringify({type:'product_launch',axes:{sig:8,nov:8,cred:8,reson:8,act:8},reason:'测试证据完整'})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:40}}));
  installModules([{name:'hot-monitor',models:{monitorScore:{label:'评分',env:'MONITOR_SCORE_MODEL',purposes:['monitor_score']},monitorTranslate:{label:'翻译',env:'MONITOR_TRANSLATE_MODEL',purposes:['monitor_translate']}}}]);
  Object.assign(process.env,{LLM_API_KEY:'local-budget-key',LLM_BASE_URL:service.url+'/v1',LLM_MODEL:'deepseek-flash'});config.modelCallsEnabled=true;invalidateModelCache();
  const e=await ingestReport(report('money-budget')),rs=await reportsFor(e.id);const ids=[randomUUID(),randomUUID()];
  try{
    assert.equal(cnyDate(new Date('2026-10-21T16:00:00Z')),'2026-10-22');
    assert.deepEqual(estimateUsage({prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:40}),{input:100,output:50,cached:40,estimated:.0005216});
    const initial=await modelUsage();const amount=reservationAmount('score',e,rs);
    await saveSpending({dailyBudget:Math.ceil((initial.today.estimated+amount*1.5)*100)/100,autoMode:'off',translate:true});
    const reserved=await Promise.allSettled(ids.map(id=>reserveModelJob(id,'score',e,rs)));
    assert.equal(reserved.filter(r=>r.status==='fulfilled').length,1,'parallel requests cannot both spend the same remaining allowance');
    assert.equal((await modelUsage()).reservations,1);
    const held=ids[reserved.findIndex(r=>r.status==='fulfilled')];
    const receiptKey=randomUUID();
    await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,attempts) VALUES(${receiptKey},'deepseek','deepseek-flash','monitor_score',${e.id},'unknown',1)`;
    await settleModelJob(held);assert.equal((await modelUsage()).reservations,1,'unknown billing keeps the allowance');
    await sql`UPDATE receipts SET status='received',received_at=now() WHERE logical_key=${receiptKey}`;
    await settleModelJob(held);assert.equal((await modelUsage()).reservations,1,'a response without token usage cannot silently release its cost allowance');
    await sql`UPDATE receipts SET status='failed',received_at=NULL WHERE logical_key=${receiptKey}`;
    await settleModelJob(held);assert.equal((await modelUsage()).reservations,0);
    await saveSpending({dailyBudget:0,autoMode:'off',translate:true});
    const id=randomUUID();await setJob({id,eventId:e.id,kind:'score',status:'queued',message:'test',createdAt:now(),updatedAt:now()});
    await perform({jobId:id,eventId:e.id,kind:'score'});
    assert.equal((await sql`SELECT data FROM hm_jobs WHERE id=${id}`)[0].data.status,'waiting');assert.equal(service.hits(),0);
    await saveSpending({dailyBudget:5,autoMode:'off',translate:true});
    const {runModelAutomation}=await import('../backend/automation.ts');await runModelAutomation();
    assert.equal((await sql`SELECT data FROM hm_jobs WHERE id=${id}`)[0].data.status,'queued');
    await perform({jobId:id,eventId:e.id,kind:'score'});assert.equal(service.hits(),2);assert.equal((await eventById(e.id))?.scoreStatus,'scored');assert.equal((await modelUsage()).reservations,0);
    const hitCount=service.hits();assert.equal((await request('GET',P+'/usage')).statusCode,200);assert.equal(service.hits(),hitCount,'reading usage cannot call a model');
    assert.equal((await request('POST',P+'/usage/settings',{dailyBudget:-1,autoMode:'all',translate:true})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:P+'/usage/settings',headers:{origin:'https://untrusted.example','content-type':'application/json'},payload:{dailyBudget:100,autoMode:'all',translate:true}})).statusCode,403);
  }finally{
    await sql`DELETE FROM hm_model_reservations WHERE event_id=${e.id}`;
    await saveSpending({dailyBudget:before.dailyBudget,autoMode:before.autoMode,translate:before.translate});
    config.modelCallsEnabled=false;installModules([]);invalidateModelCache();for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;await service.close();
  }
});

test("automatic model scope excludes history, backfill, filtered news and pre-activation arrivals",async()=>{
  const {automaticCandidate}=await import('../backend/automation.ts');const {saveSpending}=await import('../backend/spending.ts');
  const e=await ingestReport({...report('auto-scope'),upstreamSelected:true});const rs=await reportsFor(e.id);const time=Date.now();
  const s={dailyBudget:5,autoMode:'recommended' as const,translate:true,enabledAt:new Date(time-10000).toISOString(),updatedAt:now()};
  assert.equal(automaticCandidate(e,rs,s,time),true);
  assert.equal(automaticCandidate(e,rs,{...s,autoMode:'off'},time),false);
  assert.equal(automaticCandidate(e,rs.map(r=>({...r,backfill:true})),s,time),false);
  assert.equal(automaticCandidate(e,rs.map(r=>({...r,publishedAt:new Date(time-2*86400000).toISOString()})),s,time),false);
  assert.equal(automaticCandidate(e,rs,{...s,enabledAt:new Date(time+1000).toISOString()},time),false);
  assert.equal(automaticCandidate({...e,title:'今日手机壳限时促销'},rs.map(r=>({...r,screening:'block'})),{...s,autoMode:'all'},time),false);
  const first=await saveSpending({dailyBudget:5,autoMode:'recommended',translate:true});const second=await saveSpending({dailyBudget:6,autoMode:'all',translate:false});assert.equal(first.enabledAt,second.enabledAt);
  await saveSpending({dailyBudget:5,autoMode:'off',translate:true});
});

test("automatic dispatch is idempotent and disabling it stops queued model work",async()=>{
  const {installModules}=await import('@aihot/backend/modules');const {invalidateModelCache}=await import('@aihot/backend/editorial/models');
  installModules([{name:'hot-monitor',models:{monitorScore:{label:'评分',env:'MONITOR_SCORE_MODEL',purposes:['monitor_score']},monitorTranslate:{label:'翻译',env:'MONITOR_TRANSLATE_MODEL',purposes:['monitor_translate']}}}]);invalidateModelCache();
  const {saveSpending}=await import('../backend/spending.ts');const {runModelAutomation}=await import('../backend/automation.ts');const {perform}=await import('../backend/jobs.ts');
  config.modelCallsEnabled=true;
  try{
    await saveSpending({dailyBudget:5,autoMode:'recommended',translate:true});
    const e=await ingestReport({...report('auto-dispatch'),upstreamSelected:true});
    await runModelAutomation();await runModelAutomation();
    const rows=await sql`SELECT data FROM hm_jobs WHERE data->>'eventId'=${e.id} AND data->>'automatic'='true'`;
    assert.equal(rows.length,1);assert.equal(rows[0].data.kind,'score');
    await saveSpending({dailyBudget:5,autoMode:'off',translate:true});
    await perform({jobId:rows[0].data.id,kind:'score',eventId:e.id,automatic:true});
    const job=(await sql`SELECT data FROM hm_jobs WHERE id=${rows[0].data.id}`)[0].data;
    assert.equal(job.status,'completed');assert.match(job.message,/未调用模型/);assert.equal((await eventById(e.id))?.scoreStatus,'pending');
  }finally{config.modelCallsEnabled=false;installModules([]);invalidateModelCache();await saveSpending({dailyBudget:5,autoMode:'off',translate:true});}
});

test("topic shortlist exports selected events without confirming them or leaking expired text, credentials or spreadsheet formulas",async()=>{
  const first=await ingestReport({...report('shortlist-one','https://example.com/shortlist?token=private-token'),title:'=SUM(1,2)',summary:'用于选题讨论'+'很长的原始资料'.repeat(300),upstreamSelected:true});
  const expired=await ingestReport({...report('shortlist-old'),title:'历史线索',summary:'过期摘要不应导出',expiresAt:new Date(Date.now()-1000).toISOString()});
  const r=await request('POST',P+'/topics/export',{ids:[first.id,expired.id,first.id]});assert.equal(r.statusCode,200);const out=r.json();
  assert.equal(out.count,2);assert.ok(out.text.length<2000,'shortlist stays readable when a source summary contains a long article');assert.match(out.text,/用于选题讨论/);assert.ok(!out.text.includes('过期摘要不应导出'));assert.ok(!out.text.includes('private-token'));assert.match(out.csv,/'=SUM/);assert.ok(out.csv.startsWith('\uFEFF'));assert.equal((await eventById(first.id))?.confirmed,false);
  assert.equal((await request('POST',P+'/topics/export',{ids:['unknown']})).statusCode,400);
  assert.equal((await request('POST',P+'/topics/export',{ids:Array(51).fill(first.id)})).statusCode,400);
});

test("selected multi-platform links can go straight to the library while keeping original review metadata",async()=>{
  const e=await ingestReport(report('quick-library'));e.confirmed=true;await saveEvent(e);
  const input={schemaVersion:1,eventId:e.id,destination:'library',note:'02:30查看演示，需复现',items:[{url:'https://www.reddit.com/r/test/comments/post/comment/'},{url:'https://www.youtube.com/watch?v=demo&t=150'}]};
  const result=await request('POST',P+'/cases/import',input);assert.equal(result.statusCode,200);assert.equal(result.json().adopted,2);
  let list=await casesFor(e.id,true);assert.equal(list.length,2);assert.ok(list.every(c=>!c.reviewed&&c.evidence==='unknown'&&c.notes===input.note));assert.ok(list.some(c=>c.url.includes('/comment/')));assert.ok(list.some(c=>c.url.includes('t=150')));
  const c=list[0];c.notes='原有人工备注';c.reviewed=true;await updateCase(c);
  const repeated=await request('POST',P+'/cases/import',{...input,note:'不能覆盖旧备注'});assert.equal(repeated.json().created,0);assert.equal(repeated.json().adopted,0);list=await casesFor(e.id,true);assert.equal(list.find(x=>x.id===c.id)?.notes,'原有人工备注');assert.equal(list.find(x=>x.id===c.id)?.reviewed,true);
  const patch=await request('PATCH',P+'/cases/'+c.id,{title:'手动核对标题',author:'原作者',publishedAt:'2026-10-25T12:00:00+08:00',summary:'这是一条手工填写的材料摘要'});assert.equal(patch.statusCode,200);assert.equal(patch.json().author,'原作者');assert.equal(patch.json().evidence,'unknown');
  const output=await request('GET',P+'/events/'+e.id+'/export?cases='+c.id);assert.equal(output.statusCode,200);assert.deepEqual(output.json().cases.map((x:any)=>x.id),[c.id]);assert.match(JSON.stringify(output.json()),/原作者/);
  const empty=await request('GET',P+'/events/'+e.id+'/export?cases=');assert.equal(empty.json().cases.length,0);assert.equal(empty.json().assets.length,0);
  const imported=await import('../backend/case-intake.ts');await assert.rejects(imported.importCaseCandidates(input,'external'),/外部脚本只能/);
});

test("case keyword extraction keeps model families and platform searches avoid headline and syntax leakage",async()=>{
  const {extractCaseKeywords,platformCaseSearch}=await import('../case-search.ts');
  const base={product:'',summary:'',version:null,publishedAt:'2026-10-20T12:00:00+08:00'};
  const samples=[
    ['DeepSeek V4.1 Flash 新版本：许愿式编程一键成真','DeepSeek V4.1 Flash'],
    ['卡兹克分享8个Claude Opus 5.5玩法','Claude Opus 5.5'],
    ['月之暗面发布Kimi K3.1 Pro，编程能力更新','Kimi K3.1 Pro'],
    ['KRAFTON发布Raon-1 mini：30B-A4B，可与Meta Muse Glimmer竞争','Raon-1 mini'],
    ['vLLM 101手册：基线vLLM 0.31.0实测','vLLM 0.31.0'],
    ['Claude桌面应用新版界面，不到3周','Claude'],
    ['Grok Bot 0.77上线，可致电、支付','Grok Bot 0.77'],
    ['Qwen3-8B开源模型实测','Qwen 3-8B'],['Sora 2视频演示','Sora 2'],['Mistral发布Voxtral 3','Voxtral 3'],['DeepSeek开源自研推理框架DeepInfer','DeepInfer'],
  ];
  for(const [title,keywords] of samples)assert.equal(extractCaseKeywords({...base,title}).keywords,keywords,title);
  assert.equal(extractCaseKeywords({...base,title:'DeepSeek成本增加1.2倍'}).version,null);
  assert.equal(extractCaseKeywords({...base,title:'Gemini 3周内更新'}).version,null);
  const included={...base,title:'推出DeepSeek-V4.1-Flash，更新说明'};assert.equal(platformCaseSearch(included,'youtube','example',undefined,'broad').query,'DeepSeek');assert.ok(!platformCaseSearch(included,'x').query.includes(' -V4'));
  assert.match(platformCaseSearch({...base,title:'可灵4.0视频演示'},'x','example').query,/\) 4\.0/);
  assert.equal(extractCaseKeywords({...base,title:'国内首部AI电影《三星堆：未来往事》票房116.2万'}).version,null);
  const e={...base,title:samples[0][0],version:'DeepSeek 150'};const draft=extractCaseKeywords(e);assert.match(draft.warnings.join(''),/未用于搜索/);
  const time=Date.parse('2026-10-26T00:00:00Z');
  const x=platformCaseSearch(e,'x','comparison',undefined,'precise',time);assert.match(x.query,/OR/);assert.match(x.query,/coding/);assert.match(x.query,/since:2026-10-19/);assert.ok(!x.query.includes('许愿式'));assert.ok(!x.query.includes('-filter:replies'));
  const broad=platformCaseSearch(e,'x','comparison',undefined,'broad',time);assert.ok(!broad.query.includes('4.1'));assert.ok(!broad.query.includes('coding'));assert.ok(!broad.query.includes('review'));assert.ok(!broad.query.includes('since:'));
  const reddit=platformCaseSearch(e,'reddit','failure',undefined,'precise',time);assert.match(reddit.query,/AND/);assert.match(reddit.query,/failure OR problem/);assert.ok(!reddit.query.includes('since:'));assert.equal(new URL(reddit.url).searchParams.get('sort'),'relevance');
  const youtube=platformCaseSearch(e,'youtube','comparison',undefined,'precise',time);assert.match(youtube.query,/coding review/);assert.ok(!youtube.query.includes(' OR '));assert.ok(!new URL(youtube.url).searchParams.has('sp'));
  const cn=platformCaseSearch({...base,title:'可灵Kling 4.0视频生成实测'},'wechat','comparison',undefined,'precise',time);assert.match(cn.query,/可灵/);assert.ok(!cn.query.includes(' OR '));assert.ok(!cn.query.includes('since:'));
  const edited=platformCaseSearch(e,'youtube','example','MyManual Product',undefined,time);assert.match(edited.query,/MyManual Product/);assert.ok(!edited.query.includes('DeepSeek'));assert.ok(!edited.query.includes('coding'));
  assert.match(platformCaseSearch(e,'youtube','example','ManualResearch V4.1 Flash','broad',time).query,/V4.1 Flash/);
  assert.equal(extractCaseKeywords({...base,title:'不知道怎么选'}).confidence,'inferred');
});

test("plain text handoff and preview honour the same cases as other exports and keep search guidance",async()=>{
  const e=await ingestReport(report('plain-handoff'));e.confirmed=true;await saveEvent(e);
  const a=await saveCase({...candidate(e,'https://example.com/plain-a'),title:'选择的材料',author:'原作者',notes:'02:30值得复现'});
  await saveCase({...candidate(e,'https://example.com/plain-b'),title:'不导出的材料'});
  const preview=await request('GET',P+'/events/'+e.id+'/handoff?cases='+a.id+'&format=txt&preview=true');assert.equal(preview.statusCode,200);assert.match(preview.headers['content-type']!,/text\/plain/);assert.equal(preview.headers['content-disposition'],undefined);assert.match(preview.body,/选择的材料/);assert.match(preview.body,/原作者/);assert.match(preview.body,/02:30/);assert.ok(!preview.body.includes('不导出的材料'));assert.match(preview.body,/案例继续搜寻/);assert.match(preview.body,/reddit.com/);
  const download=await request('GET',P+'/events/'+e.id+'/handoff?cases='+a.id+'&format=txt');assert.match(download.headers['content-disposition']!,/\.txt/);assert.equal(download.body,preview.body);
  const empty=await request('GET',P+'/events/'+e.id+'/handoff?cases=&format=txt&preview=true');assert.ok(!empty.body.includes('02:30'));assert.match(empty.body,/DeepSeek/);
  assert.equal((await request('GET',P+'/events/'+e.id+'/handoff?format=exe')).statusCode,400);
});

test("title character selection preserves model tokens, Unicode and source order",async()=>{
  const {titleTokens,joinTitleTokens,tokensForKeywords}=await import('../title-keywords.ts');
  const text='可灵4.0发布，支持GPT-6.1和Qwen3-30B-A3B视频生成🐦‍⬛';const tokens=titleTokens(text);
  assert.ok(tokens.some(t=>t.text==='GPT-6.1'));assert.ok(tokens.some(t=>t.text==='Qwen3-30B-A3B'));assert.ok(tokens.some(t=>t.text==='🐦‍⬛'));
  const indices=(parts:string[])=>parts.map(text=>tokens.findIndex(t=>t.text===text));
  assert.equal(joinTitleTokens(text,tokens,indices(['视','频','可','灵'])),'可灵 视频');
  assert.equal(joinTitleTokens(text,tokens,indices(['视','频','生','成'])),'视频生成');
  assert.equal(joinTitleTokens(text,tokens,indices(['视','生','成'])),'视 生成');
  const english='Claude Opus 5.5 编程';const words=titleTokens(english);assert.equal(joinTitleTokens(english,words,tokensForKeywords(english,words,'Claude Opus 5.5')),'Claude Opus 5.5');
  const {platformCaseSearch}=await import('../case-search.ts');const e={product:'',title:'DeepSeek V4.1 Flash编程演示',summary:'',version:null,publishedAt:null};
  assert.equal(platformCaseSearch(e,'youtube','example','DeepSeek V4.1 Flash','broad',Date.now(),'title').query,'DeepSeek V4.1 Flash');
  assert.ok(!platformCaseSearch(e,'youtube','example','DeepSeek V4.1 Flash','precise',Date.now(),'title').query.includes('coding'));
});

test("topic date browsing groups Beijing dates and reads only eligible topics",async()=>{
  const first=await ingestReport({...report('date-picker-a'),publishedAt:'2026-01-01T16:30:00Z'});first.confirmed=true;await saveEvent(first);
  const second=await ingestReport({...report('date-picker-b'),publishedAt:'2026-01-02T02:00:00Z'});second.confirmed=true;await saveEvent(second);
  const unknown=await ingestReport({...report('date-picker-unknown'),publishedAt:null});unknown.confirmed=true;await saveEvent(unknown);
  const pending=await ingestReport({...report('date-picker-pending'),publishedAt:'2026-01-01T17:00:00Z'});
  const list=(await request('GET',P+'/cases?browse=candidates&eventId='+first.id)).json();assert.ok(list.topicDates.some((d:any)=>d.date==='2026-01-02'&&d.count>=2));
  const items=(await request('GET',P+'/topics?date=2026-01-02')).json().events;assert.ok(items.some((e:Event)=>e.id===first.id));assert.ok(items.some((e:Event)=>e.id===second.id));assert.ok(!items.some((e:Event)=>e.id===pending.id));
  const withCurrent=(await request('GET',P+'/topics?date=2026-01-02&currentId='+pending.id)).json().events;assert.ok(withCurrent.some((e:Event)=>e.id===pending.id));
  const undated=(await request('GET',P+'/topics?date=unknown')).json().events;assert.ok(undated.some((e:Event)=>e.id===unknown.id));assert.equal((await eventById(pending.id))?.confirmed,false);
  assert.equal((await request('GET',P+'/topics?date=2026-02-31')).statusCode,400);
  assert.equal((await request('GET',P+'/topics?date=not-a-date')).statusCode,400);
});

test("plain keyword searches do not add example, task, alias or date conditions",async()=>{
  const {platformCaseSearch}=await import('../case-search.ts');const {caseSearchPlan}=await import('../backend/case-search.ts');
  const e=await ingestReport({...report('raw-keywords-rog'),title:'华硕ROG影之刃零联名发布',summary:'新联名产品介绍'});
  const words='华硕 ROG 影之刃零 联名';
  for(const platform of ['x','youtube','wechat','xiaohongshu','douyin','bilibili','weibo','web'] as const){const plan=platformCaseSearch(e,platform,undefined,words);assert.equal(plan.query,words,platform);assert.ok(!plan.query.includes('案例'));assert.ok(!plan.query.includes('since:'));}
  assert.equal(caseSearchPlan(e,'wechat','keywords',words).keyword,words);assert.equal(caseSearchPlan(e,'x','keywords',words).xQuery,words);
  const narrow=platformCaseSearch(e,'wechat','example',words);assert.match(narrow.query,/案例$/);
  const reddit=platformCaseSearch(e,'reddit',undefined,words);assert.ok(!reddit.query.includes('demo'));assert.ok(!reddit.query.includes('案例'));assert.match(reddit.query,/AND/);
});

test("public case metadata extracts supplied HTML metadata without guessing dates or accepting protected images", () => {
  const metadata = parseCaseMetadata(`<!doctype html><html><head>
    <meta property="og:title" content="可复现的模型演示 &amp; 对比">
    <meta name="twitter:title" content="后备标题">
    <meta property="og:image" content="../images/result.png">
    <meta name="twitter:image" content="https://cdn.example.org/another.jpg">
    <meta property="og:image" content="https://user:secret@example.org/private.jpg">
    <meta property="og:image" content="https://cdn.example.org/signed.jpg?token=private">
    <meta property="og:image" content="http://127.0.0.1/private.png">
    <meta property="og:description" content="原作者提供的任务、输入与完整输出。">
    <meta name="author" content="真实原作者">
    <meta property="article:published_time" content="2026-10-26T09:30:00+08:00">
    <title>网页标题</title></head><body><h1>文章标题</h1></body></html>`, "https://example.org/posts/demo");
  assert.equal(metadata.title, "可复现的模型演示 & 对比");
  assert.equal(metadata.author, "真实原作者");
  assert.equal(metadata.summary, "原作者提供的任务、输入与完整输出。");
  assert.equal(metadata.publishedAt, "2026-10-26T01:30:00.000Z");
  assert.deepEqual(metadata.media.map(m => [m.url, m.kind, m.status]), [["https://example.org/images/result.png", "image", "candidate"], ["https://cdn.example.org/another.jpg", "image", "candidate"]]);
  const structured = parseCaseMetadata(`<script type="application/ld+json">${JSON.stringify({"@graph": [{"@type": "WebSite", name: "通用网站名"}, {"@type": "https://schema.org/BlogPosting", headline: "独立测试记录", author: [{name: "作者甲"}], datePublished: "2026-10-25T12:00:00Z", description: "测试条件来自原文", image: {url: "/cover.jpg"}}]})}</script>`, "https://example.org/post");
  assert.equal(structured.title, "独立测试记录"); assert.equal(structured.author, "作者甲"); assert.equal(structured.media[0].url, "https://example.org/cover.jpg");
  assert.equal(parseCaseMetadata('<h1>标题有效但时间没有时区</h1><meta property="article:published_time" content="2026-10-26 09:30:00">', "https://example.org").publishedAt, undefined);
  assert.equal(parseCaseMetadata('<h1>标题有效但日历日期错误</h1><meta property="article:published_time" content="2026-02-31T09:30:00Z">', "https://example.org").publishedAt, undefined);
  assert.throws(() => parseCaseMetadata('<title>Just a moment...</title><meta property="og:title" content="旧缓存的标题">', "https://example.org"), /登录|验证/);
  assert.throws(() => parseCaseMetadata('<title>Reddit - Dive into anything</title><meta property="og:image" content="/logo.png">', "https://reddit.com/post"), /有效案例标题/);
  assert.throws(() => parseCaseMetadata('<title>YouTube</title>', "https://youtube.com/watch?v=M7lc1UVf-VE"), /有效案例标题/);
  assert.throws(() => parseCaseMetadata('<title>小红书 - 你访问的页面不见了</title><meta property="og:image" content="/error-logo.png">', "https://www.xiaohongshu.com/discovery/item/missing"), /不存在|删除/);
  assert.equal(parseCaseMetadata('<title>A real article - 404 Media</title><meta property="og:title" content="A real article">', "https://www.404media.co/article").title,"A real article");
  assert.equal(parseCaseMetadata('<title>How to fix HTTP 404 errors</title>', "https://example.org/tutorial").title,"How to fix HTTP 404 errors");
});

test("public case metadata uses the guarded HTML reader, rejects blocked pages and never fetches image candidates", async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url!);
    if (req.url === "/redirect") { res.writeHead(302, {location: "/article"}); res.end(); return; }
    if (req.url === "/login-redirect") { res.writeHead(302, {location: "/login"}); res.end(); return; }
    if (req.url === "/forbidden") { res.writeHead(403); res.end("Forbidden"); return; }
    if (req.url === "/binary") { res.writeHead(200, {"content-type": "image/jpeg"}); res.end("image bytes"); return; }
    res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
    if (req.url === "/large") res.end("a".repeat(2 * 1024 * 1024 + 1));
    else if (req.url === "/login") res.end("<title>Sign in to continue</title>");
    else res.end('<meta property="og:title" content="公开原文演示"><meta property="og:image" content="https://cdn.example.org/case.jpg"><meta name="author" content="演示作者">');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + (server.address() as {port: number}).port;
  try {
    const result = await readCaseMetadata(url + "/redirect", "web"); assert.equal(result.title, "公开原文演示"); assert.equal(result.media[0].status, "candidate");
    assert.deepEqual(hits, ["/redirect", "/article"]);
    await assert.rejects(readCaseMetadata(url + "/login-redirect", "web"), /登录|验证/);
    await assert.rejects(readCaseMetadata(url + "/forbidden", "reddit"), /403/);
    await assert.rejects(readCaseMetadata(url + "/binary", "web"), /HTML/);
    await assert.rejects(readCaseMetadata(url + "/large", "web"), /too large/i);
    await assert.rejects(readCaseMetadata("https://youtube.com.attacker.example/watch?v=M7lc1UVf-VE", "youtube"), /YouTube/);
    await assert.rejects(readCaseMetadata("https://x.com/just-a-profile", "x"), /原帖/);
    const count = hits.length;
    config.allowPrivateNetworkFetch = false;
    await assert.rejects(readCaseMetadata(url + "/article", "web"), /Blocked|private|public/i);
    assert.equal(hits.length, count);
  } finally {
    config.allowPrivateNetworkFetch = true;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("public YouTube and X oEmbed reads keep only returned evidence and do not execute embed scripts", async () => {
  const {MockAgent, getGlobalDispatcher, setGlobalDispatcher} = await import("undici");
  const previous = getGlobalDispatcher(), proxy = config.egressProxyUrl;
  const mock = new MockAgent(); mock.disableNetConnect();
  let youtubeRequests = 0, xRequests = 0;
  mock.get("https://www.youtube.com").intercept({path: /^\/oembed\?/}).reply(options => {
    youtubeRequests++; const url = new URL(String(options.path), "https://www.youtube.com");
    assert.equal(url.searchParams.get("url"), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
    assert.equal(url.searchParams.get("format"), "json");
    return {statusCode: 200, data: JSON.stringify({title: "原作者视频测试", author_name: "视频作者", thumbnail_url: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg", html: '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE"></iframe>'}), responseOptions: {headers: {"content-type": "application/json"}}};
  });
  mock.get("https://publish.x.com").intercept({path: /^\/oembed\?/}).reply(options => {
    xRequests++; const url = new URL(String(options.path), "https://publish.x.com");
    assert.equal(url.searchParams.get("url"), "https://x.com/tester/status/1234567890123456789");
    assert.equal(url.searchParams.get("omit_script"), "true");
    return {statusCode: 200, data: JSON.stringify({author_name: "原帖作者", html: '<blockquote class="twitter-tweet"><p>我用新模型完成了任务 &amp; 展示输出。</p>— 原帖作者 <a>October 26, 2026</a></blockquote><script src="https://platform.x.com/widgets.js"></script>'}), responseOptions: {headers: {"content-type": "application/json"}}};
  });
  config.egressProxyUrl = null; setGlobalDispatcher(mock);
  try {
    const yt = await readCaseMetadata("https://youtu.be/M7lc1UVf-VE?t=30", "youtube");
    assert.equal(yt.title, "原作者视频测试"); assert.equal(yt.author, "视频作者"); assert.equal(yt.publishedAt, undefined);
    assert.deepEqual(yt.media, [{kind: "poster", url: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg", status: "candidate"}]);
    const x = await readCaseMetadata("https://twitter.com/tester/status/1234567890123456789?utm_source=share", "x");
    assert.equal(x.title, "我用新模型完成了任务 & 展示输出。"); assert.equal(x.summary, x.title); assert.equal(x.author, "原帖作者");
    assert.deepEqual(x.media, []); assert.equal(x.publishedAt, undefined); assert.equal(youtubeRequests, 1); assert.equal(xRequests, 1);
    mock.assertNoPendingInterceptors();
  } finally { setGlobalDispatcher(previous); config.egressProxyUrl = proxy; await mock.close(); }
});

test("saved link metadata runs publicly once, preserves editorial work and fails without losing blocked links", async () => {
  const {perform} = await import("../backend/jobs.ts");
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++; res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
    res.end(req.url === "/restricted" ? '<title>安全验证</title><h1>请完成安全验证</h1>' : '<meta property="og:title" content="公开网页的具体案例标题"><meta name="author" content="网页原作者"><meta name="description" content="原文提供的测试过程"><meta property="article:published_time" content="2026-10-26T09:30:00+08:00"><meta property="og:image" content="https://cdn.example.org/metadata-case.jpg">');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + (server.address() as {port: number}).port;
  const e = await ingestReport(report("public-metadata-import")); e.confirmed = true; await saveEvent(e);
  const body = {schemaVersion: 1, eventId: e.id, destination: "library", intent: "keywords", note: "编辑先记下的发现价值", items: [{url: url + "/article"}]};
  const beforeReceipts = (await sql`SELECT count(*)::int AS count FROM receipts`)[0].count;
  try {
    const imported = await request("POST", P + "/cases/import", body); assert.equal(imported.statusCode, 200); assert.equal(imported.json().metadataQueued, 1);
    const id = imported.json().caseIds[0]; let c = (await casesFor(e.id)).find(c => c.id === id)!;
    assert.equal(c.metadata?.status, "queued"); assert.equal(c.saved, true);
    const jobs = await sql`SELECT data FROM hm_jobs WHERE data->>'eventId'=${e.id} AND data->>'kind'='hydrate'`;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].data.status, "queued");
    c.notes = "编辑更新后的备注"; c.reviewed = true; c.evidence = "author_test"; await updateCase(c);
    await perform({jobId: jobs[0].data.id, kind: "hydrate", eventId: e.id, caseId: id, readMode: "public"});
    c = (await casesFor(e.id)).find(c => c.id === id)!;
    assert.equal(c.title, "公开网页的具体案例标题"); assert.equal(c.author, "网页原作者"); assert.equal(c.summary, "原文提供的测试过程"); assert.equal(c.publishedAt, "2026-10-26T01:30:00.000Z"); assert.equal(c.metadata?.status, "ready");
    assert.equal(c.notes, "编辑更新后的备注"); assert.equal(c.reviewed, true); assert.equal(c.evidence, "author_test");
    assert.deepEqual(c.media, [{kind: "image", url: "https://cdn.example.org/metadata-case.jpg", status: "candidate"}]); assert.equal(hits, 1);
    assert.equal(c.metadata?.coverUrl,"https://cdn.example.org/metadata-case.jpg");
    assert.equal((await sql`SELECT id FROM hm_assets WHERE case_id=${id}`).length, 0);
    const repeated = await request("POST", P + "/cases/import", body); assert.equal(repeated.json().metadataQueued, 0); assert.equal(repeated.json().existing, 1); assert.equal(hits, 1);
    c.title = "编辑确认的标题"; c.author = "人工作者"; c.summary = "编辑摘要"; await updateCase(c);
    await hydrateCase(id, "public"); c = (await casesFor(e.id)).find(c => c.id === id)!;
    assert.equal(c.title, "编辑确认的标题"); assert.equal(c.author, "人工作者"); assert.equal(c.summary, "编辑摘要"); assert.equal(c.media.length, 1);
    const restricted = await request("POST", P + "/cases/import", {...body, items: [{url: url + "/restricted"}]}); assert.equal(restricted.json().metadataQueued, 1);
    const blockedId = restricted.json().caseIds[0];
    const blockedJob = (await sql`SELECT data FROM hm_jobs WHERE data->>'eventId'=${e.id} AND data->>'kind'='hydrate' AND data->>'status'='queued'`)[0].data;
    await perform({jobId: blockedJob.id, kind: "hydrate", eventId: e.id, caseId: blockedId, readMode: "public"});
    const blocked = (await casesFor(e.id)).find(c => c.id === blockedId)!;
    assert.equal(blocked.metadata?.status, "failed"); assert.match(blocked.metadata?.error ?? "", /登录|验证/); assert.equal(blocked.url, url + "/restricted"); assert.equal(blocked.saved, true); assert.equal(blocked.title, "待补充案例标题"); assert.deepEqual(blocked.media, []);
    assert.equal((await sql`SELECT count(*)::int AS count FROM receipts`)[0].count, beforeReceipts);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("blocked public WeChat pages use the existing paid article reader only for complete authorised article links", async () => {
  const {MockAgent, getGlobalDispatcher, setGlobalDispatcher} = await import("undici");
  const previous = getGlobalDispatcher(), proxy = config.egressProxyUrl;
  const beforeKey = process.env.DAJIALA_KEY, beforeBase = process.env.DAJIALA_BASE_URL;
  const mock = new MockAgent(); mock.disableNetConnect(); mock.enableNetConnect(/127\.0\.0\.1/);
  mock.get("https://mp.weixin.qq.com").intercept({path: /^\/s(?:[/?]|$)/}).reply(302, "", {headers:{location:"/mp/verify.html"}}).persist();
  mock.get("https://mp.weixin.qq.com").intercept({path: "/mp/verify.html"}).reply(200, "<title>安全验证</title><h1>请完成安全验证</h1>", {headers:{"content-type":"text/html"}}).persist();
  const service = await stub((_hit, req) => {
    assert.match(req.url, /\/article_detail$/); assert.equal(JSON.parse(req.body).key, "fixture-fallback-key");
    return {code:0,cost_money:0.01,title:"接口返回的公众号原文标题",nickname:"原公众号",post_time_str:"2026-10-26 10:00:00",cover_url:"https://cdn.example.org/first-cover.jpg",cover:{url:"https://cdn.example.org/not-a-string.jpg"},content:'<p>原作者公开的演示过程与测试条件</p><img data-src="https://cdn.example.org/body-case.jpg"><img src="https://user:secret@example.org/private.jpg">'};
  });
  config.egressProxyUrl = null; process.env.DAJIALA_KEY = "fixture-fallback-key"; process.env.DAJIALA_BASE_URL = service.url; setGlobalDispatcher(mock);
  const e = await ingestReport(report("wechat-public-fallback")); e.confirmed = true; await saveEvent(e);
  try {
    const c = await saveCase({...candidate(e,"https://mp.weixin.qq.com/s/fixture_fallback"),platform:"wechat",title:"待补充案例标题",author:"",summary:"",publishedAt:null,notes:"编辑已经写好的采用理由",reviewed:true,evidence:"author_test"});
    const hydrated = await hydrateCase(c.id,"public");
    assert.equal(hydrated.title,"接口返回的公众号原文标题"); assert.equal(hydrated.author,"原公众号"); assert.equal(hydrated.summary,"原作者公开的演示过程与测试条件"); assert.equal(hydrated.publishedAt,"2026-10-26T02:00:00.000Z");
    assert.equal(hydrated.metadata?.status,"ready"); assert.equal(hydrated.metadata?.method,"wechat_api"); assert.equal(hydrated.notes,"编辑已经写好的采用理由"); assert.equal(hydrated.reviewed,true); assert.equal(hydrated.evidence,"author_test");
    assert.deepEqual(hydrated.media.map(m=>[m.url,m.status]),[["https://cdn.example.org/first-cover.jpg","candidate"],["https://cdn.example.org/body-case.jpg","candidate"]]); assert.equal(service.hits(),1);
    const receipts = await sql`SELECT status,request,response FROM receipts WHERE subject=${c.id} AND purpose='monitor_article_detail'`;
    assert.equal(receipts.length,1); assert.equal(receipts[0].status,"completed"); assert.ok(!JSON.stringify(receipts).includes("fixture-fallback-key"));
    const edited={...hydrated,title:"编辑自己确认的标题",author:"编辑确认作者",summary:"编辑自己的摘要",notes:"后续人工备注"}; await updateCase(edited);
    const reread=await hydrateCase(c.id,"public"); assert.equal(service.hits(),1); assert.equal(reread.title,edited.title); assert.equal(reread.author,edited.author); assert.equal(reread.summary,edited.summary); assert.equal(reread.notes,edited.notes); assert.equal(reread.media.length,2);
    const incomplete=await saveCase({...candidate(e,"https://mp.weixin.qq.com/s"),platform:"wechat",title:"待补充案例标题",author:"",summary:""});
    await assert.rejects(hydrateCase(incomplete.id,"public"),/链接不完整/); assert.equal(service.hits(),1);
    let failed=(await casesFor(e.id)).find(row=>row.id===incomplete.id)!; assert.equal(failed.metadata?.status,"failed"); assert.equal(failed.url,incomplete.url); assert.deepEqual(failed.media,[]);
    assert.equal((await sql`SELECT id FROM receipts WHERE subject=${incomplete.id}`).length,0);
    delete process.env.DAJIALA_KEY;
    const unconfigured=await saveCase({...candidate(e,"https://mp.weixin.qq.com/s/fixture_no_key"),platform:"wechat",title:"待补充案例标题",author:"",summary:""});
    await assert.rejects(hydrateCase(unconfigured.id,"public"),/未配置/); assert.equal(service.hits(),1);
    failed=(await casesFor(e.id)).find(row=>row.id===unconfigured.id)!; assert.equal(failed.metadata?.status,"failed"); assert.equal(failed.metadata?.method,"public"); assert.equal(failed.url,unconfigured.url); assert.equal((await sql`SELECT id FROM receipts WHERE subject=${unconfigured.id}`).length,0);
  } finally {
    setGlobalDispatcher(previous); config.egressProxyUrl=proxy;
    if(beforeKey===undefined)delete process.env.DAJIALA_KEY;else process.env.DAJIALA_KEY=beforeKey;
    if(beforeBase===undefined)delete process.env.DAJIALA_BASE_URL;else process.env.DAJIALA_BASE_URL=beforeBase;
    await mock.close(); await service.close();
  }
});

test("full WeChat reads preserve concurrent editorial changes and existing verified media", async () => {
  const entered=gate(), release=gate();
  const service=await stub(async()=>{entered.open();await release.promise;return {code:0,title:"服务返回的新标题",author:"服务返回作者",post_time:1780000000,cover:"https://cdn.example.org/full-cover.jpg",content:"<p>DeepSeek V4.1-Flash-1017 新原文内容</p>"+Array.from({length:55},(_v,i)=>'<img data-src="https://cdn.example.org/long-case-'+i+'.jpg">').join("")};});
  const beforeKey=process.env.DAJIALA_KEY,beforeBase=process.env.DAJIALA_BASE_URL;
  process.env.DAJIALA_KEY="fixture-concurrent-key";process.env.DAJIALA_BASE_URL=service.url;
  const e=await ingestReport(report("wechat-full-concurrent"));e.version="V4.1-Flash-1017";await saveEvent(e);
  const c=await saveCase({...candidate(e,"https://mp.weixin.qq.com/s?__biz=fixture&mid=2&idx=1&sn=concurrent"),platform:"wechat",title:"开始读取时的标题"});
  let reading:Promise<Case>|undefined;
  try {
    reading=hydrateCase(c.id);await entered.promise;
    const current=(await casesFor(e.id)).find(row=>row.id===c.id)!;
    Object.assign(current,{title:"请求期间编辑修正的标题",author:"请求期间确认的作者",summary:"请求期间编辑写的摘要",notes:"请求期间记录的备注",reviewed:true,evidence:"author_test",version:"人工版本",verification:"mismatch",versionEvidence:"人工版本依据",media:[{kind:"image",url:"https://cdn.example.org/editor-asset.jpg",status:"verified"}]});await updateCase(current);
    release.open();const hydrated=await reading;
    assert.equal(hydrated.title,current.title);assert.equal(hydrated.author,current.author);assert.equal(hydrated.summary,current.summary);assert.equal(hydrated.notes,current.notes);assert.equal(hydrated.reviewed,true);assert.equal(hydrated.evidence,"author_test");assert.equal(hydrated.version,"人工版本");assert.equal(hydrated.verification,"mismatch");assert.equal(hydrated.versionEvidence,"人工版本依据");
    assert.equal(hydrated.media[0].status,"verified");assert.equal(hydrated.media[1].url,"https://cdn.example.org/full-cover.jpg");assert.equal(hydrated.metadata?.method,"wechat_api");
    assert.equal(hydrated.media.length,50);assert.ok(hydrated.media.slice(1).every(m=>m.kind==="image"&&m.status==="candidate"));
    assert.equal((await sql`SELECT status FROM receipts WHERE subject=${c.id} AND purpose='monitor_article_detail'`)[0].status,"completed");
  } finally {
    release.open();await reading?.catch(()=>{});
    if(beforeKey===undefined)delete process.env.DAJIALA_KEY;else process.env.DAJIALA_KEY=beforeKey;
    if(beforeBase===undefined)delete process.env.DAJIALA_BASE_URL;else process.env.DAJIALA_BASE_URL=beforeBase;
    await service.close();
  }
});

test("manual URL saving queues metadata and simultaneous public retries enqueue only one task per case", async () => {
  const e=await ingestReport(report("manual-metadata-queue"));e.confirmed=true;await saveEvent(e);
  const manual=await request("POST",P+"/cases",{eventId:e.id,url:"https://example.org/manual-metadata"});
  assert.equal(manual.statusCode,200);assert.equal(manual.json().title,"待补充案例标题");assert.equal(manual.json().metadata.status,"queued");assert.equal(manual.json().saved,true);
  const jobsForEvent=()=>sql`SELECT data FROM hm_jobs WHERE data->>'eventId'=${e.id} AND data->>'kind'='hydrate'`;
  assert.equal((await jobsForEvent()).length,1);
  for(const status of [undefined,"ready"] as const){
    const c=await saveCase({...candidate(e,"https://example.org/concurrent-metadata-"+(status??"new")),...(status?{metadata:{status,method:"public" as const,updatedAt:now()}}:{})});
    const before=(await jobsForEvent()).length;
    const responses=await Promise.all([request("POST",P+"/cases/"+c.id+"/hydrate",{mode:"public"}),request("POST",P+"/cases/"+c.id+"/hydrate",{mode:"public"})]);
    assert.ok(responses.every(response=>response.statusCode===200));assert.equal((await jobsForEvent()).length,before+1);
    assert.equal((await casesFor(e.id)).find(row=>row.id===c.id)!.metadata?.status,"queued");
  }
});

async function collectorExtensionFixture() {
  const core=await import(new URL("../extension/collector-core.mjs",import.meta.url).href);
  const tabs=new Map<number,any>([[1,{id:1,url:"http://localhost:3002/admin/monitor/research?eventId=event-A",lastAccessed:10}],[2,{id:2,url:"https://www.reddit.com/r/LocalLLaMA/comments/abc/demo/comment/",lastAccessed:20}]]);
  const storage:Record<string,unknown>={},session:Record<string,unknown>={},events:Record<string,any>={"event-A":{id:"event-A",title:"已确认的选题A",confirmed:true},"event-B":{id:"event-B",title:"已确认的选题B",confirmed:true}};
  const calls:Array<{type:string;tabId?:number;request?:any;message?:any;options?:any}>=[];
  const state:{result:{created:number;existing:number;adopted:number;metadataQueued:number};grantResponse:boolean;grantedOrigins:Set<string>;registered:any[];grantAfterRequest?:string[]}={result:{created:1,existing:0,adopted:1,metadataQueued:1},grantResponse:true,grantedOrigins:new Set(),registered:[]};
  const api={runtime:{id:"fixture-extension",getManifest:()=>({version:"1.1.0"})},permissions:{request:async(options:any)=>{calls.push({type:"permission-request",options});if(state.grantResponse)state.grantedOrigins=new Set(state.grantAfterRequest??core.AUTO_ORIGINS);return state.grantResponse;},contains:async(options:any)=>{calls.push({type:"permission-contains",options});return options.origins.every((origin:string)=>state.grantedOrigins.has(origin));}},storage:{local:{get:async(key:string)=>{calls.push({type:"local-get"});return {[key]:storage[key]};},set:async(value:Record<string,unknown>)=>{Object.assign(storage,value);}},session:{get:async(key:string)=>{calls.push({type:"session-get"});return {[key]:session[key]};},set:async(value:Record<string,unknown>)=>{Object.assign(session,value);}}},tabs:{
    get:async(id:number)=>{calls.push({type:"tab-get",tabId:id});const tab=tabs.get(id);if(!tab)throw new Error("closed tab");return {...tab};},
    query:async(query:any)=>[...tabs.values()].filter(tab=>query.url.some((url:string)=>url.startsWith("https:"))?Boolean(core.platformPermission(tab.url)):Boolean(core.workspacePage(tab.url))).map(tab=>({...tab})),
    sendMessage:async(tabId:number,message:any)=>{calls.push({type:"message",tabId,message});},
    update:async(tabId:number,options:any)=>{calls.push({type:"update",tabId,options});Object.assign(tabs.get(tabId),options);return tabs.get(tabId);},
    create:async(options:any)=>{calls.push({type:"create",options});return {id:10,...options};},
  },scripting:{getRegisteredContentScripts:async()=>state.registered,registerContentScripts:async(scripts:any[])=>{calls.push({type:"register",options:scripts});state.registered=scripts;},unregisterContentScripts:async(options:any)=>{calls.push({type:"unregister",options});state.registered=[];},executeScript:async(options:any)=>{
    if(options.files){calls.push({type:"inject",tabId:options.target.tabId,options});return [];}
    assert.equal(options.func,core.workspaceBridge);
    const request=options.args[0];calls.push({type:"bridge",tabId:options.target.tabId,request});
    assert.ok(["event","import"].includes(request.operation));
    return [{result:request.operation==="event"?{event:events[request.eventId]}:state.result}];
  }}};
  return {core,controller:core.createCollectorController(api),api,tabs,storage,session,events,calls,state,sender:{id:"fixture-extension",frameId:0,url:tabs.get(2).url,tab:{id:2,url:tabs.get(2).url}},workspaceSender:()=>({id:"fixture-extension",frameId:0,url:tabs.get(1).url,tab:{id:1,url:tabs.get(1).url}})};
}

test("collector extension permissions and source metadata stay bounded to explicit local workbench access", async()=>{
  const manifest=JSON.parse(readFileSync(new URL("../extension/manifest.json",import.meta.url),"utf8"));
  assert.equal(manifest.manifest_version,3);assert.deepEqual(new Set(manifest.permissions),new Set(["activeTab","scripting","storage"]));
  assert.deepEqual(manifest.host_permissions,["http://localhost:3002/*","http://127.0.0.1:3002/*"]);assert.equal(manifest.externally_connectable,undefined);assert.equal(manifest.version,"1.1.0");
  assert.deepEqual(manifest.content_scripts,[{matches:["http://localhost:3002/admin/monitor*","http://127.0.0.1:3002/admin/monitor*"],js:["workspace.js"],run_at:"document_idle"}]);
  const {core}=await collectorExtensionFixture();
  assert.deepEqual(manifest.optional_host_permissions,core.AUTO_ORIGINS);assert.ok(!manifest.optional_host_permissions.includes("<all_urls>"));
  assert.equal(core.workspacePage("http://localhost:3002/admin/monitor/events/event-A").eventId,"event-A");
  assert.equal(core.workspacePage("http://127.0.0.1:3002/admin/monitor/handoff?eventId=event-A").eventId,"event-A");
  for(const url of ["http://localhost:3003/admin/monitor/research?eventId=event-A","https://localhost:3002/admin/monitor/research?eventId=event-A","http://localhost.attacker.example:3002/admin/monitor/research?eventId=event-A","http://localhost:3002/other","http://localhost:3002/admin/monitorevil"])assert.equal(core.workspacePage(url),null,url);
  const url="https://example.org/article?utm_source=share&token=temporary";
  const item=core.caseItem({url,title:"原标题",author:"原作者",summary:"原页面描述",publishedAt:"2026-10-26T10:00:00+08:00",cover:"/cover.jpg",saved:true,reviewed:true,eventId:"evil",media:[{kind:"video",url:"https://evil.example/video"}]},url);
  assert.equal(item.title,"原标题");assert.equal(item.author,"原作者");assert.equal(item.publishedAt,"2026-10-26T02:00:00.000Z");assert.deepEqual(item.media,[{kind:"image",url:"https://example.org/cover.jpg"}]);assert.equal(new URL(item.url).search,"");assert.equal(item.saved,undefined);assert.equal(item.reviewed,undefined);assert.equal(item.eventId,undefined);
  assert.equal(core.caseItem({url:"https://example.org/a",title:"YouTube",cover:"http://127.0.0.1/private.jpg"},"https://example.org/a").title,undefined);
  assert.equal(core.caseItem({url:"https://example.org/a",cover:"https://cdn.example.org/private.jpg?token=secret"},"https://example.org/a").media,undefined);
  assert.throws(()=>core.caseItem({url:"https://example.org/a"},"https://example.org/b"),/地址已变化/);
  for(const title of ["Access Denied","Page not found","小红书 - 你访问的页面不见了","登录 - 微信公众平台"])assert.throws(()=>core.caseItem({url:"https://example.org/a",title},"https://example.org/a"),/登录|失效/);
  assert.equal(core.caseItem({url:"https://example.org/a",title:"A real article - 404 Media"},"https://example.org/a").title,"A real article - 404 Media");
  assert.throws(()=>core.pageUrl("file:///private/file"),/HTTP/);assert.throws(()=>core.pageUrl("chrome://extensions"),/HTTP/);
});

test("collector discovers confirmed local context then saves without navigating or activating either tab",async()=>{
  const f=await collectorExtensionFixture();
  await f.controller.toolbar({id:2});
  const shown=f.calls.find(call=>call.type==="message")!.message;
  assert.equal(shown.context.eventId,"event-A");assert.equal(shown.context.title,"已确认的选题A");assert.equal(f.storage[f.core.CONTEXT_KEY]!==undefined,true);
  assert.deepEqual(f.calls.filter(c=>c.type==="bridge").map(c=>[c.tabId,c.request.operation]),[[1,"event"]]);
  const source=f.tabs.get(2).url;
  const result=await f.controller.handleMessage({type:"HM_SAVE",expectedEventId:"event-A",item:{url:source,title:"原作者的真实演示",author:"原作者",cover:"https://cdn.example.org/case.jpg",eventId:"wrong-target",saved:true}},f.sender);
  assert.deepEqual(result,{ok:true,created:1,existing:0,metadataQueued:1,metadataFailed:0,adopted:1});
  const imported=f.calls.filter(c=>c.type==="bridge"&&c.request.operation==="import");assert.equal(imported.length,1);assert.equal(imported[0].tabId,1);assert.equal(imported[0].request.eventId,"event-A");assert.equal(imported[0].request.item.url,source);assert.equal(imported[0].request.item.eventId,undefined);
  assert.equal(f.calls.some(c=>c.type==="update"||c.type==="create"),false);assert.equal(f.tabs.get(2).url,source);
  f.state.result={created:0,existing:1,adopted:0,metadataQueued:0};
  const duplicate=await f.controller.handleMessage({type:"HM_SAVE",expectedEventId:"event-A",item:{url:source}},f.sender);assert.equal(duplicate.existing,1);assert.equal(duplicate.created,0);
  await f.controller.handleMessage({type:"HM_OPEN_LIBRARY"},f.sender);
  const navigation=f.calls.find(c=>c.type==="update")!;assert.equal(navigation.tabId,1);assert.equal(navigation.options.url,"http://localhost:3002/admin/monitor/cases?eventId=event-A");assert.equal(navigation.options.active,true);
});

test("collector rejects changed targets and mismatched source URLs instead of silently saving under another topic",async()=>{
  const f=await collectorExtensionFixture();await f.controller.toolbar({id:2});
  f.tabs.get(1).url="http://localhost:3002/admin/monitor/cases?eventId=event-B";
  const changed=await f.controller.handleMessage({type:"HM_SAVE",expectedEventId:"event-A",item:{url:f.tabs.get(2).url}},f.sender);
  assert.equal(changed.ok,false);assert.equal(changed.code,"context-changed");assert.equal(changed.context.eventId,"event-B");assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);
  await assert.rejects(f.controller.handleMessage({type:"HM_SAVE",expectedEventId:"event-B",item:{url:"https://example.org/not-current-page"}},f.sender),/地址已变化/);
  await assert.rejects(f.controller.handleMessage({type:"HM_SAVE",expectedEventId:"event-B",item:{url:f.tabs.get(2).url}},{id:"different-extension",tab:{id:2}}),/无效/);
  f.events["event-B"].confirmed=false;
  await assert.rejects(f.controller.handleMessage({type:"HM_SAVE",expectedEventId:"event-B",item:{url:f.tabs.get(2).url}},f.sender),/确认选题/);
  assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);
  const empty=await collectorExtensionFixture();empty.tabs.delete(1);await empty.controller.toolbar({id:2});assert.equal(empty.calls.find(c=>c.type==="message")!.message.context,null);assert.equal(empty.calls.some(c=>c.type==="create"),false);
});

test("collector bridge allows only fixed same-origin event reads and case imports and blocks a last-moment topic change",async()=>{
  const {core}=await collectorExtensionFixture();
  const originalLocation=Object.getOwnPropertyDescriptor(globalThis,"location"),originalFetch=globalThis.fetch;
  const requests:Array<{path:string;options:any}>=[];
  Object.defineProperty(globalThis,"location",{configurable:true,value:new URL("http://localhost:3002/admin/monitor/research?eventId=event-A")});
  globalThis.fetch=async(input,options)=>{requests.push({path:String(input),options});return new Response(JSON.stringify({created:1,existing:0}),{headers:{"content-type":"application/json"}});};
  try{
    await core.workspaceBridge({operation:"event",origin:"http://localhost:3002",eventId:"event-A",path:"http://evil.example/arbitrary"});assert.equal(requests[0].path,"/api/admin/monitor/events/event-A");assert.equal(requests[0].options.method,"GET");
    await core.workspaceBridge({operation:"import",origin:"http://localhost:3002",eventId:"event-A",item:{url:"https://x.com/tester/status/1234567890123456789",title:"原帖",saved:true,reviewed:true},body:{eventId:"wrong"}});
    assert.equal(requests[1].path,"/api/admin/monitor/cases/import");assert.equal(requests[1].options.method,"POST");assert.equal(requests[1].options.credentials,"same-origin");
    const body=JSON.parse(requests[1].options.body);assert.equal(body.schemaVersion,1);assert.equal(body.destination,"library");assert.equal(body.eventId,"event-A");assert.equal(body.intent,"keywords");assert.equal(body.source,"browser");assert.equal(body.items.length,1);assert.equal(body.items[0].reviewed,undefined);assert.equal(body.items[0].saved,undefined);assert.equal(requests[1].options.headers.authorization,undefined);
    await assert.rejects(core.workspaceBridge({operation:"fetch",origin:"http://localhost:3002",eventId:"event-A",path:"/api/other"}),/不支持/);
    const changed=await core.workspaceBridge({operation:"import",origin:"http://localhost:3002",eventId:"event-B",item:{url:"https://example.org/a"}});assert.equal(changed.contextChanged,true);assert.equal(requests.length,2);
    Object.defineProperty(globalThis,"location",{configurable:true,value:new URL("http://localhost:3003/admin/monitor/research?eventId=event-A")});
    await assert.rejects(core.workspaceBridge({operation:"event",origin:"http://localhost:3003",eventId:"event-A"}),/地址已变化/);assert.equal(requests.length,2);
  }finally{globalThis.fetch=originalFetch;if(originalLocation)Object.defineProperty(globalThis,"location",originalLocation);else Reflect.deleteProperty(globalThis,"location");}
});


test("browser captures keep page metadata and skip redundant paid enrichment when complete",async()=>{
  const e=await ingestReport(report("browser-capture-complete"));e.confirmed=true;await saveEvent(e);
  const body={schemaVersion:1,source:"browser",eventId:e.id,destination:"library",items:[{url:"https://example.org/browser-original",title:"浏览器中的原文标题",author:"原作者",summary:"原网页公开简介",media:[{kind:"image",url:"https://cdn.example.org/original-cover.jpg"}]}]};
  const result=await request("POST",P+"/cases/import",body);assert.equal(result.statusCode,200);assert.equal(result.json().metadataQueued,0);
  const c=(await casesFor(e.id,true))[0];assert.equal(c.captureMethod,"browser");assert.equal(c.title,"浏览器中的原文标题");assert.equal(c.metadata?.status,"ready");assert.equal(c.metadata?.method,"browser");assert.equal(c.metadata?.coverUrl,"https://cdn.example.org/original-cover.jpg");assert.equal(c.evidence,"unknown");assert.equal(c.reviewed,false);
  c.notes="编辑已写好的判断";await updateCase(c);
  const duplicate=await request("POST",P+"/cases/import",{...body,items:[{...body.items[0],title:"新的页面标题"}]});assert.equal(duplicate.json().existing,1);assert.equal(duplicate.json().metadataQueued,0);assert.equal((await casesFor(e.id,true))[0].title,c.title);assert.equal((await casesFor(e.id,true))[0].notes,c.notes);
  assert.equal((await sql`SELECT id FROM hm_jobs WHERE data->>'eventId'=${e.id}`).length,0);
});

test("collector download contains a loadable local extension without project credentials",async()=>{
  const {unzipSync,strFromU8}=await import("fflate");
  const response=await request("GET",P+"/collector/extension.zip");assert.equal(response.statusCode,200);assert.match(String(response.headers["content-type"]),/application\/zip/);assert.match(String(response.headers["content-disposition"]),/hot-monitor-collector\.zip/);
  const files=unzipSync(response.rawPayload),prefix="hot-monitor-collector/";
  assert.deepEqual(Object.keys(files).sort(),["README.txt","background.js","collector-core.mjs","content.js","manifest.json","workspace.js","auto.js"].map(name=>prefix+name).sort());
  const manifest=JSON.parse(strFromU8(files[prefix+"manifest.json"]));assert.equal(manifest.manifest_version,3);assert.equal(manifest.name,"热点监测采集助手");assert.ok(files[prefix+manifest.background.service_worker]);assert.ok(!manifest.externally_connectable);assert.ok(manifest.content_scripts.every((script:any)=>script.matches.every((pattern:string)=>/^http:\/\/(?:localhost|127\.0\.0\.1):3002\/admin\/monitor/.test(pattern))));assert.ok(!manifest.host_permissions.some((value:string)=>value.includes("<all_urls>")||value.includes("https://*")));
  assert.ok(!Object.keys(files).some(name=>/\.env|credentials|\.data/.test(name)));
});

test("browser page evidence stays available when background enrichment is blocked",async()=>{
  const e=await ingestReport(report("browser-capture-partial"));e.confirmed=true;await saveEvent(e);
  const result=await request("POST",P+"/cases/import",{schemaVersion:1,source:"browser",eventId:e.id,destination:"library",items:[{url:"http://127.0.0.1/private-page",title:"浏览器里已经读到的原标题",summary:"页面已有描述"}]});assert.equal(result.statusCode,200);assert.equal(result.json().metadataQueued,1);
  const id=result.json().caseIds[0];config.allowPrivateNetworkFetch=false;
  try{await assert.rejects(hydrateCase(id,"public"),/Blocked|private/i);}finally{config.allowPrivateNetworkFetch=true;}
  const c=(await casesFor(e.id,true))[0];assert.equal(c.title,"浏览器里已经读到的原标题");assert.equal(c.summary,"页面已有描述");assert.equal(c.metadata?.status,"partial");assert.equal(c.metadata?.method,"browser");assert.match(c.metadata?.error??"",/页面信息已保存/);assert.equal(c.saved,true);
});

test("collector requests optional permissions in the original workspace click before any asynchronous tab or storage read",async()=>{
  const f=await collectorExtensionFixture();
  const pending=f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  assert.equal(f.calls[0].type,"permission-request");assert.deepEqual(f.calls[0].options,{origins:f.core.AUTO_ORIGINS});
  const started=await pending;assert.equal(started.ok,true);assert.equal(started.enabled,true);assert.equal(started.installed,true);assert.equal(started.version,"1.1.0");
  assert.equal(f.state.registered.length,1);assert.deepEqual(f.state.registered[0].matches,f.core.AUTO_ORIGINS);assert.deepEqual(f.state.registered[0].js,["auto.js"]);assert.equal(f.state.registered[0].persistAcrossSessions,false);assert.equal(f.state.registered[0].allFrames,false);
  assert.equal((f.session[f.core.AUTO_SESSION_KEY] as any).enabled,true);assert.equal(f.calls.some(c=>c.type==="inject"||c.request?.operation==="import"),false);
  const status=await f.controller.handleMessage({type:"HM_WORKSPACE_STATUS"},f.workspaceSender());assert.equal(status.enabled,true);
  const external=await collectorExtensionFixture();await assert.rejects(external.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},external.sender),/本机/);assert.equal(external.calls.some(c=>c.type==="permission-request"),false);
  const iframe=await collectorExtensionFixture();await assert.rejects(iframe.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},{...iframe.workspaceSender(),frameId:1}),/本机/);assert.equal(iframe.calls.some(c=>c.type==="permission-request"),false);
});

test("denied collector permissions do not register automatic scripts and registration only uses actually granted platforms",async()=>{
  const denied=await collectorExtensionFixture();denied.state.grantResponse=false;
  const response=await denied.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},denied.workspaceSender());
  assert.equal(response.enabled,false);assert.equal(response.ok,false);assert.match(response.error,/权限/);assert.equal(denied.state.registered.length,0);assert.equal(denied.calls.some(c=>c.type==="register"||c.request?.operation==="import"),false);
  const subset=await collectorExtensionFixture();subset.state.grantAfterRequest=["https://*.reddit.com/*","https://*.youtube.com/*"];
  assert.equal((await subset.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},subset.workspaceSender())).enabled,true);
  assert.deepEqual(subset.state.registered[0].matches,subset.state.grantAfterRequest);
  subset.tabs.get(2).url="https://x.com/user/status/1234567890";
  assert.equal((await subset.controller.handleMessage({type:"HM_AUTO_BOOT"},subset.sender)).shown,false);
  const unconfirmed=await collectorExtensionFixture();unconfirmed.events["event-A"].confirmed=false;
  await assert.rejects(unconfirmed.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},unconfirmed.workspaceSender()),/已确认/);
  assert.equal(unconfirmed.state.registered.length,0);assert.equal((await unconfirmed.controller.status()).enabled,false);
});

test("automatic collector boot only shows an enabled confirmed-topic panel, survives worker sleep and repeats after navigation without collecting",async()=>{
  const f=await collectorExtensionFixture();
  assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,false);assert.equal(f.calls.some(c=>c.type==="inject"||c.type==="bridge"),false);
  await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  const resumed=f.core.createCollectorController(f.api);
  assert.equal((await resumed.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,true);
  assert.equal(f.calls.filter(c=>c.type==="inject"&&c.tabId===2).length,1);
  f.tabs.get(2).url="https://www.reddit.com/r/LocalLLaMA/comments/new/another_demo/";
  assert.equal((await resumed.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,true);assert.equal(f.calls.filter(c=>c.type==="inject"&&c.tabId===2).length,2);
  assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);assert.equal(f.calls.some(c=>c.type==="update"||c.type==="create"),false);
  f.tabs.delete(1);
  assert.equal((await resumed.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,false);assert.equal(f.calls.filter(c=>c.type==="inject"&&c.tabId===2).length,2);
  for(const url of ["https://reddit.com.attacker.example/a","http://www.reddit.com/a","https://example.org/a","chrome://extensions"]){assert.equal(f.core.platformPermission(url),null);}
  assert.equal(f.core.platformPermission("https://www.reddit.com/r/LocalLLaMA/"),"https://*.reddit.com/*");
});

test("workspace stop removes automatic scripts and hides supported panels while manual toolbar collection remains available",async()=>{
  const f=await collectorExtensionFixture();await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender);
  f.tabs.get(1).url="http://localhost:3002/admin/monitor";
  const stopped=await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"stop"},f.workspaceSender());
  assert.equal(stopped.enabled,false);assert.equal(f.state.registered.length,0);assert.equal((f.session[f.core.AUTO_SESSION_KEY] as any).enabled,false);
  assert.ok(f.calls.some(c=>c.type==="message"&&c.tabId===2&&c.message.type==="HM_HIDE"));
  const injected=f.calls.filter(c=>c.type==="inject").length;
  assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,false);assert.equal(f.calls.filter(c=>c.type==="inject").length,injected);
  f.tabs.get(2).url="https://ordinary.example/article";
  await f.controller.toolbar({id:2});assert.equal(f.calls.filter(c=>c.type==="inject").length,injected+1);
  assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);
});

test("stopping the collector invalidates an automatic boot waiting for its topic read",async()=>{
  const f=await collectorExtensionFixture();await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  const entered=gate(),release=gate(),execute=f.api.scripting.executeScript;
  f.api.scripting.executeScript=async(options:any)=>{
    if(options.func&&options.args[0].operation==="event"){entered.open();await release.promise;}
    return execute(options);
  };
  const boot=f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender);
  try{
    await entered.promise;
    const stopped=await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"stop"},f.workspaceSender());
    assert.equal(stopped.enabled,false);
    const afterStop=f.calls.length;
    release.open();const result=await boot;
    assert.equal(result.shown,false);assert.equal(f.calls.filter(c=>c.type==="inject").length,0);
    assert.equal(f.calls.slice(afterStop).some(c=>c.type==="message"&&c.message.type==="HM_SHOW"),false);
    assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);
  }finally{release.open();await boot.catch(()=>{});}
});

test("stopping the collector waits for an in-flight injection then hides its panel before reporting stopped",async()=>{
  const f=await collectorExtensionFixture();await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  const entered=gate(),release=gate(),execute=f.api.scripting.executeScript;
  f.api.scripting.executeScript=async(options:any)=>{
    if(options.files?.includes("content.js")){entered.open();await release.promise;}
    return execute(options);
  };
  const boot=f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender);
  let stopping:Promise<any>|undefined,finished=false;
  try{
    await entered.promise;
    stopping=f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"stop"},f.workspaceSender()).then((result:any)=>{finished=true;return result;});
    // Drain the immediate mock API promises while the injection remains explicitly gated.
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(finished,false);assert.equal(f.calls.some(c=>c.type==="message"&&c.message.type==="HM_HIDE"),false);
    assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,false);
    release.open();assert.equal((await boot).shown,false);assert.equal((await stopping).enabled,false);
    const messages=f.calls.filter(c=>c.type==="message"&&c.tabId===2);assert.deepEqual(messages.map(c=>c.message.type),["HM_SHOW","HM_HIDE"]);
    const afterStop=f.calls.length;
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(f.calls.slice(afterStop).some(c=>c.type==="message"&&c.message.type==="HM_SHOW"),false);
    assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);
  }finally{release.open();await boot.catch(()=>{});await stopping?.catch(()=>{});}
});

test("collector status verifies the registered script and exposes only scrubbed host-level automatic boot failures",async()=>{
  const f=await collectorExtensionFixture();await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  const started=await f.controller.status();assert.equal(started.enabled,true);assert.equal(started.autoRegistered,true);assert.equal(started.error,undefined);
  f.state.registered=[];
  const missing=await f.controller.status();assert.equal(missing.enabled,false);assert.equal(missing.autoRegistered,false);assert.match(missing.error,/重新启动/);
  await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  f.tabs.get(2).url="https://x.com/search?f=live&q=private-research-word";
  const execute=f.api.scripting.executeScript;
  f.api.scripting.executeScript=async(options:any)=>{if(options.files)throw new Error("Cannot inject https://x.com/search?q=private-research-word&token=secret "+"x".repeat(250));return execute(options);};
  await assert.rejects(f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender),/Cannot inject/);
  const failed=await f.controller.status();assert.equal(failed.enabled,true);assert.equal(failed.diagnostic.host,"x.com");assert.equal(failed.diagnostic.stage,"context_ready");assert.ok(failed.diagnostic.error.length<=180);assert.match(failed.error,/自动浮窗未显示（x.com）/);
  assert.ok(!JSON.stringify(failed.diagnostic).includes("private-research-word"));assert.ok(!JSON.stringify(failed.diagnostic).includes("token=secret"));assert.ok(!JSON.stringify(failed.diagnostic).includes("/search"));
  f.api.scripting.executeScript=execute;
  assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,true);
  const succeeded=await f.controller.status();assert.equal(succeeded.diagnostic.stage,"shown");assert.equal(succeeded.diagnostic.host,"x.com");assert.equal(succeeded.error,undefined);
});

test("collector automatic boot records stage progression and explicit reasons without page content or case imports",async()=>{
  const f=await collectorExtensionFixture();
  const stages:string[]=[],set=f.api.storage.session.set;
  f.api.storage.session.set=async(values:Record<string,unknown>)=>{const diagnostic=values[f.core.AUTO_DIAGNOSTIC_KEY] as any;if(diagnostic)stages.push(diagnostic.stage);await set(values);};
  assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).reason,"not-enabled");
  await f.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"start"},f.workspaceSender());
  stages.length=0;assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).shown,true);
  assert.deepEqual(stages,["boot_received","context_ready","injected","shown"]);
  f.state.grantedOrigins.delete("https://*.reddit.com/*");
  assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).reason,"no-platform-permission");assert.match((await f.controller.status()).error,/访问权限/);
  f.state.grantedOrigins.add("https://*.reddit.com/*");f.tabs.delete(1);
  assert.equal((await f.controller.handleMessage({type:"HM_AUTO_BOOT"},f.sender)).reason,"no-confirmed-topic");assert.match((await f.controller.status()).error,/已确认选题/);
  assert.equal(f.calls.filter(c=>c.request?.operation==="import").length,0);
  const messages=f.calls.filter(c=>c.type==="message"&&c.message.type==="HM_SHOW");assert.equal(messages.length,1);
  const stopped=await collectorExtensionFixture();await stopped.controller.handleMessage({type:"HM_WORKSPACE_CONTROL",action:"stop"},stopped.workspaceSender());
  assert.equal((await stopped.controller.handleMessage({type:"HM_AUTO_BOOT"},stopped.sender)).reason,"stopped");
});

test("collector auto content script reports resolved failures rather than silently dropping worker replies",async()=>{
  const {runInNewContext}=await import("node:vm");const code=readFileSync(new URL("../extension/auto.js",import.meta.url),"utf8");
  const warnings:string[]=[],messages:any[]=[];
  const context={document:{documentElement:{dataset:{} as Record<string,string>}},console:{warn:(message:string)=>warnings.push(message)},chrome:{runtime:{sendMessage:async(message:any)=>{messages.push(message);return {ok:false,error:"Injection failed at https://x.com/search?q=private-search"};}}}};
  runInNewContext(code,context);assert.equal(context.document.documentElement.dataset.hmCollectorAuto,"booting");await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(context.document.documentElement.dataset.hmCollectorAuto,"failed");
  assert.equal(messages.length,1);assert.equal(messages[0].type,"HM_AUTO_BOOT");assert.equal(warnings.length,1);assert.match(warnings[0],/^\[热点监测\] Injection failed/);assert.ok(!warnings[0].includes("private-search"));
  runInNewContext(code,context);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(messages.length,1);
});

test("collector X page saving uses the exact original post DOM rather than a reply or generic page metadata",async()=>{
  const {runInNewContext}=await import("node:vm");
  const script=readFileSync(new URL("../extension/content.js",import.meta.url),"utf8");
  const node=(attrs:Record<string,string>={},textContent=""):any=>{
    const classes=new Set<string>(),listeners:Record<string,Array<(event:any)=>unknown>>={};
    return {textContent,innerText:textContent,style:{},hidden:false,disabled:false,listeners,
      getAttribute:(name:string)=>attrs[name]??null,setAttribute:(name:string,value:string)=>{attrs[name]=value;},
      addEventListener:(name:string,listener:(event:any)=>unknown)=>{(listeners[name]??=[]).push(listener);},
      classList:{add:(value:string)=>classes.add(value),remove:(value:string)=>classes.delete(value),contains:(value:string)=>classes.has(value)},
      querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null};
  };
  const controls=new Map<string,any>();for(const selector of [".topic",".page",".hint",".save",".library",".status",".close",".collapse",".body"])controls.set(selector,node());
  const root={innerHTML:"",querySelector:(selector:string)=>controls.get(selector)??null};
  const host=node();host.attachShadow=()=>root;
  const id="2112822459380707665",url="https://x.com/Jackie1101081/status/"+id+"/photo/1";
  const originalText="字节 AI 修仙游戏《不问凡尘》卖爆了，\n\n因为传说中的「合欢宗」，还是 LSP ！！#AI游戏"+" 实际游戏过程".repeat(65);
  const originalTextNode=node({},originalText),author=node({},"杰基༄ |游戏严厉的父亲(重生版)@Jackie1101081");
  const ownTime=node({datetime:"2026-10-21T08:25:03.000Z"});
  const originalLink=node({href:"/Jackie1101081/status/"+id});originalLink.querySelector=(selector:string)=>selector==="time"?ownTime:null;
  const photoUrl="https://pbs.twimg.com/media/HVJAd-3bkAAPoBc?format=png&name=900x900";
  let images=[node({src:photoUrl})];
  const original=node();
  original.querySelector=(selector:string)=>selector==='[data-testid="tweetText"]'?originalTextNode:selector==='[data-testid="User-Name"]'?author:null;
  original.querySelectorAll=(selector:string)=>selector==="a[href]"?[originalLink]:selector==='[data-testid="tweetPhoto"] img[src]'?images:[];
  const reply=node(),replyText=node({},"这是回复内容，不能当原帖"),replyAuthor=node({},"回复作者@reply");
  const replyTime=node({datetime:"2026-10-22T00:00:00.000Z"}),replyPermalink=node({href:"/reply/status/2112847369243090988"});
  replyPermalink.querySelector=(selector:string)=>selector==="time"?replyTime:null;
  const citedOriginal=node({href:"/Jackie1101081/status/"+id});
  // A link to the original inside a reply has neither its own timestamp nor author permalink.
  reply.querySelectorAll=(selector:string)=>selector==="a[href]"?[citedOriginal,replyPermalink]:[];
  reply.querySelector=(selector:string)=>selector==='[data-testid="tweetText"]'?replyText:selector==='[data-testid="User-Name"]'?replyAuthor:null;
  const metas=[node({property:"og:title",content:"An author on X: generic title / X"}),node({property:"og:image",content:"https://abs.twimg.com/generic-whats-happening.png"})];
  const messages:any[]=[],mounted:any[]=[];let receive:((message:any,sender:any)=>void)|undefined;
  const document={title:"An author on X: stale title / X",head:{},createElement:()=>host,querySelector:()=>null,querySelectorAll:(selector:string)=>selector==="article"?[reply,original]:selector==="meta"?metas:[],documentElement:{append:(value:any)=>mounted.push(value)}};
  const context={document,location:new URL(url),URL,window:{addEventListener:()=>{}},MutationObserver:class{constructor(_listener:unknown){}observe(){}},chrome:{runtime:{id:"fixture-extension",onMessage:{addListener:(listener:any)=>{receive=listener;}},sendMessage:async(message:any)=>{messages.push(message);return {ok:true,created:1,existing:0,metadataQueued:0};}}}};
  runInNewContext(script,context);
  assert.equal(mounted.length,1);assert.ok(receive);
  receive!({type:"HM_SHOW",context:{eventId:"event-original",title:"AI游戏选题"}},{id:"fixture-extension"});
  const save=controls.get(".save").listeners.click[0];
  await save({isTrusted:false});assert.equal(messages.length,0);
  await save({isTrusted:true});assert.equal(messages.length,1);assert.equal(messages[0].type,"HM_SAVE");assert.equal(messages[0].expectedEventId,"event-original");
  const item=messages[0].item;assert.equal(item.url,url);assert.equal(item.title,originalText.slice(0,300));assert.equal(item.summary,originalText);assert.equal(item.author,author.textContent);assert.equal(item.publishedAt,"2026-10-21T08:25:03.000Z");assert.equal(item.cover,photoUrl);assert.ok(!item.title.includes("reply"));assert.ok(!item.cover.includes("generic"));
  images=[];await save({isTrusted:true});assert.equal(messages.length,2);assert.equal(messages[1].item.cover,"");
  originalTextNode.textContent="  ";await save({isTrusted:true});assert.equal(messages.length,2);assert.match(controls.get(".status").textContent,/尚未加载|等待原帖/);assert.equal(controls.get(".save").disabled,false);
});

test("candidate retention is independent of scoring and only editorial removal cancels it",async()=>{
  const {setCandidate}=await import("../backend/store.ts");
  const e=await ingestReport({...report("sticky-candidate"),upstreamSelected:true});
  assert.equal(e.candidate?.status,"active");const beforeScore={...e};
  const graded=await request("POST",P+"/events/"+e.id+"/manual-score",{type:"product_launch",axes:{sig:1,nov:1,cred:1,reson:1,act:1},reason:"分数较低但需要由编辑取舍"});assert.equal(graded.statusCode,200);assert.equal(graded.json().score,10);
  const listed=await request("GET",P+"/overview?mode=priority&window=all&q=DeepSeek");assert.ok(listed.json().events.some((item:any)=>item.id===e.id&&item.score===10));
  assert.equal((await request("POST",P+"/events/"+e.id+"/candidate",{included:false})).statusCode,200);
  // An older model snapshot finishing after removal must not re-add the event.
  await saveEvent({...beforeScore,score:99,scoreStatus:"scored",scoreMethod:"ai"});
  assert.equal((await eventById(e.id))!.candidate?.status,"removed");
  assert.ok(!(await request("GET",P+"/overview?mode=priority&window=all")).json().events.some((item:any)=>item.id===e.id));
  const all=(await request("GET",P+"/events/"+e.id)).json();assert.equal(all.event.score,99);assert.ok(all.reports.length);assert.equal(all.event.originalUrl,e.originalUrl??"https://example.com/sticky-candidate");
  await setCandidate(e.id,true);assert.equal((await eventById(e.id))!.candidate?.status,"active");
  await ingestReport({...report("sticky-candidate"),title:"更新后的报道",upstreamSelected:false});assert.equal((await eventById(e.id))!.candidate?.status,"active");
  const history=await ingestReport({...report("sticky-history"),publishedAt:"2020-01-01T00:00:00Z",discoveredAt:new Date().toISOString(),upstreamSelected:true});assert.equal(history.candidate,undefined);
});

test("interrupted display jobs follow queue terminal states without retrying live or newly submitted work",async()=>{
  const {submitWork,reconcileInterruptedJobs}=await import("../backend/jobs.ts");
  const {setJob,jobById}=await import("../backend/store.ts");
  const live=await submitWork({kind:"source",sourceId:randomUUID()},"job-reconcile-live-"+randomUUID());
  const ended=await submitWork({kind:"journal",draft:{kind:"dailies",key:"latest"}},"job-reconcile-ended-"+randomUUID());
  const missing=randomUUID(),recent=randomUUID();
  for(const id of [missing,recent])await setJob({id,kind:"sync",eventId:null,status:"queued",message:"等待后台任务处理",createdAt:now(),updatedAt:now()});
  await sql`UPDATE hm_jobs SET updated_at=now()-interval '1 day',data=jsonb_set(data,'{status}','"running"') WHERE id IN (${live.id},${ended.id},${missing})`;
  await sql`UPDATE pgboss.job SET state='failed',completed_on=now() WHERE data->>'jobId'=${ended.id}`;
  const before=await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name LIKE 'hot-monitor.%'`;
  await reconcileInterruptedJobs();
  assert.equal((await jobById(live.id))!.status,"running","old timestamps do not cancel actual queue work");
  assert.equal((await jobById(ended.id))!.status,"failed");
  assert.match((await jobById(ended.id))!.message,/已中断/);
  assert.equal((await jobById(missing))!.status,"failed","cleaned-up queue jobs cannot block refreshing forever");
  assert.equal((await jobById(recent))!.status,"queued","allow the enqueue transaction to finish");
  const after=await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name LIKE 'hot-monitor.%'`;
  assert.equal(after[0].n,before[0].n,"reconciliation must not re-submit paid or collection jobs");
  const overview=(await request("GET",P+"/overview")).json();
  assert.equal(overview.jobs.find((j:any)=>j.id===ended.id)?.status,"failed");
  await sql`DELETE FROM pgboss.job WHERE data->>'jobId' IN (${live.id},${ended.id})`;
  await sql`DELETE FROM hm_jobs WHERE id IN (${live.id},${ended.id},${missing},${recent})`;
});

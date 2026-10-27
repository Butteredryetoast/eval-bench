import { setTimeout as wait } from "node:timers/promises";
import { config } from "@aihot/backend/config";
import { shutdownSignal } from "@aihot/backend/jobs/queue";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { canonicalUrl, digest, reportStats } from "./domain.ts";
import { ingestReport, eventById, saveEvent, reportsFor } from "./store.ts";
import type { Report } from "../contracts.ts";
interface UpstreamItem {
  upstreamPosition?: number;
  id: string;
  title: string;
  summary?: string;
  source: { name: string; firstParty?: boolean };
  links: { original?: string; aihot?: string; story?: string };
  publishedAt: string | null;
  discoveredAt?: string;
  category?: string;
  score?: number;
  selected?: boolean;
  reason?: string | null;
}
function base() {
  return (process.env.MONITOR_AIHOT_BASE_URL ?? "https://aihot.news").replace(
    /\/$/,
    "",
  );
}
let lastRemoteAt = 0;
export async function remotePage(path: string) {
  const [cached] = await sql`SELECT * FROM hm_sync_cache WHERE path=${path}`;
  const now = Date.now();
  if (cached?.retry_at && new Date(cached.retry_at).getTime() > now)
    throw new Error("AIHOT要求稍后重试；保留上次同步状态");
  if (cached && new Date(cached.valid_until).getTime() > now)
    return {
      data: cached.data as any,
      checkedAt: cached.fetched_at ? new Date(cached.fetched_at).toISOString() : null,
      expiresAt: new Date(cached.valid_until).toISOString(),
    };
  const earliest = Math.max(lastRemoteAt + 1100, cached?.fetched_at ? new Date(cached.fetched_at).getTime() + 60000 : 0);
  const delay = earliest - Date.now();
  if (delay > 0) await wait(delay,undefined,{signal:shutdownSignal.signal});
  lastRemoteAt = Date.now();
  const response = await guardedFetch(base() + path, {
    headers: {
      accept: "application/json",
      "user-agent": "YuanDaxia-HotMonitor/1.0",
      ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
    },
    timeoutMs: 25000,
    maxBytes: 12 * 1024 * 1024,
    route: "egress",
  });
  if (/no-store/i.test(response.headers.get("cache-control") ?? "")) {
    await sql`INSERT INTO hm_sync_cache(path,valid_until,data,etag,fetched_at) VALUES(${path},now(),'{}',NULL,now()) ON CONFLICT(path) DO UPDATE SET data='{}',etag=NULL,valid_until=now(),fetched_at=now()`;
    throw new Error("AIHOT响应禁止缓存，本次未入库");
  }
  const ttl = Math.max(
    0,
    Number(
      /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ??
        60,
    ),
  );
  const until = new Date(Date.now() + ttl * 1000).toISOString();
  if (response.status === 429) {
    const at = new Date(
      now +
        Math.max(60000, Number(response.headers.get("retry-after")) * 1000 || Date.parse(response.headers.get("retry-after") ?? "") - now || 60000),
    );
    await sql`INSERT INTO hm_sync_cache(path,valid_until,data,retry_at) VALUES(${path},now(),'{}',${at}) ON CONFLICT(path) DO UPDATE SET retry_at=${at}`;
    throw new Error("AIHOT请求限流；任务未推进");
  }
  if (response.status !== 200 && response.status !== 304)
    throw new Error("AIHOT读取失败（HTTP " + response.status + "）");
  const data =
    response.status === 304 ? cached?.data : JSON.parse(response.text());
  if (!data) throw new Error("AIHOT条件请求缺少本地数据");
  await sql`INSERT INTO hm_sync_cache(path,etag,valid_until,data,fetched_at) VALUES(${path},${response.headers.get("etag") ?? cached?.etag ?? null},${until},${sql.json(data)},now()) ON CONFLICT(path) DO UPDATE SET etag=EXCLUDED.etag,valid_until=EXCLUDED.valid_until,data=EXCLUDED.data,retry_at=NULL,fetched_at=now()`;
  return { data, expiresAt: until, checkedAt: new Date().toISOString() };
}
export async function put(item: UpstreamItem, expiresAt: string, story?: string, eventDigest=false) {
  if (!item.links.original) return null;
  return ingestReport({
    origin: "aihot",
    externalId: item.id,
    title: item.title,
    summary: item.summary ?? "",
    url: item.links.original,
    source: item.source.name,
    publishedAt: item.publishedAt,
    discoveredAt: item.discoveredAt,
    upstreamScore: item.score ?? null,
    upstreamSelected: item.selected,
    upstreamReason: item.reason,
    upstreamPosition: item.upstreamPosition,
    category: item.category,
    story: story ? "aihot:" + story : null,
    expiresAt,
    tier: item.source.firstParty ? "T1" : "T2",
    eventDigest,
  });
}
export async function syncAihot() {
  let imported = 0, pages = 0;
  const seen = new Set<string>();
  const errors: string[] = [];
  // Read the newest dynamic page before slower story expansion. A failed secondary
  // endpoint must not prevent new articles from reaching the editor.
  for (const mode of ["all", "selected"]) {
    try {
      let cursor: string | undefined;
      let position = 0;
      const cursors = new Set<string>();
      do {
        const page = await remotePage("/api/v1/items?" + new URLSearchParams({ mode, window: "7d", limit: "100", ...(cursor ? { cursor } : {}) }));
        if (!Array.isArray(page.data.items) || !page.data.page) throw new Error("AIHOT动态分页结构异常");
        pages++;
        for (const item of page.data.items) {
          if (await put({...item,upstreamPosition:mode==="all"?position++:undefined}, page.expiresAt)) { seen.add(item.id); imported++; }
        }
        if (mode === "all" && !cursor) await sql`INSERT INTO hm_sync_cache(path,valid_until,data) VALUES('last-head',now(),${sql.json({at:page.checkedAt,count:page.data.items.length,ids:page.data.items.map((i:UpstreamItem)=>i.id),newestDiscoveredAt:page.data.items[0]?.discoveredAt??null})}) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data`;
        const next = page.data.page.hasMore ? page.data.page.nextCursor : undefined;
        if (page.data.page.hasMore && (!next || cursors.has(next))) throw new Error("AIHOT动态游标缺失或重复，本次未完成全量核对");
        if (next) cursors.add(next);
        cursor = next;
      } while (cursor);
    } catch (error) {
      errors.push(mode + "：" + (error instanceof Error ? error.message : "读取失败"));
    }
  }
  // Only a complete all-items snapshot establishes absence. Never withdraw on
  // a failed page, and do not interpret falling outside seven days as deletion.
  if (!errors.some(e => e.startsWith("all："))) {
    const recent = await sql`SELECT id,event_id,data FROM hm_reports WHERE data->>'origin'='aihot' AND (data->>'publishedAt')::timestamptz>now()-interval '6 days'`;
    const changed = new Set<string>();
    for (const row of recent) {
      const r = row.data as Report;
      if (!seen.has(r.externalId)) {
        r.active = false; r.summary = "";
        await sql`UPDATE hm_reports SET data=${sql.json(r as never)} WHERE id=${row.id}`;
        changed.add(row.event_id);
      }
    }
    for (const id of changed) {
      const e = await eventById(id);
      if (e) { Object.assign(e, reportStats(await reportsFor(id))); await saveEvent(e); }
    }
  }
  try {
    const hot = await remotePage("/api/v1/hot-topics");
    if (!Array.isArray(hot.data.items)) throw new Error("AIHOT热榜结构异常");
    await sql`UPDATE hm_events SET data=jsonb_set(data,'{hotRank}','null') WHERE data->'hotRank'<>'null'::jsonb`;
    for (const item of hot.data.items as Array<UpstreamItem & { rank: number }>) {
      const id = item.links.story?.split("/").pop();
      if (!id) continue;
      try {
        const page = await remotePage("/api/v1/stories/" + encodeURIComponent(id));
        const story = page.data.story;
        if (!story || story.status !== "active") continue;
        const first = await put({ ...item, title: story.title, summary: story.digest ?? "", publishedAt: story.firstReportAt ?? item.publishedAt }, page.expiresAt, id, true);
        if (first) { first.hotRank = item.rank; first.upstreamStory = canonicalUrl(base() + "/story/" + id); await saveEvent(first); }
        for (const report of story.reports ?? []) { await put(report, page.expiresAt, id); imported++; }
      } catch { errors.push("热点详情 " + id + " 本轮未更新"); }
    }
  } catch { errors.push("热点榜本轮未更新，动态采集不受影响"); }
  for (const kind of ["dailies", "weeklies", "monthlies"]) {
    try { await remotePage("/api/v1/" + kind + "?limit=30"); await remotePage("/api/v1/" + kind + "/latest"); }
    catch { errors.push(kind + " 报告本轮未更新"); }
  }
  const result = { at: new Date().toISOString(), imported, checked: seen.size, pages, errors };
  await sql`INSERT INTO hm_sync_cache(path,valid_until,data) VALUES('last-sync',now(),${sql.json(result)}) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data`;
  // Cursor URLs describe moving snapshots; keep just recent request receipts.
  await sql`DELETE FROM hm_sync_cache WHERE path LIKE '/api/v1/items?%cursor=%' AND valid_until<now()-interval '10 minutes'`;
  return result;
}
export async function syncSelf() {
  const rows =
    await sql`SELECT a.id,coalesce(p.title,a.title) AS title,coalesce(p.summary,a.excerpt,left(a.body_text,350)) AS summary,a.url,a.published_at,a.discovered_at,a.backfill,p.score,p.category,an.relevance,s.name,s.tier,st.public_id FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN LATERAL (SELECT relevance FROM analyses WHERE article_id=a.id AND input_revision=a.revision ORDER BY id DESC LIMIT 1) an ON true LEFT JOIN editorial_overrides o ON o.article_id=a.id LEFT JOIN stories st ON st.id=p.story_id WHERE s.participation_mode='editorial' AND coalesce(o.visibility,p.visibility,'public')<>'withdrawn' ORDER BY a.discovered_at DESC`;
  for (const r of rows)
    await ingestReport({
      origin: "self",
      externalId: r.id,
      title: r.title,
      summary: r.summary ?? "",
      url: r.url,
      source: r.name,
      publishedAt: r.published_at?.toISOString() ?? null,
      discoveredAt: r.discovered_at.toISOString(),
      localScore: r.score,
      screening: r.relevance ?? "unknown",
      tier: r.tier,
      category: r.category,
      story: r.public_id ? "self:" + r.public_id : null,
      backfill: r.backfill,
    });
  const ids = rows.map((r) => r.id);
  await sql`UPDATE hm_reports SET data=data||'{"active":false,"summary":""}'::jsonb WHERE data->>'origin'='self' AND NOT (data->>'externalId'=ANY(${ids}))`;
  return { imported: rows.length };
}
export async function expireRemoteCache() {
  await sql`DELETE FROM hm_sync_cache WHERE path NOT IN ('last-sync','last-head') AND valid_until<now()-interval '7 days'`;
  await sql`UPDATE hm_reports SET data=(data-'summary')||'{"summary":"","active":false}'::jsonb WHERE data->>'origin'='aihot' AND (data->>'expiresAt')::timestamptz<now()-interval '7 days'`;
}

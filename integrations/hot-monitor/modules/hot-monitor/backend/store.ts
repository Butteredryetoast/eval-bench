import { randomUUID } from "node:crypto";
import {casePlatform} from "../contracts.ts";
import {entersCandidates} from "./priority.ts";
import { sql, type Db } from "@aihot/backend/db";
import { SELECTION } from "@aihot/industry/selection";
import {
  canonicalUrl,
  digest,
  inferField,
  inferVersion,
  reportStats,
  classifyFormat,
} from "./domain.ts";
import type {
  Event,
  Report,
  Case,
  Job,
  Asset,
  Classification,
} from "../contracts.ts";
export async function eventById(id: string): Promise<Event | null> {
  let next = id;
  const seen = new Set<string>();
  while (!seen.has(next)) {
    seen.add(next);
    const e = (await sql`SELECT data FROM hm_events WHERE id=${next}`)[0]
      ?.data as Event | undefined;
    if (!e) return null;
    if (!e.mergedInto) return e;
    next = e.mergedInto;
  }
  return null;
}
async function mergeInto(from: string, into: string, db: Db) {
  if (from === into) return;
  for (const row of await db`SELECT id,url,data FROM hm_cases WHERE event_id=${from}`) {
    const [duplicate] =
      await db`SELECT id,data FROM hm_cases WHERE event_id=${into} AND url=${row.url}`;
    if (duplicate) {
      const c = duplicate.data as Case;
      const other = row.data as Case;
      c.saved = c.saved || other.saved;
      c.notes = [...new Set([c.notes, other.notes].filter(Boolean))].join("\n");
      c.media = [
        ...c.media,
        ...other.media.filter((m) => !c.media.some((x) => x.url === m.url)),
      ];
      await db`UPDATE hm_assets SET case_id=${duplicate.id},data=jsonb_set(data,'{caseId}',to_jsonb(${duplicate.id}::text)) WHERE case_id=${row.id}`;
      await db`UPDATE hm_experiments SET case_id=${duplicate.id},event_id=${into},data=data||${db.json({ caseId: duplicate.id, eventId: into })} WHERE case_id=${row.id}`;
      await db`UPDATE hm_cases SET data=${db.json(c as never)} WHERE id=${duplicate.id}`;
      await db`DELETE FROM hm_cases WHERE id=${row.id}`;
    } else
      await db`UPDATE hm_cases SET event_id=${into},data=jsonb_set(data,'{eventId}',to_jsonb(${into}::text)) WHERE id=${row.id}`;
  }
  await db`UPDATE hm_reports SET event_id=${into},data=jsonb_set(data,'{eventId}',to_jsonb(${into}::text)) WHERE event_id=${from}`;
  await db`UPDATE hm_experiments SET event_id=${into},data=jsonb_set(data,'{eventId}',to_jsonb(${into}::text)) WHERE event_id=${from}`;
  await db`UPDATE hm_aliases SET event_id=${into} WHERE event_id=${from}`;
  const [old] = await db`SELECT data FROM hm_events WHERE id=${from}`;
  const [target] = await db`SELECT data FROM hm_events WHERE id=${into}`;
  if (old && target) {
    const e = target.data as Event;
    const o = old.data as Event;
    e.confirmed = e.confirmed || o.confirmed;
    e.classification ??= o.classification;
    e.editorialReview ??= o.editorialReview;
    e.bookmarked ||= o.bookmarked;
    const choices=[e.candidate,o.candidate].filter((v):v is NonNullable<Event["candidate"]>=>Boolean(v)).sort((a,b)=>Number(b.by==="editor")-Number(a.by==="editor")||b.at.localeCompare(a.at));
    if(choices[0])e.candidate=choices[0];
    if (e.scoreMethod !== "manual") e.scoreStatus = "pending";
    await db`UPDATE hm_events SET data=${db.json(e as never)} WHERE id=${into}`;
  }
  await db`UPDATE hm_events SET data=data||${db.json({ mergedInto: into })} WHERE id=${from}`;
}

export async function reportsFor(id: string): Promise<Report[]> {
  return (
    await sql`SELECT data FROM hm_reports WHERE event_id=${id} ORDER BY updated_at DESC`
  ).map((r) => r.data as Report);
}
export async function casesFor(id?: string, saved?: boolean): Promise<Case[]> {
  return (
    await sql`SELECT data FROM hm_cases WHERE (${id ?? null}::text IS NULL OR event_id=${id ?? null}) AND (${saved ?? null}::boolean IS NULL OR (data->>'saved')::boolean=${saved ?? null}) ORDER BY updated_at DESC,id`
  ).map((r) => ({...r.data,platform:casePlatform(r.data.url)}) as Case);
}
export async function saveEvent(e: Event) {
  e.updatedAt = new Date().toISOString();
  if(entersCandidates(e,await reportsFor(e.id)))e.candidate={status:"active",at:e.updatedAt,by:"rules"};
  const [saved]=await sql`UPDATE hm_events SET data=${sql.json(e as never)}||CASE WHEN data ? 'candidate' THEN jsonb_build_object('candidate',data->'candidate') ELSE '{}'::jsonb END,updated_at=now() WHERE id=${e.id} RETURNING data`;
  if(saved)e.candidate=saved.data.candidate;
  return e;
}
export async function setCandidate(id:string,included:boolean) {
  const candidate:NonNullable<Event["candidate"]>={status:included?"active":"removed",at:new Date().toISOString(),by:"editor"};
  const [row]=await sql`UPDATE hm_events SET data=jsonb_set(data,'{candidate}',${sql.json(candidate)}),updated_at=now() WHERE id=${id} RETURNING data`;
  return row?.data as Event|undefined;
}
export async function retainCandidate(e:Event) {
  if(!entersCandidates(e,await reportsFor(e.id)))return e;
  const candidate:NonNullable<Event["candidate"]>={status:"active",at:new Date().toISOString(),by:"rules"};
  const [row]=await sql`UPDATE hm_events SET data=jsonb_set(data,'{candidate}',${sql.json(candidate)}),updated_at=now() WHERE id=${e.id} AND NOT(data ? 'candidate') RETURNING data`;
  return row?.data as Event??e;
}
export interface IncomingReport {
  origin: Report["origin"];
  externalId: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string | null;
  discoveredAt?: string;
  upstreamScore?: number | null;
  upstreamSelected?: boolean;
  upstreamReason?: string | null;
  localScore?: number | null;
  tier?: string;
  category?: string;
  story?: string | null;
  expiresAt?: string | null;
  backfill?: boolean;
  eventDigest?: boolean;
  upstreamPosition?: number;
  screening?: Report["screening"];
}
export async function ingestReport(input: IncomingReport): Promise<Event> {
  const url = canonicalUrl(input.url);
  const id = digest(input.origin + ":" + input.externalId);
  const now = new Date().toISOString();
  return (await sql.begin(async (tx) => {
    const [old] = await tx`SELECT event_id,data FROM hm_reports WHERE id=${id}`;
    const [same] =
      await tx`SELECT event_id FROM hm_reports WHERE canonical_url=${url} ORDER BY updated_at DESC LIMIT 1`;
    const identity = input.story ? "story:" + input.story : "url:" + url;
    const [alias] =
      await tx`SELECT event_id AS id FROM hm_aliases WHERE alias=${identity}`;
    const [group] = alias
      ? [alias]
      : await tx`SELECT id FROM hm_events WHERE identity=${identity}`;
    let eventId = String(
      old?.event_id ?? same?.event_id ?? group?.id ?? randomUUID(),
    );
    for (const other of new Set(
      [old?.event_id, same?.event_id, group?.id].filter(Boolean),
    ))
      if (other !== eventId) await mergeInto(String(other), eventId, tx);

    let [row] = await tx`SELECT data FROM hm_events WHERE id=${eventId}`;
    let e: Event = row?.data as Event;
    if (!e) {
      e = {
        id: eventId,
        title: input.title,
        summary: input.summary,
        field: inferField(input.title),
        fieldMethod: "rule",
        format: classifyFormat(input.category ?? ""),
        product: "",
        version: inferVersion(input.title),
        aliases: [],
        publishedAt: input.publishedAt,
        discoveredAt: input.discoveredAt ?? now,
        confirmed: false,
        score: null,
        scoreStatus: "pending",
        scoreReason: "等待独立评分",
        scoreThreshold: SELECTION.thresholds[input.tier ?? "T2"] ?? 76,
        origins: [],
        sourceCount: 0,
        hotRank: null,
        classification: null,
        upstreamStory: input.story ?? null,
        updatedAt: now,
      };
      const inserted =
        await tx`INSERT INTO hm_events(id,identity,data) VALUES(${eventId},${identity},${tx.json(e as never)}) ON CONFLICT(identity) DO UPDATE SET identity=EXCLUDED.identity RETURNING id,data`;
      eventId = inserted[0].id;
      e = inserted[0].data as Event;
    }
    const r: Report = {
      id,
      receivedAt: old ? old.data?.receivedAt : now,
      upstreamPosition: input.upstreamPosition ?? old?.data?.upstreamPosition,
      screening: input.screening ?? old?.data?.screening,
      eventId,
      origin: input.origin,
      externalId: input.externalId,
      title: input.title,
      summary: input.summary,
      url,
      source: input.source,
      publishedAt: input.publishedAt,
      discoveredAt: input.discoveredAt ?? now,
      upstreamScore: input.upstreamScore ?? old?.data?.upstreamScore ?? null,
      upstreamSelected: input.upstreamSelected ?? old?.data?.upstreamSelected ?? false,
      upstreamReason: input.upstreamReason ?? old?.data?.upstreamReason ?? null,
      localScore: input.localScore ?? null,
      active: true,
      expiresAt: input.expiresAt ?? null,
      tier: input.tier ?? "T2",
      backfill: input.backfill ?? false,
      chinese: old?.data?.chinese,
    };
    await tx`INSERT INTO hm_reports(id,event_id,canonical_url,data) VALUES(${id},${eventId},${url},${tx.json(r as never)}) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
    await tx`INSERT INTO hm_aliases(alias,event_id) VALUES(${identity},${eventId}) ON CONFLICT(alias) DO NOTHING`;
    const reports = (
      await tx`SELECT data FROM hm_reports WHERE event_id=${eventId}`
    ).map((x) => x.data as Report);
    Object.assign(e, reportStats(reports));
    if (e.scoreStatus === "scored" && e.scoreMethod !== "manual" && !old) {
      e.scoreStatus = "pending";
      e.scoreReason = "出现新报道，等待重新评估";
    }
    if (input.eventDigest || input.origin !== "aihot" || !e.summary || (old?.data?.title===e.title && old?.data?.summary===e.summary)) {
      e.title = input.title;
      e.summary = input.summary;
      e.summaryExpiresAt=input.origin==="aihot" ? input.expiresAt ?? null : null;
    }
    e.updatedAt = now;
    if(entersCandidates(e,reports))e.candidate={status:"active",at:now,by:"rules"};
    await tx`UPDATE hm_events SET data=${tx.json(e as never)}||CASE WHEN data ? 'candidate' THEN jsonb_build_object('candidate',data->'candidate') ELSE '{}'::jsonb END,updated_at=now() WHERE id=${eventId}`;
    return e;
  })) as unknown as Event;
}
export async function saveCase(c: Case): Promise<Case> {
  const url = canonicalUrl(c.url);
  c.url = url;
  const [row] =
    await sql`INSERT INTO hm_cases(id,event_id,url,data) VALUES(${c.id},${c.eventId},${url},${sql.json(c as never)}) ON CONFLICT(event_id,url) DO UPDATE SET data=hm_cases.data || ${sql.json({ title: c.title, summary: c.summary, media: c.media, collectedAt: c.collectedAt, version: c.version, versionEvidence: c.versionEvidence, verification: c.verification } as never)},updated_at=now() RETURNING id,data`;
  if (row.data.id !== row.id) {
    row.data.id = row.id;
    await sql`UPDATE hm_cases SET data=${sql.json(row.data)} WHERE id=${row.id}`;
  }
  return row.data as Case;
}
export async function caseById(id: string): Promise<Case | null> {
  const r = (await sql`SELECT data FROM hm_cases WHERE id=${id}`)[0];
  return (r?.data as Case) ?? null;
}
export async function updateCase(c: Case) {
  await sql`UPDATE hm_cases SET data=${sql.json(c as never)},updated_at=now() WHERE id=${c.id}`;
  return c;
}
export async function saveClassification(c: Classification) {
  const e = await eventById(c.eventId);
  if (!e) throw new Error("事件不存在");
  e.classification = c;
  return saveEvent(e);
}
export async function assetsFor(caseId?: string): Promise<Asset[]> {
  return (
    await sql`SELECT data FROM hm_assets WHERE (${caseId ?? null}::text IS NULL OR case_id=${caseId ?? null}) ORDER BY created_at`
  ).map((r) => r.data as Asset);
}
export async function setJob(j: Job) {
  await sql`INSERT INTO hm_jobs(id,data) VALUES(${j.id},${sql.json(j as never)}) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
}
export async function jobById(id: string): Promise<Job | null> {
  return (
    ((await sql`SELECT data FROM hm_jobs WHERE id=${id}`)[0]?.data as Job) ??
    null
  );
}

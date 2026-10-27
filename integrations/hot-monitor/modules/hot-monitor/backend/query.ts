import { currentReview } from "./priority.ts";
import { addDays, beijingDate, beijingMidnight, isValidDate } from "@aihot/contracts/time";
import { sourcePlatform, type Event, type Report } from "../contracts.ts";
import { displayEvent, displayReport } from "./chinese.ts";
import { canonicalUrl, reportStats } from "./domain.ts";
export type Query = Record<string, string>;
const bad = (s: string) => Object.assign(new Error(s), { statusCode: 400 });
export function reportTime(r: Report, by = "published") {
  return Date.parse(by === "discovered" ? r.discoveredAt : r.publishedAt ?? r.discoveredAt);
}
export function reportPlatform(r: Report) {
  const result = sourcePlatform({ kind: "", name: r.source, originalExample: r.url });
  return result === "其他 / 待确认" && /^https?:/.test(r.url) ? "网站 / RSS" : result;
}
export function reportMatcher(q: Query, now = Date.now()) {
  for (const k of ["from", "to"]) if (q[k] && !isValidDate(q[k])) throw bad("日期格式应为 YYYY-MM-DD");
  if (q.from && q.to && q.from > q.to) throw bad("开始日期不能晚于结束日期");
  const custom = Boolean(q.from || q.to);
  const window = q.window || "7d";
  const start = q.from ? +beijingMidnight(q.from) : custom || window === "all" ? -Infinity : window === "today" ? +beijingMidnight(beijingDate(new Date(now))) : now - ({ "24h": 1, "48h": 2, "7d": 7 }[window] ?? 7) * 86400000;
  const end = q.to ? +beijingMidnight(addDays(q.to, 1)) : Infinity;
  return (r: Report) => r.active && (!q.platform || reportPlatform(r) === q.platform) && (!q.source || r.source === q.source) && (!q.origin || r.origin === q.origin) && (reportTime(r, q.timeBy) >= start && reportTime(r, q.timeBy) < end);
}
export function filterOptions(reports: Report[]) {
  const active = reports.filter(r => r.active);
  return { platforms: [...new Set(active.map(reportPlatform))].sort(), sources: [...new Set(active.map(r => r.source))].sort((a, b) => a.localeCompare(b, "zh-CN")) };
}
export function paginate<T>(items: T[], q: Query) {
  const size = [20, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 20;
  const total = Math.max(1, Math.ceil(items.length / size));
  const number = Math.min(total, Math.max(1, Math.floor(Number(q.page)) || 1));
  return { items: items.slice((number - 1) * size, number * size), page: { number, total, count: items.length, size } };
}
export function queryEvents(events: Event[], reports: Report[], q: Query, now = Date.now()) {
  const matches = reportMatcher(q, now);
  const byEvent = new Map<string, Report[]>();
  for (const r of reports) { const group = byEvent.get(r.eventId) ?? []; group.push(r); byEvent.set(r.eventId, group); }
  let result = events.filter(e => !e.mergedInto).flatMap(e => {
    const all = byEvent.get(e.id) ?? [];
    const matching = all.filter(matches);
    if (!matching.length) return [];
    const latestAt = new Date(Math.max(...matching.map(r => reportTime(r, q.timeBy)))).toISOString();
    return [{ ...displayEvent(e, all), editorialReview:currentReview(e)??undefined, ...reportStats(all.filter(r => r.active)), latestAt }];
  }).filter(e => (!q.field || e.field === q.field) && (!q.format || e.format === q.format) && (q.state !== "confirmed" || e.confirmed) && (q.state !== "pending" || !e.classification) && (q.state !== "bookmarked" || e.bookmarked));
  if (q.q) { const words = q.q.trim().toLowerCase().split(/\s+/); result = result.filter(e => words.every(w => `${e.title} ${e.summary} ${e.originalTitle ?? ""}`.toLowerCase().includes(w))); }
  result.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt) || a.id.localeCompare(b.id));
  if(q.mode==='used'){const ids=new Set((q.ids||'').split(',').filter(Boolean));result=result.filter(e=>ids.has(e.id));}
  if(q.mode==='confirmed')result=result.filter(e=>e.confirmed);
  if(q.mode==='bookmarked')result=result.filter(e=>e.bookmarked);
  if (q.review) result = result.filter(e=>e.editorialReview?.by===q.review);
  if (q.mode === "observe") result = result.filter(e=>e.priority?.rank===1);
  if (q.mode === "rejected") result = result.filter(e=>e.priority?.rank===3);
  if (q.mode === "selected") result = result.filter(e => e.scoreStatus === "scored" && e.score !== null && e.score >= e.scoreThreshold).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (q.mode === "hot") result = result.filter(e => e.hotRank !== null).sort((a, b) => (a.hotRank ?? 999) - (b.hotRank ?? 999));
  if (q.mode === "priority") result = result.filter(e => e.candidate?e.candidate.status==="active":e.priority?.rank === 0).sort((a,b)=>Number(b.field==="AI与大模型")-Number(a.field==="AI与大模型") || Date.parse(b.latestAt)-Date.parse(a.latestAt));
  const page = paginate(result, q);
  return { events: page.items, page: page.page, filters: filterOptions(reports) };
}
export function timeline(reports: Report[], order = "asc") {
  const grouped = new Map<string, Report[]>();
  for (const r of reports) { const key = canonicalUrl(r.url); const group = grouped.get(key) ?? []; group.push(r); grouped.set(key, group); }
  return [...grouped.values()].map(group => {
    const preferred = [...group].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.origin === "aihot") - Number(a.origin === "aihot"))[0]!;
    return { ...displayReport(preferred), origins: [...new Set(group.map(r => r.origin))], duplicateCount: group.length };
  }).sort((a, b) => {
    if (!a.publishedAt !== !b.publishedAt) return a.publishedAt ? -1 : 1;
    return (reportTime(a) - reportTime(b)) * (order === "desc" ? -1 : 1) || a.id.localeCompare(b.id);
  });
}

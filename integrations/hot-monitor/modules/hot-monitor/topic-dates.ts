import type {Event} from "./contracts.ts";
export function topicDay(event:Pick<Event,"publishedAt">) {
  const time=event.publishedAt?Date.parse(event.publishedAt):NaN;
  return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,10):"unknown";
}
export function topicDateCounts(events:Event[]) {
  const grouped=new Map<string,number>();
  for(const e of events){const day=topicDay(e);grouped.set(day,(grouped.get(day)??0)+1);}
  return [...grouped].map(([date,count])=>({date,count})).sort((a,b)=>a.date==="unknown"?1:b.date==="unknown"?-1:b.date.localeCompare(a.date));
}

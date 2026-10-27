import {sql} from "@aihot/backend/db";
import type {Event,Report} from "../contracts.ts";
import {topicDay} from "../topic-dates.ts";
import {displayEvent} from "./chinese.ts";
import {eventById} from "./store.ts";
export async function topicsOnDate(date:string,currentId?:string) {
  const current=currentId?await eventById(currentId):null;
  const rows=await sql`SELECT data FROM hm_events WHERE NOT(data ? 'mergedInto') AND (data->>'confirmed'='true' OR id=${current?.id??null}) ORDER BY updated_at DESC,id`;
  const events=rows.map(row=>row.data as Event).filter(e=>topicDay(e)===date);
  if(!events.length)return {events:[]};
  const reports=await sql`SELECT event_id,data FROM hm_reports WHERE event_id=ANY(${events.map(e=>e.id)})`;
  return {events:events.map(e=>displayEvent(e,reports.filter(r=>r.event_id===e.id).map(r=>r.data as Report)))};
}

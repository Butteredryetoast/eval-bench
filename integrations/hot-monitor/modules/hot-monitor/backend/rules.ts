import { MONITOR_POLICY, MONITOR_RECENCY_HOURS } from "@aihot/industry/monitor-policy";
import { SELECTION } from "@aihot/industry/selection";
import { TYPE_WEIGHTS } from "./domain.ts";
import { CASE_SEARCH_POLICY } from "./case-search.ts";
import { SOURCE_INTERVAL_MINUTES } from "./catalogue.ts";
import { modelFor } from "@aihot/backend/editorial/models";
import { SCORE_MATERIAL_POLICY } from "./providers.ts";
import { SCORE_AXES, SCORE_TYPES } from "../contracts.ts";
export async function monitorRules() {
  return {version:"当前运行规则",weights:TYPE_WEIGHTS,scoreMaterial:SCORE_MATERIAL_POLICY,thresholds:SELECTION.thresholds,axes:SCORE_AXES,types:SCORE_TYPES,recencyHours:MONITOR_RECENCY_HOURS,patterns:Object.fromEntries(Object.entries(MONITOR_POLICY).map(([k,v])=>[k,v.toString()])),search:CASE_SEARCH_POLICY,newSourceIntervalMinutes:SOURCE_INTERVAL_MINUTES,models:{score:await modelFor("monitorScore"),translate:await modelFor("monitorTranslate")}};
}

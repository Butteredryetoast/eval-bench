import {CASE_PLATFORMS,casePlatform,caseGaps,type Case,type Asset} from "../contracts.ts";
import {paginate,type Query} from "./query.ts";
export function queryCases(all:Case[],assets:Asset[],q:Query){
  const savedCount=all.filter(c=>c.saved).length;
  const scope=all.filter(c=>q.browse==="saved"?c.saved:!c.saved);
  const words=(q.q??"").normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean);
  let rows=scope.filter(c=>(!q.platform||casePlatform(c.url)===q.platform)&&(!q.verification||c.verification===q.verification)&&(!q.evidence||c.evidence===q.evidence)&&(!q.captureMethod||(c.captureMethod??"unknown")===q.captureMethod)&&(!q.reviewed||c.reviewed===(q.reviewed==="true"))&&(!q.gap||caseGaps(c,assets).includes(q.gap as never))&&words.every(w=>[c.title,c.summary,c.author,c.url,c.version,c.versionEvidence,c.conditions,c.notes].join(" ").normalize("NFKC").toLowerCase().includes(w)));
  const time=(c:Case)=>{const value=q.sort==="published"?c.publishedAt:c.collectedAt;return value?Date.parse(value):-Infinity;};
  rows.sort((a,b)=>(Number.isFinite(time(b))?time(b):-Infinity)-(Number.isFinite(time(a))?time(a):-Infinity)||a.id.localeCompare(b.id));
  const result=paginate(rows,q);
  return {cases:result.items,caseList:{page:result.page,scopeCount:scope.length,savedCount,candidateCount:all.length-savedCount,platforms:CASE_PLATFORMS.map(platform=>({platform,count:scope.filter(c=>casePlatform(c.url)===platform).length}))}};
}

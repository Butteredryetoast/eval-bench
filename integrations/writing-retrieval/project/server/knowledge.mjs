import {createObsidianSource,excerpt,queryTerms} from './obsidian.mjs';
import {createLibraryRetriever,explainMatch,RETRIEVAL_INFO} from './retrieval.mjs';
import {createHaystackKnowledge} from './haystack-knowledge.mjs';


const queryTermsForBlueprint=(brief,references,b)=>{const text=[b.fit,b.needs,...b.nodes.map(n=>n.move)].join(' ').toLowerCase();return queryTerms([brief,...references.map(r=>r.title)].join(' ')).filter(term=>text.includes(term)).length;};
function compactExample(article,query,entry){const match=explainMatch(entry),topic=entry.hits.find(h=>h.channel===0);return {
 id:article.id,title:article.title,account:article.account,url:article.url,publishDate:article.publishDate,
 genre:article.genre,structureId:article.structureId,structureName:article.structureName,structureFit:article.structureFit,
 reviewStatus:article.reviewStatus,evidenceLevel:article.evidenceLevel,analysisStatus:article.analysisStatus,
 notePath:article.notePath,obsidianUrl:article.obsidianUrl,originalNotePath:article.originalNotePath,originalObsidianUrl:article.originalObsidianUrl,
 recipe:article.recipe,stages:article.stages,stageNotes:article.stageNotes,opening:article.opening,middle:article.middle,ending:article.ending,hookChains:article.hookChains,
 contentExcerpt:topic?.kind==='原文'?excerpt(topic.text,query,1400):excerpt(article._sourceText,query,1400),analysisExcerpt:article.evidenceLevel==='analyzed'?excerpt(topic?.kind==='全文拆解'?topic.text:article._analysisText,match.terms[0]||query,1600):'',
 match,
};}
export function createKnowledgeSource(options={}){
 const source=options.source||createObsidianSource(options);
 const engine=options.engine||process.env.RAG_ENGINE||'local';
 if(!['local','haystack'].includes(engine))throw Object.assign(new Error('检索引擎配置无效。'),{code:'RAG_CONFIG_ERROR'});
 const rag=options.rag||(engine==='haystack'?createHaystackKnowledge():null);let checkedRag=false;
 let indexedLibrary,retriever;
 const index=library=>{if(indexedLibrary!==library){retriever=createLibraryRetriever(library);indexedLibrary=library;}return retriever;};
 const withInfo=library=>({...library,...(library.source?{source:{...library.source,retrieval:rag?rag.info():RETRIEVAL_INFO}}:{})});
 async function loadLibrary(){const library=await source.loadLibrary();if(rag&&(!checkedRag||['indexing','error'].includes(rag.info().phase))){checkedRag=true;try{await rag.health();}catch{checkedRag=false;}}return withInfo(library);}
 async function retrieve({brief='',genre='',references=[],preferredStructure}={},limit=12){
  const library=await source.loadLibrary();
  if(rag)return rag.retrieve(library,{brief,genre,references,preferredStructure},limit);
  const eligible=library.articles.filter(a=>(!genre||a.genre===genre)&&!a.structureId.startsWith('X'));
  const found=index(library).retrieve({brief,genre,references,preferredStructure},limit);
  const rank=new Map(found.structureHits.map((hit,i)=>[hit.item.id,i]));
  const templates=library.templates.filter(t=>!genre||t.genre===genre).sort((a,b)=>(rank.get(a.id)??999)-(rank.get(b.id)??999)||a.id.localeCompare(b.id));
  const guidance=found.guidance.map(hit=>({title:hit.item.title,notePath:hit.notePath,obsidianUrl:hit.obsidianUrl,excerpt:excerpt(hit.text,hit.matchedTerms[0],800)}));
  const structureMatches=found.structureHits.map(hit=>({id:hit.item.id,name:hit.item.name,matchedTerms:hit.matchedTerms}));
  const blueprints=(library.blueprints||[]).filter(b=>!genre||b.genre===genre).map(b=>({b,score:queryTermsForBlueprint(brief,references,b)})).sort((a,b)=>b.score-a.score).map(x=>x.b);
  return {templates,blueprints,examples:found.selected.map(entry=>compactExample(entry.item,brief,entry)),stats:{...library.stats,matchedArticles:found.retrieval.candidateArticles,eligibleArticles:eligible.length,returnedExamples:found.selected.length},source:withInfo(library).source,revision:library.revision,guidance,retrieval:found.retrieval,structureMatches};
 }
 async function search({q='',genre='',limit=5}={}){
  const library=await source.loadLibrary();if(rag)return rag.search(library,{q,genre,limit});
  const found=index(library).search({q,genre,limit});
  const results=found.hits.map(hit=>({id:hit.item.id,title:hit.item.title||hit.item.id+' '+hit.item.name,notePath:hit.notePath,obsidianUrl:hit.obsidianUrl,
   snippet:excerpt(hit.text,hit.matchedTerms[0]||q,600),kind:hit.kind==='原文'?(hit.item.evidenceLevel==='analyzed'?'原文（已关联拆解）':'原文候选'):hit.kind,
   reviewStatus:hit.item.reviewStatus||(hit.category==='template'?'结构定义':'参考笔记'),evidenceLevel:hit.item.evidenceLevel||(hit.category==='template'?'analyzed':'candidate'),
   match:{terms:hit.matchedTerms,reason:hit.kind+'命中：'+hit.matchedTerms.join('、')}}));
  return {source:withInfo(library).source,revision:library.revision,total:found.total,results,retrieval:found.retrieval};
 }
 return {loadLibrary,retrieve,search,close:()=>rag?.close()};
}
// .env is loaded by the entry point after module imports. Resolve the default
// connection lazily so a configured Vault is never replaced by an earlier default.
let live,liveConfig;
function defaultSource(){const config=JSON.stringify([process.env.OBSIDIAN_VAULT_PATH,process.env.OBSIDIAN_LIBRARY_PATH,process.env.RAG_ENGINE,process.env.RAG_PYTHON,process.env.RAG_CACHE_DIR,process.env.RAG_MODELS_DIR,process.env.RAG_THREADS,process.env.RAG_RANK_CANDIDATES,process.env.RAG_MIN_RERANK_SCORE]);if(!live||liveConfig!==config){live?.close();live=createKnowledgeSource();liveConfig=config;}return live;}
export const loadLibrary=(...args)=>defaultSource().loadLibrary(...args);
export const retrieve=(...args)=>defaultSource().retrieve(...args);
export const searchKnowledge=(...args)=>defaultSource().search(...args);

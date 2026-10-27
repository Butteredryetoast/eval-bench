// WeKnora v0.8.3 REST contract. This client performs retrieval/ingestion only;
// article generation continues through the existing DeepSeek client.
const unavailable=()=>Object.assign(new Error('WeKnora 检索服务暂不可用，请检查连接和索引状态。'),{code:'WEKNORA_UNAVAILABLE'});
const id=value=>encodeURIComponent(String(value));

export function createWeKnoraClient({baseUrl,apiKey,knowledgeBaseId,rerankModelId='',vectorThreshold=.2,keywordThreshold=0,timeoutMs=20000,fetchImpl=fetch}={}){
 let root;
 try{const url=new URL(baseUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!apiKey||!knowledgeBaseId)throw new Error();root=url.href.replace(/\/+$/,'');}catch{throw Object.assign(new Error('请配置 WeKnora 服务地址、API Key 和知识库 ID。'),{code:'WEKNORA_NOT_CONFIGURED'});}
 const prefix=root.endsWith('/api/v1')?root:root+'/api/v1';
 async function request(path,{method='GET',body}={}){
  try{
   const response=await fetchImpl(prefix+path,{method,headers:{'X-API-Key':apiKey,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok)throw unavailable();
   const payload=await response.json();if(payload?.success===false)throw unavailable();return payload;
  }catch{throw unavailable();}
 }
 async function search({query='',limit=48,knowledgeIds,tagIds}={}){
  if(!String(query).trim())return {hits:[],meta:{}};
  const count=Math.max(1,Math.min(Math.floor(Number(limit)||48),100));
  const body={query_text:String(query).trim(),match_count:count,vector_threshold:vectorThreshold,keyword_threshold:keywordThreshold,disable_keywords_match:false,disable_vector_match:false};
  if(knowledgeIds?.length)body.knowledge_ids=knowledgeIds;
  if(tagIds?.length)body.tag_ids=tagIds;
  if(rerankModelId)body.rerank={model_id:rerankModelId,top_k:count};
  const payload=await request('/knowledge-bases/'+id(knowledgeBaseId)+'/hybrid-search',{method:'POST',body});
  if(!Array.isArray(payload.data))throw unavailable();
  return {hits:payload.data.filter(hit=>hit&&typeof hit.knowledge_id==='string'&&typeof hit.content==='string'),meta:payload.meta||{}};
 }
 async function createNote({title,content,tagId}={}){const payload=await request('/knowledge-bases/'+id(knowledgeBaseId)+'/knowledge/manual',{method:'POST',body:{title,content,channel:'obsidian-writing-workflow',...(tagId?{tag_id:tagId}:{})}});if(!payload.data?.id)throw unavailable();return payload.data;}
 async function updateNote(knowledgeId,{title,content}={}){const payload=await request('/knowledge/manual/'+id(knowledgeId),{method:'PUT',body:{title,content}});if(!payload.data?.id)throw unavailable();return payload.data;}
 async function deleteNote(knowledgeId){return request('/knowledge/'+id(knowledgeId),{method:'DELETE'});}
 async function getNote(knowledgeId){const payload=await request('/knowledge/'+id(knowledgeId));if(!payload.data?.id)throw unavailable();return payload.data;}
 async function getKnowledgeBase(){const payload=await request('/knowledge-bases/'+id(knowledgeBaseId));if(!payload.data?.id)throw unavailable();return payload.data;}
 async function listNotes({page=1,pageSize=100}={}){return request('/knowledge-bases/'+id(knowledgeBaseId)+'/knowledge?'+new URLSearchParams({page:String(page),page_size:String(pageSize)}));}
 return {search,createNote,updateNote,deleteNote,getNote,getKnowledgeBase,listNotes};
}

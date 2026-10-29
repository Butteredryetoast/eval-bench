import { z } from 'zod';
import {renderWritingNarrative,type WritingNarrativeContext} from './writing-narrative';
import {knowledgeCitationSchema} from './writing-citations';

const replySchema=z.object({
  action:z.enum(['reply','edit']),
  target:z.enum(['document','selection']).default('document'),
  reply:z.string().max(100000).default(''),
  markdown:z.string().max(500000).default(''),
  narrative:z.unknown().optional(),
  knowledgeCitations:z.array(knowledgeCitationSchema).max(16).default([])
}).strict();

export const automaticWritingInstruction=`根据用户本轮要求自动判断是讨论、提问，还是生成大纲、初稿或修订，不要求用户选择模式。
只返回一个 JSON 对象，不加代码围栏：
讨论或询问：{"action":"reply","reply":"你的回答"}
生成或修改正文：{"action":"edit","target":"document","reply":"简短说明","markdown":"完整的新稿 Markdown"}
修改选中的文字：{"action":"edit","target":"selection","reply":"简短说明","markdown":"只包含所选文字的替换内容"}
有选区时默认围绕该选区回答；用户要求修改它时仅替换选中文字，保留选区外的文字。用户明确要求全文修改才用 document。没有选区不可用 selection。
只有用户要求生成或修改时才返回 edit；评价、解释、讨论返回 reply。正文以当前人工编辑版本为准，不能因移除选区而丢失全文语境。
已有媒体与参考卡由编辑器保留，不要重复输出其文件链接。这不包括尚未提供的素材：缺少的事实、引语、数据、案例或截图须在叙事需要的位置保留【素材位：具体所需内容及用途】，依赖它的判断保留【待写：补齐哪项证据后再写什么】。保留原稿已有的素材位；用户明确要求删除或已补齐对应证据时才调整。`;

export function interpretWritingReply(answer:string,narrative?:{context:WritingNarrativeContext;required:boolean;stage?:'planning'|'drafting'|'default'}){
  const raw=answer.trim().replace(/^```(?:json)?\s*\n?/i,'').replace(/\n?```$/,'');
  let decoded:unknown;try{decoded=JSON.parse(raw);}catch{return {purpose:'discuss' as const,text:answer,target:'document' as const,citations:[],requiredKnowledgeIds:[] as string[],sourceIds:[] as string[]};}
  const result=replySchema.safeParse(decoded);
  // An unstructured answer is still readable, but cannot silently rewrite the document.
  if(!result.success)return {purpose:'discuss' as const,text:answer,target:'document' as const,citations:[],requiredKnowledgeIds:[] as string[],sourceIds:[] as string[]};
  const v=result.data;
  if(v.action==='edit'){
    if(v.narrative!==undefined&&narrative?.stage==='planning')throw Error('当前先完成结构匹配与大纲，确认后再生成全文初稿');
    if(v.narrative!==undefined){if(!narrative||v.target!=='document'||v.markdown.trim())throw Error('资讯叙事与正文返回格式冲突，请重试');const rendered=renderWritingNarrative(v.narrative,narrative.context);return {purpose:'revise' as const,text:rendered.markdown,target:v.target,citations:v.knowledgeCitations,requiredKnowledgeIds:rendered.knowledgeIds,sourceIds:rendered.sourceIds};}
    if(narrative?.required&&v.target==='document')throw Error('资讯初稿缺少叙事素材计划，未写入正文，请重新生成');
    if(!v.markdown.trim())throw Error('助手没有返回修改内容，请重试');return {purpose:'revise' as const,text:v.markdown,target:v.target,citations:v.knowledgeCitations,requiredKnowledgeIds:[] as string[],sourceIds:[] as string[]};
  }
  if(!v.reply.trim())throw Error('助手没有返回正文，请重试');
  return {purpose:'discuss' as const,text:v.reply,target:'document' as const,citations:v.knowledgeCitations,requiredKnowledgeIds:[] as string[],sourceIds:[] as string[]};
}

import { z } from 'zod';

const replySchema=z.object({
  action:z.enum(['reply','edit']),
  target:z.enum(['document','selection']).default('document'),
  reply:z.string().max(100000).default(''),
  markdown:z.string().max(500000).default('')
}).strict();

export const automaticWritingInstruction=`根据用户本轮要求自动判断是讨论、提问，还是生成大纲、初稿或修订，不要求用户选择模式。
只返回一个 JSON 对象，不加代码围栏：
讨论或询问：{"action":"reply","reply":"你的回答"}
生成或修改正文：{"action":"edit","target":"document","reply":"简短说明","markdown":"完整的新稿 Markdown"}
修改选中的文字：{"action":"edit","target":"selection","reply":"简短说明","markdown":"只包含所选文字的替换内容"}
有选区时默认围绕该选区回答；用户要求修改它时仅替换选中文字，保留选区外的文字。用户明确要求全文修改才用 document。没有选区不可用 selection。
只有用户要求生成或修改时才返回 edit；评价、解释、讨论返回 reply。正文以当前人工编辑版本为准，不能因移除选区而丢失全文语境。
媒体与参考卡由编辑器保留，不要重新输出其占位符或文件链接。`;

export function interpretWritingReply(answer:string){
  const raw=answer.trim().replace(/^```(?:json)?\s*\n?/i,'').replace(/\n?```$/,'');
  let decoded:unknown;try{decoded=JSON.parse(raw);}catch{return {purpose:'discuss' as const,text:answer,target:'document' as const};}
  const result=replySchema.safeParse(decoded);
  // An unstructured answer is still readable, but cannot silently rewrite the document.
  if(!result.success)return {purpose:'discuss' as const,text:answer,target:'document' as const};
  const v=result.data;
  if(v.action==='edit'){if(!v.markdown.trim())throw Error('助手没有返回修改内容，请重试');return {purpose:'revise' as const,text:v.markdown,target:v.target};}
  if(!v.reply.trim())throw Error('助手没有返回正文，请重试');
  return {purpose:'discuss' as const,text:v.reply,target:'document' as const};
}

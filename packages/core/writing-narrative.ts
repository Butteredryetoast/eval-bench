import {z} from 'zod';
import {compileNewsPlan,renderNewsDraft} from '../../integrations/writing-retrieval/project/server/news-narrative.mjs';
import type {WritingArticle} from '../contracts/editorial';
import {knowledgeArticles} from './writing-citations';

const beat=z.object({id:z.string(),type:z.enum(['narration','material','observation','transition']),instruction:z.string(),dependsOn:z.array(z.string()),kind:z.string().optional(),role:z.string().optional(),required:z.boolean().optional()}).passthrough();
const blueprint=z.object({id:z.string(),title:z.string(),revision:z.string(),structureId:z.string(),sourceArticleIds:z.array(z.string()).default([]),nodes:z.array(z.object({id:z.string(),beats:z.array(beat)}).passthrough())}).passthrough();
export type WritingNarrativeContext={blueprints:(z.infer<typeof blueprint>&{name:string})[];references:{id:string;content:string}[]};

export function writingGenerationStage(request:string):'planning'|'drafting'|'default'{
 const positive=request.replace(/(?:不要|不用|无需|不必|暂不|先不|别)(?:再|先|直接|急着)?\s*(?:生成|撰写|输出|写(?:出|成)?)?\s*(?:完整)?(?:正文|全文|初稿|成稿|文章)/g,'');
 if(/(?:生成|撰写|输出|写出|重写|写|完成)[^。\n！？!?]{0,16}(?:正文|全文|初稿|成稿|文章)(?!的?(?:大纲|提纲|框架|结构))|(?:正文|全文|初稿|成稿)[^。\n！？!?]{0,12}(?:重写|重新生成)|\b(?:write|generate|draft)\b.{0,35}\b(?:article|full draft)\b/i.test(positive))return 'drafting';
 if(/大纲|提纲|框架|(?:写作|叙事|文章)结构|(?:匹配|推荐|挑选|选择)[^。\n！？!?]{0,12}结构|\b(?:outline|writing structures?)\b/i.test(request))return 'planning';
 return 'default';
}

export function writingWorkflowStage(article:WritingArticle,request:string,hasDocument:boolean):ReturnType<typeof writingGenerationStage>{
 const turns=article.messages.filter(m=>m.status==='complete');let lastRequest='',planningDone=false;
 for(const m of turns){if(m.role==='user')lastRequest=m.text;else if(m.writingStage==='planning'||!m.writingStage&&writingGenerationStage(lastRequest)==='planning')planningDone=true;}
 const hasDraft=turns.some(m=>m.role==='assistant'&&m.writingStage==='drafting')||hasDocument&&!planningDone;
 const requested=writingGenerationStage(request);
 const refining=/(?:生成|匹配|修改|完善|调整|补充|重做)[^。\n！？!?]{0,20}(?:大纲|结构|提纲|框架)|(?:先|暂时|继续)(?:改|调整|修改|完善|补充)/.test(request);
 const confirmed=/(?:选(?:择|用)?|采用|按)\s*(?:第)?[1-3一二三](?:[个种项号，,、。\s]|$)|(?:就用|就按)(?:这个|这套)(?:结构|大纲|方案)?|开始(?:写|生成)|继续(?:写|生成)|写吧|(?:结构|大纲|方案).{0,6}(?:确认|没问题|可以)|确认(?:了|这个|上述|以上)?(?:结构|大纲|方案)|^\s*(?:确认|可以|没问题)[。！!\s]*$/.test(request);
 if(planningDone&&confirmed&&!refining)return 'drafting';
 if(requested==='planning'||!planningDone&&!hasDraft)return 'planning';
 return requested;
}

export function writingNarrativeContext(knowledge:{context:unknown}|null,article:WritingArticle):WritingNarrativeContext|null{
 if(article.kind!=='news'||!knowledge)return null;
 const found=z.object({blueprints:z.array(blueprint).max(5).default([])}).parse(knowledge.context);
 if(!found.blueprints.length)return null;
 const blueprints=found.blueprints.map(b=>({...b,name:b.title}));
 const references=article.references.filter(r=>r.enabled!==false&&!r.removed).map(r=>({id:r.id,content:[r.task,r.output.replace(/^来源：[^\n]*\n发布时间：[^\n]*(?:\n|$)/,''),r.notes].filter(Boolean).join('\n').trim()}));
 return {blueprints,references:[...references,...knowledgeArticles(knowledge.context).map(a=>({id:'kb:'+a.id,content:a.content}))]};
}

export function narrativeWritingInstruction(context:WritingNarrativeContext|null,required:boolean,stage:ReturnType<typeof writingGenerationStage>='default'){
 if(!context)return '';
 if(stage==='planning')return `\n\n当前处于第一阶段：结构匹配与大纲必须一起完成，尚不生成全文初稿。
首次匹配通常给三个不同方向，每个方向同时给出匹配的结构、叙事推进大纲、素材插入位置与所需材料、知识库引用。用户只要一种或已选定方案时按其要求完善对应大纲，不把结构名与大纲拆成两次交付。
参考知识库的蓝图与文章，说明每步怎么叙事、在哪里插入什么材料，以及哪些判断依赖这些材料。完成后请用户确认方向和大纲；确认或要求写正文后才进入第二阶段的完整初稿。即使首次请求直接写文章，也先完成这个阶段。
给方向建议用 action=reply；生成或修改编辑器中的大纲用 action=edit、target=document、markdown 返回 Markdown 大纲，不返回完整初稿的 narrative.plan/draft.blocks。
保留具体素材位与缺料说明，不展开成完整文章，也不因素材未齐而拒绝给出大纲。知识库前置与 knowledgeCitations 引用约定仍须满足。`;
 return `\n\n资讯叙事与素材交付约定（优先于表达规则及普通 Markdown 输出约定）：
讨论、推荐三个方向、评价或提问仍返回 action=reply，不生成正文。推荐方向要说明叙事怎样推进、素材插在何处；用户已选方向后沿用其叙事目的，不机械照搬无关蓝图。
${required?'本轮若生成全文初稿，必须使用下述 narrative 协议；普通 markdown 无法交付初稿。':'局部润色沿用现有 Markdown 与选区协议，保留原有【素材位】和【待写】。需要重新组织整篇叙事时可使用下述 narrative 协议。'}
按叙事蓝图生成或重写全文时只返回一个 JSON：{"action":"edit","target":"document","reply":"简短说明","narrative":{"plan":{"blueprintId":"检索中准确的蓝图 ID","blueprintRevision":"对应 revision","nodeInstructions":[{"nodeId":"原节点 ID","instruction":"针对本次选题的叙事动作","heading":"短小标题；开头可为空"}],"materialBindings":[{"materialId":"原 material beat ID","referenceIds":[],"requirement":"本篇具体需要什么事实、引语、数据、案例或截图，以及要证明什么"}]},"draft":{"title":"文章标题","structureId":"所选蓝图的 structureId","sourceIds":[],"blocks":[{"beatId":"原 beat ID","markdown":"该叙事片段的正文"}]}}}。
plan 保留同一张蓝图的全部节点和素材 ID 及原顺序，不把多个蓝图拼接。draft.blocks 按蓝图顺序仅输出可写的 beats，不输出标题、节点小标题或空片段；标题由后端生成。
materialBindings.referenceIds 可用本篇实际提供正文的参考资料 ID，或已读知识库文章的 kb:文章ID。历史文章可提供明确归属和时间的材料与写法，不得把旧事写成本次新消息的证据，也不冒用原作者的亲历。未拆解正文也可引用。只有链接、文件名、选题中的未核实说法都不能算已提供证据。文字资料不能满足图片或视频节点。
素材未提供时 referenceIds=[]：required=true 的 material beat 及 dependsOn 含该素材的叙事、分析或判断均不输出 blocks；required=false 时该素材及依赖它的文字一并省略。其余可写 beats 必须逐一完整输出，不漏写、重复或重排。不要自行输出【素材位】或【待写】，后端会按 beat 原位置插入具体缺口与依赖提示。
只简短提出问题、交代已支持的事实、自然转场。证据不足就保留待写，禁止为了字数先写长篇推演，再在段末或文末补材料清单。未核实的消息不能改成已经发生的事实。事实依据与历史写法参考要区分。
本篇可绑定的资料 ID：${JSON.stringify(context.references.map(r=>r.id))}。素材位置和依赖详见上方检索 blueprints；同一次回答完成写作及 Humanizer 自检，不增加润色或重试调用。`;
}

export function renderWritingNarrative(value:unknown,context:WritingNarrativeContext){
 const v=z.object({plan:z.object({blueprintId:z.string(),blueprintRevision:z.string(),nodeInstructions:z.array(z.unknown()),materialBindings:z.array(z.unknown())}).strict(),draft:z.object({title:z.string(),structureId:z.string(),sourceIds:z.array(z.string()),blocks:z.array(z.unknown())}).strict()}).strict().parse(value);
 const plan=compileNewsPlan(v.plan,context.blueprints,context.references,v.draft.structureId);
 // Pending prose should describe this topic, not the historical article's paragraph notes.
 for(const node of plan.nodes)for(const beat of node.beats)if(beat.type!=='material'&&beat.dependsOn.length)beat.instruction=node.instruction;
 const selected=context.blueprints.find(b=>b.id===v.plan.blueprintId)!;
 return {markdown:renderNewsDraft(v.draft,plan,context.references).markdown,sourceIds:v.draft.sourceIds,knowledgeIds:[...new Set([...selected.sourceArticleIds,...v.draft.sourceIds.filter(id=>id.startsWith('kb:')).map(id=>id.slice(3))])]};
}

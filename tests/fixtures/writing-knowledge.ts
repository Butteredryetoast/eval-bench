export const knowledgeArticle={id:'KB-FIXTURE',title:'有正文但尚未拆解的写法样本',url:'https://example.com/writing-source',account:'样本作者',publishDate:'2025-01-01',evidenceLevel:'candidate' as const,content:'先明确问题，再用证据解释，最后给出边界。',contentScope:'full' as const,readChars:22,totalChars:22};
export const fixtureCitation={articleId:knowledgeArticle.id,purpose:'structure' as const,location:'本次写作结构',quote:'先明确问题，再用证据解释'};
export const fixtureKnowledge=()=>({context:{templates:[],examples:[],blueprints:[],articles:[knowledgeArticle]},instructions:'保留真实来源。',revision:'fixture-r1',examples:1,engine:'fixture'});
export function citedReply(text:string,action:'reply'|'edit'='edit'){
 let value;try{value=JSON.parse(text);}catch{value=action==='reply'?{action,reply:text}:{action,target:'document',markdown:text};}
 return JSON.stringify({...value,knowledgeCitations:value.knowledgeCitations??[fixtureCitation]});
}

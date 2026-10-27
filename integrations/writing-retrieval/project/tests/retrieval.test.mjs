import test from 'node:test';
import assert from 'node:assert/strict';
import {createBm25Index,createLibraryRetriever,explainMatch,reciprocalRankFusion,retrievalQuery,splitPassages} from '../server/retrieval.mjs';

const article = (id, body, options = {}) => ({
  id, title: id, genre: '测评', structureId: 'R1', evidenceLevel: 'candidate', reviewStatus: '未全文复核候选',
  _sourceText: body, _analysisText: '', recipe: {}, stages: [],
  notePath: `库/文章/${id}.md`, obsidianUrl: `obsidian://open?vault=test&file=${id}`,
  ...options,
});
const template = {id:'R1',name:'多维验证',genre:'测评',fit:'实测验证结果，交代测试过程与局限',sequence:['任务','结果','边界'],materials:'测试记录',boundary:'没有记录不能声称亲测',hooks:''};
const library = (articles, templates = [template], notes = []) => ({ articles, templates, notes });

test('rare concrete terms outrank a repeated generic topic in the passage ranking', () => {
  const docs = Array.from({length:20}, (_,i) => ({key:'news-'+i,title:'模型消息',text:'模型发布新闻发布模型，产品发布。'}));
  docs.push({key:'specific',title:'新的观测记录',text:'海豚光谱仪用于海洋观测，模型提供辅助处理。'});
  const results = createBm25Index(docs).search('模型发布 海豚光谱仪');
  assert.equal(results[0].key, 'specific');
  assert.ok(results[0].matchedTerms.some(t => /海豚|光谱/.test(t)));
});

test('new material can match through pasted reference content, without fetching its URL', () => {
  const retriever = createLibraryRetriever(library([article('A1','嫦娥月背通信技术的验证过程'),article('A2','咖啡烘焙的感官记录')]));
  const found = retriever.retrieve({brief:'这条新闻',genre:'测评',references:[{title:'最新消息',content:'嫦娥月背通信',url:'https://unused.invalid/private'}]});
  assert.deepEqual(found.selected.map(x => x.item.id), ['A1']);
  assert.equal(found.retrieval.modelCalls, 0);
  assert.equal(found.retrieval.vectorSearch, false);
});

test('review status and a preferred structure never manufacture a zero-match example', () => {
  const a = article('reviewed','咖啡烘焙记录',{evidenceLevel:'analyzed',reviewStatus:'独立复核通过',_analysisText:'咖啡产地与烘焙温度',recipe:{readerTask:'咖啡品尝'}});
  const found = createLibraryRetriever(library([a])).retrieve({brief:'斑马光谱仪',genre:'测评',preferredStructure:'R1'});
  assert.equal(found.selected.length,0);
  assert.equal(found.retrieval.candidateArticles,0);
  assert.match(found.retrieval.notice,/没有检索到/);
});

test('writing-pattern retrieval finds a cross-topic example and excludes an unreviewed old tag', () => {
  const analyzed = article('recipe','厨房米饭记录',{evidenceLevel:'analyzed',_analysisText:'按不同人群分析取舍',recipe:{readerTask:'比较不同选项的差异，为适用人群完成选型'}});
  const candidate = article('old-tag','烤箱温度记录',{structureName:'比较 差异 选型',recipe:{readerTask:'比较不同选项的差异'}});
  const found = createLibraryRetriever(library([analyzed,candidate])).retrieve({brief:'比较两款智能体的差异，怎么选',genre:'测评'});
  assert.deepEqual(found.selected.map(x=>x.item.id),['recipe']);
  const match=explainMatch(found.selected[0]);
  assert.deepEqual(match.channels,['拆解写法']);
  assert.match(match.reason,/主题可能不同/);
  assert.deepEqual(found.retrieval.taskLabels,['对比选型']);
});

test('genre filtering runs before fusion; long articles occupy a single candidate slot', () => {
  const long=article('long',('磁悬浮电机测量数据。'+ '测试场景记录。'.repeat(80)+'\n').repeat(8));
  const same=article('short','磁悬浮电机的简短记录');
  const other=article('tutorial','磁悬浮电机教程',{genre:'教程'});
  const found=createLibraryRetriever(library([long,same,other])).retrieve({brief:'磁悬浮电机',genre:'测评'},12);
  assert.equal(found.selected.length,2);
  assert.equal(new Set(found.selected.map(x=>x.item.id)).size,2);
  assert.ok(found.retrieval.passages>8);
});

test('terms at the end of a long brief remain searchable', () => {
  const found=createLibraryRetriever(library([article('target','萤火虫量子通信'),article('other','海洋测绘')])).retrieve({brief:'无关背景叙述'.repeat(60)+' 萤火虫量子通信',genre:'测评'});
  assert.equal(found.selected[0].item.id,'target');
});

test('a hit deep inside a long body keeps the actual source passage and source link', () => {
  const sourceUrl='obsidian://open?vault=test&file=original';
  const a=article('deep','无关文字'.repeat(8000)+'月背红外成像独有记录',{evidenceLevel:'analyzed',_analysisText:'普通分析',notePath:'库/拆解/deep.md',originalNotePath:'库/文章/deep.md',originalObsidianUrl:sourceUrl});
  const result=createLibraryRetriever(library([a])).search({q:'月背红外成像',genre:'测评'});
  assert.equal(result.hits.length,1);
  assert.match(result.hits[0].text,/月背红外成像/);
  assert.equal(result.hits[0].notePath,'库/文章/deep.md');
  assert.equal(result.hits[0].obsidianUrl,sourceUrl);
});

test('task expansion is explicitly lexical and is not activated by pasted references alone', () => {
  const query=retrievalQuery({brief:'某个新产品发布了',references:[{title:'报告',content:'作者进行了实测和对比'}]});
  assert.deepEqual(query.taskLabels,[]);
  assert.deepEqual(query.pattern,[]);
  assert.ok(query.topic.some(p=>p.text.includes('作者进行了实测')));
});

test('generic writing instructions do not drown out the actual reference subject', () => {
  const generic=article('generic','围绕消息组织记录',{evidenceLevel:'analyzed',_analysisText:'围绕一篇文章组织信息',recipe:{readerTask:'围绕消息组织一篇文章'}});
  const video=article('video','视频镜头连续性和人物一致性');
  const found=createLibraryRetriever(library([generic,video])).retrieve({brief:'围绕这条消息组织一篇文章',genre:'测评',references:[{title:'素材',content:'视频镜头连续性和人物一致性'}]});
  assert.deepEqual(found.selected.map(hit=>hit.item.id),['video']);
  assert.equal(found.retrieval.patternMatches,0);
});

test('a missing-material prohibition is not positive evidence of a writing-task fit', () => {
  const a=article('negative-only','咖啡烘焙记录',{evidenceLevel:'analyzed',_analysisText:'咖啡产地说明',recipe:{readerTask:'咖啡品尝',cannotUseWithout:'没有记录不能做比较与差异选型'}});
  const found=createLibraryRetriever(library([a],[{...template,fit:'解释烘焙温度',sequence:['温度','香气'],boundary:'没有记录不能做比较与差异选型'}])).retrieve({brief:'比较两款智能体差异，怎么选',genre:'测评'});
  assert.equal(found.selected.length,0);
  assert.equal(found.structureHits.length,0);
});

test('RRF deduplicates each channel before assigning ranks', () => {
  const hit=key=>({key,item:{id:key}});
  const one=reciprocalRankFusion([[hit('A'),hit('A'),hit('B')],[hit('B')]]);
  const two=reciprocalRankFusion([[hit('A'),hit('B')],[hit('B')]]);
  assert.deepEqual(one,two);
  assert.equal(one[0].key,'B');
});

test('overlapping passages retain a term crossing a chunk boundary', () => {
  const body='甲'.repeat(895)+'深海光谱探测器'+'乙'.repeat(900);
  const pieces=splitPassages(body);
  assert.ok(pieces.some(p=>p.includes('深海光谱探测器')));
  assert.ok(pieces.every(p=>p.length<=900));
});

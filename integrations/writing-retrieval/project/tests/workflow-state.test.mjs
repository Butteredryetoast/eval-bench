import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTopics, toggleSelection, inputSnapshot, createVersion, exportHtml, makeRequestInput, buildRevisionInput, mergePoolReferences, appendVersion, renameDraft } from '../src/workflow.mjs';

test('topic selection persists while searching unrelated results', () => {
 const topics=[{id:'a',title:'写作',summary:'模型',publishedAt:'2026-10-25',favorite:true},{id:'b',title:'办公',summary:'任务',publishedAt:'2026-10-24'}];
 const ids=toggleSelection(['a'],'b');
 assert.deepEqual(filterTopics(topics,{query:'写作'}).map(x=>x.id),['a']);
 assert.deepEqual(ids,['a','b']);
 assert.equal(filterTopics(topics,{tab:'favorite'}).length,1);
});
test('all fact, genre and reference changes invalidate the confirmation snapshot',()=>{
 const a={brief:'热点',genre:'资讯',references:[{id:'x',title:'公告',content:'事实',url:''}]};
 for(const b of [{...a,genre:'评论'},{...a,brief:'另一热点'},{...a,references:[{...a.references[0],content:'新事实'}]}]) assert.notEqual(inputSnapshot(a),inputSnapshot(b));
});
test('a new generation preserves prior edited versions',()=>{
 const v1=createVersion({versions:[]},{title:'标题',markdown:'原稿'});
 const v2=createVersion({versions:[v1]},{title:'标题',markdown:'人工改稿'});
 assert.equal(v1.markdown,'原稿'); assert.equal(v2.number,2);assert.notEqual(v1.id,v2.id);
});
test('HTML export escapes model and user HTML without executable source links',()=>{
 const html=exportHtml({title:'<script>bad()</script>',markdown:'# 标题\n\n<script>bad()</script>',references:[{title:'来源',url:'javascript:bad()'}]});
 assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('&lt;script&gt;'));
});
test('request input uses explicitly supplied source content, excluding UI metadata',()=>{
 const result=makeRequestInput({brief:'新热点',genre:'资讯',preferredStructure:'N1',references:[{id:'a',title:'公告',content:'已贴事实',url:'https://example.com',favorite:true,example:false}]});
 assert.deepEqual(Object.keys(result.references[0]).sort(),['content','id','title','url']);assert.equal(result.genre,'资讯');
});

test('native select string zero means all dates rather than no results',()=>{
 const topics=[{id:'a',title:'旧选题',summary:'',publishedAt:'2024-01-01T00:00:00Z'}];
 assert.equal(filterTopics(topics,{days:'0'}).length,1);
});


test('removed sources do not block revision and require rechecking unsupported statements',()=>{
 const c={brief:'热点',genre:'资讯',references:[{id:'b',title:'保留来源',content:'正文'}],draft:{title:'旧稿',markdown:'依赖a的结论',structureId:'N1',sourceIds:['a','b'],materialSlots:['补充复测截图']}};
 const input=buildRevisionInput(c,'修改开头');assert.deepEqual(input.draft.sourceIds,['b']);assert.deepEqual(input.draft.materialSlots,['补充复测截图']);assert.match(input.instruction,/不再|已移除/);
});
test('versions retain the sources they were written with',()=>{
 const refs=[{id:'a',title:'原来源',content:'原事实'}];const c={references:refs,genre:'资讯',versions:[]};const v=createVersion(c,{title:'旧稿',markdown:'原稿',sourceIds:['a']});
 refs[0].title='外部修改';assert.equal(v.references[0].title,'原来源');
});

test('HTML export formats article headings and renders a single title',()=>{
 const html=exportHtml({title:'标题',markdown:'# 标题\n\n## 观点\n\n正文内容。'});
 assert.ok(html.includes('<h2>观点</h2>')); assert.equal((html.match(/<h1>/g)||[]).length,1);
});


test('reselecting topics updates this article while keeping manual references',()=>{
 const manual={id:'manual',title:'个人观察'},a={id:'a',title:'选题A'},b={id:'b',title:'选题B'};
 assert.deepEqual(mergePoolReferences([manual,a],[a,b],['b']),[manual,b]);
});

test('new article inherits genre from the selected writing mode',async()=>{
 const {newConversation}=await import('../src/seed.mjs');assert.equal(newConversation([],'测评文章').genre,'测评');assert.equal(newConversation([],'评论文章').preferredStructure,'');
});


test('appending a generated draft snapshots current sources for later export',()=>{
 const source={id:'a',title:'新热点公告',content:'当前事实'};const c={references:[source],genre:'资讯',versions:[],dirty:false};const next=appendVersion(c,{title:'新稿',markdown:'全文',sourceIds:['a']});
 assert.equal(next.draft.references[0]?.id,'a');assert.match(exportHtml({...next.draft,references:next.draft.references}),/新热点公告/);
});


test('editing the title also updates the exported Markdown title',()=>{
 const d=renameDraft({title:'旧标题',markdown:'# 旧标题\n\n正文'},'新标题');assert.equal(d.markdown,'# 新标题\n\n正文');
});

test('news narrative metadata survives revisions and versions; editing keeps prose but clears layout status',async()=>{
 const {editDraftMarkdown}=await import('../src/workflow.mjs');
 const narrative={schema:'news-narrative-v1',plan:{blueprintId:'NEWS-TEST'},layoutVerified:true,renderHash:'abc',incomplete:true};
 const c={brief:'热点',genre:'资讯',references:[],versions:[],draft:{title:'稿件',markdown:'# 稿件\n\n正文',structureId:'N1',sourceIds:[],materialSlots:['证据'],narrative}};
 assert.deepEqual(buildRevisionInput(c,'修改承接').draft.narrative,narrative);
 assert.deepEqual(createVersion(c,c.draft).narrative,narrative);
 assert.equal(typeof editDraftMarkdown,'function');
 const edited=editDraftMarkdown(c.draft,c.draft.markdown+'\n\n作者自己的观察。');assert.match(edited.markdown,/作者自己/);assert.equal(edited.narrative.layoutVerified,false);assert.equal(edited.narrative.plan.blueprintId,'NEWS-TEST');
 assert.equal(renameDraft(c.draft,'作者的新标题').narrative.layoutVerified,false);
});

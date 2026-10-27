import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanRagText,ragPassages,createRagManifest,publicRagHit} from '../server/rag-documents.mjs';

test('analysis passages keep actual writing stages and exclude audit records and promotion',()=>{
 const text='# 文章\n\n## 原文实际阶段\n\n### 同题对照\n\n用相同提示词比较连续性。\n\n## 独立复核记录\n\n**模型**：gpt-6-luna\n\n复核方法：完整阅读。\n\n## 留言与其他邀请\n\n点赞、在看和转发。\n\n## 可复用方案与素材要求\n\n**读者任务**：判断哪个工具适合自己。';
 const clean=cleanRagText(text,{analysis:true});
 assert.match(clean,/用相同提示词比较连续性/);assert.match(clean,/判断哪个工具适合自己/);
 assert.doesNotMatch(clean,/gpt-6-luna|独立复核|复核方法|在看|转发/);
});
test('Obsidian links become readable text while actual passage provenance stays in metadata',()=>{
 const clean=cleanRagText('## 实测\n\n> [[库/文章/很长的路径#^p1|P1]]：任务失败，第二次重试成功。\n\n^p1');
 assert.match(clean,/P1：任务失败/);assert.doesNotMatch(clean,/\[\[|库\/文章|\^p1/);
});
test('small overlapping chunks preserve a term across a boundary and keep the heading',()=>{
 const chunks=ragPassages('## 结果\n\n'+'甲'.repeat(355)+'深海光谱探测器'+'乙'.repeat(500));
 assert.ok(chunks.some(p=>p.content.includes('深海光谱探测器')));assert.ok(chunks.every(p=>p.content.length<=360&&p.heading==='结果'));
});
test('passage cuts and overlaps never split an emoji surrogate pair',()=>{
 const chunks=ragPassages('甲'.repeat(359)+'🧠'+'乙'.repeat(311)+'🧠'+'丙'.repeat(400));
 assert.ok(chunks.every(p=>p.content.isWellFormed()));assert.ok(chunks.some(p=>p.content.includes('🧠')));
});
test('manifest hashes change on actual edits and unreviewed articles never get an analysis source',()=>{
 const a={id:'A1',title:'测试',genre:'测评',structureId:'R1',evidenceLevel:'candidate',_sourceText:'第一版正文',_analysisText:'',notePath:'库/A1.md'};
 const lib={articles:[a],templates:[],notes:[]},first=createRagManifest(lib);
 assert.deepEqual(first.manifest.map(s=>s.kind),['source']);
 a._sourceText='第二版正文';const next=createRagManifest(lib);assert.notEqual(first.manifest[0].digest,next.manifest[0].digest);
 assert.equal(publicRagHit({parentKey:'article:deleted',passages:[{content:'旧缓存'}]},next),null);
});
test('adding a blueprint changes only its own source and retains a full typed parent',()=>{
 const a={id:'A1',title:'文章',genre:'资讯',_sourceText:'原文事实',notePath:'库/A1.md'},lib={articles:[a],templates:[],notes:[]};
 const before=createRagManifest(lib),b={id:'NEWS-TEST',name:'事件推进',genre:'资讯',structureId:'N1',revision:'v1',fit:'解释变化',nodes:[{title:'开场',readerQuestion:'发生什么？',move:'先给事实',transition:'追问原因',evidence:'A1 P1',beats:[{id:'fact',type:'material',instruction:'已知事实',kind:'fact',role:'建立共识'}]}]};
 const after=createRagManifest({...lib,blueprints:[b]});assert.equal(after.manifest.length,before.manifest.length+1);
 assert.equal(after.manifest[0].digest,before.manifest[0].digest);assert.equal(after.manifest.at(-1).kind,'blueprint');
 assert.equal(after.parents.get('blueprint:NEWS-TEST'),b);assert.ok(after.sources.at(-1).chunks().some(c=>c.content.includes('建立共识')));
});

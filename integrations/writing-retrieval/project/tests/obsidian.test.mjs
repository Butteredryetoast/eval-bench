import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObsidianSource} from '../server/obsidian.mjs';

const template=(name='消息与背景解释')=>`---\n类型: 写作结构\n体裁: 资讯\n结构代码: N1\n结构名称: ${name}\n可推荐: true\n---\n# N1 ${name}\n\n## 什么时候用\n热点事实需要解释\n\n## 推进顺序\n1. 核心变化\n2. 背景解释\n3. 边界\n\n## 必须具备的素材\n公告和时间\n\n## 适用边界\n不能把演示当成亲测\n\n## 钩子如何接入\n先交代变化，再回收承诺`;
const article=(id='A1',text='量子发布资料',date='2025-01-01')=>`---\n类型: 文章拆解\n文章ID: ${id}\n标题: 文章${id}\n账号: 测试账号\n发布日期: "${date}"\n体裁: 资讯\n结构代码: N1\n复核状态: 自动候选\n原文链接: https://example.com/${id}\n---\n# 文章${id}\n\n## 来源与正文转写\n${text}`;
const analysis=(text='旧拆解',quality='AI独立复核通过')=>`---\n类型: 全文拆解结果\n文章ID: A1\n账号: 测试账号\n发布日期: "2025-01-01"\n体裁: 评论\n结构代码: C1\n质量层级: ${quality}\n---\n# 已修正的分类\n\n## 原文实际阶段\n### 01 冲突进入\n${text}\n\n## 可复用方案与素材要求\n**读者任务**：理解${text}\n\n**适用选题**：产品争议\n\n**所需素材**：完整记录\n\n**适用边界**：只参考写法`;
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'obsidian-live-'));const library=join(root,'写作库');await mkdir(library);const put=async(p,s)=>{const file=join(library,p);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,s);return file;};try{await fn({root,library,put,source:createObsidianSource({vaultPath:root,libraryPath:'写作库'})});}finally{await rm(root,{recursive:true,force:true});}}

test('actual Markdown is the source; edit/add/delete are reflected without export or restart',async()=>fixture(async({put,source})=>{
 await put('结构/N1.md',template());const path=await put('文章/A1.md',article());
 const a=await source.loadLibrary();assert.equal(a.articles.length,1);assert.equal(a.templates[0].name,'消息与背景解释');assert.equal(a.source.type,'obsidian');
 await put('结构/N1.md',template('用户改过的结构'));await put('文章/A1.md',article('A1','新增磁悬浮标记'));
 const b=await source.loadLibrary();assert.notEqual(a.revision,b.revision);assert.equal(b.templates[0].name,'用户改过的结构');assert.equal((await source.search({q:'新增磁悬浮标记'})).results[0].id,'A1');
 await put('文章/A2.md',article('A2','新增第二篇'));assert.equal((await source.loadLibrary()).articles.length,2);
 await rm(path);assert.equal((await source.loadLibrary()).articles.length,1);assert.equal((await source.search({q:'磁悬浮标记'})).results.length,0);
}));
test('latest cumulative analysis overrides candidate labels, but older rounds are not counted or resurrected',async()=>fixture(async({put,source,library})=>{
 await put('结构/N1.md',template());await put('文章/A1.md',article());await put('全文拆解v4/文章/A1.md',analysis('旧版本词'));
 const path=await put('全文拆解v5/文章/A1.md',analysis('最新版词'));
 const a=await source.loadLibrary();assert.equal(a.articles.length,1);assert.equal(a.articles[0].genre,'评论');assert.equal(a.stats.analyzedArticles,1);assert.equal(a.stats.independentReviews,1);
 assert.equal((await source.search({q:'旧版本词'})).results.length,0);assert.ok((await source.search({q:'最新版词'})).results.length);
 await rm(path);const b=await source.loadLibrary();assert.equal(b.articles[0].genre,'资讯');assert.equal(b.stats.analyzedArticles,0);
}));
test('ordinary added notes are searchable with exact snippets and an Obsidian source link',async()=>fixture(async({put,source})=>{
 await put('我的方法/新想法.md','# 新想法\n\n独有的蝴蝶开头方法，先提出一个悬念。');
 const result=await source.search({q:'蝴蝶开头'});assert.equal(result.results.length,1);assert.match(result.results[0].snippet,/蝴蝶开头/);assert.match(result.results[0].obsidianUrl,/^obsidian:\/\/open\?/);assert.match(result.results[0].notePath,/我的方法\/新想法.md/);
}));
test('pre-2023 records, symlinks and malformed YAML cannot silently enter retrieval',async()=>fixture(async({put,source,root,library})=>{
 await put('结构/N1.md',template());await put('文章/old.md',article('OLD','不允许的旧资料','2022-12-01'));await put('文章/new.md',article('NEW','新资料'));
 await put('坏笔记.md','---\na: [broken\n---\n损坏');await writeFile(join(root,'outside.md'),'外部不可读标记');await symlink(join(root,'outside.md'),join(library,'链接.md'));
 const lib=await source.loadLibrary();assert.deepEqual(lib.articles.map(x=>x.id),['NEW']);assert.ok(lib.source.warnings.length);assert.equal((await source.search({q:'外部不可读标记'})).results.length,0);
}));
test('missing or unsafe vault reports a knowledge error rather than using a static fallback',async()=>fixture(async({root})=>{
 await assert.rejects(createObsidianSource({vaultPath:join(root,'missing'),libraryPath:'库'}).loadLibrary(),{code:'KNOWLEDGE_UNAVAILABLE'});
 await assert.rejects(createObsidianSource({vaultPath:root,libraryPath:'../'}).loadLibrary(),{code:'KNOWLEDGE_UNAVAILABLE'});
}));
test('duplicate article IDs use the most recently edited note deterministically and report a warning',async()=>fixture(async({put,source})=>{
 const newer=await put('文章/a-new.md',article('A1','磁悬浮新记录'));
 const older=await put('文章/z-old.md',article('A1','火山旧记录'));
 await utimes(newer,new Date('2026-10-26'),new Date('2026-10-26'));
 await utimes(older,new Date('2026-10-25'),new Date('2026-10-25'));
 const a=await source.loadLibrary();assert.equal(a.articles.length,1);assert.match(a.articles[0]._sourceText,/磁悬浮新记录/);assert.ok(a.source.warnings.some(x=>x.includes('重复文章ID')));
 await utimes(older,new Date('2026-10-27'),new Date('2026-10-27'));
 const b=await source.loadLibrary();assert.match(b.articles[0]._sourceText,/火山旧记录/);assert.notEqual(a.revision,b.revision);
}));
test('search excerpts use actual body or analysis text and link to the note containing that excerpt',async()=>fixture(async({put,source})=>{
 await put('文章/A1.md',article('A1','来源：导出文件追踪信息\n\n### P1\n\n> 原文星际唯一证据。\n\n^p1').replace('## 来源与正文转写','## 分类判断\n旧自动标签迷惑信息\n\n## 来源与正文转写'));
 await put('全文拆解v5/文章/A1.md',analysis('拆解特有透明路径'));
 const raw=(await source.search({q:'原文星际唯一证据'})).results[0];assert.match(raw.snippet,/原文星际唯一证据/);assert.doesNotMatch(raw.snippet,/旧自动标签|导出文件追踪信息|### P1/);assert.equal(raw.notePath,'写作库/文章/A1.md');assert.equal(raw.kind,'原文（已关联拆解）');
 const analyzed=(await source.search({q:'拆解特有透明路径'})).results[0];assert.match(analyzed.snippet,/拆解特有透明路径/);assert.equal(analyzed.notePath,'写作库/全文拆解v5/文章/A1.md');assert.equal(analyzed.kind,'全文拆解');
 assert.equal((await source.search({q:'旧自动标签迷惑信息'})).results.length,0);
}));

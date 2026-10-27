import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKnowledgeSource,loadLibrary} from '../server/knowledge.mjs';
async function withVault(fn){const root=await mkdtemp(join(tmpdir(),'knowledge-live-'));await mkdir(join(root,'库/结构'),{recursive:true});await mkdir(join(root,'库/文章'));const put=async(id,body)=>writeFile(join(root,'库/文章',id+'.md'),`---\n类型: 文章拆解\n文章ID: ${id}\n标题: 无词面线索${id}\n体裁: 资讯\n结构代码: N1\n发布日期: "2025-01-01"\n复核状态: 自动候选\n---\n# 无词面线索${id}\n\n## 来源与正文转写\n${body}`);await writeFile(join(root,'库/结构/N1.md'),'---\n类型: 写作结构\n体裁: 资讯\n结构代码: N1\n结构名称: 消息解释\n---\n# N1 消息解释\n\n## 推进顺序\n1. 变化\n2. 背景');try{await fn({source:createKnowledgeSource({vaultPath:root,libraryPath:'库'}),put,root});}finally{await rm(root,{recursive:true,force:true});}}
test('retrieval directly searches current vault bodies, including articles without full analysis',async()=>withVault(async({source,put})=>{
 await put('A1','旧材料');await put('A2','开场。'+'无关文字'.repeat(8000)+'独有磁悬浮体验');
 const result=await source.retrieve({brief:'磁悬浮体验',genre:'资讯'},2);
 assert.equal(result.examples[0].id,'A2');assert.equal(result.examples[0].evidenceLevel,'candidate');assert.equal(result.stats.articles,2);assert.equal(result.stats.analyzedArticles,0);assert.match(result.examples[0].contentExcerpt,/磁悬浮/);
 assert.ok(!('_text' in result.examples[0]));assert.ok(!('metrics' in result.examples[0]));
}));
test('the same live retriever sees edits with no exported dataset',async()=>withVault(async({source,put})=>{
 await put('A1','月球基地词');await put('A2','海洋地质词');const a=await source.retrieve({brief:'月球基地词',genre:'资讯'},1);assert.equal(a.examples[0].id,'A1');
 await put('A1','重写为另一题');await put('A2','月球基地词的新资料');const b=await source.retrieve({brief:'月球基地词',genre:'资讯'},1);assert.equal(b.examples[0].id,'A2');assert.notEqual(a.revision,b.revision);assert.match(b.examples[0].obsidianUrl,/^obsidian:\/\/open/);
}));
test('deleting a note invalidates the passage index and removes its old matches',async()=>withVault(async({source,put,root})=>{
 await put('A1','月背红外成像唯一标记');await put('A2','咖啡烘焙记录');
 assert.equal((await source.search({q:'月背红外成像'})).results[0].id,'A1');
 await rm(join(root,'库/文章/A1.md'));
 const result=await source.search({q:'月背红外成像'});assert.equal(result.results.length,0);assert.equal(result.total,0);
 assert.equal((await source.loadLibrary()).source.retrieval.engine,'local-bm25-rrf-v1');
}));
test('default source reads path configuration at use time, after optional env loading',async()=>withVault(async({put,root})=>{
 await put('ENV1','环境配置测试');
 const previousVault=process.env.OBSIDIAN_VAULT_PATH,previousLibrary=process.env.OBSIDIAN_LIBRARY_PATH;
 try{process.env.OBSIDIAN_VAULT_PATH=root;process.env.OBSIDIAN_LIBRARY_PATH='库';const lib=await loadLibrary();assert.equal(lib.articles.length,1);assert.equal(lib.articles[0].id,'ENV1');}
 finally{if(previousVault===undefined)delete process.env.OBSIDIAN_VAULT_PATH;else process.env.OBSIDIAN_VAULT_PATH=previousVault;if(previousLibrary===undefined)delete process.env.OBSIDIAN_LIBRARY_PATH;else process.env.OBSIDIAN_LIBRARY_PATH=previousLibrary;}
}));

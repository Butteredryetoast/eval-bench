import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';
import {createObsidianSource} from '../server/obsidian.mjs';
import {blueprintMarkdown} from './fixtures/news-blueprint.mjs';
const module=await import('../server/blueprints.mjs').catch(()=>({}));
const note=(raw=blueprintMarkdown)=>{const fm=raw.match(/^---\n([\s\S]*?)\n---\n/);return {meta:parse(fm[1]),body:raw.slice(fm[0].length),notePath:'库/叙事蓝图/资讯/NEWS-TEST.md',obsidianUrl:'obsidian://open?vault=test&file=blueprint',digest:'test-revision'};};
test('blueprint parsing preserves ordered material and dependent observations',()=>{
 assert.equal(typeof module.parseBlueprint,'function');const b=module.parseBlueprint(note());
 assert.equal(b.id,'NEWS-TEST');assert.equal(b.structureId,'N1');assert.equal(b.nodes[0].beats[1].type,'material');
 assert.deepEqual(b.nodes[0].beats[2].dependsOn,['release']);assert.equal(b.nodes[1].evidence,'A1 P3–P4');
});
test('duplicate beats and future material dependencies are rejected',()=>{
 assert.equal(typeof module.parseBlueprint,'function');
 assert.throws(()=>module.parseBlueprint(note(blueprintMarkdown.replace('#### next · transition','#### release · transition'))));
 assert.throws(()=>module.parseBlueprint(note(blueprintMarkdown.replace('依赖：release','依赖：comparison'))));
});
test('live blueprint edits and deletion do not change article or analysis counts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'news-blueprint-vault-'));try{
  await mkdir(join(root,'库/叙事蓝图/资讯'),{recursive:true});await mkdir(join(root,'库/文章'));
  await writeFile(join(root,'库/文章/A1.md'),'---\n类型: 文章拆解\n文章ID: A1\n体裁: 资讯\n结构代码: N1\n发布日期: "2025-01-01"\n---\n# 记录\n\n## 正文\n一条原文。');
  const path=join(root,'库/叙事蓝图/资讯/NEWS-TEST.md');await writeFile(path,blueprintMarkdown);
  const source=createObsidianSource({vaultPath:root,libraryPath:'库'}),first=await source.loadLibrary();
  assert.equal(first.blueprints?.length,1);assert.equal(first.stats.articles,1);assert.equal(first.stats.analyzedArticles,0);assert.equal(first.notes.length,0);
  await writeFile(path,blueprintMarkdown.replace('解释一个已经公布的变化','解释一条最新变化'));
  const edited=await source.loadLibrary();assert.notEqual(edited.blueprints[0].revision,first.blueprints[0].revision);
  await rm(path);const deleted=await source.loadLibrary();assert.equal(deleted.blueprints.length,0);assert.equal(deleted.stats.articles,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {newsFixture} from './fixtures/news-contract.mjs';
import * as module from '../server/news-narrative.mjs';
test('news material gaps block only dependent prose and retain its actual position',()=>{
 assert.equal(typeof module.compileNewsPlan,'function');const {b,references,raw}=newsFixture(),plan=module.compileNewsPlan(raw,[b],references,'N1');
 const writable=module.writableNewsBeats(plan);assert.ok(writable.some(b=>b.id==='meaning'));assert.ok(!writable.some(b=>b.id==='comparison-result'));
 const result=module.renderNewsDraft({title:'更新与边界',structureId:'N1',sourceIds:['r1'],blocks:writable.map(b=>({beatId:b.id,markdown:'片段 '+b.id+'：根据提供的资料组织叙事。'}))},plan,references);
 assert.ok(result.markdown.indexOf('boundary-setup')<result.markdown.indexOf('【素材位：'));
 assert.ok(result.markdown.indexOf('【素材位：')<result.markdown.indexOf('【待写：'));
 assert.ok(result.markdown.indexOf('【待写：')<result.markdown.indexOf('片段 next'));assert.equal(result.narrative.layoutVerified,true);
});
test('complete materials allow a draft with no artificial placeholder',()=>{
 assert.equal(typeof module.compileNewsPlan,'function');const {b,references,raw}=newsFixture();raw.materialBindings[1].referenceIds=['r2'];
 const plan=module.compileNewsPlan(raw,[b],references,'N1'),blocks=module.writableNewsBeats(plan).map(b=>({beatId:b.id,markdown:'已提供材料支持的正文 '+b.id}));
 const result=module.renderNewsDraft({title:'已核实的更新',structureId:'N1',sourceIds:['r1','r2'],blocks},plan,references);assert.deepEqual(result.materialSlots,[]);assert.doesNotMatch(result.markdown,/素材位|待写/);
});
test('URL-only evidence, unknown sources and stale blueprint revisions are rejected',()=>{
 assert.equal(typeof module.compileNewsPlan,'function');const {b,references,raw}=newsFixture();
 assert.throws(()=>module.compileNewsPlan({...raw,blueprintRevision:'stale'},[b],references,'N1'));
 assert.throws(()=>module.compileNewsPlan({...raw,materialBindings:[{materialId:'release',referenceIds:['unknown']},raw.materialBindings[1]]},[b],references,'N1'));
 assert.throws(()=>module.compileNewsPlan(raw,[b],[{id:'r1',url:'https://example.com',content:''}],'N1'));
});
test('a tail-placeholder legacy bad draft and invented or duplicate blocks cannot pass news validation',()=>{
 assert.equal(typeof module.compileNewsPlan,'function');const {b,references,raw}=newsFixture(),plan=module.compileNewsPlan(raw,[b],references,'N1');
 assert.throws(()=>module.renderNewsDraft({title:'坏稿',markdown:'判断已经写完。'.repeat(20)+'【素材位：末尾补证据】',structureId:'N1',sourceIds:[],materialSlots:['证据']},plan,references));
 const valid=module.writableNewsBeats(plan).map(b=>({beatId:b.id,markdown:'合法片段 '+b.id}));
 assert.throws(()=>module.renderNewsDraft({title:'坏稿',structureId:'N1',sourceIds:[],blocks:[...valid,{beatId:'comparison-result',markdown:'尚未提供数据却已得出胜负。'}]},plan,references));
 assert.throws(()=>module.renderNewsDraft({title:'坏稿',structureId:'N1',sourceIds:[],blocks:[valid[0],...valid]},plan,references));
});

test('text references cannot satisfy a visual beat; omitted optional material removes dependent prose',()=>{
 const {b,references,raw}=newsFixture(),visual=structuredClone(b);visual.nodes[0].beats[1].kind='image';
 assert.throws(()=>module.compileNewsPlan(raw,[visual],references,'N1'));
 const optional=structuredClone(b);optional.nodes[1].beats.find(b=>b.id==='comparison').required=false;
 const plan=module.compileNewsPlan(raw,[optional],references,'N1');assert.equal(plan.materials[1].status,'omitted');assert.ok(!module.writableNewsBeats(plan).some(b=>b.id==='comparison-result'));
});
test('news saves the validated block mapping and does not cite a URL-only reference as read evidence',()=>{
 const {b,references,raw}=newsFixture(),plan=module.compileNewsPlan(raw,[b],references,'N1'),blocks=module.writableNewsBeats(plan).map(b=>({beatId:b.id,markdown:'资料支持的片段 '+b.id}));
 const result=module.renderNewsDraft({title:'稿件',structureId:'N1',sourceIds:['r1'],blocks},plan,references);assert.deepEqual(result.narrative.blocks,blocks);
 assert.throws(()=>module.renderNewsDraft({title:'稿件',structureId:'N1',sourceIds:['url'],blocks},plan,[...references,{id:'url',url:'https://example.com'}]));
});

test('manual news patches retain untouched author paragraphs and reject a whole-document reset',()=>{
 assert.equal(typeof module.applyNewsEdits,'function');
 const draft={title:'原题',structureId:'N1',markdown:'# 原题\n\n待调整的一句。\n\n作者独有的观察，必须保留。',sourceIds:['r1']},references=[{id:'r1',content:'当前资料'}];
 const result=module.applyNewsEdits({title:'新题',structureId:'N1',sourceIds:['r1'],edits:[{before:'待调整的一句。',after:'更短的承接。'}]},draft,references);
 assert.match(result.markdown,/作者独有的观察，必须保留/);assert.match(result.markdown,/^# 新题/);
 assert.throws(()=>module.applyNewsEdits({title:'新题',structureId:'N1',sourceIds:['r1'],edits:[{before:'待调整的一句。\n\n作者独有的观察，必须保留。',after:'只有重写结果。'}]},draft,references));
 assert.throws(()=>module.applyNewsEdits({title:'新题',structureId:'N1',sourceIds:[],edits:[{before:'不存在的片段',after:'删除作者正文。'}]},draft,references));
});

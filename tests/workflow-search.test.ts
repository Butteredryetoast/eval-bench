import test from 'node:test';import assert from 'node:assert/strict';
import {extractCaseKeywords,platformCaseSearch,CASE_PLATFORMS} from '../packages/core/hotspots/search';
import {titleTokens,joinTitleTokens} from '../packages/core/hotspots/title-keywords';
const event={title:'DeepSeek 发布视频生成新功能',summary:'提供视频演示',product:'DeepSeek',version:null,publishedAt:null};
test('all platform links preserve explicit plain keywords without adding tests or dates',()=>{
 for(const platform of CASE_PLATFORMS){const plan=platformCaseSearch(event,platform,'keywords','DeepSeek 视频','precise',Date.now(),'manual');assert.equal(plan.query.replace(/["()]/g,'').replace(/\bAND\b/g,'').replace(/\s+/g,' ').trim(),'DeepSeek 视频');const url=new URL(plan.url);assert.equal(url.protocol,'https:');assert.ok(!url.username&&!url.password);}
});
test('title selection preserves model names and source order across separated fragments',()=>{const title='GPT-6.1：游戏生成与视频',tokens=titleTokens(title);assert.equal(tokens[0].text,'GPT-6.1');const indices=tokens.map((t,i)=>({t,i})).filter(({t})=>['GPT-6.1','游','戏'].includes(t.text)).map(x=>x.i);assert.equal(joinTitleTokens(title,tokens,indices.reverse()),'GPT-6.1 游戏');});
test('suggested subject is grounded in source text and can be replaced by manual words',()=>{const draft=extractCaseKeywords(event);assert.match(draft.keywords,/DeepSeek/i);const plan=platformCaseSearch(event,'x','comparison','用户手动词','broad',Date.now(),'manual');assert.match(plan.query,/用户手动词/);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadHumanizerSkill,withHumanizerRules,preservesDraft} from '../server/humanizer.mjs';

const draft={title:'导出记录',structureId:'N1',sourceIds:['r1'],materialSlots:['补充复测截图'],markdown:'# 导出记录\n\n## 观察\n\n工具支持 CSV、搜索和批量重命名。单个文件上限为 10 MB，目前还没有复测。\n\n运行 `save --dry-run`，详情见[说明](https://example.com/v2)。\n\n【素材位：补充复测截图】'};

test('the full pinned upstream skill is loaded, with its MIT attribution retained',async()=>{
 const skill=await loadHumanizerSkill();
 const original=await readFile(new URL('../server/skills/humanizer-zh/SKILL.md',import.meta.url),'utf8');
 assert.equal(skill.id,'humanizer-zh');assert.equal(skill.revision,createHash('sha256').update(original).digest('hex'));
 assert.equal(skill.commit,'f4518a8eab97b8bfebc66a89d34320a89bef6930');
 const inputMessages=[{role:'system',content:'Return the requested article JSON.'},{role:'user',content:JSON.stringify({draft,genre:'资讯'})}];
 const messages=withHumanizerRules(skill,inputMessages);
 assert.ok(messages[0].content.includes(skill.instructions));assert.deepEqual(messages[1],inputMessages[1]);assert.equal(messages.length,2);assert.equal(inputMessages[0].content,'Return the requested article JSON.');
 assert.match(await readFile(new URL('../server/skills/humanizer-zh/LICENSE',import.meta.url),'utf8'),/MIT License/);
});
test('natural prose edits can pass while protected information and structure remain intact',()=>{
 const edited={...draft,markdown:draft.markdown.replace('工具支持 CSV、搜索和批量重命名。','这次新增 CSV 导出、搜索和批量重命名。')};
 assert.equal(preservesDraft(draft,edited),true);
});
test('the manual QA guard detects changes to sources, material gaps, numeric facts, headings, links or commands',()=>{
 for(const edited of [
  {...draft,title:'另一个标题'}, {...draft,structureId:'N2'}, {...draft,sourceIds:['r2']}, {...draft,materialSlots:[]},
  {...draft,markdown:draft.markdown.replace('10 MB','20 MB')},
  {...draft,markdown:draft.markdown.replace('## 观察','## 结论')},
  {...draft,markdown:draft.markdown.replace('【素材位：补充复测截图】','')},
  {...draft,markdown:draft.markdown.replace('https://example.com/v2','https://example.com/new')},
  {...draft,markdown:draft.markdown.replace('save --dry-run','save --force')},
 ])assert.equal(preservesDraft(draft,edited),false);
});

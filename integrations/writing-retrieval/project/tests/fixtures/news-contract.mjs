import {parse} from 'yaml';
import {parseBlueprint} from '../../server/blueprints.mjs';
import {blueprintMarkdown} from './news-blueprint.mjs';
export function newsFixture(){const fm=blueprintMarkdown.match(/^---\n([\s\S]*?)\n---\n/),b=parseBlueprint({meta:parse(fm[1]),body:blueprintMarkdown.slice(fm[0].length),digest:'fixture-revision',notePath:'库/蓝图.md',obsidianUrl:'obsidian://open?vault=test&file=b'}),references=[{id:'r1',title:'公告',content:'已确认一项更新。'},{id:'r2',title:'结果',content:'同条件对照记录。'}];return {b,references,raw:{blueprintId:b.id,blueprintRevision:b.revision,nodeInstructions:b.nodes.map(n=>({nodeId:n.id,instruction:n.move,heading:n.id==='opening'?'':'边界'})),materialBindings:[{materialId:'release',referenceIds:['r1']},{materialId:'comparison',referenceIds:[]}]}};}

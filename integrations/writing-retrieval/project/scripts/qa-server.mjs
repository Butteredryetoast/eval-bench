import {writableNewsBeats} from '../server/news-narrative.mjs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApiServer } from '../server/api.mjs';
import { loadLibrary } from '../server/knowledge.mjs';

export const QA_HOST = '127.0.0.1';
export const QA_API_PORT = 8788;
export const QA_PROVIDER_PORT = 8990;
export const QA_API_KEY = 'qa-local-only';

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function recommendation(payload) {
  const structures = payload.allowedStructures || [];
  const examples = payload.writingExamples || [];
  const labels = [
    ['矛盾起点', '围绕关键矛盾追查问题从哪里开始'],
    ['决策过程', '沿着读者的选择过程拆解每个判断'],
    ['证据边界', '从可核验的证据说明结论适用范围'],
  ];
  const structureFor = index => structures.find(x => x.id === payload.preferredStructure) && index === 0
    ? structures.find(x => x.id === payload.preferredStructure)
    : structures[index % Math.max(1, structures.length)];
  return { directions: labels.map(([label, angle], index) => {
    const b=payload.allowedBlueprints?.[index%payload.allowedBlueprints.length];
    const structure = (b&&structures.find(t=>t.id===b.structureId))||structureFor(index)||structures[0];
    const narrativePlan=b?{blueprintId:b.id,blueprintRevision:b.revision,nodeInstructions:b.nodes.map(n=>({nodeId:n.id,instruction:n.move,heading:''})),materialBindings:b.nodes.flatMap(n=>n.beats).filter(b=>b.type==='material').map((m,i)=>({materialId:m.id,referenceIds:i===0&&!['image','video'].includes(m.kind)?(payload.references||[]).filter(r=>r.content).slice(0,1).map(r=>r.id):[],requirement:m.instruction}))}:null;
    return {
      title: `${label}视角`, angle, reason: `按“${structure?.name || payload.requestedGenre}”结构组织，模拟服务仅用于验收接口流程。`,
      structureId: structure?.id || '', outline: ['交代用户已提供的背景', '逐步展开分析与证据', '说明结论和适用边界'],
      ...(narrativePlan?{narrativePlan}:{}),
      materialNeeds: ['补充可核验的原始截图或完整记录'], examples: examples[index % Math.max(1, examples.length)] ? [{ id: examples[index % examples.length].id }] : [],
    };
  }) };
}

function article(payload) {
  if(payload.narrativePlan){
    const plan=payload.narrativePlan;
    return {title:'[验收示例] 资讯叙事流程',structureId:plan.structureId,sourceIds:(payload.references||[]).filter(r=>r.content).map(r=>r.id),blocks:writableNewsBeats(plan).map(b=>({beatId:b.id,markdown:'本地模拟片段 '+b.id+'：仅用于核对节点顺序和素材位置，不代表真实模型写作。'})),...(payload.instruction?{materialBindings:plan.materials.map(m=>({materialId:m.id,referenceIds:m.referenceIds,requirement:m.instruction}))}:{})};
  }
  if(payload.preserveDraft)return {title:payload.draft.title,structureId:payload.draft.structureId,sourceIds:payload.draft.sourceIds,edits:[]};
  const prior = payload.draft;
  const refs = payload.references || [];
  const direction = payload.confirmedDirection;
  const title = `[验收示例] ${prior?.title || direction?.title || '写作流程示例'}`;
  const sourceIds = refs.map(ref => ref.id);
  const markdown = `# ${title}\n\n> 本文由本地验收模拟服务生成，用来检查 API 流程，不代表真实模型写作结果。\n\n## 背景与问题\n\n${refs.length ? `用户提供的材料《${refs[0].title}》描述了相关情况。` : '当前没有提供可引用的外部材料，正文仅展示结构和素材缺口。'} 本节只复述已提交内容，不从网络补充新事实。\n\n## 分析过程\n\n可以先把已知事实、待验证假设和判断边界分开，再依照所选结构说明它们之间的关系。遇到缺少证据的地方，先留出明确位置，待补充材料后再完成核验。\n\n## 结论与下一步\n\n现有信息足以呈现分析路径，但不足以替代实测或独立验证。后续可补充原始记录，并根据新增材料更新结论。\n\n【素材位：补充可核验的原始截图、完整记录或实测数据后，再确认关键判断。】`;
  return { title, markdown, structureId: prior?.structureId || direction?.structureId || payload.structure?.id, sourceIds, materialSlots: ['可核验的原始截图、完整记录或实测数据'] };
}

export function createQaProviderServer({ apiKey = QA_API_KEY, model = 'deepseek-flash' } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) return json(res, 404, { error: { message: 'QA fixture route not found' } });
    if (req.headers.authorization !== `Bearer ${apiKey}`) return json(res, 401, { error: { message: 'QA fixture only' } });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let request;
    try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: { message: 'Invalid JSON' } }); }
    if (request.model !== model || request.response_format?.type !== 'json_object' || request.thinking?.type !== 'disabled' || request.stream !== false || !Array.isArray(request.messages) || request.messages.length !== 2) {
      return json(res, 400, { error: { message: 'Unexpected fixture request schema' } });
    }
    let payload;
    try { payload = JSON.parse(request.messages[1].content); } catch { return json(res, 400, { error: { message: 'Missing prompt payload' } }); }
    requests.push({ request, payload });
    const result = payload.requestedGenre ? recommendation(payload) : article(payload);
    return json(res, 200, { choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }] });
  });
  server.qaRequests = requests;
  return server;
}

export async function startQaFixture() {
  const library = await loadLibrary();
  const provider = createQaProviderServer();
  provider.listen(QA_PROVIDER_PORT, QA_HOST);
  await new Promise((resolve, reject) => { provider.once('listening', resolve); provider.once('error', reject); });
  const api = await createApiServer({ apiKey: QA_API_KEY, baseUrl: `http://${QA_HOST}:${QA_PROVIDER_PORT}`, model: 'deepseek-flash', allowedOrigins:['http://127.0.0.1:5174'] });
  api.listen(QA_API_PORT, QA_HOST);
  await new Promise((resolve, reject) => { api.once('listening', resolve); api.once('error', reject); });
  console.log('QA FIXTURE ONLY: fake DeepSeek HTTP provider and writing API are running; no real provider call will be made.');
  console.log(`Knowledge library: ${library.stats.articles} source articles, ${library.stats.analyzedArticles} analyzed articles, ${library.stats.templates} templates.`);
  console.log(`Local browser API: http://${QA_HOST}:${QA_API_PORT} (test-only key configured server-side).`);
  console.log(`Fake OpenAI-compatible provider: http://${QA_HOST}:${QA_PROVIDER_PORT}/chat/completions.`);
  const stop = () => { api.close(); provider.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { api, provider };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startQaFixture();

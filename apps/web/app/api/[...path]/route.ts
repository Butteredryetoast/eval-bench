import {knowledgeStatus,saveKnowledgeConfig} from '@/packages/core/writing-knowledge';
import { sessionAgent } from '@/scripts/native-agents.mjs';
import { ConversationService } from '@/packages/core/conversations';
import { launchConversation } from '@/packages/core/conversation-launcher';
import { mkdir, writeFile } from 'node:fs/promises';
import { stateDir } from '@/packages/core/config';
import { agentCatalog } from '@/packages/core/agent-catalog';
import { Readable } from 'node:stream';
import path from 'node:path';
import { ZodError } from 'zod';
import { getStore } from '@/packages/core/db';
import { seedStore } from '@/packages/core/seed';
import { CasebenchService, AppError } from '@/packages/core/service';
import { compareHtml, compareMarkdown, makeArchive } from '@/packages/core/export';
import { startDemo, startLocalRun } from '@/packages/core/demo-runner';
import { readLiveProgress } from '@/packages/core/live-progress';
import { EditorialService } from '@/packages/core/editorial';
import { ArticleMaterialsService } from '@/packages/core/article-materials';
import { MediaPreparationService } from '@/packages/core/media-preparation';
import { WritingDocumentService } from '@/packages/core/writing-service';
import { files as storedFiles } from '@/packages/core/schema';
import { desc } from 'drizzle-orm';
import {isWritingVideo,writingMediaMime,WRITING_VIDEO_LIMIT} from '@/packages/contracts/writing-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED = new Set(
  (process.env.CASEBENCH_ALLOWED_HOSTS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
);
function permittedHost(host: string) { return LOCAL.has(host) || ALLOWED.has(host); }
function guard(request: Request) {
  const url = new URL(request.url);
  if (!permittedHost(url.hostname)) throw new AppError(403, '当前仅接受本机或已授权的局域网地址访问');
  const host = (request.headers.get('host') || '').split(':')[0];
  if (!permittedHost(host)) throw new AppError(403, '未授权的主机地址');
  url.host = request.headers.get('host')!;
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new AppError(403, '请求来源不匹配');
  if (['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '') && request.method !== 'GET') throw new AppError(403, '请从本网站提交修改');
  return url;
}
async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get('content-length')) > max) throw new AppError(413, '上传内容过大');
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new AppError(413, '上传内容过大'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415, '请使用 JSON 提交');
  try { return JSON.parse((await limitedBody(request, 3 * 1024 * 1024)).toString('utf8')); }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError(400, 'JSON 格式无效'); }
}
async function formBody(request: Request, max=26 * 1024 * 1024) {
  return new Response(new Uint8Array(await limitedBody(request, max)), { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
}
function uploadedFile(form: FormData) {
  const f = form.get('file');
  if (!f || typeof f === 'string') throw new AppError(400, '请选择文件');
  return f;
}
async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const url = guard(request);
    const p = (await context.params).path;
    const method = request.method;
    const store = await getStore(); await seedStore(store);
    const s = new CasebenchService(store);
    const ok = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (p[0] === 'editorial') {
      const e = new EditorialService(s);
      if(p[1]==='knowledge'&&method==='GET')return ok(await knowledgeStatus(url.searchParams.get('check')==='1'));
      if(p[1]==='knowledge'&&method==='PATCH')return ok(await saveKnowledgeConfig(await jsonBody(request)));
      if (method === 'GET' && p[1] === 'sources') return ok(await e.list('source'));
      if (method === 'POST' && p[1] === 'sources') return ok(await e.addSource(await jsonBody(request)), 201);
      if (method === 'PATCH' && p[1] === 'sources' && p[2]) return ok(await e.favorite(p[2], await jsonBody(request)));
      if (method === 'GET' && p[1] === 'media') return ok(await e.list('prepared-media'));
      if (method === 'POST' && p[1] === 'media' && !p[2]) return ok(await new MediaPreparationService(e).attach(await jsonBody(request)),201);
      if (method === 'POST' && p[1] === 'media' && p[2] === 'process') return ok(await new MediaPreparationService(e).process(await jsonBody(request)),201);
      if (method === 'PATCH' && p[1] === 'instances' && p[2] && p[3] === 'preparation') return ok(await new MediaPreparationService(e).save(p[2],await jsonBody(request)));
      if (method === 'GET' && p[1] === 'instances') return ok(await e.instances());
      if (method === 'POST' && p[1] === 'instances') return ok(await e.addInstance(await jsonBody(request)), 201);
      if (method === 'GET' && p[1] === 'files') return ok((await s.db.select().from(storedFiles).orderBy(desc(storedFiles.createdAt)).limit(300)).map(f => ({ ...f, role: f.role as 'reference' })));
      if (method === 'POST' && p[1] === 'files') {
        const form = await formBody(request,WRITING_VIDEO_LIMIT+1024*1024), file = uploadedFile(form),mime=writingMediaMime(file.name,file.type)||'application/octet-stream';
        return ok(await s.putFile(new Uint8Array(await file.arrayBuffer()), file.name, mime, 'reference',undefined,undefined,{editorialVideo:true}), 201);
      }
      if (p[1] === 'articles') {
        if (method === 'GET' && !p[2]) {
          const items = await e.list<import('@/packages/contracts/editorial').WritingArticle>('article');
          return ok(items.map(a => ({id:a.id,title:a.title,kind:a.kind,pinned:a.pinned,updatedAt:a.updatedAt,createdAt:a.createdAt,messageCount:a.messages.length})));
        }
        if (method === 'POST' && !p[2]) return ok(await e.create(await jsonBody(request)), 201);
        if (method === 'POST' && p[2] && p[3] === 'references') return ok(await new ArticleMaterialsService(e).references(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'media') return ok(await new ArticleMaterialsService(e).media(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'insert') return ok(await new ArticleMaterialsService(e).insert(p[2],await jsonBody(request)));
        if (method === 'PATCH' && p[2] && p[3] === 'document') return ok(await new WritingDocumentService(e).save(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'proposal') return ok(await new WritingDocumentService(e).proposal(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'restore') return ok(await new WritingDocumentService(e).restore(p[2],await jsonBody(request)));
        if (method === 'GET' && p[2] && !p[3]) return ok(await e.article(p[2]));
        if (method === 'PATCH' && p[2] && !p[3]) return ok(await e.patch(p[2], await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'messages') return ok(await e.send(p[2], await jsonBody(request)), 202);
      }
      throw new AppError(404, '内容接口不存在');
    }
    if (method === 'GET' && p[0] === 'health') return ok({ ok: true, mode: 'local-development', engine: store.engine, version: '0.1.0' });
    if (method === 'GET' && p[0] === 'agents' && p.length === 1) return ok(await agentCatalog(url.searchParams.get('refresh') === '1'));
    if (method === 'GET' && p[0] === 'bootstrap') return ok({ cases: await s.listCases(), profiles: await s.catalog(), runs: await s.listRuns() });
    if (p[0] === 'cases') {
      if (method === 'GET' && p.length === 1) return ok(await s.listCases());
      if (method === 'POST' && p.length === 1) return ok(await s.saveCase(await jsonBody(request)), 201);
      if (method === 'PATCH' && p.length === 2) return ok(await s.saveCase(await jsonBody(request), p[1]));
      if (method === 'PATCH' && p.length === 3 && p[2] === 'metadata') return ok(await s.updateCaseMetadata(p[1], await jsonBody(request)));
    }
    if (p[0] === 'runs') {
      if (method === 'GET' && p.length === 1) return ok(await s.listRuns());
      if (method === 'POST' && p.length === 1) return ok(await s.createRun(await jsonBody(request)), 201);
      if (method === 'GET' && p.length === 2) return ok(await s.getRun(p[1]));
      if (method === 'PATCH' && p.length === 3 && p[2] === 'metadata') return ok(await s.updateRunMetadata(p[1], await jsonBody(request)));
      if (method === 'GET' && p.length === 3 && p[2] === 'live') return ok(await readLiveProgress(await s.getRun(p[1], false)));
      if (method === 'POST' && p[2] === 'demo') { await jsonBody(request); return ok(await startDemo(s, p[1], url.origin), 202); }
      if (method === 'POST' && p.length === 3 && p[2] === 'start-local') { await jsonBody(request); return ok(await startLocalRun(s, p[1], url.origin), 202); }
      if (method === 'GET' && p[2] === 'export') {
        const run = await s.getRun(p[1]), format = url.searchParams.get('format');
        if (format === 'html') return ok({ html: compareHtml(run, url.origin), text: compareMarkdown(run, url.origin) });
        if (format === 'md') return new Response(compareMarkdown(run, url.origin), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${run.id}.md"` } });
        const stream = makeArchive(s, run, url.origin);
        return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="casebench-${run.id}.zip"`, 'Cache-Control': 'no-store' } });
      }
    }
    if (p[0] === 'search' && method === 'GET') return ok(await s.searchResults((url.searchParams.get('q') || '').slice(0, 300), url.searchParams.get('verdict') || 'usable', url.searchParams.get('profile') || ''));
    if (p[0] === 'conversations' && p[1]) {
      const conversations = new ConversationService(s), id = p[1];
      if (method === 'GET' && p.length === 2) return ok(await conversations.get(id));
      if (method === 'POST' && p[2] === 'sync') { await jsonBody(request); return ok(await conversations.synchronize(id)); }
      if (method === 'POST' && p[2] === 'stop') { await jsonBody(request); return ok(await conversations.stop(id)); }
      if (method === 'POST' && p[2] === 'recover') {
        await jsonBody(request); const record = await conversations.get(id), turn = [...record.turns].reverse().find(t => ['pending','running','uploading'].includes(t.attempt.status));
        if (!turn) throw new AppError(409,'没有等待恢复归档的轮次');
        await launchConversation(conversations,turn.id,url.origin,true); return ok({started:true},202);
      }
      if (method === 'POST' && p[2] === 'turns') {
        const body = await jsonBody(request);
        // A lost HTTP response can be retried with the same key without running inference twice.
        const result = await conversations.enqueue(id, body);
        await launchConversation(conversations,result.turnId,url.origin); return ok(result,202);
      }
    }
    if (p[0] === 'attempts') {
      if (method === 'GET' && p.length === 3 && p[2] === 'conversation') return ok(await new ConversationService(s).attach(p[1]));
      if (method === 'POST' && p[2] === 'stop') {
        await jsonBody(request); const item = await s.getAttempt(p[1]);
        if (!['running','uploading'].includes(item.result.status)) throw new AppError(409,'当前没有正在执行的任务');
        if (!['gpt','workbuddy','deepseek','minimax'].includes(sessionAgent(item.model)||'')) throw new AppError(400,'这个 Agent 暂不支持网页停止');
        const directory=path.join(stateDir(),'runs',item.run.id,item.result.id,item.result.attempt!.id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'cancel.json'),'{}');return ok({ok:true});
      }
      if (method === 'GET' && p.length === 2) return ok(await s.getAttempt(p[1]));
      if (method === 'PATCH' && p[2] === 'annotation') return ok(await s.annotate(p[1], await jsonBody(request)));
    }
    if (p[0] === 'files') {
      if (method === 'POST' && p.length === 1) {
        const form = await formBody(request), file = uploadedFile(form);
        const role = form.get('role') === 'reference' ? 'reference' : 'input';
        return ok(await s.putFile(new Uint8Array(await file.arrayBuffer()), file.name, file.type, role), 201);
      }
      if (method === 'GET' && p.length === 2) {
        const f = await s.file(p[1]);
        const bytes = await s.fileBytes(f.id);
        const safeInline = (/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.mime)||isWritingVideo(f.mime)) && url.searchParams.get('download') !== '1';
        const headers: Record<string, string> = {
          'Content-Type': safeInline ? f.mime : 'application/octet-stream',
          'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename="artifact"; filename*=UTF-8''${encodeURIComponent(path.basename(f.name))}`,
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
        };
        const range = request.headers.get('range');
        if (range && safeInline && isWritingVideo(f.mime)) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
          const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
          const end = match[1] && match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
          return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) } });
        }
        return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Length': String(bytes.length) } });
      }
    }
    if (p[0] === 'runner') {
      if (p[1] === 'register' && method === 'POST') {
        const body = await jsonBody(request);
        return ok(await s.registerDevice(typeof body.name === 'string' ? body.name : '本地执行器'), 201);
      }
      const runnerId = await s.authenticate((request.headers.get('authorization') || '').replace(/^Bearer /, ''));
      if (p[1] === 'conversations' && p[2]) {
        const service = new ConversationService(s), id=p[2];
        if (method === 'POST' && (p[3] === 'claim' || p[3] === 'recover')) { await jsonBody(request); return ok(await service.claim(id,runnerId,p[3] === 'recover')); }
        const lease=request.headers.get('x-casebench-conversation-lease')||'';
        if (method === 'POST' && p[3] === 'progress') return ok(await service.progress(id,runnerId,lease,await jsonBody(request)));
        if (method === 'POST' && p[3] === 'complete') return ok(await service.complete(id,runnerId,lease,await jsonBody(request)));
        if (method === 'POST' && p[3] === 'files') {
          const form=await formBody(request),f=uploadedFile(form),fileId=form.get('id');if(typeof fileId!=='string')throw new AppError(400,'缺少产物编号');
          return ok(await service.upload(id,runnerId,lease,new Uint8Array(await f.arrayBuffer()),f.name,f.type,fileId),201);
        }
      }
      if (p[1] === 'runs' && p[2]) {
        const id = p[2], action = p[3];
        if (method === 'POST' && action === 'claim') return ok(await s.claim(id, runnerId));
        const generation = Number(request.headers.get('x-casebench-lease'));
        if (!Number.isSafeInteger(generation) || generation < 1) throw new AppError(400, '缺少运行授权编号');
        if (method === 'POST' && action === 'heartbeat') return ok(await s.heartbeat(id, runnerId, generation));
        if (method === 'POST' && action === 'attempts' && p.length === 4) {
          const body = await jsonBody(request);
          if (typeof body.resultId !== 'string' || (body.retry !== undefined && typeof body.retry !== 'boolean')) throw new AppError(400, '任务参数无效');
          return ok(await s.beginAttempt(id, body.resultId, runnerId, generation, body.retry === true), 201);
        }
        if (method === 'POST' && action === 'attempts' && p[4] && p[5] === 'files') {
          const form = await formBody(request), f = uploadedFile(form), fileId = form.get('id');
          if (typeof fileId !== 'string') throw new AppError(400, '缺少产物编号');
          return ok(await s.uploadArtifact(id, p[4], runnerId, generation, new Uint8Array(await f.arrayBuffer()), f.name, f.type, fileId), 201);
        }
        if (method === 'POST' && action === 'attempts' && p[4] && p[5] === 'complete') return ok(await s.completeAttempt(id, p[4], runnerId, generation, await jsonBody(request)));
      }
    }
    throw new AppError(404, '没有找到这个入口');
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: e.issues.map(i => `${i.path.join('.')} ${i.message}`).join('；') }, { status: 400 });
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    console.error('Casebench API:', e instanceof Error ? e.message : 'unknown error');
    return Response.json({ error: '服务暂时无法处理请求，请重试并检查本地服务日志' }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PATCH };

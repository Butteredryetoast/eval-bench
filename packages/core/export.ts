import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import type { RunRecord } from '../contracts/index';
import type { CasebenchService } from './service';
import { ConversationService } from './conversations';

export const htmlEscape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const mdCell = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
export function csvCell(s: unknown) {
  let v = s === null || s === undefined ? '' : String(s);
  if (/^[\s]*[=+\-@]/.test(v)) v = `'${v}`;
  return `"${v.replaceAll('"', '""')}"`;
}
export function exportRows(run: RunRecord) {
  return run.results.map(r => {
    const c = run.spec.cases.find(c => c.versionId === r.caseVersionId)!;
    const m = run.spec.models.find(m => m.id === r.profileId)!;
    const a = r.attempt;
    return { case: c.title, caseVersion: c.version, caseHash: c.contentHash, profile: m.name, model: a?.reportedModel || m.model, harness: m.adapter, status: r.status, attemptId: a?.id || null, durationMs: a?.durationMs ?? null, inputTokens: a?.usage.inputTokens ?? null, outputTokens: a?.usage.outputTokens ?? null, cost: a?.usage.cost ?? null, currency: a?.usage.currency ?? null, verdict: a?.annotation.verdict ?? null, note: a?.annotation.note || '', text: a?.outputText || '', files: a?.artifacts || [], error: a?.error || '', demo: run.spec.demo };
  });
}
export function compareMarkdown(run: RunRecord, origin = '') {
  const rows = exportRows(run);
  return `# ${run.spec.demo ? '演示运行' : '运行结果'} ${run.id}\n\n创建于 ${run.createdAt}\n\n${run.spec.demo ? '> 本批结果来自本地演示执行器，不代表真实模型表现。\n\n' : ''}| 案例 | 版本 | 模型与工具 | 状态 | 执行耗时 | 判定 | 备注 | 固定结果 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.map(r => `| ${mdCell(r.case)} | v${r.caseVersion} | ${mdCell(r.model)} / ${r.harness} | ${r.status} | ${r.durationMs === null ? '未知' : `${(r.durationMs / 1000).toFixed(2)}s`} | ${r.verdict || '未评审'} | ${mdCell(r.note)} | ${r.attemptId ? `${origin}/a/${r.attemptId}` : ''} |`).join('\n')}\n`;
}
export function compareHtml(run: RunRecord, origin: string) {
  return `<h2>${run.spec.demo ? '演示运行' : '运行结果'}</h2><p>${htmlEscape(run.id)} · ${htmlEscape(run.createdAt)}</p>${run.spec.demo ? '<p>本批结果来自本地演示执行器，不代表真实模型表现。</p>' : ''}<table border="1" cellpadding="8"><thead><tr><th>案例</th><th>模型与工具</th><th>耗时</th><th>判定与备注</th><th>正文</th><th>固定链接</th></tr></thead><tbody>${exportRows(run).map(r => `<tr><td>${htmlEscape(r.case)} v${r.caseVersion}</td><td>${htmlEscape(r.model)} / ${r.harness}</td><td>${r.durationMs === null ? '未知' : `${(r.durationMs / 1000).toFixed(2)}s`}</td><td>${htmlEscape(`${r.verdict || '未评审'} ${r.note}`)}</td><td><pre>${htmlEscape(r.text)}</pre></td><td>${r.attemptId ? `<a href="${htmlEscape(`${origin}/a/${r.attemptId}`)}">查看原始结果</a>` : '尚未执行'}</td></tr>`).join('')}</tbody></table>`;
}
export function makeArchive(service: CasebenchService, run: RunRecord, origin: string) {
  const archive = archiver('zip', { zlib: { level: 5 } });
  const output = new PassThrough();
  archive.on('error', e => output.destroy(e));
  archive.on('warning', e => output.destroy(e));
  archive.pipe(output);
  const rows = exportRows(run);
  archive.append(compareMarkdown(run, origin), { name: 'comparison.md' });
  const keys = ['case', 'caseVersion', 'profile', 'model', 'harness', 'status', 'attemptId', 'durationMs', 'inputTokens', 'outputTokens', 'cost', 'currency', 'verdict', 'note', 'error', 'demo'] as const;
  archive.append(`\ufeff${keys.map(csvCell).join(',')}\r\n${rows.map(r => keys.map(k => csvCell(r[k])).join(',')).join('\r\n')}`, { name: 'metrics.csv' });
  archive.append(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), runId: run.id, spec: run.spec, results: rows.map(({ text, ...r }) => r) }, null, 2), { name: 'manifest.json' });
  for (const r of run.results) {
    const c = run.spec.cases.find(c => c.versionId === r.caseVersionId)!;
    const m = run.spec.models.find(m => m.id === r.profileId)!;
    const folder = `artifacts/${c.id}/${m.id}/${r.attempt?.id || 'not-started'}`;
    if (r.attempt?.outputText) archive.append(r.attempt.outputText, { name: `records/${r.attempt.id}/response.txt` });
    for (const f of r.attempt?.artifacts || []) archive.file(service.filePath(f.id), { name: `${folder}/${f.name}` });
  }
  void (async () => {
    const conversations = new ConversationService(service);
    for (const result of run.results) {
      if (!result.attempt) continue;
      const record = await conversations.attach(result.attempt.id);
      if (!record) continue;
      archive.append(JSON.stringify(record, null, 2), { name: `conversations/${record.id}/conversation.json` });
      for (const turn of record.turns) for (const attempt of [...(turn.previousAttempts || []), turn.attempt]) {
        if (attempt.id === result.attempt.id) continue;
        const folder = `conversations/${record.id}/round-${turn.number}/${attempt.id}`;
        archive.append(attempt.outputText, { name: `${folder}/response.txt` });
        archive.append(JSON.stringify({ prompt: turn.prompt, status: attempt.status, usage: attempt.usage, durationMs: attempt.metadata?.activeDurationMs ?? attempt.durationMs, annotation: attempt.annotation, retryCount: turn.retryCount }, null, 2), { name: `${folder}/metrics.json` });
        for (const file of attempt.artifacts) archive.file(service.filePath(file.id), { name: `${folder}/files/${file.name}` });
      }
    }
    await archive.finalize();
  })().catch(e => output.destroy(e));
  return output;
}

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const origin = 'http://127.0.0.1:43110';
async function api(route, body, method = 'POST', headers = {}) {
  const response = await fetch(`${origin}/api/${route}`, { method, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers }, signal: AbortSignal.timeout(10000) });
  const data = await response.json(); assert.equal(response.ok, true, JSON.stringify(data)); return data;
}
const bootstrap = await api('bootstrap', undefined, 'GET');
const run = bootstrap.runs.find(r => r.spec.demo && r.status === 'completed' && r.spec.cases.length === 2);
assert.ok(run, '需要已有已完成的演示运行');
assert.equal(run.results.length, 4);
assert.ok(run.results.every(r => r.status === 'succeeded' && r.attemptCount === 1));
const form = new FormData();
const fixture = await readFile(new URL('./fixtures/quarterly-sales.csv', import.meta.url));
form.set('file', new Blob([fixture], { type: 'text/csv' }), 'quarterly-sales.csv'); form.set('role', 'input');
const file = await api('files', form);
assert.equal(file.size, fixture.length);
const entry = bootstrap.cases.find(c => c.title === '季度销售简报' && c.prompt === '根据附件中的四季度销售数据，写一段 200 字以内的经营简报。说明总额与变化，不要编造原因。');
if (entry && !entry.inputs.length) {
  const updated = await api(`cases/${entry.id}`, { title: entry.title, prompt: entry.prompt, scene: entry.scene, capabilities: entry.capabilities, artifactType: entry.artifactType, executionMode: entry.executionMode, inputIds: [file.id], referenceId: entry.reference?.id || null, instructions: entry.instructions, expectedVersion: entry.version }, 'PATCH');
  assert.equal(updated.inputs[0].id, file.id);
  assert.equal(updated.version, entry.version + 1);
}
const response = await fetch(`${origin}/api/runs/${run.id}/export`, { signal: AbortSignal.timeout(10000) });
assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/zip/);
const output = path.resolve('output/dev-checks'); await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'verified-run.zip'), Buffer.from(await response.arrayBuffer()));
const blocked = await fetch(`${origin}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
assert.equal(blocked.status, 403);
console.log(JSON.stringify({ run: run.id, results: run.results.length, allAttemptsPreserved: true, uploadBytes: file.size, archive: path.join(output, 'verified-run.zip'), crossOriginMutationBlocked: true }));

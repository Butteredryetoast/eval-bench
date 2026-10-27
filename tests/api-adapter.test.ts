import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { executeAdapter, redact } from '../packages/adapters';
import { publicProfile } from '../packages/core/config';
import type { CaseRecord, LocalProfile } from '../packages/contracts';

test('兼容接口适配器发送锁定参数、保存正文并保留未知成本', { timeout: 10000 }, async () => {
  const received: Record<string, unknown>[] = [];
  const server = http.createServer(async (request, response) => {
    let data = ''; for await (const chunk of request) data += chunk;
    received.push(JSON.parse(data));
    assert.equal(request.headers.authorization, 'Bearer fixture-token-not-a-real-key');
    response.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': 'local-fixture-request' });
    response.end(JSON.stringify({ model: 'fixture-pinned-model-v1', choices: [{ message: { content: '这是本地接口测试返回的正文。' } }], usage: { prompt_tokens: 21, completion_tokens: 13 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.CASEBENCH_FIXTURE_KEY = 'fixture-token-not-a-real-key';
  try {
    const address = server.address() as { port: number };
    const directory = await mkdtemp('/private/tmp/casebench-api-test-');
    const out = path.join(directory, 'out'); await mkdir(out);
    const profile: LocalProfile = { id: 'fixture-api', name: '本地接口测试', vendor: '本地测试服务', model: 'fixture-alias', adapter: 'api', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: 'CASEBENCH_FIXTURE_KEY', color: '#16816b', modes: ['text'], supportsTemperature: true, maxTokens: 256 };
    const entry: CaseRecord = { id: 'fixture-case', versionId: 'fixture-version', version: 1, title: '接口正文', prompt: '返回一段正文', scene: 'writing', capabilities: ['follow'], artifactType: 'copy', executionMode: 'text', inputs: [], reference: null, instructions: '', sample: true, contentHash: 'fixture', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runCount: 0 };
    const result = await executeAdapter({ case: entry, model: { ...publicProfile(profile), temperature: 0.3 }, profile, directory, outputDirectory: out, inputPaths: [], signal: AbortSignal.timeout(5000) });
    assert.equal(received[0].model, 'fixture-alias'); assert.equal(received[0].temperature, 0.3); assert.equal(received[0].max_tokens, 256); assert.equal(received[0].stream, false);
    assert.equal(result.reportedModel, 'fixture-pinned-model-v1'); assert.equal(result.usage.inputTokens, 21); assert.equal(result.usage.outputTokens, 13); assert.equal(result.usage.cost, null);
    assert.equal(await readFile(path.join(out, 'response.md'), 'utf8'), result.text);
    assert.equal(redact('Bearer fixture-token-not-a-real-key', [profile]), 'Bearer [REDACTED]');
  } finally {
    delete process.env.CASEBENCH_FIXTURE_KEY;
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});

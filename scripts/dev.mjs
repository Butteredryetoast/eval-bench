import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const next = path.join(root, 'node_modules/next/dist/bin/next');
try { await access(next); }
catch { console.error('请先在项目目录安装依赖：pnpm install'); process.exit(1); }
// Start the independent collector only for the real workspace, never for isolated QA state.
if (!process.env.CASEBENCH_DATA_DIR) {
  try { await access(path.join(root, 'integrations/hot-monitor/.data/bridge.json'));
    const started = spawnSync(process.execPath, [path.join(root, 'scripts/hotspots.mjs'), 'start'], { cwd: root, env: process.env, stdio: 'inherit' });
    if (started.status !== 0) console.error('热点服务未启动；网站其他功能仍可使用。');
  } catch {}
}
const mode = process.argv.includes('--production') ? 'start' : 'dev';
const hostname = process.env.CASEBENCH_HOST || '127.0.0.1';
const args = [next, mode, path.join(root, 'apps/web'), '--hostname', hostname, '--port', process.env.PORT || '43110'];
if (mode === 'dev') args.push('--webpack');
const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, CASEBENCH_ROOT: root, NEXT_TELEMETRY_DISABLED: '1', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` }, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));

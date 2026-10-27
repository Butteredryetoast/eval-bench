// Local lifecycle only. Private runtime packages and credentials stay under .data/.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  openSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const runtime = join(root, ".data/local-runtime");
mkdirSync(runtime, { recursive: true });
const node = [
  process.env.MONITOR_NODE,
  join(
    homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node",
  ),
  process.execPath,
]
  .filter(Boolean)
  .find((p) => {
    if (!existsSync(p)) return false;
    const v = spawnSync(p, ["--version"], { encoding: "utf8" }).stdout;
    return (
      Number(v?.match(/v(\d+)/)?.[1]) > 24 ||
      (Number(v?.match(/v(\d+)/)?.[1]) === 24 &&
        Number(v?.match(/v\d+\.(\d+)/)?.[1]) >= 11)
    );
  });
if (!node)
  throw Error("需要Node 24.11以上。安装后设置 MONITOR_NODE 为其绝对路径。");
const envFile = join(root, ".env");
const env = {
  ...process.env,
  ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {}),
  NODE_ENV: "production",
  API_HOST: "127.0.0.1",
  WEB_HOST: "127.0.0.1",
  PATH:
    dirname(node) +
    ":" +
    join(root, ".data/postgres-tools/bin") +
    ":" +
    process.env.PATH,
};
const stateFile = join(root, ".data/monitor-processes.json");
let state = {};
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const ready = (port) =>
  new Promise((r) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      r(true);
    });
    s.once("error", () => r(false));
  });
function run(exe, args, extra = {}) {
  const r = spawnSync(exe, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: "inherit",
  });
  if (r.status !== 0) throw Error("命令未成功：" + args[0]);
}
function launch(name, args, cwd = root) {
  if (state[name] && alive(state[name])) return;
  const fd = openSync(join(root, ".data/" + name + ".log"), "a", 0o600);
  const child = spawn(node, args, {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  state[name] = child.pid;
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}
async function database() {
  if (await ready(55432)) return;
  launch("postgres", ["scripts/monitor-postgres.mjs"]);
  for (let i = 0; i < 60; i++) {
    if (await ready(55432)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("数据库启动失败，请查看.data/postgres.log");
}
const command = process.argv[2] ?? "status";
if (command === "restart") {
  if (state.worker && alive(state.worker)) process.kill(state.worker, "SIGTERM");
  for (let i=0;i<120 && state.worker && alive(state.worker);i++)
    await new Promise(r=>setTimeout(r,500));
  if (state.worker && alive(state.worker))
    throw Error("后台仍在结束任务，网页和接口继续运行；稍后再重启。");
  for (const name of ["web", "api"])
    if (state[name] && alive(state[name])) process.kill(state[name], "SIGTERM");
  for (let i = 0; i < 60; i++) {
    if (!["worker", "web", "api"].some((n) => state[n] && alive(state[n])))
      break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (["worker", "web", "api"].some((n) => state[n] && alive(state[n])))
    throw Error("后台仍在结束任务，请稍后再重启；未强制终止付费请求。");
}
if (command === "setup") {
  run("npm", [
    "install",
    "--prefix",
    runtime,
    "embedded-postgres@17.10.0-beta.17",
    "--no-audit",
    "--no-fund",
  ]);
  await database();
  run("sh", ["scripts/monitor-pg-tools.sh"]);
  if (!existsSync(envFile)) {
    const c = JSON.parse(
      readFileSync(join(root, ".data/local-database.json"), "utf8"),
    );
    const password = randomBytes(18).toString("base64url");
    const values = {
      DATABASE_URL:
        "postgres://" +
        c.user +
        ":" +
        c.password +
        "@127.0.0.1:" +
        c.port +
        "/hot_monitor",
      SITE_URL: "http://localhost:3000",
      API_BASE_URL: "http://127.0.0.1:3001",
      ADMIN_PASSWORD: password,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      IMG_PROXY_SIGN_SECRET: randomBytes(32).toString("hex"),
      AIHOT_CREDENTIALS_DIR: ".data/credentials",
      LLM_BASE_URL: "https://api.deepseek.com/v1",
      LLM_MODEL: "deepseek-flash",
      COLLECT_ENABLED: "false",
      MODEL_CALLS_ENABLED: "false",
      FEISHU_CONTENT_PUSH_ENABLED: "false",
      FEISHU_INTERNAL_ENABLED: "false",
      INDEXNOW_SUBMIT_ENABLED: "false",
    };
    writeFileSync(
      envFile,
      Object.entries(values)
        .map(([k, v]) => k + "=" + v)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    writeFileSync(
      join(root, ".data/local-access.txt"),
      "http://localhost:3000/admin/monitor\n热点台免登录，共享编辑。\n",
      { mode: 0o600 },
    );
    Object.assign(env, values);
  }
  mkdirSync(join(root, ".data/credentials"), { recursive: true });
  run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"]);
  run("npx", ["playwright", "install", "chromium", "webkit"]);
  run(node, ["--env-file=.env", "scripts/migrate.ts"]);
  run("npm", ["run", "build", "-w", "@aihot/web"]);
  console.log("准备完成。运行 node scripts/monitor-local.mjs start");
} else if (command === "start" || command === "restart") {
  await database();
  run(node, ["--env-file=.env", "scripts/migrate.ts"]);
  if (!existsSync("apps/web/build/server/index.js"))
    run("npm", ["run", "build", "-w", "@aihot/web"]);
  if (
    (!state.api || !alive(state.api)) &&
    (await ready(Number(env.API_PORT || 3001)))
  )
    throw Error("接口端口已被其他程序占用，请修改.env的API_PORT和API_BASE_URL");
  if (
    (!state.web || !alive(state.web)) &&
    (await ready(Number(env.WEB_PORT || 3000)))
  )
    throw Error("网页端口已被其他程序占用，请修改.env的WEB_PORT和SITE_URL");
  launch("api", ["--env-file=.env", "apps/api/src/main.ts"]);
  launch("worker", ["--env-file=.env", "apps/worker/src/main.ts"]);
  launch("web", ["--env-file=../../.env", "server.ts"], join(root, "apps/web"));
  console.log(
    "已启动：" +
      env.SITE_URL +
      "/admin/monitor\n免登录，共享编辑\n日志：.data/api.log、worker.log、web.log",
  );
} else if (command === "stop") {
  for (const name of ["worker", "web", "api"])
    if (state[name] && alive(state[name])) process.kill(state[name], "SIGTERM");
  for (let i = 0; i < 60; i++) {
    if (!["worker", "web", "api"].some((n) => state[n] && alive(state[n])))
      break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (["worker", "web", "api"].some((n) => state[n] && alive(state[n])))
    console.log("后台仍在结束任务；数据库保留运行，请稍后再执行stop。");
  else {
    if (state.postgres && alive(state.postgres))
      process.kill(state.postgres, "SIGTERM");
    writeFileSync(stateFile, "{}", { mode: 0o600 });
    console.log("已停止应用。");
  }
} else if (command === "check") {
  await database();
  const testEnv = { ...env };
  for (const key of [
    "NODE_ENV",
    "COLLECT_ENABLED",
    "MODEL_CALLS_ENABLED",
    "AIHOT_CREDENTIALS_DIR",
    "ADMIN_PASSWORD",
    "LLM_BASE_URL",
    "LLM_MODEL",
  ])
    delete testEnv[key];
  const u = new URL(env.DATABASE_URL);
  u.pathname = "/hot_monitor_test";
  testEnv.DATABASE_URL = u.toString();
  run("npm", ["run", "typecheck"]);
  const t = spawnSync("npm", ["test"], {
    cwd: root,
    env: testEnv,
    stdio: "inherit",
  });
  if (t.status !== 0) process.exit(t.status ?? 1);
  run("npm", ["run", "build", "-w", "@aihot/web"]);
  run(node, [
    "--test",
    ...(await import("node:fs"))
      .readdirSync("apps/web/tests")
      .filter((x) => x.endsWith(".test.ts"))
      .map((x) => "apps/web/tests/" + x),
  ]);
  run(node, [
    "scripts/smoke.ts",
    "--base",
    env.SITE_URL || "http://localhost:3000",
  ]);
} else
  console.log(
    JSON.stringify(
      {
        node: spawnSync(node, ["--version"], {
          encoding: "utf8",
        }).stdout.trim(),
        databaseReady: await ready(55432),
        apiReady: await ready(Number(env.API_PORT || 3001)),
        webReady: await ready(Number(env.WEB_PORT || 3000)),
        processes: Object.fromEntries(
          Object.entries(state).map(([k, p]) => [
            k,
            { pid: p, running: alive(p) },
          ]),
        ),
      },
      null,
      2,
    ),
  );

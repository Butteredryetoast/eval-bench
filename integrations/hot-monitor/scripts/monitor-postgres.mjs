import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
const root = resolve(import.meta.dirname, "..");
const local = resolve(root, ".data/local-runtime");
const require = createRequire(resolve(local, "package.json"));
const { default: EmbeddedPostgres } = await import(
  pathToFileURL(require.resolve("embedded-postgres")).href
);
await mkdir(resolve(root, ".data"), { recursive: true });
let c;
try {
  c = JSON.parse(
    await readFile(resolve(root, ".data/local-database.json"), "utf8"),
  );
} catch {
  c = {
    user: "hot_monitor",
    password: randomBytes(24).toString("hex"),
    port: 55432,
  };
  await writeFile(
    resolve(root, ".data/local-database.json"),
    JSON.stringify(c),
    { mode: 0o600 },
  );
}
const pg = new EmbeddedPostgres({
  databaseDir: resolve(root, ".data/postgres"),
  user: c.user,
  password: c.password,
  port: c.port,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog() {},
  onError(e) {
    console.error(String(e));
  },
});
if (!existsSync(resolve(root, ".data/postgres/PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='hot_monitor'"))
    .rowCount
)
  await client.query("CREATE DATABASE hot_monitor");
await client.end();
console.log("PostgreSQL 17 ready on 127.0.0.1:" + c.port);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

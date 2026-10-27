import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { sql } from "@aihot/backend/db";
import { assetPath } from "./media.ts";
import { assetsFor, casesFor, eventById, reportsFor } from "./store.ts";
import { exportEvent } from "./domain.ts";
import { displayEvent } from "./chinese.ts";
import { handoffMarkdown,handoffText, selectCases } from "./handoff.ts";
export async function buildBundle(id: string, selectedIds?: string[]) {
  const event = await eventById(id);
  if (!event) throw new Error("事件不存在");
  const cases = selectCases(await casesFor(event.id, true), selectedIds);
  const assets = (await assetsFor()).filter((a) =>
    cases.some((c) => c.id === a.caseId),
  );
  if (assets.reduce((sum, a) => sum + a.bytes, 0) > 100 * 1024 * 1024)
    throw Object.assign(
      new Error("素材包超过100MB，请分批下载附件或导出交接JSON"),
      { statusCode: 400 },
    );
  const reports = (await reportsFor(event.id)).filter(
    (r) => r.active && (!r.expiresAt || Date.parse(r.expiresAt) > Date.now()),
  );
  const experiments = (
    await sql`SELECT data FROM hm_experiments WHERE event_id=${event.id}`
  ).map((r) => r.data).filter(x=>!x.caseId || cases.some(c=>c.id===x.caseId));
  const parent = path.join(config.dataDir, "monitor-exports");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(parent, "bundle-"));
  try {
    const files = path.join(dir, "assets");
    await mkdir(files, { mode: 0o700 });
    const manifestAssets = [];
    const ext: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/webm": "webm",
    };
    for (const asset of assets) {
      const file = "assets/" + asset.id + "." + (ext[asset.mime] ?? "bin");
      await copyFile(assetPath(asset.id), path.join(dir, file));
      manifestAssets.push({ ...asset, file });
    }
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        exportEvent(
          { ...event, summary: reports.length ? event.summary : "" },
          reports,
          cases,
          manifestAssets,
          experiments,
        ),
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(path.join(dir,"交接单.md"), handoffMarkdown(displayEvent(event,reports), reports, cases, manifestAssets, experiments as never), {mode:0o600});
    await writeFile(path.join(dir,"交接单.txt"),handoffText(displayEvent(event,reports),reports,cases,manifestAssets,experiments as never),{mode:0o600});
    const file = path.join(dir, "materials.tar.gz");
    await promisify(execFile)(
      "tar",
      ["-czf", file, "-C", dir, "manifest.json", "交接单.md", "交接单.txt", "assets"],
      { timeout: 60000 },
    );
    return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

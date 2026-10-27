import sharp from "sharp";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { Asset } from "../contracts.ts";
import { caseById, updateCase } from "./store.ts";
import { canonicalUrl } from "./domain.ts";
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export function detectMime(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString())) return "image/gif";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (b.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  if (b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
    return "video/webm";
  return null;
}
export const assetPath = (id: string) =>
  path.join(config.dataDir, "monitor-assets", id);
export async function storeAsset(
  caseId: string,
  bytes: Buffer,
  name: string,
  originUrl: string | null = null,
) {
  if (!(await caseById(caseId))) throw new Error("案例不存在");
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES)
    throw Object.assign(new Error("素材大小必须在1字节至25MB之间"), {
      statusCode: 400,
    });
  const mime = detectMime(bytes);
  if (!mime)
    throw Object.assign(
      new Error("仅支持真实的PNG、JPEG、GIF、WebP、MP4或WebM素材"),
      { statusCode: 400 },
    );
  if (mime.startsWith("image/")) {
    try {
      const info = await sharp(bytes, {
        limitInputPixels: 40000000,
      }).metadata();
      if (!info.width || !info.height) throw new Error();
    } catch {
      throw Object.assign(new Error("图片文件损坏或像素尺寸过大"), {
        statusCode: 400,
      });
    }
  }
  const a: Asset = {
    id: randomUUID(),
    caseId,
    name: path.basename(name).slice(0, 160),
    mime,
    bytes: bytes.length,
    createdAt: new Date().toISOString(),
    originUrl: originUrl ? canonicalUrl(originUrl) : null,
  };
  await mkdir(path.dirname(assetPath(a.id)), { recursive: true });
  await writeFile(assetPath(a.id), bytes, { mode: 0o600, flag: "wx" });
  try {
    await sql`INSERT INTO hm_assets(id,case_id,data) VALUES(${a.id},${caseId},${sql.json(a as never)})`;
  } catch (error) {
    await unlink(assetPath(a.id));
    throw error;
  }
  return a;
}
export async function archiveMedia(caseId: string, index: number) {
  const c = await caseById(caseId);
  const m = c?.media[index];
  if (!c || !m) throw new Error("素材不存在");
  if (m.kind === "link")
    throw new Error("此项为原文入口，请手动上传截图或录屏");
  try {
    const r = await guardedFetch(m.url, {
      maxBytes: MAX_ASSET_BYTES,
      timeoutMs: 45000,
    });
    if (r.status !== 200) throw new Error("素材服务器返回HTTP " + r.status);
    const mime = detectMime(r.body);
    if (
      !mime ||
      (m.kind === "video" && !mime.startsWith("video/")) ||
      (m.kind !== "video" && !mime.startsWith("image/"))
    )
      throw new Error("返回内容不是所需媒体文件，可能是封面或错误页面");
    const a = await storeAsset(
      caseId,
      r.body,
      c.title + (mime.startsWith("video/") ? ".mp4" : ".image"),
      m.url,
    );
    m.status = "verified";
    delete m.error;
    await updateCase(c);
    return a;
  } catch (error) {
    m.status = "failed";
    m.error =
      error instanceof Error && /^素材服务器|^返回内容/.test(error.message)
        ? error.message
        : "素材读取失败，请打开原文或上传录屏";
    await updateCase(c);
    throw new Error(m.error);
  }
}

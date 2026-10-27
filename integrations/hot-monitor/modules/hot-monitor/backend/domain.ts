import { MONITOR_RECENCY_HOURS } from "@aihot/industry/monitor-policy";
import { createHash } from "node:crypto";
import type { Event, Report, Case } from "../contracts.ts";
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Object.assign(new Error("只支持无登录信息的 HTTP/HTTPS 原文链接"), {
      statusCode: 400,
    });
  if (
    u.hash === "#rd" ||
    u.hash === "#main" ||
    /(^|\.)x\.com$|twitter\.com$/.test(u.hostname)
  )
    u.hash = "";
  if (["twitter.com", "www.twitter.com", "www.x.com"].includes(u.hostname))
    u.hostname = "x.com";
  if (u.hostname === "mp.weixin.qq.com") {
    u.protocol = "https:";
    for (const key of [...u.searchParams.keys()])
      if (!["__biz", "mid", "idx", "sn"].includes(key))
        u.searchParams.delete(key);
  } else
    for (const key of [...u.searchParams.keys()])
      if (
        /^(utm_|spm|fbclid|gclid|ref$|source$)/i.test(key) ||
        /token|secret|password|cookie|session|signature|^sign$|^sig$|auth|ticket|(^|_)key$|^x-amz-|^dis_/i.test(
          key,
        )
      )
        u.searchParams.delete(key);
  u.searchParams.sort();
  return u.toString();
}
export function safeExport(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replace(/https?:\/\/[^\s<>"']+/g, (url) => {
        try {
          return canonicalUrl(url);
        } catch {
          return "[已移除不安全链接]";
        }
      })
      .replace(
        /\b(?:Bearer\s+[A-Za-z0-9._~-]+|(?:sk-|JZL)[A-Za-z0-9_-]{12,})\b/g,
        "[已移除凭据]",
      );
  if (Array.isArray(value)) return value.map(safeExport);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/password|secret|cookie|token|credential|authorization|api.?key/i.test(
              key,
            ),
        )
        .map(([key, val]) => [key, safeExport(val)]),
    );
  return value;
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function inferVersion(text: string): string | null {
  return (
    text.match(
      /(?:[A-Za-z][A-Za-z0-9._-]*[- ](?:V?\d[\w.-]*))|(?:V\d[\w.-]*)/i,
    )?.[0] ?? null
  );
}
export function inferField(text: string): string {
  const title = text.split("\n")[0];
  if (/\bAI\b|人工智能|大模型|新模型|模型发布|智能体|\bAgent\b|Harness|OpenAI|Anthropic|Groq|推理框架|DeepSeek|Claude|ChatGPT|GPT[- ]?\d|Gemini|Grok|Voxtral|可灵|即梦|Meshy|Sora|Midjourney|ComfyUI|LLM|机器学习|机器人/i.test(title)) return "AI与大模型";
  if (/iPhone|iOS|iPad|macOS|Apple|苹果|Vision Pro|Photoshop|Adobe|OneDrive/i.test(title)) return "苹果与软件";
  if (/汽车|智驾|座舱|Waymo|Tesla|特斯拉|比亚迪|吉利|秦 PLUS|自动驾驶|车钥匙/.test(title)) return "汽车";
  if (/手机|荣耀|OPPO|vivo|鸿蒙|小米/i.test(title)) return "国产手机";
  if (/游戏|影视|文娱|Nintendo|PlayStation|GTA|Steam|电影|音乐/i.test(title)) return "游戏文娱";
  if (/融资|收购|估值|资本|财报|IPO|收入|营收|商业模式/i.test(title)) return "商业资本";
  if (/职场|岗位|裁员|劳动|工作制|失业/.test(title)) return "职场社会";
  return "待归类";
}
export function classifyFormat(category: string): string {
  return (
    (
      {
        "ai-models": "模型",
        "ai-products": "产品",
        industry: "行业",
        paper: "论文",
        tip: "教程",
        opinion: "观点",
        review: "评测/体验",
      } as Record<string, string>
    )[category] ?? "行业"
  );
}
export function visibleToday(
  report: Pick<
    Report,
    "publishedAt" | "discoveredAt" | "active" | "expiresAt" | "backfill"
  >,
  now = Date.now(),
): boolean {
  const published = Date.parse(report.publishedAt ?? "");
  return (
    !report.backfill &&
    report.active &&
    Number.isFinite(published) &&
    (!report.expiresAt || Date.parse(report.expiresAt) > now) &&
    Date.parse(report.discoveredAt) - published <= MONITOR_RECENCY_HOURS * 3600_000 &&
    now - published <= MONITOR_RECENCY_HOURS * 3600_000
  );
}
export function reportStats(reports: Report[]) {
  const active = reports.filter((r) => r.active);
  return {
    origins: [...new Set(active.map((r) => r.origin))],
    selfArticleScore: active.filter(r=>r.origin==="self" && r.localScore!==null).reduce<number|null>((score,r)=>score===null?r.localScore:Math.max(score,r.localScore!),null),
    sourceCount: new Set(
      active.map((r) => {
        try {
          const u = new URL(r.url);
          return u.hostname === "x.com"
            ? "x:" + u.pathname.split("/")[1].toLowerCase()
            : u.hostname === "mp.weixin.qq.com"
              ? "mp:" + u.searchParams.get("__biz")
              : u.hostname;
        } catch {
          return r.source;
        }
      }),
    ).size,
  };
}
export function caseVersion(
  version: string | null,
  text: string,
): {
  version: string | null;
  verification: Case["verification"];
  versionEvidence: string;
} {
  if (!version)
    return {
      version: null,
      verification: "pending",
      versionEvidence: "事件尚未确认精确版本",
    };
  if (text.toLowerCase().includes(version.toLowerCase()))
    return {
      version,
      verification: "matched",
      versionEvidence: "原文包含事件版本字符串；效果尚未复现",
    };
  const explicit = inferVersion(text);
  const token = explicit?.match(/v?\d[\w.-]*/i)?.[0].replace(/^v/i, "").toLowerCase();
  const expected = version.replace(/^v/i, "").toLowerCase();
  if (token && (expected.startsWith(token + "-") || expected.endsWith("-" + token)))
    return { version: explicit, verification: "pending", versionEvidence: "仅提供模型系列，缺少精确快照或后缀，待确认" };
  return {
    version: explicit,
    verification: explicit ? "mismatch" : "pending",
    versionEvidence: explicit
      ? "原文版本与事件不同，请核对"
      : "原文未提供精确版本，不能用发布时间替代",
  };
}
export const TYPE_WEIGHTS: Record<string, number[]> = {
  model_release: [3, 2, 2, 2, 1],
  product_launch: [2, 2, 1, 2, 3],
  tool_or_prompt: [1, 2, 1, 2, 4],
  research_paper: [5, 3, 1, 0, 1],
  industry_event: [3, 1, 2, 4, 0],
  opinion_analysis: [1, 3, 1, 4, 1],
  tutorial_explainer: [1, 1, 1, 3, 4],
};
export function weightedScore(
  type: string,
  axes: Record<string, number>,
): number {
  const w = TYPE_WEIGHTS[type];
  if (!w) throw new Error("未知内容类型");
  return ["sig", "nov", "cred", "reson", "act"].reduce((sum, k, i) => {
    const n = axes[k];
    if (!Number.isInteger(n) || n < 0 || n > 10)
      throw new Error("评分轴必须为0–10整数");
    return sum + n * w[i];
  }, 0);
}
export function exportEvent(
  event: Event,
  reports: Report[],
  cases: Case[],
  assets: unknown[],
  experiments: unknown[],
) {
  return safeExport({
    schemaVersion: 1,
    kind: "yuan-daxia-event",
    event,
    reports,
    cases: cases.filter((c) => c.saved),
    assets,
    experiments,
  });
}

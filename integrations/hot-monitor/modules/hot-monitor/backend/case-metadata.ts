import { isIP } from "node:net";
import { load } from "cheerio";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { isBlockedAddress, tweetIdFromUrl } from "@aihot/backend/lib/url";
import type { CasePlatform, Medium } from "../contracts.ts";

export interface CaseMetadata {
  title?: string;
  author?: string;
  summary?: string;
  publishedAt?: string;
  media: Medium[];
}

const text = (value: unknown, limit = 300) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
const blockedPage = /^(?:just a moment[.!…]*|attention required.*|access denied.*|security check.*|something went wrong.*|page not found.*|verify (?:that )?you are human.*|(?:log|sign)\s*in(?:\s+(?:(?:to|with)\s+|[-–—|•]\s*).*)?|(?:请先)?登录(?:注册)?(?:\s*[-–—|•].*)?|安全验证|访问验证|环境异常|请完成(?:安全)?验证|访问受限|页面不存在|内容不存在|this (?:post|video|page) (?:is |has been )?(?:unavailable|deleted|removed).*)$/i;
const genericTitle = /^(?:X|Twitter|YouTube|Reddit(?:\s*[-–—:]\s*Dive into anything)?|小红书(?:\s*[-–—]\s*你的生活指南)?|抖音(?:\s*[-–—]\s*记录美好生活)?|微博(?:\s*[-–—]\s*随时随地发现新鲜事)?|微信公众平台|哔哩哔哩(?:\s*[-–—_].*)?|bilibili)$/i;
const missingPage = /^(?:(?:小红书|抖音|微博|哔哩哔哩)\s*[-–—|:]\s*)?(?:你访问的页面不见了|笔记不存在|笔记已删除|内容已删除|内容不存在|该内容无法查看|该内容已被删除|页面不存在|404(?:\s*[-–—|:]?\s*(?:not found|page not found|页面不存在))?|page not found)$/i;
const titleText = (value: unknown) => { const title = text(value); return title.length >= 2 && !blockedPage.test(title) && !genericTitle.test(title) ? title : ""; };

function publicLink(value: unknown, base: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const url = new URL(value, base);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || (isIP(host) && isBlockedAddress(host))) return;
    if ([...url.searchParams.keys()].some(key => /token|secret|password|cookie|session|signature|^sign$|^sig$|auth|ticket|(?:^|_)key$|^x-amz-/i.test(key))) return;
    url.hash = "";
    return url.toString();
  } catch { return; }
}

// Only unambiguous, timezone-bearing dates are adopted; the reader never guesses a page's timezone.
function published(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) return;
  const day = value.trim().slice(0, 10);
  const calendar = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function parseCaseMetadata(html: string, url: string, maxImages = 8): CaseMetadata {
  const $ = load(html);
  const meta = (key: string) => $("meta").filter((_i, node) => [$(node).attr("property"), $(node).attr("name")].some(v => v?.toLowerCase() === key.toLowerCase())).map((_i, node) => $(node).attr("content") ?? "").get();
  const documentTitle = text($("title").first().text());
  if(missingPage.test(documentTitle)||missingPage.test(text($("h1").first().text())))throw new Error("原文页面不存在或内容已删除，未提取标题与封面");
  if (blockedPage.test(documentTitle) || blockedPage.test(text($("h1").first().text()))) throw new Error("原文要求登录或安全验证，未读取案例信息；可稍后重新提取或打开原文");
  const nodes: Record<string, unknown>[] = [];
  const collect = (value: unknown, depth = 0) => {
    if (depth > 6 || nodes.length >= 100) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 100)) collect(item, depth + 1); }
    else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
      if (types.some(type => typeof type === "string" && /^(?:Article|NewsArticle|BlogPosting|SocialMediaPosting|DiscussionForumPosting|VideoObject)$/i.test(type.replace(/^https?:\/\/schema\.org\//i, "")))) nodes.push(item);
      collect(item["@graph"], depth + 1);
      collect(item.mainEntity, depth + 1);
    }
  };
  $("script[type='application/ld+json']").each((_i, node) => { try { collect(JSON.parse($(node).text())); } catch { /* Invalid structured data does not invalidate ordinary HTML metadata. */ } });
  const structured = nodes[0];
  const title = [...meta("og:title"), ...meta("twitter:title"), structured?.headline, structured?.name, documentTitle, $("h1").first().text()].map(titleText).find(Boolean);
  if (!title) throw new Error("未取得有效案例标题，页面可能仅提供登录入口或动态内容；可稍后重新提取或打开原文");
  const authorValue = structured?.author;
  const authors = (Array.isArray(authorValue) ? authorValue : [authorValue]).map(value => typeof value === "string" ? value : value && typeof value === "object" ? (value as Record<string, unknown>).name : "").map(value => text(value, 200)).filter(Boolean);
  const author = [...meta("author"), ...meta("article:author"), ...authors].map(value => text(value, 200)).find(Boolean);
  const summary = [...meta("og:description"), ...meta("twitter:description"), ...meta("description"), structured?.description].map(value => text(value, 30000)).find(Boolean);
  const publishedAt = [...meta("article:published_time"), ...meta("datePublished"), structured?.datePublished, $("time[itemprop='datePublished'][datetime]").first().attr("datetime")].map(published).find(Boolean);
  const image = structured?.image;
  const images = (Array.isArray(image) ? image : [image]).map(value => typeof value === "string" ? value : value && typeof value === "object" ? (value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl : undefined);
  const media: Medium[] = [...new Set([...meta("og:image"), ...meta("og:image:url"), ...meta("twitter:image"), ...meta("twitter:image:src"), ...images].map(value => publicLink(value, url)).filter((value): value is string => Boolean(value)))].slice(0, maxImages).map(value => ({kind: "image", url: value, status: "candidate"}));
  return {title, ...(author ? {author} : {}), ...(summary ? {summary} : {}), ...(publishedAt ? {publishedAt} : {}), media};
}

async function oembed(endpoint: URL, platform: "youtube" | "x", url: string): Promise<CaseMetadata> {
  const response = requireOk(await guardedFetch(endpoint.toString(), {headers: {accept: "application/json"}, timeoutMs: 15000, maxBytes: 512 * 1024, maxRedirects: 3}), "公开嵌入信息");
  let data: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(response.text());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    data = value as Record<string, unknown>;
  } catch { throw new Error("公开嵌入接口未返回有效信息，可稍后重新提取或打开原文"); }
  // X's HTML is fallback text, never executed. It does not guarantee an image or video URL.
  const $ = load(typeof data.html === "string" ? data.html : "");
  const summary = platform === "x" ? text($("blockquote p").first().text(), 30000) : "";
  const title = titleText(platform === "x" ? summary : data.title);
  if (!title) throw new Error("原帖未公开可读的标题或文字，可稍后重新提取或打开原文；未执行登录或验证操作");
  const author = text(data.author_name, 200);
  const thumbnail = platform === "youtube" ? publicLink(data.thumbnail_url, url) : undefined;
  return {title, ...(author ? {author} : {}), ...(summary ? {summary} : {}), media: thumbnail ? [{kind: "poster", url: thumbnail, status: "candidate"}] : []};
}

export async function readCaseMetadata(rawUrl: string, platform: CasePlatform): Promise<CaseMetadata> {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("只支持无登录信息的HTTP/HTTPS原文链接");
  if (platform === "youtube") {
    const host = url.hostname.toLowerCase();
    if (!(host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"))) throw new Error("请提供YouTube原始视频链接");
    const id = host === "youtu.be" ? url.pathname.split("/")[1] : url.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("未识别到YouTube视频ID，请提供单条视频链接");
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", "https://www.youtube.com/watch?v=" + id);
    endpoint.searchParams.set("format", "json");
    return oembed(endpoint, "youtube", url.toString());
  }
  if (platform === "x") {
    const id = tweetIdFromUrl(url.toString());
    if (!id) throw new Error("请提供X原帖链接，账号主页不能提取为单条案例");
    const endpoint = new URL("https://publish.x.com/oembed");
    const post = new URL(url.toString()); post.protocol = "https:"; post.hostname = "x.com"; post.search = ""; post.hash = "";
    endpoint.searchParams.set("url", post.toString());
    endpoint.searchParams.set("omit_script", "true");
    endpoint.searchParams.set("hide_thread", "true");
    return oembed(endpoint, "x", url.toString());
  }
  const response = requireOk(await guardedFetch(url.toString(), {headers: {accept: "text/html,application/xhtml+xml"}, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3}), "案例公开网页");
  const final = new URL(response.url);
  if (/\/(?:login|signin|sign-in|checkpoint|captcha)(?:\/|$)/i.test(final.pathname)) throw new Error("原文跳转至登录或验证页面，可稍后重新提取或打开原文");
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("原文不是可读取的公开HTML页面，可稍后重新提取或打开原文");
  return parseCaseMetadata(response.text(), response.url);
}

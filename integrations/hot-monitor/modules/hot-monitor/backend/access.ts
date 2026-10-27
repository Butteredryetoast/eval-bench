import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { config } from "@aihot/backend/config";
import { redactProviderError } from "./providers.ts";

// The workspace is shared without identities. Cross-site forms must not trigger paid work.
export function sharedHandler(fn: (req: FastifyRequest, reply: FastifyReply, actor: string) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.headers["sec-fetch-site"] === "cross-site" ||
          (req.headers.origin && req.headers.origin !== new URL(config.siteUrl).origin))
        return reply.code(403).send({ detail: "请从热点监测页面提交操作" });
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? ""))
        return reply.code(400).send({ detail: "请使用JSON提交操作" });
    }
    try {
      return await fn(req, reply, "shared-editor");
    } catch (error) {
      if (error instanceof ZodError)
        return reply.code(400).send({ detail: error.issues.map(i => `${i.path.join(".") || "请求"}: ${i.message}`).join("; ").slice(0, 300) });
      const status = (error as { code?: string })?.code === "conflict" ? 409 :
        (error as { statusCode?: number })?.statusCode === 400 || error instanceof SyntaxError ? 400 : 500;
      const detail = redactProviderError(error);
      if (status === 500) req.log.error({ path: req.url.split("?")[0], message: detail }, "monitor api error");
      return reply.code(status).send({ detail: status === 500 ? "处理失败，请检查运行状态后重试" : detail });
    }
  };
}

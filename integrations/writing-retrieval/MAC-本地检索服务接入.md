# Mac 本机检索服务与网站迁移说明

本包把网站代码与运行数据分开：代码可迁移、合并和部署；原 Obsidian 知识库、完整 SQLite 向量索引、FastEmbed 模型和缓存继续保存在当前 Mac。没有把它们复制进本包。配置目标机或本机路径时以现有文件为准。

## 留在 Mac 上的数据

- Obsidian Vault：`/Users/mac/Documents/Obsidian Vault`
- 写作库：`公众号写作结构库`
- 主 RAG 数据目录：`/Users/mac/Documents/Codex/2026-10-22/wo/writing-workflow/.rag-cache`
- 向量数据库：`.rag-cache/index-f64012467e24.sqlite`，约 918 MiB；已索引5,858篇文章、27种结构及蓝图，共93,601个段落。
- 两个FastEmbed模型：中文向量模型约90 MiB；中文重排模型约544 MiB。

后端通过 `.env` 中的 `OBSIDIAN_VAULT_PATH`、`OBSIDIAN_LIBRARY_PATH`、`RAG_CACHE_DIR` 和 `RAG_MODELS_DIR` 读取这些目录。保持Vault只读；新增和修改内容由现有增量索引流程处理。

## 网站和后端代码

`project/` 包含 React前端、Node API、Python检索worker、Humanizer-zh规则、资讯蓝图协议、安装/构建脚本、锁文件和测试。它不带 `node_modules/`、`.venv-rag/` 或模型/索引；换机器时按该机器的操作系统重装依赖。

当前API是 `server/start.mjs`，默认监听本机回环地址 `127.0.0.1:8787`。它只提供API，没有独立托管前端静态文件的生产Web服务器。Vite的5173端口是开发预览，请勿把开发服务器直接暴露到公网。

## 建议拓扑

```text
浏览器 ── HTTPS ── 网站主机/静态站点
                       │ 同源 /api 反向代理
                       │ 私人组网隧道
                       ▼
              Mac 上的 Node API :8787
                       ├── 本机 Obsidian Vault（只读）
                       ├── 本机 SQLite 向量索引
                       └── 本机 FastEmbed 模型与 Python worker
```

这样网页代码可以合并到另一项目，重检索仍由Mac执行。网站主机用HTTPS托管 `dist/client`；它把同源 `/api` 转发到Mac的API。转发路径应经过私人组网隧道或等效访问控制。API请求通过同一个网站域名，避免让浏览器直接访问Mac内网地址。

API只监听 `127.0.0.1` 时，隧道端需要在Mac侧接入本地回环API。不要为省事把 `HOST` 改成 `0.0.0.0` 后直接暴露8787。

## 发布前仍需处理的访问控制

当前项目没有用户登录和API鉴权。仅把网站设为公开，并让它把 `/api` 转发到Mac，会让任何访客都可能调用模型、消耗DeepSeek额度或检索用户库内容。公网发布前应在反向代理和API入口增加登录鉴权、访问限额及日志脱敏；或将整站限制在可信的私人网络中。HTTPS不会代替登录鉴权。

推荐ID保存在API进程内，默认30分钟；先用单个API进程，避免请求被分发到另一个没有推荐缓存的进程。对话和版本保存在浏览器 `localStorage`，它们不会随源码包迁移。

## 合并和验证顺序

1. 把 `project/src/`、`project/public/`、`project/server/`、`project/scripts/` 以及根目录构建配置合并到目标站点；对方已有框架或依赖时不要直接替换它的 `package.json` 和锁文件。
2. 保留前端对 `/api/` 的同源请求；让目标站点反向代理 `/api` 到Mac端的API。不要在浏览器代码里放DeepSeek密钥或模型/知识库目录。
3. Mac服务端使用它现有的 `.env`、`.rag-cache` 和Obsidian路径；绝不把真实 `.env` 复制进压缩包、代码仓库或静态站点。
4. 在目标操作系统上执行 `npm ci`，按 `server/rag/requirements.txt` 建立Python环境；Mac上的 `node_modules` 与Python虚拟环境不跨系统复制。
5. 合并后运行 `npm test`、`npm run build` 和 `npm run test:sites`。用拦截的模拟provider先验收登录边界、三方向推荐、单次写作、素材依赖与引用；无需真实DeepSeek调用。

代码包不等于可安全公开的成品服务。首先确定网站只对指定成员开放，或完成登录与API授权，再配置实际的TLS和隧道端点。

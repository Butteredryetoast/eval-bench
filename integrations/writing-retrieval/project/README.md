# Eval Bench · 选题与写作

按照 Figma「内容工作流 · v1」的选题与写作页面实现。独立项目，保留旧网站与拆解源文件；资讯试点仅在 Obsidian 新增五张已批准的叙事蓝图。

## 使用

本地预览：http://127.0.0.1:5173

1. 在选题池点击「添加选题」，粘贴热点、相关事实与来源链接。原型自带的选题明确标注为示例，不是真实新闻。
2. 勾选一条或多条选题，点击「带入 AI 写作」。也可直接新建对话输入热点。
3. 在底部文章类型中选体裁、模板，在引用弹窗增删资料。链接只保留出处，本版不自动读取网页，请粘贴关键原文。
4. 点击「匹配三个写作方向」，查看角度、结构、材料缺口及结构案例。明确选择一个方向，再点击「生成草稿」。
5. 草稿打开后可直接编辑，或继续对话修改。缺少实测/案例时留下具体素材位；各次生成、编辑保存及恢复均保留版本。
6. 复制正文及来源，或导出 Markdown / HTML。文章和选题保存在当前浏览器，重要稿件请导出。

## DeepSeek 本地配置

复制 `.env.example` 为 `.env`，在本地填写 `DEEPSEEK_API_KEY`。不要在聊天中发送密钥。配置后重启接口服务；设置弹窗的「检查连接」检查服务配置状态，不会消费一次模型调用。它不校验密钥有效性，实际调用才会得到授权结果。

```dotenv
DEEPSEEK_API_KEY=填写你自己的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
PORT=8787
OBSIDIAN_VAULT_PATH="/Users/mac/Documents/Obsidian Vault"
OBSIDIAN_LIBRARY_PATH="公众号写作结构库"
```

## Obsidian 知识库

网页直接只读连接现有 Obsidian Vault 中配置的写作结构库，不需要手工导出。默认 Vault 路径为 `/Users/mac/Documents/Obsidian Vault`，库目录为 `公众号写作结构库`；如位置不同，在 `.env` 中设置 `OBSIDIAN_VAULT_PATH` 和相对于 Vault 的 `OBSIDIAN_LIBRARY_PATH`。检索会检查文件变化，因此新增、修改和删除的笔记会在下次检索或状态刷新时反映到网页。

知识库包含可检索的原文与拆解资料；设置页分别显示总资料数、当前已拆解数、结构数和独立复核数。这些数量随 Vault 内容变化。5858 是来源语料规模的说明，不代表已复核数量；1000 篇拆解是当前数据快照的规模，不是系统上限。搜索使用本地检索模型，不需要 DeepSeek 密钥，也不增加远程模型调用。结构案例可从网页直接打开对应的 Obsidian 笔记。

后续继续在 Obsidian 中维护即可：原文放在现有「文章」目录，结构定义在「结构」目录，普通方法笔记也会纳入搜索。原文和最高版本的累计全文拆解按文章 ID 合并，2023 年前文章不参与匹配；重复 ID 采用最近编辑的同类笔记并提示。原文里旧自动分类的说明不会代替正文进入匹配片段。若确认方向后知识库发生变化，网页会要求重新匹配，以免沿用过期结构。

本地网页连接本机 Vault。部署到云端时，仍需配置持续同步的 Vault 副本或本机连接服务；当前项目没有提供云端知识库同步。

## Haystack + FastEmbed RAG 检索

现有 Node API 已接入 Haystack 检索管线，FastEmbed 在本地执行中文向量与重排模型。实时 Obsidian 原文、拆解、结构卡、方法笔记 → 清洗与分段 → SQLite BM25 + 中文向量召回 → RRF 合并、文章去重 → 中文重排 → DeepSeek 推荐三个方向 → 确认结构 → 单次起草。这是项目的检索增强生成（RAG）链路。

当前电脑使用 `RAG_ENGINE=haystack`；索引保存在项目自己的 `.rag-cache/`，运行时只读 Vault。首次全库索引较慢；后续查询检查变动，仅为变化片段计算向量，删除的笔记也会移出索引。原文候选与已有拆解保持区分；清洗排除复核日志与推广段落。配置为 Haystack 后，故障会明确报错，未完成索引会提示进度。

新环境可运行 `npm run rag:setup` 安装隔离 Python 环境、下载并校验固定版本中文 ONNX 模型，再运行 `npm run rag:index` 建立当前 Vault 的索引。配置及模型、资源、质量边界见 [Haystack RAG 说明](docs/haystack-rag.md)。旧词面检索仍可通过 `RAG_ENGINE=local` 显式选择，规则存档在 [旧版检索说明](docs/local-retrieval.md)。不需要腾讯云 ES、GPU 或额外 API 密钥。

本地模型不产生 API 费用；召回片段计入原有 DeepSeek 请求的输入 token。结构匹配与生成质量仍需用真实热点评价，不能把重排分数当作准确率。

## 内置写作润色

已按用户选择内置 [Humanizer-zh](https://github.com/op7418/Humanizer-zh)，直接用于起草和改稿。DeepSeek 在同一次回答中成稿并按规则自检，只返回最终文章，无需手动输入 skill 名称。每次生成、改稿各一轮模型调用，不再另发润色请求；规则文本仍会计入输入 token。方向推荐仍为一轮。

原始规则和 MIT 许可保存在 `server/skills/humanizer-zh/`，固定版本并记录来源。结构与来源 ID 仍由后端校验，事实、限定与素材位保真按规则处理并由作者审阅。已有文章可直接在对话中要求「按 Humanizer-zh 润色，保留原意与结构」，同样只发起一次改稿调用。完整接入与验证记录见 `docs/humanizer-integration.md`。

默认模型和 OpenAI 兼容接口依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/)；可按自己账号的可用模型修改 `DEEPSEEK_MODEL`。密钥只由后端读取。JSON 输出按 [官方 JSON 模式](https://api-docs.deepseek.com/guides/json_mode/)调用，并在服务端检查字段、结构、来源和完整性；失效推荐会拒绝继续生成。最终事实与引用仍须人工核验。

## 开发与验证

Node 24 和 Python 3.11+（本机已验证 Python 3.12），安装依赖后运行 `npm run dev`，会启动本地网页5173和API8787；仅监听本机。`npm test` 运行 Node 行为与 HTTP 集成测试，`npm run test:rag` 检查真实 SQLite FTS/向量缓存行为，`node scripts/qa-rag-live.mjs` 用临时 Vault、真实本地模型和模拟生成接口验证接线（不产生 API 费用），`npm run build` 构建网页，`npm run test:sites` 检查模板托管产物。

项目保留 Sites starter 的静态托管构建文件；**Node API 并未部署到 Sites Worker**，不能只上传静态 dist 就认为写作API可用了。当前没有登录、云同步或云存储。后续云端部署需要一台支持 Node 的主机、同源反向代理、用户访问控制及对话持久化；目前的对话保存在浏览器，服务端推荐缓存30分钟。

2026-10-26 已配置本地 DeepSeek 密钥并重启接口，官方模型列表和一次最小真实模型调用均成功；正常网页接口确认模型已配置、Obsidian 已连接。实际热点写作质量仍需试稿验收。测试中的 HTTP 模拟服务与正常服务隔离：`node scripts/qa-server.mjs` 启动API8788 / 模拟provider8990；另运行 `npx vite --config vite.qa.config.mjs --host 127.0.0.1` 打开5174测试页，生成稿均带「验收示例」标识。正常5173服务没有模拟回退。

- `server/`：DeepSeek客户端、Obsidian只读接入、检索与本地启动。
- `src/`：选题池、对话、推荐卡和草稿面板。
- `docs/design-qa.md`：视觉与功能验收记录。
- `docs/live-obsidian-qa.md`：Obsidian 实时连接的测试、实际库检查及本轮验收边界。

缩略图来自用户给定原型的实际截图裁切，只用于原型示意。没有把它们当成新热点原文封面。

2026-10-27，本机 Haystack/FastEmbed 全库索引已完成并启用：5,858 篇文章、27 种结构、93,573 个段落。真实 API 四类检索及来源检查通过；经 SQL 查询优化，同组输入首次约 12 秒、后续约 5–7 秒（单次抽查）。79 项 Node 测试、5 项 Python SQLite/向量测试和网页构建通过；本次未增加真实 DeepSeek 付费调用。完整证据与已知漏召记录在 `docs/haystack-rag.md` 及其 QA 链接中。

## 资讯叙事蓝图试点

已在现有 Obsidian「叙事蓝图/资讯」新增五张卡：选择解释、更新主线、压力与应对、场景演示、争议与回应。方向卡展示有序叙事、素材作用和具体缺口；原文、旧分析与27种结构保留。资讯起草使用固定片段顺序：缺料处留下素材位，依赖它的判断留待补写；材料齐全允许没有占位。手动改稿使用局部编辑保留未修改的作者文字，旧会话仍可查看/编辑。新增或修改蓝图后，下次刷新/检索自动生效，旧推荐需重新匹配。

推荐与每次起草/改稿仍各一轮 DeepSeek 调用，Humanizer 同轮使用；新增规则仍占输入 token。说明、编辑格式和验收边界见 [资讯接入记录](docs/news-narrative-integration.md)。`node scripts/qa-news-narrative.mjs` 使用真实 Vault/本地模型和本地模拟 provider，不消耗真实 DeepSeek 额度。

# Haystack + FastEmbed 本地 RAG

2026-10-27。用户要求先在电脑测试，最终再考虑之前的服务器。本次只修改、运行本机项目；没有部署服务器，也没有恢复 WeKnora。

## 架构与分工

Haystack 是可以编排 RAG 的框架；FastEmbed 提供本地向量与重排推理。项目复用现有 DeepSeek 写作接口，组成完整链路：

```text
只读 Obsidian → 清洗与分段 → SQLite FTS5 + sqlite-vec 持久索引
热点及已粘贴资料 → BM25 + FastEmbed 中文向量 → Haystack RRF
→ 文章去重 → FastembedRanker 中文重排 → 来源校验与上下文补全
→ DeepSeek 单次推荐三个方向 → 用户确认 → 单次起草 / 单次改稿
```

实际使用官方 `FastembedDocumentEmbedder`、`FastembedTextEmbedder`、`FastembedRanker` 和 Haystack `Pipeline`、`DocumentJoiner`。Node 通过私有 JSONL 标准输入输出管理 Python 子进程，没有新增对外 HTTP 端口。SQLite 文件只放在项目缓存目录；不需要 Elasticsearch、GPU、Torch 或额外 API 密钥。

## 实时知识库与索引

- 来源仍是现有 Vault：当前 5,858 篇原文、1,000 篇全文拆解、27 种结构、11 篇方法笔记。364 篇独立复核是质量元数据，不是额外原文数量。2023 年前文章继续排除。
- 使用原有只读加载器选择最高累计拆解版本、按文章 ID 合并；不读取固定 1,000 篇导出作为替代库。
- 清洗正文、保留标题与小节，将分析中的复核日志、模型名、执行记录和推广内容排除。清洗不会修改 Vault；来源路径和 Obsidian 链接保留在独立元数据中。
- 按小节生成最多 360 个 UTF-16 单元的片段，交叠 48，避免切断表情字符。向量输入为标题前 60 字、小节前 60 字和片段。正文和拆解分别索引，候选原文不伪装成已拆解证据。
- 每次查询检查 Vault 快照。源摘要未变跳过；变化的源重建片段，模型与文本摘要相同的片段复用向量缓存。删除仅作用于项目索引，不删除 Vault 笔记。
- 单写者锁阻止网页与命令行重复建立同一索引；每份源替换是事务，更新过程中清空已提交版本。完整清单校验通过后才提交新版本，查询必须匹配它；中断可重跑续建。
- 返回片段必须通过当前清单的源摘要、父文章和路径映射校验，过时或已删除的缓存片段不能进入提示词。

首次全库索引是较重的离线工作。网页设置显示处理进度；此时匹配返回 `RAG_INDEXING`，不是假装搜索结果为空。后续普通编辑只重算变化片段，大量新文章仍需要等待处理。

## 检索规则与限制

1. BM25 使用 jieba 分词、SQLite FTS5，标题与正文权重为 3:1；查询最多采用前 80 个去重信息词。实际粘贴正文参与查询，链接不抓取。
2. 中文 BGE 生成 512 维向量，sqlite-vec 做余弦 KNN。语义描述最多 440 个 Unicode 字符；长描述有引用时取描述前 180 字及前 4 条资料的均分摘录，保留各条参与机会。更多或更后面的信息会有截断，原有生成请求仍获得用户实际提交资料。
3. 当前选定体裁先用于限定文章；未复核的旧体裁仍可能误分，跨体裁可用文章可能漏召。关键词和向量各召回最多 60 个段落，Haystack 按 RRF 合并前 100 个段落，再取最多 20 篇不同文章重排。长文章不重复占最终名额。
4. 中文交叉编码器依据查询、标题、小节和片段重新排序。结构卡会合并为完整短卡再判断；不将单个边界句当作整张卡。文章和结构/方法笔记分两次本地检索，方法笔记不受空体裁字段阻挡；当前体裁全部结构定义仍交给 DeepSeek。
5. 默认原始重排分数下限为 `-5`，是临时工程设置，**不是概率、准确率或经过充分人工标注的标准**。已观察到相关转述被过滤的情况；调整应同时比较漏召和错误入选，不能为某条样例过拟合阈值。搜索返回的是接受的候选窗口，不声称全库相关总数。
6. 命中补入同小节相邻片段，以及同一篇文章的原文/拆解互补片段，最多 4 段。显示实际关键词/语义通道、是否真正重排、片段出处；`vectorSearch=true` 表示有该能力，`rerankApplied` 才表示本次运行了重排。
7. 无通过筛选的案例时允许返回空案例，DeepSeek 只可参考结构定义并说明材料缺口。故障不静默回退旧 BM25，也不把失败包装成空命中。初始或增量索引若超过页面等待时间，后台可以继续建立索引；页面连接已关闭则不再启动付费推荐调用。

历史文章只参考结构和写法。本次热点事实仍只来自用户粘贴资料；不能复用历史作者经历、数字和引文冒充新素材。Humanizer-zh 保持同一次写作调用内执行。

## 固定模型与费用

模型文件由 `server/rag/models.json` 固定仓库版本；下载时对照仓库 blob/LFS 哈希验证，完整通过才生成就绪标记。正常检索 `local_files_only=true`，不上传笔记、不动态下载模型，Haystack/Hugging Face 遥测关闭。

| 用途 | 本地模型 | 固定版本 | 许可 |
| --- | --- | --- | --- |
| 中文向量 | BAAI/bge-small-zh-v1.5，Qdrant ONNX | `46fbe35fd4374a00fee7de77dfddaeb6dd6a2c59` | MIT |
| 中文重排 | BAAI/bge-reranker-v2-m3-int8，onnx-community | `6f5ff65298512715a1e669753bc754d2bc8f367b` | Apache-2.0 |

向量 ONNX 约 95 MB，重排 ONNX 约 571 MB，另有 tokenizer。下载断流有范围续传与最终完整哈希校验。正式索引始终使用上表的同一模型。

本地推理不产生 DeepSeek API 费用；检索调用数通过 `remoteModelCalls=0` 表示。推荐、起草、改稿仍各一次远程调用，带入的案例和 Humanizer 规则仍计入输入 token。功能测试使用模拟生成接口，不为验收额外调用付费生成模型。

## 配置与维护

依赖固定在 `server/rag/requirements.txt`，隔离安装至 `.venv-rag/`。缓存、模型与虚拟环境均已忽略；API 密钥只在本地 `.env`，不放在网页或文档。

```sh
npm run rag:setup
npm run rag:index
npm run dev
```

`rag:setup` 使用 Python 3 建立隔离环境，安装依赖并校验模型；本机已验证 Python 3.12。`RAG_PYTHON` 可指定解释器。主要配置：

```dotenv
RAG_ENGINE=haystack
RAG_THREADS=2
RAG_RANK_CANDIDATES=20
RAG_MIN_RERANK_SCORE=-5
```

缓存和模型默认是项目 `.rag-cache/` 与 `.rag-cache/models/`；可分别通过 `RAG_CACHE_DIR`、`RAG_MODELS_DIR` 指定。`RAG_ENGINE=local` 显式选择旧版词面检索。检索工作进程串行执行，限制 ONNX 线程数和重排候选，避免同时加载多个大型重排会话。初始命令行索引本机使用 4 线程，常驻 API 使用 2。

## 验证与实际边界

`npm test` 检查 Node/API 合约、实时更新、来源限制、单次写作调用等。`npm run test:rag` 使用真实 SQLite FTS5/sqlite-vec 和确定性向量夹具验证事务、删除、体裁过滤和失败保留旧源；它不代表模型语义质量。

`node scripts/qa-rag-live.mjs` 使用临时 Vault 和实际本地中文模型，验证纯语义匹配、HTTP 推荐接收真实片段、编辑/删除后的真实索引变化、无关控制查询；生成接口模拟，不产生费用。结果在 `docs/qa/haystack-live.json`。其中三条转述的两条通过当前阈值，一条已记录为漏召；这组很小的受控样例不能作为准确率评价。

100 篇真实文章的抽查已跑通视频工具测评、私有知识库教程、大模型上下文科普，取回实际原文/拆解与 Obsidian 链接。样本索引约 2,337 个段落，首次建立约 105 秒；当时单独运行的三组文章与结构检索合计约 6–12 秒/组。随后与全量索引同时运行会更慢，不能作为日常响应时长承诺。

全库已经完成并在正常 API 启用：6,896 份原文/拆解/结构/方法文件、5,858 个文章 ID、27 种结构，共 93,573 个段落；版本与当前 Vault 一致，没有清洗后为空的原文。状态与实际结果在 `docs/qa/haystack-full.json`。

全库初次检查为 29–46 秒/条。cProfile 定位到 BM25 的临时全量排序，以及补上下文时重复扫描全库；按 SQLite 官方 FTS5 `rank` 排序方式保留标题/正文权重，并将父文章的上下文查询约束到它的 rowid 集合。无需重新计算向量。优化后的同四条输入、同模型、同快照、同返回 ID 与顺序，分别约 12.1、6.7、6.6、4.9 秒，包含第一次冷启动；无关控制返回 0 条。对照在 `docs/qa/haystack-performance.json`。这是本机单次抽查，不是性能承诺，也不是相关性准确率评价。

最终 79 项 Node 测试、5 项 Python SQLite/向量测试通过，网页生产构建通过。受控真实模型测试确认单次模拟生成调用拿到实际检索片段，并验证真实索引编辑/删除；真实 Vault 全库测试只调用本地查询，未发生付费 DeepSeek 调用。

优化后的全库测试，检索 Python 进程记录的峰值 RSS 约 667 MiB；Node 读取真实 Vault 另有内存开销。更长输入、并发及未来服务器资源仍需另测。

网页布局只加检索状态和实际命中说明，沿用既定 Figma。正常网页 HTTP 200，已请求打开预览。本机 Work 设置仍禁用了浏览器控制，因此没有声称完成设置弹窗的浏览器视觉复验。

本次没有证明达到 ima 的写作质量。下一轮应保留 20–30 个真实热点的人工可接受案例与结构，并分离调参与保留测试题，比较 Top3 可用率、Recall@12、错误入选和耗时；目前没有这些指标。最终搬到服务器还需要 Mac Vault 的持续增量同步与资源隔离，当前不包含该部署工作。

## 上游资料

- [Haystack 官方 FastEmbed 集成](https://haystack.deepset.ai/integrations/fastembed)
- [Haystack 混合检索教程](https://haystack.deepset.ai/tutorials/33_hybrid_retrieval)
- [FastEmbed 官方文档](https://qdrant.tech/documentation/embeddings/fastembed/)
- [BGE 中文向量模型](https://huggingface.co/BAAI/bge-small-zh-v1.5)
- [BGE 重排模型](https://huggingface.co/BAAI/bge-reranker-v2-m3)
- [SQLite FTS5 排序说明](https://www.sqlite.org/fts5.html#sorting_by_auxiliary_function_results)
- [sqlite-vec Python 文档](https://alexgarcia.xyz/sqlite-vec/python.html)

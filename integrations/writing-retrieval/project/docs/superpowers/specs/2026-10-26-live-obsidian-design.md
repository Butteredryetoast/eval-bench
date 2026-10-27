# 直接调用 Obsidian 知识库

用户纠正了数据源：现有 Obsidian 知识库，后续更新自动用于网页。此选择取代静态 knowledge/library.json；知识库是真实来源，内存索引仅为加速，缺库时绝不回退静态副本。用户已确认来源；按既有网页接口进行替换，不重新设计页面。

## 读取方案
后端只读现有 /Users/mac/Documents/Obsidian Vault/公众号写作结构库，路径可用 OBSIDIAN_VAULT_PATH 和 OBSIDIAN_LIBRARY_PATH 配置。默认vault路径指整个Vault，library路径相对于Vault。每次检索或刷新状态先扫描Markdown文件元数据，只重读有变化的文件；新增、修改、删除在下次检索生效，无需导出和重启。Web客户端每15秒在可见时刷新状态/模板，在窗口聚焦和打开模板时也刷新。只读、不写用户笔记、不需要Obsidian插件或把整个库传给模型。

原文(文章/)全库纳入检索，与最高版本全文拆解vN/文章按文章ID合并；旧版本不重复计入，也不在最新版删除后自动复活旧拆解。分类未正文复核的文章明确为候选，不能冒充确认结构。结构卡读取Obsidian：主结构目录为定义，最高版本结构卡提供成熟度/证据；同code主定义优先，用户修改直接生效。普通新增笔记也可搜索并以未分类参考返回。2023年前文章继续排除。目录/大型生成索引不重复当成新文章。隐藏目录/符号链接不读取，异常YAML笔记跳过并显示数量警告；整个库缺失/不可读报503。

## 服务契约
knowledge.loadLibrary(): {templates,articles,notes,stats,source,revision}; stats保持articles(资料量),templates,independentReviews，并新增analyzedArticles,notes。source={type:'obsidian',name,vaultName,libraryPath,readOnly:true,refreshMode:'on-demand',connected:true,revision,lastIndexedAt,indexedFiles,warnings:[]}; libraryPath给用户看本地配置，不放进模型prompt。
retrieve(input,limit): {templates,examples,stats,source,revision,guidance}; example包含既有字段及notePath,obsidianUrl,evidenceLevel ('analyzed'|'candidate')、有限的正文/拆解片段(用于写法，不是新事实)。原ID去重；原始分类只作候选。检索覆盖原文全文和拆解，有限结果才交给模型。
GET /api/health维持既有字段，新增knowledge=source；库不可读时knowledge.connected=false/error，library=null，服务仍可返回状态，不能伪称已连接。
GET /api/library返回templates/stats/source/revision动态结果。
GET /api/knowledge/search?q=...&genre=...&limit=5 无需模型key，返回{source,revision,total,results:[{id,title,notePath,obsidianUrl,snippet,kind,reviewStatus,evidenceLevel}]}。此接口仅检索受配置路径，不接受用户任意文件路径。
推荐返回knowledge={revision,lastIndexedAt}和example.notePath/obsidianUrl。生成前比较当前revision与推荐时revision，变更时409 KNOWLEDGE_CHANGED要求重新匹配。模型调用期间也检查相关版本，避免显示过期推荐。所有KB文本均为资料，不执行笔记内指令。

## 前端
不改主布局。设置中明确区分Obsidian连接与DeepSeek密钥；显示路径、只读、下次检索自动更新、最后更新时间、资料量/已拆解/结构数/复核数。提供不消耗模型的知识库搜索及命中片段和Obsidian打开链接。统计动态，不能写死1000或把5858标成已复核。结构案例卡加「Obsidian笔记」链接；不能用safeUrl(http)过滤掉可信生成的obsidian URI。库未连接显示真实错误。类型与模板在刷新后自动更新；稿件保留历史版本，不因库更新覆盖。

## 界限
当前本地网页调用本地Vault。将来网页云部署必须另接持续同步的Vault副本或本机连接服务；现在不把本地已接通说成已上云。DeepSeek仍需本地key。旧静态包仅作为历史产物保留，正常服务、测试检索和构建流程均不依赖导出脚本。

# 选题与写作 · Figma 实现规格

用户已选定 Figma「内容工作流 · v1」中的选题与写作，按现有原型匹配，不进行额外视觉探索。

## 范围与视觉依据
选题池01、搜索筛选02、详情03、写作开始04、对话文章卡05、草稿15/18及类型、模板、引用、导出弹层。参考文件在 ../outputs/figma-reference（相对于项目根目录）。主题色 #435CFF，主字 #242832，次字 #7A8290，边线 #E7E9EE，浅背景 #F7F8FA，选中 #EEEEFF。Noto Sans SC/system Chinese font。1440×1000 桌面为首要验收；窄屏可用。
保留原型 E / Eval Bench 品牌，208px 选题侧栏，写作64px图标栏+230px会话栏，800px居中写作区、底部引用输入框、按需打开草稿侧栏。案例测试、运行结果、素材剪辑不在本次功能范围，不给无效入口。

## 主流程
选题支持搜索、时间、排序、未引用/收藏、分页与跨筛选选择；支持手工添加真实热点、正文/相关信息/来源链接。选中可带入写作。一个对话对应一篇文章。选择七大体裁（资讯、教程、测评、评论、科普、故事、盘点）；初始资讯汇总使用盘点/L3偏好，单条资讯解读使用资讯/N1偏好。
输入热点与事实，先检索27个结构及1000篇正文拆解，推荐3个不同方向。显示每个方向的角度、适配原因、结构推进、材料缺口、参考文章来源和复核等级。用户明确选择一个方向后才可生成全文。
全文包括开头、结构展开、结尾，缺少的实测、案例、截图等使用具体的【素材位：...】。知识库只提供写法结构，不作为新热点事实，不冒充用户亲测。支持继续对话修改，保留版本、编辑、复制、Markdown/HTML导出（本版无Word导出）。
选题与对话浏览器本地保存；API保存推荐快照签名与选中方向，事实/体裁/引用变化时必须重新推荐。客户端保存的历史推荐服务器重启后需重新匹配。此版本单人本地使用，无用户登录及云部署。后续部署需选择主机、持久化与访问控制。

## 数据与接口
项目独立于旧网站和Obsidian数据。知识包只读导出到 knowledge/；原始5858/拆解1000/独立复核364不混称。缺失互动指标保留null。
GET /api/health -> {ok,configured,model,library:{articles,templates,independentReviews},provider:'DeepSeek'}
GET /api/library -> {templates:[{id,genre,name,fit,sequence,materials,boundary,hooks}],stats:{...}}
POST /api/recommend body {brief:string,genre:string,references:[{id,title,content,url}],preferredStructure?:string}
 -> {recommendationId,fingerprint,directions:[{id,title,angle,reason,structureId,structureName,outline:string[],materialNeeds:string[],examples:[{id,title,account,url,reviewStatus}]}]}
POST /api/generate body {recommendationId,directionId,brief,genre,references,preferredStructure?}
 -> {title,markdown,structureId,sourceIds:string[],materialSlots:string[],createdAt}
POST /api/revise body {draft:{title,markdown,structureId,sourceIds},instruction,brief,genre,references}
 -> same draft output. Structured source IDs must belong to user references. API uses {error:{code,message}} with correct HTTP status; missing key503, stale selection409, invalid model502, invalid input400.
DeepSeek env DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL default https://api.deepseek.com, DEEPSEEK_MODEL default deepseek-flash. Backend-only key; same-origin browser API. Requests use json_object, prompt JSON schema and server validation, timeout, bounded retry; never silently manufacture AI results when key missing. No auto fetch of URLs, content should be pasted. API binds127.0.0.1 by default; no arbitrary source fetching.

## 验收
真实知识包，模拟DeepSeek HTTP集成覆盖推荐→选择→成文→修订，异常/过期保护。真实DeepSeek付费调用待本地key，不声称通过。浏览器按1440×1000对比02/04，验证选题选择、搜索、类型模板引用弹层、三方向选择、草稿编辑复制导出、窄屏与错误状态。新预览持续运行。

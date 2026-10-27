# 给同事的Codex：还原选题与案例网站

这是当前工作副本的迁移包，含未提交改动、站点定制、业务数据库和本机已归档素材。不是上游原版。先读本文件，再读AGENTS.md、README.md和docs/hot-monitor.md。

## 请按以下顺序执行

1. 检查操作系统与环境，需要Node.js>=24.11、npm、PostgreSQL17客户端。macOS可沿用scripts/monitor-local.mjs的setup；Windows/Linux请检查Docker或docs/deploy.md对应部署方案，不要照搬macOS绝对路径。
2. 在独立新目录还原，不覆盖同事已有网站。不要运行种子数据覆盖本包行业配置。保留原有LICENSE、NOTICE和依赖许可。
3. macOS：运行`node scripts/monitor-local.mjs setup`准备数据库、依赖和前端。该过程可能下载软件并需要Xcode命令行工具；若默认端口冲突，修改新生成.env中的WEB_PORT/API_PORT/SITE_URL/API_BASE_URL。不要启动worker。
4. 把business-data.dump还原到一个全新的空数据库，例如hot_monitor_restore。使用PostgreSQL17的`createdb`、`pg_restore --no-owner --no-acl --dbname=hot_monitor_restore business-data.dump`，连接参数使用本机新生成的数据库账号。不可使用--clean删除已有库。数据库密码不要输出到聊天中。
5. 修改.env的DATABASE_URL指向还原后的新库。确认`COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`、`FEISHU_CONTENT_PUSH_ENABLED=false`、`FEISHU_INTERNAL_ENABLED=false`、`INDEXNOW_SUBMIT_ENABLED=false`。所有来源在迁移副本中已暂停。模型、公众号、X及其他第三方凭据需要收件人自己配置，不能沿用发送人的凭据。
6. 把本包.data/monitor-assets保留在项目相同位置。数据库hm_assets的本机目录若含发送人旧绝对路径，按实际字段核对并仅在新库中改到本机素材目录，不能修改原文链接。
7. 运行迁移检查、构建，再`node scripts/monitor-local.mjs start`。按.env实际端口打开/admin/monitor。
8. 对照data-summary.json核对事件、报道、案例、素材、实测及文章数量；检查随机事件、案例附件显示、交接导出和现有分类。数据库记录可能多于页面去重事件数。
9. 做typecheck、独立_test数据库测试、前端检查与本机smoke。恢复验证前不得启用收费调用或自动采集。不要未经同事要求把免登录共享编辑网站开放到公网。

## 本包数据边界

保留采集文章、正文、事件、案例、分类、实测、来源配置（已暂停）和本机素材。迁移副本已去除登录账号/会话、审计日志、反馈个人信息、推送目标、待执行任务、同步缓存及运行设置；队列pgboss不携带，由程序初始化。历史收费回执等保留作业务历史，不代表同事发生的消费。来源配置中的凭据字段删除，已知私有值替换为[RECONFIGURE]；因此部分来源需要重新填写连接参数。

迁移不是共享服务：同事还原后得到独立副本，不会自动与发送人的网站同步。三站对接沿用eventId/caseId与现有版本1接口，先用一个真实选题联调，再接自动流转。

## 可以直接发给Codex的指令

请读取「给同事的Codex还原说明.md」及AGENTS.md，在新目录完整还原这个网站和业务数据。根据我的系统选择运行方式，生成新的本机凭据，先关闭采集、模型和推送，不覆盖已有数据库。恢复business-data.dump和素材，核对data-summary.json，验证网页和附件能使用，最后给我本机访问地址以及尚需自行配置的服务。不要自动对公网发布。

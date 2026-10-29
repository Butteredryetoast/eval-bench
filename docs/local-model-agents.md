# 本机 GPT 与腾讯内置模型接入 · 2026-10-28

当前网站已接通 GPT/Codex 与腾讯内置模型。保持现有前端布局、样式和交互。

## 当前执行入口

| 网页选项 | 执行程序 | 登录与可用性 |
| --- | --- | --- |
| GPT 桌面端 | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` | 用户通过官方流程重新登录；账户类型为 ChatGPT，8 个模型候选 |
| WorkBuddy | 项目内 `tools/codebuddy-cli/codebuddy`，腾讯官方 CodeBuddy Code 2.177.1 | 用户通过腾讯国内站授权完整 CLI，19 个内置模型候选 |

WorkBuddy 安装包内的精简后台 CLI 未取得桌面加密凭据的独立调用权限，Auto 实测失败。按照用户“使用原生自带模型”的要求，采用腾讯官方完整 CLI 的独立登录通道；它使用腾讯内置模型，不经过旧豆包自定义 API。实际通过的内置型号为 `hy4-preview` 和 `glm-5.1`。这不是 WorkBuddy 桌面会话同步验收，也没有证明桌面套餐与 CLI 额度的具体共用规则；用量、权限和费用以腾讯账号及执行器实际返回为准。

CLI 从腾讯官方安装脚本指向的发布地址获取，固定版本 2.177.1，下载包 SHA-256 为 `ec8c95cd6d167299ecab035b0ee8ee76d811884ed9a624c91287a4bbe0295552`，校验通过后解压到项目目录。安装包已清理，本机程序及 vendor 资源保留；没有全局安装。

## 本机私有配置

`apps/web/.env.local` 仅配置以下本机运行入口，已被 Git 忽略：

```dotenv
CASEBENCH_WORKBUDDY_PROGRAM=/Users/mac/Documents/Codex/2026-10-22/wo/eval-bench/tools/codebuddy-cli/codebuddy
WORKBUDDY_CONFIG_DIR=/Users/mac/Documents/Codex/2026-10-22/wo/eval-bench/.casebench/agents/workbuddy-cli/config
```

网站和独立 Runner 通过既有环境变量传递使用同一程序和配置目录。登录凭据由官方客户端管理；网站没有保存额外的模型 API 密钥。执行入口和设置写入项目的本机配置，原 WorkBuddy 桌面安装包未修改。

网页使用时刷新页面，在“写作设置”中选择 Agent 和实际型号。已验证 GPT 的 `gpt-6.1-sol`、腾讯内置的 `glm-5.1`；候选目录不代表每个型号都已逐一生成验收。

GPT 如需重新登录，可运行本机 Codex 的 `login`。腾讯 CLI 如需重新授权，在本项目目录运行：

```sh
CODEBUDDY_CONFIG_DIR="$PWD/.casebench/agents/workbuddy-cli/config" ./tools/codebuddy-cli/codebuddy
```

在官方客户端中使用 `/login` 完成账号授权。当前账户已登录，日常使用不需要重复登录。

## 验证记录

- GPT `gpt-6.1-sol` 真实短文本返回“GPT连接成功”，执行器报告输入 29,119、输出 7 Token（包含客户端自身上下文）。
- 腾讯 `hy4-preview` 真实短文本返回“WorkBuddy连接成功”，输入 7,148、输出 7 Token。
- GPT + 真实 Haystack 知识库：取回 6 篇案例，单次真实生成，返回写作 JSON 并保存成正文；端到端约 60 秒。
- 腾讯 `glm-5.1` + 相同真实知识库：取回 6 篇案例，单次真实生成，返回写作 JSON 并保存成正文；端到端约 54 秒。
- 两次写作验收都包含 Humanizer 和完整叙事蓝图上下文，使用隔离临时数据库；测试稿与资料没有进入正式文章库。耗时包含本机检索和执行器启动，不能作为长期性能承诺。
- 既有适配器、原生会话和独立 Runner 的 5 项回归测试通过。
- 旧精简执行器的授权错误及旧豆包账户欠费记录保存在验收输出，当前健康记录对应新执行入口。

结果与原始指标在 `output/local-agents-20261028/`。模型候选仍通过执行器动态读取，不写死到前端。

## 参考

- [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Docs：身份验证](https://learn.chatgpt.com/docs/auth)
- [腾讯官方 CLI 快速入门](https://www.codebuddy.ai/docs/cli/quickstart)
- [腾讯官方 CLI 登录命令](https://www.codebuddy.ai/docs/cli/slash-commands)

只读检查 WorkBuddy 安装包时使用了 REA 技能，确认内置后台仅有 lite bundle。该静态检查仅用于选择接入路径；最终可用性来自上面的真实生成结果。没有修改安装包或启用其内部评测接口。

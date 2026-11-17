# 源码基线与初始化记录

记录日期：2026-11-16。以下第 1–5 节保留初始化阶段状态。后续已按明确授权建立两个桥接源码分支并进行 L1 验证，见第 6 节；生产运行/Android/跨网仍未验收。

## 1. 仓库来源

- 开发目录：`/home/allen/projects/pi-web-remote`，开始时为空，未处于其他 Git 工作树中。
- 上游：<https://github.com/liguobao/ds-harness-remote>，remote 名为 `upstream`；没有创建个人远程仓库或设置 `origin`，没有 push。
- 使用 `git init`、按完整提交 SHA 的 `git fetch --no-tags --depth=1`、本地分支 checkout 初始化；没有追踪 main 或运行仓库脚本。
- 基线提交：`0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`。
- 本地分支：`m2/pi-web-remote`；本地基线标签：`baseline/dsh-remote-apk-0.6.4-build71`。
- 上游跟踪文件共 757 个。源码历史为浅仓库；需要历史归因时另行取回，不把浅历史缺失解释为上游没有旧提交。
- 保留 MIT `LICENSE`。上游根 AGENTS 原文保存在基线标签中，本项目根 AGENTS 改为当前项目约定；Android 子目录约定保留。
- 未配置 Git `user.name` / `user.email`，未虚构提交作者；项目文档暂未提交。

交接将该 SHA 对应到 v0.6.4 发布页中重建的 Android build 71；本轮核对了取回 SHA 及源码清单，**未下载/核对用户手机 APK、签名或 release 资产哈希**。

## 2. 三个版本锚点

- DSH Remote：`liguobao/ds-harness-remote@0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`；根包与 Android 为 0.6.4，共享包可能为 0.5.21，不自动统一版本。
- Pi Web：`agegr/pi-web@174bff967807cdb59abb0204198d3d7cc19c862d`，交接对应安装版 0.17.0、嵌入 SDK 1.5.2；本轮在线只读核对相关源码，没有另建/安装该源码项目。
- 问答插件：`juicesharp/rpiv-mono@ce6d3530410812ca504ec294995581a52170f9e1`，交接对应 `@juicesharp/rpiv-ask-user-question@2.15.0`；本轮在线只读核对事件、answer-channel、RPC fallback 与工具入口。

源码依赖：Expo `~57.0.13`、React Native `0.86.2`、react-native-webview `13.16.1`；包管理器声明 `pnpm@9.15.4`，上游工程指南使用 Node 24.9。它们不是本机已安装/已通过构建的证明。

## 3. 可追溯哈希

初始化时读取的源文件 SHA-256：

```text
/home/allen/pi-web/M2-HANDOFF.md
4e3a71aab706efbdbc1f4acaa9081851f5e573f275490268d6b6540b07ed9883
/home/allen/pi-web/README.md
098154792bab51dee319042dae5ba12b3b63c486b7086b0f879706aa0d02501b
/home/allen/pi-web/MILESTONES.md
51e952a27e9c90ac4158e2545c1197947848c1ff253a31cfcc7101ac21fec434
/home/allen/pi-web/service.mjs
88bb8ded04354fa66d127a8262fd1be73639903c6d9d490ca924567f891af305
/home/allen/pi-web/package.json
d1e5969139ed46d0e123693c2ceeaadc254077d322852c4884958d6420d04839
/home/allen/pi-web/package-lock.json
d71aa95ada5ee9957288a95fd582f140ab267933f810e6bda5cd19b7a89e5007
```

上游工作树基线：

```text
pnpm-lock.yaml
fbcf968a071d10673652412c7f33870acd4d273d6088fc1d1b7f733957612591
AGENTS.md（上游原文，不是本项目新文件）
542cf705bece72afe21ef5ff84ae60f04a46dfd90bb9e203c911cbcc676d8d2f
apps/android/app.json
c34fcddb8322bea549a62bc1e53eb8c2c93c3eed5b935f46ce7ea96a1f7dad24
apps/android/package.json
c4eeacb3e66849676605e0ded76f564bdd3062dbbb4797e525d9f26874091a78
```

[交接副本](reference/M2-HANDOFF.md)只增加来源说明并把指向部署相邻文件的 Markdown 链接改为绝对 `file:` 地址；其余正文保留。上面交接哈希指原文件，不指经过链接调整的副本。

## 4. 本轮源码核对所得

### Host 并非即插即用的独立 SDK

- `packages/plugin/src/service.ts` 的 `HostPluginRuntime` 构造器实例化 ACP/Codex，`start()` 调用它们的启动逻辑并读取 Harness 版本。不能直接启动它来满足“唯一原 Pi Agent”。
- `connection-controller.ts` 已把认证连接和 router factory 分开，但工厂返回类型是具体 `RpcRouter`，不是已经公开的任意 Host adapter 接口。
- `rpc-router.ts` 是固定业务分发；独立 Host 要么有限提取连接层接口，要么做小范围接入点改动，不伪装 Harness 能力。
- 根包及 plugin 的公开入口仍是 DSH/Cordis 集成，不宣称已有 PiWebHost SDK。

### Pi Web 的观察路径也要审计副作用

- 固定版本 `app/api/agent/[id]/events/route.ts`：已有且 alive 的 wrapper 直接复用；否则解析会话文件并调用 `startRpcSession`。普通 GET 不是严格“只附着已存活实例”。
- `app/api/agent/[id]/route.ts` 导入并使用会话启动/命令逻辑；新适配必须审计冷启动和变更命令，不靠方法名判断只读。
- `getRunningRpcSessionIds()` 按 `isRunning()` 收集任务状态，不应等同“所有存活 wrapper 列表”。先查 running 再连 SSE 也不能消除竞态。
- `agent-event-stream.ts` 在 `connected` 中给出 `pendingExtensionUiIds`，订阅时重放未决 UI 并提供当前流式消息快照；没有据此证明共享历史游标或任意断点重放能力。
- `rpc-manager.ts` 的普通 `extension_ui_response` 分支调用响应处理后返回；HTTP 成功不是答案已采纳的证据。

### 完整问卷与现有 UI 的差距

- `answer-channel.ts` 在 `host === "rpc"` 时明确拒绝为 `unsupported_host`。
- RPC 路径使用 `runRpcQuestionnaire` 逐题 select/input，并不自动与外部整份答案的 first-wins 控制器协作。
- 公共答案字段为 0-based `questionIndex`、`optionIndexes`、`text`，还包含 notes/globalNote；优先复用既有校验，不能按标签文本关联。
- Android `QuestionCard` 按 `option.label` 存选择、用标签作 key，并用 `allAnswered` 禁用未全答提交。Pi 接线需要索引关联和插件空答案规则核对，不能直接搬用这两条语义。

### 网页兼容与 APK 并存

- `LoopbackHost.call()` 的 HTTP 空读 20 秒抛错并关闭 handle；交接给出的 Pi Web 心跳为 30 秒。冲突已静态核对，未运行复现。
- `LoopbackHost.openHttp()` 另有等待响应头的 20 秒预算；不能只改 read 就声称所有超时均已解决。
- Android config plugin 第 10 行固定 `PACKAGE = 'io.github.liguobao.dshremote'`；`app.json` 也使用该包名和 `dshremote` scheme。需要联动核对 Kotlin 包、组件、intent/分享/深链及安全存储身份。
- `app.json` 目前设置 `usesCleartextTraffic: true`；本项目只能接受受控设备内部 HTTP，不将这个上游开关视为可放宽公网安全策略的授权。

## 5. 验证边界与工具情况

- 已核对开发目录、Git SHA/分支、基线文件哈希；未读取生产会话正文、身份文件或模型凭据。
- 未重新查询运行服务/PID、会话数量或生产 HTTP；交接中的运行快照仍是历史观测，不写成当前事实。
- `project_report` 返回 `review graph disabled: project has more than 1000 files (cap 1000)`；未提高上限或改工具配置，使用已知路径的语法 outline 与定点源码读取。
- 一次 LSP 导航返回 `No LSP server available ... no language server answered`；部分 TSX outline 提示解析不完整，关键 QuestionCard 已读取正文，不能宣称做过类型检查。
- Markdown 自动诊断提示 `spellcheck: not installed` / `no primary language server answered`；这不是文档全绿。本轮只做额外的链接、忽略规则与 Git 差异静态自检。
- context-mode 提示版本过旧；没有升级。没有模型切换、子代理运行、项目测试或构建。

完整固定源码链接见交接副本第 17 节；本项目代码检视可用基线标签重定位，不依赖会话缓存或旧子代理报告。

## 6. 最小桥接源码分支（后续授权阶段）

- `/home/allen/projects/pi-web-bridge`：`agegr/pi-web@174bff967807cdb59abb0204198d3d7cc19c862d`；分支 `m2/minimal-bridge`，标签 `baseline/pi-web-0.17.0`。
- `/home/allen/projects/rpiv-mono-bridge`：`juicesharp/rpiv-mono@ce6d3530410812ca504ec294995581a52170f9e1`；分支 `m2/minimal-bridge`，标签 `baseline/rpiv-ask-user-question-2.15.0`。
- 均从公开 upstream 固定提交浅取回；没有跟 main、推送、发布或复制生产 node_modules/runtime。两者 MIT 与归属保留。
- 审查后使用 npm ci --include=dev --ignore-scripts --no-audit --no-fund，锁文件冻结。Pi Web 的 SDK 1.5.2、问答仓库开发 SDK 1.4.0 均来自各自原锁；跨源码契约另用 Pi Web 的真实 SDK 1.5.2 EventBus/ResourceLoader 验证，不做依赖升级。
- 实际工具为 Node 24.14.0、npm 11.9.0；未执行本仓库 pnpm、Android 构建、服务或模型。取回与安装失败、LSP 不可用以及生产 npm cache/log 意外写入见 [执行记录](MINIMAL-BRIDGE-RESULTS.md)。
- 未配置 Git 作者，不提交或推送。工作树补丁与内容哈希由主仓库保存；恢复时从各自固定 SHA 检查/应用补丁，不从生产安装反向复制。

## 7. G3 独立 Host（2026-11-17 UTC）

在主仓库固定基线的现有 `m2/pi-web-remote` 工作树实现 apps/pi-web-host 及协议/连接层有限补充，没有更换源码 SHA、包清单或锁文件，也没有更新上一阶段两个源码分支。冻结 pnpm 9.15.4 依赖与所有检查使用工作树外开发 HOME/XDG/cache/store；完整命令、失败记录与工件哈希见 [Host 执行记录](HOST-RESULTS.md)。该 Node 工件不是 APK，未连接托管服务或生产 Pi Web。

## 8. P3 原生链路（2026-11-17 UTC）

在相同固定 HEAD 的 Pi Web 与本主仓库继续实现聊天目录／历史、原实例发送／停止、client-core 和 Android 独立 backend／完整问卷；rpiv 开发树未新增改动。授权及精确范围见 [P3 决定](P3-ADR.md)，命令、失败与验证见 [P3 执行记录](P3-RESULTS.md)。三个 HEAD 与锁文件未变，生产未安装；新增累积 Pi Web 补丁不覆盖旧阶段补丁。Android 仅冻结依赖／静态生成／类型和 Node 契约检查，没有 APK、服务、账号、设备或模型。

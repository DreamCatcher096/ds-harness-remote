# P3 原生聊天与完整问卷：隔离实现／验证记录

日期：2026-11-17（UTC）。依据用户明确批准的 P3 范围执行。**交付源码与隔离契约闭环，不称为真机验收或上线。** 设计、限制和回执语义见 [P3 决定](P3-ADR.md)。

## 1. 实际交付

- Pi Web 开发树：`lib/remote-chat.ts`、catalog/history 路由、原 wrapper 的聊天操作／查询及 remote 专用 live/state 投影；原浏览器不会收到冗余聊天快照。目录／冷历史不初始化 registry、不调用 Agent 创建、不写 scanner index 或迁移原文件。
- protocol／Host：新增 5 个聊天 RPC，严格参数／响应 schema、真实实例及回执校验、认证 peer 的 operationId 命名空间。既有固定回环、句柄归属、空读、1 MiB 帧／64 MiB 累计等限制保持。
- `packages/client-core/src/pi-web-client.ts`：能力发现、冷读、附着／读取／释放、换代与缺口恢复、问卷提交／取消／操作查询、旧连接迟到结果隔离；不自动重放写入。关闭是终态。
- Android：独立 Pi Web carrier 分支及 `screens/pi-web-screen.tsx`、`services/pi-web.ts`；能选择目录、读历史、显示聊天／思考／普通工具结果、显式发送／停止、填写完整多题问卷和查询 unknown。既有 ACP Pi 源码／语义保留，不创建假 Harness proxy 或 ACP session。
- 问卷按索引处理单选、多选、自由文字、备注、整份提交和取消；预览仅安全文本。pending 集合消失使本地表单失效，未见终态不假定已答；普通扩展自定义交互仅只读提示，不以数字 walker 代替原生完整表单。
- 用户选择不初始化 BMad；没有新增其工具配置、子代理或独立审查。

## 2. 已执行结果

全部检查运行于隔离开发 HOME/XDG/cache/tmp，白名单环境不携带 Pi／DSH／provider 凭据。未启动监听服务、SDK AgentSession 或模型。

- **通过：Pi Web 71/71，6 个文件，失败／跳过 0。** remote-chat、remote-bridge、显式跨源码问卷集成、agent-event-stream、agent-event-wire、rpc-manager-extension-ui；不是 Pi Web 全仓测试或真实 SDK 会话。
- **通过：Host 24/24，5 个文件。** 包含聊天负向边界、原 20 项回归与新 native-chain 跨源码业务夹具。
- **通过：protocol＋client-core＋Android 720/720，79 个文件。** 包括真实 Noise 算法的内存通道旧测试、原 ACP Pi／Harness 恢复回归，以及新状态机／问卷投影。账号相关旧测试只用合成数据和假 HTTP，不代表真实登录／注册；没有实际账号操作。
- **通过：protocol、client-core 定向 TypeScript 构建；Host、Android、Pi Web 类型检查。** Android 已有四类 renderer 仅做静态生成，供原仓库类型依赖使用；没有启动 WebView、Expo 开发服务、模拟器或设备。未新增依赖／改锁文件。
- **通过：Pi Web 8 个变更实现／测试路径 ESLint。** 未执行全仓自动修复或发布脚本。
- **通过：独立 Host bundle／闭包与 --help 冒烟。** 216 源码模块；无 ACP/Codex/service 入口，不带 SDK 执行器。没有传 --connect。
- **LSP／辅助规则不是全绿。** 主仓库 22 个实际变更路径主动探测：20 inconclusive、2 有 findings，5 条辅助规则错误均指向未改动的旧 as-unknown-as 转换处（protocol index 4 条、Android connection 1 条）。独立 Pi Web 8 路径没有语言服务器就绪，不能确认。最终小批复查同样未确认 clean，不能用 tsc 通过冒充 LSP 全通过；没有顺手修旧代码或升级工具。

### 跨源码链证明了什么

native-chain 在内存中连接：Android 表单答案投影 → client-core → 原 Remote 编解码 → Host router／HTTP client → 实际 Pi Web 路由／wrapper → 实际固定问答插件及 SDK EventBus。

选择真实目录行后附着同一 fixture wrapper，历史保持真实 entry/toolCall ID；prompt／Stop 到可计数假执行上游各一次。完整多题 submit 回到原 toolCall，工具完成一次。另一次整份取消故意在上游提交后丢弃 HTTP 回执，客户端显示 unknown；查询原 operation 后得到 accepted，取消只发送一次，没有再发 prompt／Stop。

夹具没有创建 SDK AgentSession，不能替代生产同实例证明、真实模型业务或 Android 点击操作。浏览器／手机 first-wins 仍复用上一阶段真实插件控制器，本轮没有修改 rpiv 源码或重新执行其 885 项全包测试。

## 3. 冻结依赖与环境

使用 Node 24.14.0、pnpm 9.15.4 和原 lock 中的 Vitest 2.1.9；没有工具升级。安装前阅读 Android／共享包 scripts，直接调用获准检查，不执行 Expo 的 prestart/preandroid/prebuild 或 APK 流程。

本轮冻结安装为 offline／ignore-scripts／prod=false，选择 Android 依赖闭包和根项目，exit=0。命令中的 `--filter @dsh-remote/plugin` 报 No projects matched，记录而不伪称该 selector 命中；总选择为 7/11 workspace，后续 Host、共享包和 Android 检查均通过。没有网络下载或依赖版本改变，也没有清理此前误写的生产 npm 缓存。

开发根：`/home/allen/projects/.pi-web-remote-dev/`。每次 Node／pnpm 检查显式设置 HOME、TMPDIR、XDG、npm cache/userconfig；不继承生产 HOME。pnpm-lock.yaml 的 SHA-256 仍为：

```text
fbcf968a071d10673652412c7f33870acd4d273d6088fc1d1b7f733957612591
```

## 4. 可重跑检查

先具备原锁对应的开发依赖。不要在生产目录执行，不向命令传真实身份／账号／模型变量。

```bash
D=/home/allen/projects/.pi-web-remote-dev
run_dev() {
  env -i PATH="$PATH" LANG=C.UTF-8 NODE_ENV=test NO_COLOR=1 \
    HOME="$D/home" USERPROFILE="$D/home" TMPDIR="$D/tmp" \
    XDG_CONFIG_HOME="$D/config" XDG_CACHE_HOME="$D/cache" XDG_DATA_HOME="$D/data" \
    npm_config_cache="$D/cache/npm" npm_config_userconfig=/dev/null npm_config_globalconfig=/dev/null \
    PI_CODING_AGENT_DIR="$D/disabled-agent" \
    PI_WEB_BRIDGE_SOURCE=/home/allen/projects/pi-web-bridge \
    PI_WEB_QUESTIONNAIRE_SOURCE=/home/allen/projects/rpiv-mono-bridge/packages/rpiv-ask-user-question "$@"
}
# 在 pi-web-remote 根按顺序执行
run_dev node node_modules/typescript/bin/tsc -p packages/protocol/tsconfig.json
run_dev node node_modules/typescript/bin/tsc -p packages/client-core/tsconfig.json
run_dev node node_modules/vitest/vitest.mjs run --config apps/pi-web-host/vitest.config.ts
run_dev node node_modules/vitest/vitest.mjs run packages/client-core/tests packages/protocol/tests apps/android/tests --maxWorkers=1 --minWorkers=1
run_dev node node_modules/typescript/bin/tsc -p apps/pi-web-host/tsconfig.json
# 如尚未生成原有 renderer，只在检查所需时顺序运行以下四条
run_dev node apps/android/scripts/build-terminal.mjs
run_dev node apps/android/scripts/build-pdf.mjs
run_dev node apps/android/scripts/build-mermaid.mjs
run_dev node apps/android/scripts/build-intelligent-ui.mjs
run_dev node node_modules/typescript/bin/tsc -p apps/android/tsconfig.json --noEmit
run_dev node apps/pi-web-host/build.mjs
run_dev node apps/pi-web-host/dist/host.mjs --help

# 切到 pi-web-bridge 开发树，沿用同一 run_dev，不启动服务
run_dev node --test lib/remote-chat.test.mjs lib/remote-bridge.test.mjs lib/remote-bridge.integration.mjs \
  lib/agent-event-stream.test.mjs lib/agent-event-wire.test.mjs lib/rpc-manager-extension-ui.test.mjs
run_dev node node_modules/typescript/bin/tsc --noEmit --incremental false
run_dev node node_modules/eslint/bin/eslint.js lib/rpc-manager.ts lib/agent-event-stream.ts \
  lib/remote-chat.ts lib/remote-chat.test.mjs lib/remote-bridge.test.mjs \
  'app/api/remote/[id]/route.ts' 'app/api/remote/[id]/history/route.ts' app/api/remote/catalog/route.ts
```

若从完全未构建的共享包重新开始，先按 [G3 记录](HOST-RESULTS.md) 的 protocol → crypto → webrtc → client-core 顺序构建真实依赖；不以旧 dist 假装源码检查通过。安装仍须 frozen-lockfile、ignore-scripts 和隔离配置，不能借机更新锁文件。

## 5. 工件与可移植性

主仓库 HEAD 仍为 `0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`；Pi Web 为 `174bff967807cdb59abb0204198d3d7cc19c862d`，rpiv 为 `ce6d3530410812ca504ec294995581a52170f9e1`。没有提交／推送、没有配置作者；原暂存集合仍为 9 路径，新增业务源码未擅自暂存。

新增 [Pi Web P3 累积补丁](patches/pi-web-p3-cumulative.patch)，包含固定 Pi Web 基线上的 G1/G2＋P3，**替代而不是叠加在旧最小补丁之后**。在开发临时目录从 git archive 的原固定 HEAD 检查／应用成功，14 个修改／新增文件逐字节与工作树一致。没有对实际工作树或生产执行 apply。

```text
pi-web-p3-cumulative.patch
73194 bytes
SHA-256 7a277f3a79c5fa0a455d29cce756f7f5c79594063944c3219867b214a0521bb1
```

旧 pi-web-minimal-bridge.patch 与 rpiv-questionnaire-bridge.patch 未修改，哈希与 [上一阶段记录](MINIMAL-BRIDGE-RESULTS.md) 一致。

Host 新 bundle（忽略，不入库；不是 APK）：

```text
apps/pi-web-host/dist/host.mjs
2397074 bytes
SHA-256 6973dbd8c22f2b6a777a7fe16bf455f51736a01b6d7dad67e180bfde146c7c9a
```

最终静态自检：主／桥接仓库的工作区与暂存区 diff --check 均通过；15 份入口／协议／项目文档的 102 个本地链接无缺失，19 个外部 URL 仅作语法检查，没有在线验链。Host dist／graph、Android 四类生成 renderer 均被忽略；P3 源码与两份新文档没有被误忽略。

## 6. 实际失败与修正

- 冷目录测试最初发现 registry 从 undefined 变成空 Map，确认 getRpcSession 的隐式初始化；改为只读现有 global registry 后通过。
- 跨源码夹具首次用 CommonJS require 加载 ESM-only SDK，报 `No "exports" main defined`；改用开发树 Jiti 的 ESM 导入，没有更换 SDK。
- 夹具中同一题重复 label 被原插件校验拒绝，未打开问卷；完整链使用合法 A/B，索引投影另测重复显示文字，不修改上游规则。
- 工具完成后的权威 snapshot 是空 pending 集合，不保证保留 answered；据此修正客户端失效表单投影，没有编造终态或要求上游永久保留问题。
- 第一次 Android 完整回归 7 项失败，定位为旧 connection 测试替身缺少新增 hasPiWeb，补齐“未提供该 backend”契约后最终 720 项全部通过；没有改生产代码做兼容降级。初次类型检查还提示未生成原 renderer／操作 ID 工厂返回类型过窄，按真实构建流程与 string 类型修正后通过。
- 最终源码检查还补上迟到 subscribe 的清理归属：旧连接返回的 handle 只向创建它的旧 RPC 释放，不能误送新连接；增加专门负向用例后重跑通过。
- 早期 LSP 指向旧共享包 dist 导致新增导出缺失；按依赖顺序构建声明后 tsc 通过，后续主动 LSP 仍未能确认 clean。
- project_report 仍受 too_many_files 限制，独立 Pi Web 导航无语言服务器回答；context-mode 的外部文件分析报 outside project root。没有改权限、工具配置或用模型／子代理绕过；必要源码用已允许的普通 read 阅读。

## 7. 尚未验证与回滚

未做：生产补丁安装／服务或配置变更、真实认证和作者服务准入、真实会话输入／模型、APK／模拟器／真机、蜂窝／P2P/TURN/Relay、WebView／回环代理、独立审查或部署。

源码页面通过类型检查和纯业务投影测试，不等于已验证手机上的布局、键盘、无障碍、后台生命周期或触控交互。原 Remote loopback 的 20/30 秒冲突没有在本轮解决。

回滚仅处理本轮新增开发源码／产物和本项目连接；停止新连接不发 Agent Stop，不清理既有 DSH／Pi Web 身份、缓存、运行目录或任务，不回放会话文件。任何生产、账号或设备动作仍需单独授权。

# 最小桥接隔离实现与验证记录

日期：2026-11-16。**G1/G2 最小源码补充及 L1 契约验证已完成；没有部署，M2 未验收。** 这是执行结果，不是 Android、真实业务或生产同实例验收。接口决定见 [ADR](MINIMAL-BRIDGE-ADR.md)，后续范围见 [实施方案](IMPLEMENTATION-PLAN.md)。

## 1. 授权与交付位置

用户要求“根据实施计划，解决 Pi Web／问答插件的最小桥接”，并确认“实现并验证”：允许固定源码分支、审查后冻结依赖安装及无模型契约测试。不包含服务启动、模型会话、Host/Android、账号、APK、独立审查或生产部署。

- Pi Web：`/home/allen/projects/pi-web-bridge`，基线 `174bff967807cdb59abb0204198d3d7cc19c862d`，分支 `m2/minimal-bridge`，标签 `baseline/pi-web-0.17.0`。
- 问答插件：`/home/allen/projects/rpiv-mono-bridge`，基线 `ce6d3530410812ca504ec294995581a52170f9e1`，同名开发分支，标签 `baseline/rpiv-ask-user-question-2.15.0`。
- 原 DSH Remote 仓库业务源码与 pnpm 锁文件未改；只更新本项目约定、入口/状态文档并保存补丁。保留原已暂存初始化文档，不覆盖其 index 内容。
- 两个新源码仓库没有提交/推送；新增文件使用 intent-to-add 以生成完整 diff，没有虚构 Git 作者或版本。MIT 与上游归属保留。

可移植交付：

- [Pi Web 补丁](patches/pi-web-minimal-bridge.patch)，10 个文件，560 行新增／5 行删除。
- [问答插件补丁](patches/rpiv-questionnaire-bridge.patch)，11 个文件，538 行新增／32 行删除。
- 补丁包含实现、契约测试、分支约定和必要文档，不含 node_modules、运行数据、模型、凭据、日志或构建工件。
- 用独立临时 Git index 装载各自基线，`git apply --cached --check` 通过；对当前工作树的 `git apply --reverse --check` 也通过。未将补丁应用到生产。

SHA-256：

```text
pi-web-minimal-bridge.patch
447b1dc9d8613bb600d8be6d4757a274832d44ea1756c1b26ab7e8540432bb3d
rpiv-questionnaire-bridge.patch
51f7e626034df02eb884423c89644d5b7e0da5811b58c928e6cde7144ec4bb00
```

## 2. 实际最小接线

### Pi Web

- `lib/rpc-manager.ts`：wrapper 生命周期内稳定的 agentInstanceId；只查现有 registry 的 attachRpcSession；有限同步 remoteCommand；原 resource loader 显式注入会话独立的 SDK EventBus，wrapper 绑定/释放问卷监听。
- `lib/remote-questionnaire.ts`：仅桥接指定版本化通道；没有通用 emit 或替代 Agent；握手成功才宣告问卷能力；完整问卷快照/状态的 UTF-8 上限为 1 MiB，超限明确拒绝，原网页仍可答。
- `app/api/remote/[id]/route.ts`：GET 快照，POST 问卷 submit/cancel、operation.get 和普通 ui.respond。body 实际字节上限 1 MiB；读完 body 后同步查实例、校验并执行，不等待 binding，也不经过可冷启动的旧 command 路径。
- `app/api/remote/[id]/events/route.ts` 和 `lib/agent-event-stream.ts`：只附着、connected 内权威问卷快照、实例/epoch/seq、明确 attachment_ended/error；继续复用原 SSE 的有界背压与增量合并。
- 旧浏览器入口行为保留。新入口不提供 prompt/Stop/模型变更，不可据此宣称 P3 会话接线已完成；同样不能拿旧 events 路由代替新 attach-only。

### 问答插件

- `answer-channel.ts`：原 OpenQuestionnaire 成为所有完成来源共同的 first-wins，独立 signal 仅撤销本问卷 UI，按调用生成 opaque revision。
- `rpc-fallback.ts`、`ask-user-question.ts`：RPC walker 与外部整份答案协作；每次 UI await 前后检查，外部完成不再开下一题；工具 AbortSignal 为 aborted，不制造 accepted 或用户 decline。
- `questionnaire-bridge.ts`、`events.ts`：完整问题/索引/preview、终态及明确回执；复用原 resolveExternalAnswer，不猜标题/顺序，不造 frameRpcId；原公共事件的语义和原 RPC unsupported_host 保留，新整份提交只经版本化通道。
- 同操作同 payload 返回原回执；异 payload 冲突；操作记录最多 256、关闭 tombstone 最多 128，均 10 分钟惰性过期。只有内存保留，不承诺跨 reload/崩溃 exactly-once。
- 新生产模块加入原包 files，版本和锁文件未变。

## 3. 无模型验证结果

环境：Node 24.14.0、npm 11.9.0。各仓库按原 package-lock 安装，跳过 scripts。Pi Web 的 SDK 为 1.5.2，问答仓库的开发 SDK 为 1.4.0；没有改版本或引入模拟 provider。

最终检查：

- **通过：Pi Web 40/40，失败 0、取消 0、跳过 0。** 范围为 remote-bridge.test.mjs、显式跨源码 remote-bridge.integration.mjs、原 agent-event-stream.test.mjs、原 rpc-manager-extension-ui.test.mjs。
- **通过：问答包 44 个测试文件，885/885。** 只运行 rpiv-ask-user-question 包，没有运行全 monorepo、real-session 测试或模型测试。
- **通过：Pi Web tsc --noEmit --incremental false。** 未运行 Next build/dev/typegen。
- **通过：问答仓库 tsc --noEmit -p tsconfig.base.json。** 没有执行含全仓自动写入的根 check。
- **通过：Pi Web 8 个实现/测试文件 ESLint；问答包 8 个变更 TS 文件 Biome check。** 仅对本次引入的格式差异定点格式化，没有全仓修复。
- **未确认：LSP。** 对全部 17 个变更代码/清单路径主动探测，clean=0、unavailable=17；无语言服务器回答不是零诊断通过。未安装/升级语言工具。
- **通过：三个仓库的工作区及暂存区 git diff --check；三个锁文件没有变更；两个补丁的基线/反向静态应用检查。**
- **通过：10 份项目文档的 67 个本地链接目标、51 个外部 URL 语法及代码围栏配对检查，错误 0。** 未逐一在线抓取外链；主仓库原暂存文件集合保留。补丁未发现私钥标记，但这不是完整秘密审计。

夹具实际覆盖：

- 缺失/关闭/替换实例不创建 registry 或 start lock；两个订阅关联同一 wrapper，断开只清理自身 listener。
- POST 等待 body 期间实例被替换后，在业务效果前拒绝旧 instance；错误/关闭 UI ID 不以 HTTP 200 冒充答案采纳。
- 单选、多选、自定义、多题、notes/globalNote、完整 preview；网页部分作答后外部整份提交、网页先完成、同 tick 竞争、显式取消、Agent AbortSignal 与不误关另一问卷。
- 同操作重试、异 payload 冲突、同步 state listener 重入、迟到/旧 revision、回执查询、10 分钟过期及 256/128 容量边界。
- 重连读取权威已关闭集合，不重发写入；SSE 实例/epoch/seq 与终止；超大问卷明确拒绝而网页问题仍可完成。
- 跨源码夹具使用真实 SDK 1.5.2 EventBus、ResourceLoader 与其 invalidate/reload，证明旧插件监听被解除；同时调用原插件工具与原 wrapper 的 UI 适配方法。**未构造 AgentSession、未起 HTTP 服务、未调用模型。** wrapper.inner 为固定夹具，不能称为真实生产原实例验收。

首轮新桥接测试先复现旧代码不响应（6/6 失败），实现后通过。扩到问答全包时，新增通道触发 3 条旧测试对“所有 emit 的绝对序号”的假设；已改为检查原通道之间及 UI 的真实顺序，未删除或跳过断言。最终全包通过。

## 4. 可重跑命令（不要指向生产目录）

下面只重跑检查，不安装、不启动服务、不应用补丁。跨源码集成文件不是默认 test glob 的一部分，必须显式执行，且必须给固定插件源码；缺少路径会失败，不静默 skip。

```bash
check_home="$(mktemp -d /tmp/minimal-bridge-check.XXXXXX)"
mkdir -p "$check_home/tmp"
trap 'rm -rf "$check_home"' EXIT
run_isolated() {
  env -i PATH="$PATH" LANG=C.UTF-8 NODE_ENV=test NO_COLOR=1 \
    HOME="$check_home" USERPROFILE="$check_home" TMPDIR="$check_home/tmp" \
    XDG_CONFIG_HOME="$check_home/config" XDG_CACHE_HOME="$check_home/cache" \
    PI_CODING_AGENT_DIR="$check_home/agent" PI_WEB_IDLE_TIMEOUT_MS=0 \
    PI_WEB_QUESTIONNAIRE_SOURCE=/home/allen/projects/rpiv-mono-bridge/packages/rpiv-ask-user-question \
    "$@"
}
(
  cd /home/allen/projects/pi-web-bridge
  run_isolated node --experimental-strip-types --test --test-reporter=tap --test-concurrency=1 \
    lib/remote-bridge.test.mjs lib/remote-bridge.integration.mjs \
    lib/agent-event-stream.test.mjs lib/rpc-manager-extension-ui.test.mjs
  run_isolated node node_modules/typescript/bin/tsc --noEmit --incremental false
)
(
  cd /home/allen/projects/rpiv-mono-bridge
  run_isolated node node_modules/vitest/vitest.mjs run packages/rpiv-ask-user-question --maxWorkers=1
  run_isolated node node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
)
```

今后如需重复安装，必须额外显式设置**开发** HOME/XDG、npm_config_cache、npm_config_userconfig（空配置或 /dev/null），不继承生产 .npmrc/token。冻结 ci 并继续跳过 scripts；代理只透传已有获批值，不搬生产凭据。本轮没有借机升级依赖/工具。

## 5. 执行异常：生产 npm 缓存/日志意外写入

**这是本轮实际越过只读边界的例外，不隐瞒，也不把它称为“生产完全未变化”。**

早期 npm ci 与 npm 元数据命令继承了工具进程的 HOME。后续核实该 HOME 为 `/home/allen/pi-web/runtime/home`，默认 npm cache 为其 `.npm`；因此 npm 下载缓存与日志落到了生产 runtime/home/.npm，而非独立开发 HOME。工作目录和依赖安装目标始终是两个源码仓库，生命周期脚本均跳过；没有编辑生产 node_modules、包装器、运行配置、凭据或会话，没有启动/停止/重启服务。

发现后已向用户明确披露，停止对此路径的主动写入；验证使用临时 HOME、XDG 和白名单环境。**没有自动删除/搬移共享缓存或日志，没有修改运行服务环境。** 是否清理该 .npm 的哪些内容，需要用户另行决定；不凭事后扫描擅自归属或清空。

只读复核 service.mjs、生产 package.json、package-lock.json 的 SHA-256 与既有基线记录一致。这只能证明这三个文件字节一致，不证明整个 runtime 不变；活跃会话自身仍可能由原服务正常更新。未扫描秘密、未读会话正文或 npm 日志正文来补证。

另外：

- 问答仓库取回曾两次超时；确认无遗留 Git 进程后清理本次产生的 shallow.lock，再用 HTTP/1.1 的浅取回完成固定 SHA。没有改网络/服务/模型。
- 一次 include=dev 安装返回 exit=1，仅捕获到弃用警告，原因未确认；同一冻结安装设置网络时限后成功。不把失败编成已定位的网络故障。
- context-mode ctx_execute_file 误将项目根定位到生产安装并拒绝读取开发文件；记录原始限制，使用正常 read 及有界命令输出，没有改 allow rule/权限或升级工具。
- 一个预期示例路径 events.ts 不存在（ENOENT）；后续以实际 SDK 类型、EventBus、ResourceLoader 及 loader 生命周期源码核对，不假称读到了该示例。

## 6. 尚未完成与回滚边界

- G3 独立 Host、DSH 连接/能力协商、原生聊天历史/prompt/Stop、G4 Android 本地代理/WebView、G5 托管服务/独立身份/APK 尚未实现或验证。
- Remote 20 秒空读／Pi Web 30 秒心跳冲突尚未改；这里通过的是 Pi Web 侧 SSE 回归，不是 Remote 转发长连接验收。
- 没有真实超时来源，未制造 expired；没有独立 peer 鉴权、跨进程持久回执、生产/真机竞答或真实蜂窝/P2P/E2E 验收。
- 没有生产包装器/插件安装、服务或模型操作，未执行独立 review。今后部署仍须独立审查、工件与任务空闲窗口授权。
- 代码回滚限于这两个新开发分支/主仓库补丁；不要停止原 Pi Web/DSH，不取消原任务，不回放 session JSONL。生产 .npm 缓存例外单独保留，不能将清空它混入代码回滚。

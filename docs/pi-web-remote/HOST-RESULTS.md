# G3 独立 Host 实现与验证记录

日期：2026-11-17（UTC）。本轮依据用户“继续实现”，推进 G3 隔离源码与无账号/无模型验证；**未连接真实托管服务、未注册、未部署，Android 与 M2 端到端仍未完成**。

## 1. 实现范围

- 新增 [apps/pi-web-host](../../apps/pi-web-host/README.md)：固定回环 HTTP client、逐帧 SSE 解析、有界订阅 router、显式独立状态的 runtime、受控 CLI 和 bundle 构建。
- `packages/protocol/src/pi-web.ts` 及 index：9 个有限 RPC、capability、严格参数与响应 schema；协议 v=1、原 Noise/消息 envelope 不变。规范见 [线协议](../protocol.md) 与 [ADR](HOST-ADR.md)。
- ConnectionController 只依赖实际的 handle/closePeerStreams 和 isTrusted 接口，原 RpcRouter 结构兼容；没有复制安全通道或引入第二套执行器。
- IdentityStore 新增只读 Host 状态加载，显式目录/host role 才可用；不调用 loadOrCreate、不补建文件、不默认迁移。原创建/客户端自愈路径保留。
- HostServerApi 增加默认兼容的禁注册策略与诊断实现标识；新 Host 明确 allowRegistration=false，初次缺凭据或后续凭据过期均不会注册。控制面禁 HTTP 重定向。
- HostServerConnection 可接收真实实现标识 `pi-web-host@source-0a0ac9a1`；不伪造发布版本或 Harness 版本。新增单测核对 hello 字段。

本轮没有新建 workspace package.json、改变版本、锁文件或现有发布入口。独立 Host 目前只支持指定 session 的附着、状态/问卷/普通 UI；没有目录、历史、prompt/Stop 或网页代理，也没有 Android backend。

## 2. 已验证结果

环境：Linux、Node 24.14.0、固定 pnpm 9.15.4、锁文件内 Vitest 2.1.9。全程以工作树外 `/home/allen/projects/.pi-web-remote-dev/` 的 HOME、XDG、TMPDIR、npm cache/userconfig 和 pnpm store 执行安装/检查；白名单环境不携带 provider、DSH 或 Pi 凭据。没有清理上一阶段误写的共享 npm 缓存，也没有修改生产服务环境。

- **通过：Host 20/20，3 个测试文件。**
- **通过：受影响回归 165/165，13 个测试文件。** 范围为协议包、connection-controller、server-api、server-connection、identity-store；不是全仓/Android/生产测试。
- **通过：Host 与受影响源码/测试的 source-alias TypeScript 检查；plugin 的 tsconfig.test 检查。** 后者在 shared 包按真实依赖顺序生成声明后通过。
- **通过：protocol、crypto、webrtc、client-core 的定向串行 TypeScript 构建。** 没运行完整 plugin bundler、Next、Android、APK、模型或 SDK 会话。
- **通过：独立 Host bundle 及构建图门槛。** 共 216 个源码模块；没有 ACP/Codex/原 service 入口或 Cordis runtime。除 Node 内建和可选 `@roamhq/wrtc` 外无未审查外部依赖，纯 JS werift 内联。
- **通过：bundle --help 导入/入口冒烟。** 不传 --connect，不启动控制面或原 Pi Web。没有执行真实 RTC/native addon 加载或外网连通测试。
- **主动诊断不是全绿。** 最新探测 20 个变更代码/配置路径返回 5 clean、14 findings、1 inconclusive；聚合 235 条诊断，包含 TypeScript 弃用提示、规则建议和上游原有规则错误。主语言结果列出的 4 条是 Zod 弃用 hint；覆盖仍有未确认，不能把独立 tsc 通过等同 LSP/全部规则通过。未按建议顺手重构旧代码或升级工具。

核心场景：

- 构造/close 无网络/身份副作用；已有独立身份/凭据才进入连接工厂；同时 start/close、初始化期间关闭不会迟到启动。
- 缺身份/信任、错误标记、弱权限/symlink 拒绝；纯读取方法不会补建身份或 trusted-peers，失效不保留旧内存信任。
- 禁止伪造 Harness/ACP 能力、任意 URL/客户端 header/peer；真实 session/instance、回执原调用及 operationId 均核对。
- operationId 按已认证 peer 命名空间，设备间隔离、同设备跨连接稳定；HTTP 200 无合法 receipt、不确定写入均不是 accepted，不自动重发。
- subscribe 返回原 connected 快照、epoch/seq 与 pending UI IDs；read 空等不当 EOF，迟到帧不因超时丢失，并发 read 拒绝。
- 句柄不跨 peer；关闭/替换/撤销不投递旧流，不发 Agent Stop；16 句柄/60 秒回收、1 MiB 帧、64 MiB 累计、UTF-8/CRLF/CR、多行 data、截断与 epoch/seq 缺口。
- 原连接/协议回归继续覆盖实际 Noise 算法的模拟控制面/transport 测试；这不是作者服务或真实蜂窝/P2P/E2E 验收。

工件（忽略、不提交）：

```text
apps/pi-web-host/dist/host.mjs
2391779 bytes
SHA-256 119d397ecd07cab85af122ca3466d99bec13fe2d875a3803440a1e7f3db0c335
```

锁文件 SHA-256 仍为 `fbcf968a071d10673652412c7f33870acd4d273d6088fc1d1b7f733957612591`，与固定基线一致。Git 没有提交/推送，也没有改变原暂存文件集合或提交身份。最终静态检查覆盖 14 份文档、89 个本地链接目标、51 个外部 URL 语法，错误 0；没有逐一在线抓取外链。工作区/暂存区 diff --check、工件/身份忽略规则与源码对照均通过。

## 3. 可重跑命令

在仓库根使用已有开发依赖运行。不要在生产目录执行，不传真实身份/账号/模型变量。

```bash
D=/home/allen/projects/.pi-web-remote-dev
run_dev() {
  env -i PATH="$PATH" LANG=C.UTF-8 NODE_ENV=test NO_COLOR=1 \
    HOME="$D/home" USERPROFILE="$D/home" TMPDIR="$D/tmp" \
    XDG_CONFIG_HOME="$D/config" XDG_CACHE_HOME="$D/cache" XDG_DATA_HOME="$D/data" \
    PI_CODING_AGENT_DIR="$D/disabled-agent" "$@"
}
run_dev node node_modules/typescript/bin/tsc -p packages/protocol/tsconfig.json
run_dev node node_modules/typescript/bin/tsc -p packages/crypto/tsconfig.json
run_dev node node_modules/typescript/bin/tsc -p packages/webrtc/tsconfig.json
run_dev node node_modules/typescript/bin/tsc -p packages/client-core/tsconfig.json
run_dev node node_modules/typescript/bin/tsc -p apps/pi-web-host/tsconfig.json
run_dev node node_modules/typescript/bin/tsc -p packages/plugin/tsconfig.test.json
run_dev node node_modules/vitest/vitest.mjs run --config apps/pi-web-host/vitest.config.ts
run_dev node node_modules/vitest/vitest.mjs run \
  packages/plugin/tests/connection-controller.test.ts packages/plugin/tests/server-api.test.ts \
  packages/plugin/tests/server-connection.test.ts packages/plugin/tests/identity-store.test.ts \
  packages/protocol/tests --maxWorkers=1 --minWorkers=1
run_dev node apps/pi-web-host/build.mjs
run_dev node apps/pi-web-host/dist/host.mjs --help
```

如需重新安装，仍使用隔离开发 HOME/XDG/npm cache、`npm_config_userconfig=/dev/null`、`npm_config_globalconfig=/dev/null`，仅按既有批准值透传网络代理；执行 pnpm install --frozen-lockfile --ignore-scripts --prod=false，显式选择根、plugin、protocol、crypto、webrtc、client-core 六个 workspace。不得借机升级 lock 或执行 native/安装生命周期脚本。

## 4. 实际失败及修正

- 首次冻结安装 600 秒超时，日志含 ECONNRESET；没有升级工具或改代理。相同锁文件后续补齐依赖。
- 一次五 workspace 安装虽输出 Done，但进程未及时退出，记录为 timeout，不当干净通过。最终显式六 workspace、CI、offline 安装 exit=0（1.7 秒），没有下载新版本。
- 初次 bundle 使用固定 node_modules 物理路径，遇到 hoisted 布局而 ERR_MODULE_NOT_FOUND；改为从 plugin 的 package.json 解析已有 esbuild，兼容 hoisted/isolated，不增加依赖。
- 初次 webrtc/client-core 定向构建缺少对应 workspace 链接，TS2307；首次 plugin 检查也缺 client-core 声明。补齐六 workspace 并按依赖顺序重建后通过，没有以错误产生的声明文件冒充通过。
- 初次 Host 类型检查发现测试替身强转 IdentityStore；将共享连接层缩为真实 isTrusted 接口，消除该强转。
- 最后状态核查发现纯读取启动不能间接调用 loadOrCreate，避免身份文件竞争触发补建；新增独立只读方法及负向测试后通过。

## 5. 仍未完成

- 当前生产 Pi Web 没有安装上一阶段桥接补丁；新 Host 不会回退旧路由来“接通”。本轮只用假 HTTP/控制面和临时测试身份，没有接当前生产会话。
- 独立 Host 真实托管准入、账号/设备注册、撤销与 RTC/P2P/TURN/Relay 实测均未做；标记不是授权，不能用 DSH profile 凭据伪造独立身份。
- Native client-core/Android backend、会话目录/历史、prompt/Stop 与问卷 UI，以及安全 WebView 代理仍待实现。此拉取协议不代表原 Remote loopback 20/30 秒冲突已修复。
- 真实 Pi Web 认证配置/受限凭据传递、APK 包标识/签名、独立审查和受控部署需要后续单独授权。
- 回滚只处理本轮源码/新开发产物；不停止 Pi Web/DSH，不注销原身份、不取消原任务，不回放会话文件。

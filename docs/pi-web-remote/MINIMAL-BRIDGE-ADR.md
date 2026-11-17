# ADR：Pi Web／问答插件最小桥接

状态：本轮隔离实现的接口决定，不代表生产已支持。依据固定版本 Pi Web 174bff9、rpiv-mono ce6d353；用户已确认实现、冻结依赖安装与无模型契约验证。

## 范围

只做 G1/G2。新源码目录为 `~/projects/pi-web-bridge`、`~/projects/rpiv-mono-bridge`，分支均为 `m2/minimal-bridge`，各有 baseline 标签。生产目录授权边界为只读（实际 npm 缓存例外见执行记录）；不启动服务、SDK 会话或模型，不做 Host／Android、SSE Remote 空读修复、账号、APK、部署或独立审查。

## SDK 接线依据

SDK 1.5.2 的 `DefaultResourceLoaderOptions.eventBus` 和公开 `createEventBus()` 足够：每个原 wrapper 使用一个独立总线，在创建 services 前创建总线，经 resource loader options 注入；原 wrapper 在绑定扩展前安装桥接监听，reload 使用同一总线。只转发约定的问卷通道，绝不公开任意 event emit、扩展执行或会话创建 API。无扩展的 Chat only 不宣告问卷能力。

插件通过新版本化通道提供完整快照、操作回执及关闭状态，原 `rpiv:ask-user:prompt/answer/...` 保留兼容（原 RPC answer 仍拒绝 unsupported_host）。网页 walker 和新桥接最终都走同一 `OpenQuestionnaire.settle()`；每份问卷独立 signal 关闭自己的 select/input，并检查每次 await 前后，不能 abort Agent 或其他问卷。

## 只附着 HTTP 入口

选择独立 `/api/remote/[id]`（GET 快照、POST 有限操作）及其 `/events`（GET SSE），而不是给可冷启动的旧入口加一个可能被旧版本忽略的参数。这是本 ADR 对实施方案 G1 路由选择的收敛。

- GET 只同步查 registry 的 alive wrapper；没有为 409 not-attachable，不读会话文件、不调用 startRpcSession。
- 返回 opaque `agentInstanceId`；SSE 必须带相同 instance；POST 必须同时携带 sessionId 与 instance。每次业务效果前同步校验，不经旧 command 路由。缺少本接口或能力不算支持。
- POST 首版只支持 questionnaire.submit/cancel、operation.get 与普通 ui.respond，不开放任意 send、prompt、模型、provider 或会话变更。原生 prompt／Stop 后续由 Host 阶段另接，不假称本轮已完成。
- 新入口沿用 Pi Web 原有认证/来源边界，instanceId 不是凭据。未来 Host 仍须鉴权及固定回环目标；不能据此开放公网。
- SSE 复用现有有界背压 transport；connected 携带权威问卷 snapshot，所有新入口流帧带 instance、订阅 epoch/seq。先装 listener 再同步读 snapshot，没有跨 await 的问卷窗口。seq 是本连接顺序，不是持久消息游标；原有可重建增量仍可按背压规则丢弃，不能声称历史无缺口。

## 问卷契约收敛

- 新通道：`rpiv:ask-user:bridge-request.v1`、`bridge-response.v1`、`bridge-state.v1`，payload 为 JSON-safe。
- ref 为 sessionId、agentInstanceId、toolCallId、revision。revision 从草案的 number 改成每次工具调用随机生成的 opaque string：插件 reload 或同 toolCallId 再调用不会复用旧 revision。结构不变时不变，网页局部作答不改 revision。
- 插件权威终态为 answered/cancelled/aborted；原插件没有真实截止时间，本轮不造 expired/expiresAt。外部整份取消是 cancelled，Agent signal／未完成退出是 aborted。
- 复用 resolveExternalAnswer 的整份校验、索引、notes/globalNote。它拒绝缺题和空多选；RPC/TUI 允许的部分/空答案是原 UI 语义，不借 UI 行为放宽外部验证。
- 操作回执 accepted/invalid/stale/already-closed/operation-conflict/unknown；operationId 最长 128 字符。同 revision+operationId 同规范化 payload 返回原回执，不同 payload 冲突。查询不重发。只有插件控制器裁决 accepted。
- 操作记录最多 256、关闭 tombstone 最多 128，均 10 分钟；惰性清理，无持久化。容量驱逐/过期后查询 unknown，不能声称跨重启 exactly-once。已关闭且 tombstone 丢失的问卷为 stale，不会重新完成。
- 新入口 POST body、整批问卷快照及单个状态投影均限 1 MiB（UTF-8）。超大快照 GET 返回 413 questionnaire-too-large；live 发 questionnaire_unavailable（仅 ref/code），不截断 preview/问题后宣称完整。原网页可继续回答，不因此取消工具。SSE 继续保留原有背压上限。
- Pi Web 当前只有原网页认证主体，没有独立 peer 身份。本地幂等按同实例／问卷／operationId；未来 Host 必须由认证连接命名空间化 operationId，不把客户端自报 peerId 当授权。
- 普通 ui.respond 按真实 dialog ID 给明确 accepted/already-closed；这只表示该 UI 回调已消费，不是整份问卷 accepted。

## 验证边界

先跑受影响插件测试及 Pi Web wrapper/route/SSE 的固定夹具，另用同一真实 SDK EventBus + 原插件工具注册 + 原 wrapper UI 做跨源码契约测试，不构造 AgentSession，不调用模型。无模型夹具不是运行服务、Android 或生产同实例验收。锁文件不得变更；安装跳过 scripts，避免 native build／husky／上游 prepare。主动探测实际变更路径 LSP，工具 unavailable 不算通过。

# M2 具体实施方案（第一版）

日期：2026-11-16。**这是待批准的工程设计，不是已实现接口或执行授权。**
该首版记录初始化阶段的设计。后续用户已批准 G1/G2 隔离实现与无模型验证；实际新增接口、有限操作集及 revision 类型以 [桥接 ADR](MINIMAL-BRIDGE-ADR.md) 为准，结果见 [执行记录](MINIMAL-BRIDGE-RESULTS.md)。其余阶段不因此获得授权。用户后续要求继续实现，当前 G3 的精确范围见 [Host ADR](HOST-ADR.md)，执行结果见 [Host 记录](HOST-RESULTS.md)；不扩大为 Android、注册或部署授权。源码依据见 [SOURCE-BASELINE.md](SOURCE-BASELINE.md)，原需求见 [交接](reference/M2-HANDOFF.md)。

P3 后续状态：用户已明确批准原生链路源码与隔离契约验证，实际交付见 [P3 决定](P3-ADR.md) 和 [执行结果](P3-RESULTS.md)。下方各“拟议／尚未实现”保留第一版历史语境，不覆盖这份后续记录；WebView、APK、账号／真机与生产仍未获本轮授权。

## 1. 交付目标与非目标

必须同时交付：

1. Android 原生聊天接入当前 Pi Web 的原会话/原 SDK 实例，正确展示文本、思考增量和普通工具结果；发送/停止的实际行为由原实例执行。
2. 完整原生问卷：单选、多选、自定义文字、多题整份提交、取消、校验、竞争、重复/迟到与重连；不是逐题数字输入的包装。
3. App 内切入同一 session 的 Pi Web 网页，经原 Remote 加密链路访问，不另开公网网页。
4. 不占 VPN；真实可直连时 P2P，不能直连时 TURN/Relay 仍 E2E。

首版不做子代理树、上下文统计或任意插件小组件的增强面板，不实现新执行器、通用终端/文件系统协议、自建 Server 或 Windows 保活工程。未知工具结果不能因没有增强面板就丢弃。
原生 provider/模型变更入口默认隐藏或只读；不在接入时修改设置。网页具有 Pi Web 原有权限，不把原生 allowlist 宣传为网页权限沙箱。

## 2. 推荐架构

```text
桌面普通/无痕浏览器 ───────────────────────┐
                                          │
Android 原生 PiWeb client ─┐               │
                          ├─ Remote Noise ─ 独立 PiWeb Host
Android 受控 WebView      │   P2P / TURN / Relay  │
  ↕ 手机回环代理 ─────────┘                       │
                                           固定回环 HTTP
                                                 │
                                    Pi Web 127.0.0.1:30141
                                          │       │
                                    原 wrapper   问卷桥接
                                          └── 原 SDK/插件
```

- 控制面继续使用 HTTPS/WSS，业务通过现有 Noise IK；Server 不需要理解 `pi-web.*` 业务。
- E2E 终点为 Android Remote 层与 WSL Host。手机内部 HTTP 和 Host→Pi Web HTTP 是设备内受信段，不冒称 TLS。
- Host 负责账号/设备校验、固定目标、限额、连接隔离与业务投影，不成为 Agent 或问卷最终裁决者。
- 原 wrapper/插件持有问卷、执行和取消的权威状态；App 与 Host 只持可重建的内存投影。
- 原 App、定制 App、原 DSH Host、新 PiWeb Host 四者的身份/凭据和运行数据独立。

## 3. 五项前置设计门槛

### G1：同实例、无隐式启动的附着契约

已核对：原 SSE 路由在 wrapper 不存活时会 `startRpcSession`。先查 running 再打开 SSE 存在竞态，而且 running 列表不是完整 alive 列表。

拟议最小补充：

- 在 Pi Web 侧提供明确能力协商与 `attach-only` 语义：只获取 registry 中仍 alive 的原 wrapper，没有则返回明确不可附着状态，不走创建/恢复分支。
- 给 wrapper 一个仅用于关联的 opaque `agentInstanceId`（生命周期内稳定，替换/重启后变化）；快照、事件、变更命令都带或校验它。
- 命令在执行前原子核对目标实例；不能依靠 Host 的先查后写。Session ID 相同而 instanceId 不同，应重新由用户确认，不自动发送旧任务。
- 新 query/字段必须伴随可验证的能力声明；旧 Pi Web 忽略未知参数不算支持。
- 原浏览器默认行为保持兼容；Host 的原生附着以及本项目网页流的会话路由都要审计隐式启动风险。

接口位置候选为已有 events/command 路由的小范围扩展与 rpc-manager helper；若需要独立 `/api/remote/...` 路由，先写 ADR 再定名。**它们当前均不存在。**

退出标准：固定事件/无模型测试能证明多个订阅复用同一 wrapper，缺失/替换实例不调用创建函数，断开 App/Host 不停止原任务。

### G2：问卷权威控制器与 RPC walker 合作

见 [QUESTIONNAIRE-CONTRACT.md](QUESTIONNAIRE-CONTRACT.md)。先解决 RPC 的 `unsupported_host`、事件导出和只关闭本问卷对话，再接 Android。

优先方案是问答插件小补充 + Pi Web 侧受限桥接：

- 插件在真实 RPC 模式下也让 walker 与外部整份答案进入同一个 first-wins 控制器；不伪装 TUI、不只删除 guard。
- 为该问卷的 select/input 增加独立取消 signal，并在每次 await 后检查是否已完成。外部答案成功后只关闭自己的 UI，不能触发整个 Agent 的 Stop。
- Pi Web 在原 session 生命周期内导出完整快照/关闭/结果，并受限地传递答案。先确认 SDK 的事件/服务注入边界，不能假设 `pi.events` 已可通过 HTTP 访问。
- 纯扩展是否足够尚未证明；允许设计最小 Pi Web 核心接线，但实施前需列出准确改动点。若必须重写 SDK 或全局 UI manager，暂停重审。

退出标准：网页先答、App 先答、同时提交、网页部分作答后 App 提交、取消/Stop、断线恢复均只产生一个最终工具结果；回执与 UI 关闭一致。

### G3：独立 Host runtime 的可复用边界

不能直接调用 `HostPluginRuntime.start()`：它会初始化 ACP/Codex，且原能力声明带 Harness 业务假设。

推荐从现有连接层做**有限提取**：

- 候选复用：`connection-controller.ts`、`server-connection.ts`、`server-api.ts`、身份/凭据存储、认证加密 transport。
- 先梳理它们对 DSH/Cordis 的依赖与副作用。将 router factory 所需契约缩到实际的消息处理/断开清理接口，原 RpcRouter 行为保留。
- 新 Host 用独立业务 router，仅宣告真实的 Pi Web 能力；不自动启用 ACP、Codex、更新检查、旧凭据迁移或默认 DSH_HOME。
- 新 Host 状态目录必须显式配置在工作树外，凭据文件私有权限；不读原 DSH 的身份路径，未授权时不自动注册。
- 若发现必须把大量 DSH 框架搬入独立 Host，停止，提交范围/成本变更，而非实现第二套 Noise 或复制整个 runtime。

退出标准：无模型、无账号的隔离测试可构造/关闭 Host，无 spawn Pi/ACP/DSH、无旧身份读取；只有用户明确授权后才建立真实 Server 连接。

### G4：Android 本地代理安全与 native 可行性

推荐真实本地 HTTP server + 受控 WebView，不用 JS 全面劫持 fetch/XHR/EventSource，也不靠 shouldOverrideUrlLoading 转发 POST。

选型候选（尚未选定或安装）：Ktor CIO 优先评估完整请求体/流式响应/WebSocket 与协程取消；NanoHTTPD/NanoWSD 作为轻量对照，重点审查流式、取消、限额和维护状态。Android API/Expo 57 兼容、包体、许可证和传递依赖需在固定版本下验证；不手写 HTTP parser。

先写代理 ADR，至少回答：

- 只绑定手机回环；认证不能只有随机端口。每个 Host/账号/网页实例绑定不可预测访问凭据与精确 origin，凭据保存在原生层。
- 优先验证随机 `.localhost` 主机名 + 独立来源；Android DNS/WebView 支持未经验证，不能直接照搬 desktop。若不可用，需证明原生逐请求认证/来源隔离替代方案，不能退回“127.0.0.1 随机端口就安全”。
- 用受控 native bootstrap 建立本地短期认证；不把 Remote token/私钥放入 URL、页面 JS、localStorage 或通用 JS bridge。Cookie 无端口隔离，不能给所有 localhost 端口共享凭据。
- 导航、子资源、重定向均校验来源；外链交给系统浏览器且不带本地凭据/桥接权限。Origin/Referer/Host 校验不能只挡导航漏掉 POST、WS 或无 Origin 请求。
- 默认禁 Service Worker 与离线缓存，控制 WebView cookie/cache 生命周期；是否使用独立 WebView 数据目录/进程是可行性门槛，不预先承诺平台支持。
- 明确 Host/Origin、Cookie、CSP 和 Location 的限定重写规则，不使用通配 CORS，不删除所有 CSP；区分 WebView 自身回环凭据和上游 Pi Web 认证。
- 固定目标 `127.0.0.1:30141`；禁止任意 URL、CONNECT、跨目标重定向和跨连接 handle 复用。

退出标准：隔离页面可真实 POST/接收流式 SSE/取消，其他本地 App 或外部 origin 无法取得会话；未过安全门槛不进入生产页面联调。

### G5：作者服务准入与定制 APK 并存

- 托管服务默认 `https://dsh.r2049.cn`。先核实独立 Host/定制客户端政策、限额/费用；未确认不宣称免费或可用，不改为自动自托管。
- 实际登录/设备注册须用户授权同一账号；新 Host 与 App 生成各自身份，失败不借用原 DSH 登录文件。
- 定制 applicationId、scheme、签名、设备显示名由用户在构建前确认。保留原包并存，不覆盖安装。
- 核查 `app.json`、Expo config plugin 的硬编码 `PACKAGE`、Kotlin 包/组件、provider authorities、intent/share/deep-link、SecureStore 命名与备份规则。
- 阅读 Expo 57 和相应 Android/WebView 版本文档后实施；不能用 Expo Go 代替 native 模块或 APK 验收。

## 4. 拟议模块与最小改动面

以下新增目录/文件尚未创建，名称可在契约阶段收敛；不为未来能力搭框架。

### 本仓库

- `apps/pi-web-host/`：独立进程入口、只访问固定 Pi Web 的 HTTP client、认证 peer router、事件投影、受限网页转发、连接与资源清理。
- `packages/protocol/src/pi-web.ts`：`pi-web.session.v1`、`pi-web.questionnaire.v1` 等拟议 capability、严格参数 schema/错误码；沿用原 RPC/event envelope，不另造安全协议。
- `packages/client-core/src/pi-web-client.ts`：固定业务方法、请求关联、断线状态与只读快照恢复；不默认重试写入。
- `packages/plugin/src/connection-controller.ts` 等：仅按 G3 提取实际必须复用的安全连接接口；`loopback-host.ts` 调整空读语义时补核心回归，保留原功能边界。
- `apps/android/src/services/pi-web.ts`：独立于现有 ACP Pi 的数据接线；不覆盖 `services/pi.ts` 的 ACP 语义。
- Android 的 `types.ts`、connection/capability、workspace/session/event/prompt actions：增加独立 `pi-web` backend 和特性判断；不伪造 `agent.acp.pi.v1`、Harness 版本或 frameRpcId。
- `screens/chat/messages.tsx`：复用问卷视觉，增加基于索引的选择、取消、等待与失效回调；不无关重构聊天组件。
- 拟新增 `screens/pi-web-screen.tsx`、native loopback 模块及 Expo config plugin：网页切换、同 session 导航与代理资源生命周期。

### 另行获批的两个源码仓库

- Pi Web 固定分支：wrapper 的 attach-only/实例标识、问卷事件到 HTTP/SSE 的最小桥接、回执；可能涉及 `lib/rpc-manager.ts`、事件类型和相关路由。
- rpiv-mono 固定分支：`answer-channel.ts`、`rpc-fallback.ts`、`ask-user-question.ts` 和必要的增量事件类型；保留非桥接 RPC/TUI 原语义。

不修改已安装 node_modules；不在本仓库复制生产 SDK/插件代码维护第二份来源。跨仓库版本、patch 和构建工件必须有对应记录。

## 5. 原生会话数据与业务操作

拟议接口族（名称未发布）：

- `pi-web.describe`：能力、版本、上游就绪情况；不伪装原生 Harness。
- `pi-web.sessions.list` / `session.snapshot`：读取可访问会话及状态/历史；不创建目录或会话。
- `session.subscribe` / `unsubscribe`：在 G1 约束下附着原实例，返回 snapshot 边界和当前未决问卷。
- `session.prompt` / `abort`：只转发明确用户操作，校验会话与实例；prompt 不以接收 HTTP 200 冒充任务已完成。
- `ui.respond`：普通 select/input/confirm 按真实 dialog ID；与整份问卷接口分开。
- `questionnaire.get/submit/cancel/operation.get`：按问卷契约执行。

每次变更有 operationId；请求超时/断线时标记 unknown，先查原操作结果，不自动重发。原 Pi Web 未提供幂等的操作不能由 Host 缓存宣称跨进程 exactly-once。
队列/Stop/运行状态来自原实例；如果尚无法可靠映射某种 steer/follow-up/排队状态，显式显示未支持，不猜测为空闲或自动转换成新 prompt。

历史和 live 恢复策略：

1. 在同实例附着边界获取权威 snapshot，并对建立期间事件做有界缓冲。
2. 优先使用真实 message/toolCall ID；不能按文本相同去重，不能冒用 ACP synthetic IDs。
3. Host 可提供本轮订阅的 epoch/seq 用于去重，但它不是 Pi Web 持久游标；换代或缺口必须重新拉取状态，不能声称连续重放。
4. 丢失窗口/缓冲溢出时明确要求 resync。若原接口无法构成无缺口 snapshot 边界，列入最小 Pi Web 补充，不靠多次拼历史碰运气。
5. 重连恢复 pending 问卷和真实运行状态，不恢复“待自动发送”任务。App 退出只取消自己的订阅/代理句柄。

## 6. HTTP/SSE 与资源预算

保留现有上限作为起点：64 KiB chunk、1 MiB 请求体、64 MiB 累计 HTTP 响应、16 活动 handle、256 KiB WS 单消息，以及有界缓冲。是否调整必须有测试、依据与明确预算。

- 空读等待到期返回 `{data:"", done:false}`，不是错误也不是 EOF；每连接每 handle 同时最多一个 read。等待预算必须短于真实 RPC timeout，避免忙轮询。
- 明确区分无数据、上游真实结束、截断、取消、网络错误和限额；关闭后不能重建旧 handle。
- 审计响应头等待 20 秒、RPC、后台暂停和空闲 handle 回收的整体预算，不能只改一个 read timer。
- SSE 不伪造业务心跳；空等、多次 30 秒心跳、网络切换以及 64 MiB 边界均有测试。
- 长 SSE 达累计限额时执行可识别的关闭与只读重连/快照恢复，不能删除累计限制或因此重新发任务。
- 页面资源并发有排队和背压，生命周期绑定连接；超限/取消能及时释放自己的 handle，不能拖死聊天流。
- 上传/下载超过边界必须显式拒绝；如 Pi Web 正常工作流需要更大上传，单独设计有界分块请求，不伪称所有上传已兼容。
- 生产页面是否确需 WS 由固定版本请求路径确认；需要时测 WS，不需要则记录“不适用”的源码/实测依据，不能为省事静默丢弃。

## 7. 分阶段交付与依赖

### P0：初始化与规划——本轮

交付：固定源码、Git 分支/标签、AGENTS、忽略规则、来源记录、问卷草案、实施与验收方案。
验证：SHA、文档链接、差异与忽略规则；不是功能测试。

### P1：收敛接口与可行性——下一步优先

交付：G1/G2/G3 的精确调用路径及最小 patch 清单、问卷 schema、snapshot 边界；G4 的代理 ADR、G5 的包标识/服务政策待办。
先完成只读设计。**若开始源码分支改动、依赖安装或任何无模型原型/测试，需批准相应隔离开发范围。**
验收：不存在“靠标题猜关联”“删 guard 即完成”“只查 PID 证明同实例”这类缺口；不能满足则在写主功能前停止。

### P2：问卷与同实例契约实现

依赖 P1 与源码修改/无模型测试授权。先在 Pi Web/插件的隔离固定事件夹具中实现权威控制器、回执、按问卷取消和 attach-only。
验收：本轮验收文档的实例与问卷核心矩阵全部有明确结果；没有新增模型 provider 或调用真实模型。不要把夹具测试称为生产同实例验收。

### P3：独立 Host 与 Android 原生接线

依赖 P2 与 G3。先用固定事件输入验证 Host/router，再接 Android `pi-web` backend、历史/live、普通工具和问卷 UI；隐藏未支持的后台能力入口。
验收：代码层不会启动 ACP/Agent；消息/问卷的连接换代、去重、迟到和失效状态正确。托管账号/真机连接若未授权，继续使用隔离传输夹具而不注册设备。

### P4：受保护 WebView 代理

依赖 G4；代理选型的只读研究可提前，实际 native spike 需授权。接 HTTP body、Cookie、SSE、必要 WS、背压与同 session 切换。
验收：受控页面互操作和来源负向检查通过；原生问卷仍独立验收，网页能开不替代它。

### P5：APK、托管服务与真实跨网验收

依赖 P3/P4、安全设计过关及构建/账号/设备/网络各项授权。确认独立包标识、签名和新身份，先证明独立 Host 准入，再验证桌面普通/无痕/App/内嵌网页与真实蜂窝。
验收：实际单次执行、P2P 证据、TURN/Relay E2E、撤销/异常/恢复和不占 VPN；失败如实保留。模型输入仅使用获准任务或最小功能测试授权。

### P6：独立审查与受控部署

实现后另获独立审查授权，覆盖问卷、来源隔离、权限、日志及回滚；已有旧 review 不覆盖这些改动。
通过后才讨论生产变更。锁源代码/工件/签名哈希，确认任务空闲与持久化，单独批准包装器/插件升级及服务重启。回滚见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 8. 尚待收敛而非默默假设的决策

- 事件桥接是否需要 Pi Web 核心补充，以及 attach-only/实例标识/无缺口快照的最小公开面。
- 独立 Host 的共享连接层提取范围与构建闭包；不能把深层 import 当稳定 SDK。
- Android 本地 HTTP 库、可隔离来源、Cookie/cache 策略和 API 兼容性。
- 定制 applicationId/scheme/签名与分发方式；未确认前不改现有配置。
- 作者服务的准入政策/费用、实际账号；仅在 A 不适用且获批时讨论自托管 B。
- preview/notes 的首版 UI 细节：建议安全文本/Markdown 展示 preview，保留 notes 数据；不承诺复刻所有 TUI 外观。

不对当前未知的 native/桥接工程量给固定工时承诺。优先把 G1–G4 变成可证伪的门槛，比先堆 Android 页面更能控制返工。

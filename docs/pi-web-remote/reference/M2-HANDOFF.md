# Pi Web M2 开发交接：Android App、完整问卷与加密网页兜底

> 开发引用副本，取自 `/home/allen/pi-web/M2-HANDOFF.md`（2026-11-16）。原文件 SHA-256：`4e3a71aab706efbdbc1f4acaa9081851f5e573f275490268d6b6540b07ed9883`。
> 除本说明和第 17 节部署相邻文档链接改为绝对 `file:` 地址外，正文保留历史状态；其中“尚未初始化”与“本轮仅交接”指原交接时点。用户现已授权本开发仓库初始化与规划，当前状态见 [开发入口](../README.md)，不因此扩张为实现/安装/部署授权。

更新：2026-11-16。本文是本阶段**最新交接入口**，取代 `M2-PLAN.md` 中已经过期的需求与待决事项；旧稿只保留历史依据。本文的“拟议”内容不是现成接口或实施授权。

## 0. 接手者先读这十条

1. 生产安装为 `/home/allen/pi-web`，不是开发仓库。入口仍是 `http://127.0.0.1:30141`，生命周期由用户服务 `pi-web.service` 管理。
2. 建议开发仓库为 `/home/allen/projects/pi-web-remote`；这是建议，**尚未创建、克隆或初始化**。用户将自行切换工作区；切换目录不自动代表批准安装、开发或发布。
3. 唯一执行后端必须是当前 Pi Web 持有的 Pi SDK/Agent。App 和网页是它的不同客户端，不能另起 `pi`、`pi-acp` 或第二个 SDK 会话来冒充同步。
4. Android 不得占系统 VPN 槽位。App 优先；P2P 优先、TURN/Relay 兜底，所有跨网络业务路径必须保持 E2E。
5. 优先复用作者 DSH Remote 托管服务器；协议上有复用依据，**独立 Host 的实际注册、账户准入、费用和连通尚未验证**。不因 Pi Web 后端就直接自建服务器。
6. 用户接受有限 App 定制；不要求适配子代理树、上下文统计、任意插件小组件，但**完整原生问卷是必须项**。
7. 完整问卷至少包含单选、多选、自由输入、整份提交、取消、正确回到原工具调用及跨端失效处理。用户明确不选“多选暂用数字输入”的最终方案。
8. 还必须能在 App 内切换到当前 Pi Web 网页，经同一套 Remote 加密网络访问，不另开公网网页，不把切网页当成原生问卷已适配。
9. 已发现实质兼容点：Pi Web SSE 心跳 30 秒，Remote 0.6.4 HTTP 分块读取空等 20 秒会报错关闭；不能原样套现有预览代理。
10. 当前仍是**方案/只读调研阶段**，本次只获准整理 Markdown 交接。未开发、未构建 APK、未登录或注册新 Host、未部署；M2 未验收，M3 也未整体通过。

## 1. 权限、红线与阶段状态

### 已获用户确认的设计方向

- 参考 ds-harness-remote 的 App、P2P/TURN/Relay 和端到端加密，而非 VPN。
- 接受为原生问卷和内嵌 Pi Web 做限定范围的 Android App 适配。
- 接受继续研究必要的最小 Pi Web/问答插件结构化桥接补充；**这不是批准实际修改代码或安装新版本**。
- 接受 E2E 终点是 Android 原生客户端与本地 Host 适配器；Host→Pi Web 是受信主机内部回环 HTTP。
- 接受 DSH 文档中的服务端参与账号授权、首次设备公钥分发/固定的信任模型，不额外要求已经实现带外指纹核验。
- 只要求电脑唤醒、WSL 在线时可用，不要求 Windows 重启后无人值守自动拉起或防睡眠。

### 尚未授权的动作

不因阅读本文而执行：安装依赖/隧道/Android 工具链、修改代码或运行配置、克隆初始化仓库、注册设备、登录远端账号、发布入口、开放端口、改防火墙、启动 tailscaled、新建 VPS/域名或付费、重启 Pi Web/WSL、修改模型/provider、执行应用模型或性能测试。

任何后续实现、构建、本地原型、设备验证及部署，都要按下一阶段用户明确授权的范围执行。本文可作为获批后的设计依据，不能替代授权。

### 一直有效的保护边界

- 不修改既有 DSH 安装、profile 或其运行状态；不借用其 token、deviceId、私钥、provider 或模型凭据。
- 不删除、覆盖、回放旧备份覆盖现用会话，不直接写 session JSONL 做同步。
- Pi Web 内置子代理保持关闭；沿用 pi-subagents 插件，不混用两套实现。
- 配置隔离不是 OS 沙箱：Pi 工具仍按 allen 的 Unix 权限运行，获准 App 提交任务意味着具有相应高权限代理入口能力。
- 工具/兼容性失败记录原始错误；不要切模型反复试，也不要把父代理代查包装成子代理验证通过。

里程碑：M1 由用户确认完成；M2 方案交接完成但开发/部署/验收均未完成；M3 插件已安装且本任务执行了部分能力，兼容性/UI 等仍待验收；M4 不在本阶段。

## 2. 工作区推荐与代码/运行数据隔离

推荐把 **DSH Remote 的开发分支/派生仓库直接放在** `~/projects/pi-web-remote/`，而不是在部署目录里 git init，也不是把整个部署目录复制进去。

建议布局，均为未来结构，不表示已创建：

```text
~/projects/pi-web-remote/       DSH Remote 派生开发仓库
  apps/android/                复用原版 App，限定增加问卷接线与网页模块
  packages/                    复用原协议、crypto、client-core、webrtc
  apps/pi-web-host/             拟新增：独立 Host/接口适配，名称待设计
  docs/                        接口、架构、验收、运维和本交接文档的开发副本

~/pi-web/                      当前运行/部署目录，默认不作为开发工作树
  service.mjs                  启动包装器，修改需单独批准
  runtime/                     活跃配置、会话、缓存与秘密，不得提交 Git
  node_modules/                已安装发布物，不作为源码编辑位置
  M2-HANDOFF.md                本文，当前交接入口
```

如果确实需要修改问答插件源码，另行批准后在 `~/projects/` 建它的源码分支；若确实需要 Pi Web 核心补充，同样在独立源码仓库开发。不要直接编辑已安装的 node_modules 再称为可维护实现。

原因：生产根目录不是 Git 仓库，包含活跃状态与秘密；开发依赖更新、构建、分支切换、清理不能影响正在运行的会话。新仓库必须排除 runtime、身份/token、会话、node_modules、构建缓存和不应入库的 APK/签名密钥。

定制 APK 建议使用独立 applicationId、签名及设备身份，与作者原版并存；不能用自己的签名无缝覆盖作者 APK。还需检查 Expo 原生插件中的硬编码包名、组件、深链/共享标识冲突，不能只改 App 显示名称。不得搬运原 App 的私钥或登录数据。具体包名/分发方式未确定。

## 3. 当前部署：实际观测与历史记录分开

### 本次交接前的只读观测

- 2026-11-16T13:25:11Z：`pi-web.service` 为 enabled、active/running，MainPID=287，NRestarts=0；单元路径 `/home/allen/.config/systemd/user/pi-web.service`。
- 同时 `ss` 只显示 `127.0.0.1:30141`，next-server 观测 PID=543；未改变监听。
- 2026-11-16T13:30:05Z：匿名 `GET /` 返回 200、标题 Pi Web；匿名 `GET /api/sessions` 返回 200，列表 **2 项**；`GET /api/subagents/settings` 返回 `enabled=false`。只统计元数据，不读取正文、不发 prompt。
- 13:30–13:31Z 的安装元数据：Pi Web 0.17.0、嵌入 Pi SDK 1.5.2、pi-subagents 0.88.1、pi-web-access 0.48.0、rpiv-ask-user-question 2.15.0。
- settings 的非秘密默认选择观测为 `local-ollama / qwen3.5-9b-official:q4_k_m-ctx16k`、thinking high；仅为观测，**不能自动把该配置写入新项目**，不推断所有活跃会话均用此默认值。

### 必须保留的快照变化

较早 11:13Z 的会话列表为 1 项，交接时为 2 项。`settings.json` 的指纹也由早期 `2e51bf7d...` 变成 13:30Z 的 `de30ddb9...`，可见顶层多了 extensions 字段。**原因/修改者未核实，本代理没有写该文件，不擅自还原，不归因给用户或其他代理。**不能再声称整个会话期间所有配置始终字节不变。

下面指纹是交接文档写入前的新基线，不含秘密值；文档整理的前后比较以此为准：

```text
service.mjs                 88bb8ded04354fa66d127a8262fd1be73639903c6d9d490ca924567f891af305
pi-web.service              af8a8f44138d8037b4f684191a9113e8458a36f3824c5429fe0fb2dabe953d4e
runtime/agent/settings.json de30ddb97b7e3d3bcd56fca77b404b282f0d639e16af7538d16580704c9abd1c
runtime/agent/models.json   7e15a3da42600fb82db5bc76acbb765140eec40699234d12f4e9b9a88cc4bcba
runtime/agent/models-store.json 44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a
runtime/network.json        63b55ae132d410e68e2f366040261e7446c320f6f6625bcc6ae79406dfff244c
package.json                d1e5969139ed46d0e123693c2ceeaadc254077d322852c4884958d6420d04839
package-lock.json           d71aa95ada5ee9957288a95fd582f140ab267933f810e6bda5cd19b7a89e5007
```

后续接手必须重新观察，不把 PID、数量、指纹或历史验收当永恒事实。普通 shell 的 systemctl 若报 `No medium found`，检查已有用户总线环境；本轮只读查询曾显式指定现有 `/run/user/1000/bus` 后成功，不因此修改服务环境或重启总线。

### 已知运行约束

`service.mjs` 固定回环绑定、独立 HOME/XDG/PI_CODING_AGENT_DIR 和环境白名单，闲置回收为 0。systemd 管理生命周期；不要手动 start 第二份，不跨命名空间用上游 status/stop 清理 PID。

包装器尚未透传 `PI_WEB_PASSWORD` / `PI_WEB_ALLOWED_HOSTS`。仅往 systemd 添加环境变量不会让它们生效。启用原生认证时必须另批受限凭据传递和最小包装器适配；不要复制整个 process.env。

现有健康判断看 HTTP 成功和 `<title>Pi Web</title>`，不能证明启用认证后的受保护功能就绪；需区分进程/HTTP存活、预期匿名拒绝、已认证只读业务。当前 systemd 不按 HTTP 探活重启，不能虚构已有 401 重启循环。任何重启先确认持久化和任务窗口，不承诺在途任务续跑。

WSL 内 systemd/linger 不保证 Windows 唤醒或 WSL 永久在线。这里只接受电脑在线时可用，不扩成 Windows 生命周期工程。

## 4. 源码与发布基线：不要追 main 推断手机能力

- Pi Web 源码基线：`agegr/pi-web@174bff967807cdb59abb0204198d3d7cc19c862d`，对应安装版 0.17.0。
- Android 用户自述：原作者 GitHub Release 下载的 **0.6.4**，尚未比对手机 APK 哈希/构建。
- v0.6.4 发布页注明 APK 在 2026-11-09 从 `0a0ac9a1` 重建、build 71，release tag 和其他包资源未变。调研锁定完整提交 **`0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`**。不要把 `v0.6.4` 标签直接当作这次更新 APK 的准确源码。
- 该提交 Android package.json：Expo `~57.0.13`、React Native `0.86.2`、react-native-webview `13.16.1`；这是源码依赖，不表示本机 Android 构建环境已经就绪。
- 本机 DSH web profile 的 ds-harness-remote 为 0.6.4，TUI profile 为 0.6.0；只读查看过包元数据/源码，没有更新 DSH。
- 当前安装问答插件 `@juicesharp/rpiv-ask-user-question@2.15.0`；npm gitHead 为 **`ce6d3530410812ca504ec294995581a52170f9e1`**，调研按该提交。
- 曾查 main `f8e62202...` / 0.6.5 文档，仅作版本漂移参考。发布列表可见 v0.6.5，不代表可直接替代用户的 0.6.4 验收，也没有批准升级。
- 旧安装 README 与较新 main 对最小自托管 Server 的 WebRTC/TURN 能力有差异。任何 B 方案都要锁匹配版本，不能套新文档到旧部署。

## 5. 多端同步原理：三个接入不要混同

### Pi Web 浏览器

服务端 registry 按 session ID 复用活跃 AgentSessionWrapper；相同会话的并发启动也有锁。每个 SSE 客户端注册 listener，连接时获得当前状态/待处理 UI，后续事件分别推送。普通浏览器与无痕窗口无需共享本地存储。

### DSH Remote → 原生 DSH

不是 ACP。走 DSH 原生 Typert Remote carrier，转发同一个 DSH 后端的业务接口和事件。原生 DSH 可多端，不表示所有 ACP backend 等价。

### DSH Remote → 现成 Pi/ACP

通过 pi-acp wrapper 管理 Pi。0.6.4 ACP gateway 的 `sessionOwners` / `claimSession` / `publishToSession` 限制一个会话一个 Remote connection owner，live 输出发给 owner；其他受信任连接读历史不等于订阅同一 live 流。

这不是 ACP 永远不能多端，而是该版实现策略。一个 Android Remote 客户端加多个 Pi Web 浏览器，不必然触犯此限制：浏览器不属于 ACP gateway 的 Remote owner；关键是桥接必须使用 Pi Web 原实例，不能启动 pi-acp 替代。

验收不能只看相同历史、相同 session ID 或相同服务器 PID，要证明原 SDK/Agent 关联、连续事件和单次实际执行。目标至少包含一台 Android 与现有桌面/无痕客户端；不额外承诺多台 Remote ACP App 可同时持有写 owner。

## 6. 目标架构与四个最小改动面

```text
桌面浏览器 ──────────────────────────┐
                                     │
Android 原生聊天/完整问卷              │
       ↕ Remote Noise 安全通道         ├─ Pi Web ─ 唯一的原 SDK/Agent
Android 内 WebView                    │
       ↕ 手机受保护本地代理            │
       ↕ 同一套 P2P/TURN/密文 Relay    │
       ↕ WSL 独立 Pi Web Host ────────┘
               只访问 WSL 回环 30141
```

四块范围：App 问卷接线；完整问答的结构化桥接补充；Android WebView/本地网络模块；独立 Host 的 Pi Web API/事件与网页转发适配。

优先复用既有 UI、协议、crypto、client-core、webrtc，不自创加密、不重写整个 App/Remote 产品。公开 package 入口依赖 Cordis，未证实存在即插即用的独立 PiWebHost SDK；实际可复用 runtime 边界/工程量仍需确认，不把“最小改动面”说成已知小工时。

不伪装成原生 Harness、不填假版本/能力、不编造 frameRpcId，不以拷贝会话文件做同步。若必须进入大规模 App/Pi Web/DSH 核心重写，暂停重新审批。

## 7. Android 原生 UI 已确认的复用点

0.6.4 中有真正 Pi 适配，不只是名称：

- `services/pi.ts`：loadPiCatalog、readPiHistory、Pi 模型目录与选择入口。
- `services/cursor.ts`：虽然名字含 Cursor，实际共用于 Pi 等 ACP backend；转换回答/思考增量、用户消息、tool_call/update、审批等。
- Pi 分支专门处理 `_meta.terminal_output` 和 `_meta.terminal_exit`，保留运行/成功/失败及有界 bash 输出。
- `types.ts` 的 ChatItem 包括 message、tool、approval、question；`screens/chat/messages.tsx` 有 QuestionCard，支持多选与自定义文字。
- `state/session-event-actions.ts` 按当前 backend 和 session ID 接事件；消息渲染通路没有要求必须由 App 先发 prompt，对网页发起/App观察有利，但运行状态、停止、队列和重连仍未验证。
- 历史与 live 有合并逻辑，但 ACP synthetic IDs 不共享完整序列游标，不能假定现有去重自动适配 Pi Web。

不能因此保证任意插件 TUI、图片输入、完整 thinking 历史、模型配置、终端/文件功能都无损可用。普通工具结果仍应显示，免做增强面板不等于丢弃工具输出。模型/provider 入口是否隐藏/只读需按批准范围处理，不能让接入暗中改变配置。

## 8. 完整原生问卷：当前接口、实质缺口与候选设计

### 当前已有的 RPC 基础

Pi Web 的普通 UI 请求包含 `id`、method、title，以及 select 的 options 或 input 的 placeholder 等。现有形态示意：

```json
{"type":"extension_ui_request","id":"<dialog-id>","method":"select","title":"...","options":["A","B"]}
{"type":"extension_ui_response","id":"<same-dialog-id>","value":"A"}
{"type":"extension_ui_closed","id":"<same-dialog-id>"}
```

取消用 `cancelled:true`，确认用 `confirmed:boolean`。服务端按请求 ID 找等待回调，settle 后清理并广播 closed；onEvent 会重放仍 pending 的 UI。**基础逐题选择/输入/确认可以据此安全接原调用，而非猜标题。**

但响应处理对未知/已关闭 ID 静默返回，命令处理仍可能 HTTP 成功。App 不能把 HTTP 200 当答案已采纳；需要关闭/最终结果或明确 verdict，提交不确定时不能自动重发。

### 为什么完整问卷不能只靠现有 RPC 字段

问答插件 2.15.0 检测 `ctx.mode === "rpc"` 后走 rpc-fallback：逐题 select/input；多选转成数字/文字输入，无一次多题复核提交的原始表单。Pi Web 对应源码明确以 mode rpc 绑定扩展 UI。

现有普通 UI 请求没有原问卷 toolCallId、questionIndex、multiSelect 和完整结构化关联，不能靠解析本地化标题、猜顺序或模拟按键拼成可靠完整表单。用户已选择保留完整原生问卷，不能把数字输入降级当最终完成。

### 公开 answer 事件的关键修正

插件确实定义 JSON-safe 的 prompt、blocked、answer、answer-result 事件，且 toolCallId/选项索引/自定义文字有严格校验；其 first-wins 控制可复用。

**但当前 answer-channel 对 host=rpc 返回 `unsupported_host`。**前期“已有事件可直接手机回传”的判断必须收窄，不能直接应用于当前 Pi Web。不能仅删 guard、伪装 mode=tui：RPC walker 也必须合作接收结果并关闭自己的原生对话，否则会出现假成功/悬挂。

### 候选设计，尚未实现或最终定名

- 以 `(sessionId, toolCallId)` 标识整份问卷，原 Agent/插件持有权威状态。App 与 Host 只持投影，不成为第二个执行器。
- 优先复用插件的完整问题结构和 resolveExternalAnswer 校验，不重复发明多选/自定义文字规则。
- 同一完成控制器接收“网页 RPC walker 完成”和“App 整份提交”；整份问卷只产生一个最终结果。App 完成时安全终止属于该问卷的未决原生对话，不能误取消其他问题或整个 Agent。
- 新桥接需提供完整 question snapshot、回答/取消、明确 accepted/invalid/stale/already-closed 等回执、关闭与重连快照；这些是**拟议接口，不是现成 API**。
- 每次提交有稳定 operation/request ID；重复到达查询原结果，不再次完成工具。先前网页的逐题选择与最终提交如何协调需明确定义；不把某题的局部选择误当整份已提交。
- 只影响当前问答能力，优先桥接扩展/插件最小补充，避免 Pi Web 核心大改。SDK 内部事件如何安全导出给独立 Host、RPC 完成如何关闭，是实施前具体设计门槛，不声称已打通。
- 原生 QuestionCard 可复用单选、多选、自由文字与一次提交；增加正确取消、等待/失效状态及新回调，不沿用强绑 DSH requireProxy/frameRpcId 的回答路径冒充 Pi 问卷。
- 首版保证范围聚焦当前 rpiv-ask-user-question 与标准 Pi UI 对话，不承诺所有第三方自定义问答。preview/notes 的展示细节尚未逐项确认，不伪称完整复现全部 TUI 外观。

## 9. App 内网页：为何需要 Android 网络模块

原版已有 react-native-webview，使用于 PDF 等，但没有 Android loopback 预览入口。现有 desktop LoopbackPreview 依赖 Node 的 http/server/ws，不能原样放进 React Native。

推荐研究“真实手机本地 HTTP 代理 + WebView”，让网页照常处理资源、POST、Cookie 和 SSE，再由原生/JS Remote runtime 走 Noise 转发；不全面改写 Pi Web 的 fetch/XHR/EventSource。

不选简单 JS 劫持/导航回调的依据：Android shouldOverrideUrlLoading 不覆盖 POST；WebResourceRequest 提供 URL/方法/头但没有通用请求体 API；WebView 13.16.1 的 Android source headers 只支持 GET；页面加载前脚本注入被官方标注 Android 非完全可靠。WebViewAssetLoader 对安全本地资源有帮助，但不自动等于任意动态 POST/SSE/WS 的透明代理。

安全与兼容要求：

- 仅授权目标 `127.0.0.1:30141`，不成为任意内网/TCP 代理；Host/Client 独立连接和句柄隔离。
- 手机入口仅回环且有不可预测访问凭据/来源限制；仅回环并不能防其他本地应用访问，不能只靠随机端口。
- WebView 只加载受控来源。加密密钥/设备 token 留在原生 Remote 层，不给网页脚本；外部导航不获得原生桥接权限。
- 处理相对/绝对资源路径、Host/Origin、Cookie 作用域、CSP、重定向、下载/上传、SSE取消和背压；不要用全放开 Origin/CORS 救场。
- desktop 的随机 `.localhost` origin 与 Cookie 隔离是参考，不假定 Android DNS/WebView 已实测支持。来源方案和本地代理库选型仍待定，避免手写不完整 HTTP 解析器。
- 原 desktop 代理拒绝 Service Worker 注册。App 网页是否允许 PWA/离线缓存须明确，不自动继承手机上不安全的缓存/来源策略。
- 切换只切客户端视图，跳到同一 session；退出 App 不停止原 Agent，关闭网页只释放自己的转发句柄，不取消原任务。

## 10. 已确认的 HTTP/SSE 兼容冲突与限制

源码事实：

- Pi Web `AGENT_EVENT_HEARTBEAT_MS = 30_000`。
- Remote 0.6.4 的 loopback `http.read` 空等 20_000ms 后抛错，关闭 handle 并返回 LOOPBACK_READ_FAILED；desktop 下游随之结束/销毁响应。
- 因而安静 SSE 按原样转发存在 20 秒先于 30 秒心跳的冲突。**未运行复现，不写成已经测得的线上故障。**

候选修正：在新 Host 传输等待预算内返回 `{data:"", done:false}`，表示尚无数据，客户端继续读取，真实上游结束才 done=true。现有循环已区分空数据和 done，可作为不改中继业务 API 的方向；仍须检查 RPC timeout、空读频率、取消、背压、连接回收与实际重连。不要伪造业务心跳或简单无限提高超时。

现有边界：chunk 64 KiB；请求体 1 MiB；HTTP 累计响应 64 MiB；活动 handle 16；WS 单消息 256 KiB，另有有界积压。网页上传、长 SSE 达到累计上限、资源并发、后台暂停均需设计。不能删掉所有上限来实现“兼容”。

## 11. 作者托管服务器、自托管备选与 E2E

### A：优先复用作者托管服务

默认地址 `https://dsh.r2049.cn`。公开协议描述账号/独立设备注册、presence、membership、signaling、TURN 与 opaque Relay。Server 不解析安全通道里的 Pi/DSH 业务映射，未知客户端版本也不应仅因诊断版本字段被拒绝。

因此有协议依据认为无需为 Pi Web 增加 Server 业务接口。但只读抓取主页仅得到加载页面，**没有实际账号登录、Host 注册、连接、TURN 凭据或负载验证**；没有核实自定义 Host 的托管服务准入政策、费用/限额/SLA。不能说作者已承诺支持、已免费或已经接通。

Host 与手机须使用同一用户明确授权账号；新 Host 有独立 key/device token。账号选择尚未实施，不把复用服务器混同于复制 DSH 登录文件。

### B：仅在 A 确实不适合时考虑自托管

需要匹配版本 Server、公开可达的 HTTPS/WSS、有效 WebRTC signaling/STUN/TURN 及密文 Relay。不能把唯一协调服务器放在同一个不可达回环 WSL 就声称跨网。较新源码支持 WebRTC，但 STUN/TURN 留空时可能是 Relay-only，不满足 P2P 能力要求；依版本确认。

VPS/域名/流量/维护均未选型或购买，不给虚构费用。自托管也解决不了本地 live-session/问卷/App 适配缺口。

### 用户已接受的信任边界

所有跨网络业务使用既有 Noise `Noise_IK_25519_ChaChaPoly_SHA256`，P2P/TURN/Relay 都不降级明文。控制面/账号仍需 HTTPS/WSS。

解密端为 Android 与本地 Host；手机内部 WebView→本地代理以及 WSL Host→Pi Web 属受信设备内部，不宣称这两段 HTTP 是 TLS。

Server 仍管理账号/新设备授权及首次公钥分发；同账号初次固定身份不是独立带外核验。服务器能看到连接元数据，能拒绝/延迟服务；端点被攻破也能读明文。用户已明确接受这些边界，后续不要重复把它列成尚未决定，也不能宣传“完全不需信任服务端”。

## 12. 获批后建议推进顺序，不是立即执行清单

1. 切到新工作区先读本文、部署 README/MILESTONES 和原包装器，确认目录/工具边界。不要先 npm install、git clone、登录或启动服务；请用户明确下一阶段授权。
2. 获批后建立可追溯源码仓库/分支，锁 APK 来源提交和依赖；不以 latest 更新代替兼容性核对。新仓库建立 AGENTS/README 指向设计红线，生产目录不 git init。
3. 先给出问卷状态机/事件 schema/回执与跨端竞争设计，定位最小桥接补充。不做字符串猜测、假 frame ID 或模式伪装。
4. 做隔离的静态/固定事件契约验证：同一 session 只读附着、完整问卷、重复/迟到/取消及 SSE 空等。使用测试数据不等于新增模拟模型 provider；没有批准不运行测试，不能为测试调用模型。
5. 完成 Android 代理选型、来源/凭据隔离与构建方案；先明确 native 模块和 APK 并存影响，再估工时。不承诺“只改几个 JSX”。
6. 代码实现和本地原型另批。真实业务写入、实际 Android 连接作者服务、设备注册及跨网验收再按授权开展；任何费用/防火墙/服务重启另确认。
7. 实现后需新的独立安全/可实施性审查，覆盖完整问卷与 WebView 代理。旧 reviewer 没有放行这些最终新增能力。
8. 只在验收和审查通过后讨论受控部署；改包装器/插件时先确认持久化、任务空闲和可回退工件。

## 13. 后续验收的不可替代项

以下均为计划，除明确观测外未执行：

- 真实安装的 Android APK 版本/来源/签名可追溯，确认不占 VPN 槽位；定制包与原版并存，不复制原身份。
- 作者服务独立 Host 实际准入、同账号授权、撤销和 ICE 能力；不能以官网能打开代替。
- 桌面普通/无痕网页与 App 同一原 session、同一 SDK/Agent；只读订阅不隐式创建替代实例，输入由原实例单次执行。
- 完整问卷：单选、多选、自定义文字、多题整份提交、取消、错误答案拒绝、超时/Stop；答案回原调用而非新 prompt。
- 网页先答、手机先答、同时提交、重复/迟到包、问卷已关闭、部分网页作答后手机最终提交；一个最终结果，明确回执，不假成功。
- App 断线/后台恢复/Host 断线后重连：恢复当前未决问卷和实际运行状态，不重发任务、不重放历史成新事件。
- App 内切网页访问原 session；静态资源、API POST、Cookie、SSE、必要 WS、原生与网页之间切换及取消均实测。
- 安静状态超过 30 秒的 SSE、空读、多次心跳、64 MiB 边界、并发/背压、断网和实际结束；传输错误不触发重提模型任务。
- 在允许直连的真实环境证明业务实际 P2P；不能直连时证明 TURN/Relay 兜底仍 E2E。只看配置开关不算；不承诺所有蜂窝 NAT 都能直连。
- 匿名、非授权设备、撤销 token、公钥变化、过期/错误请求拒绝；本地代理来源、跨端口 Cookie、重定向、外部网页访问原生桥接的负向检查。
- 不泄漏设备/账号 token、私钥、Authorization、对话正文到中继或诊断日志。看不到明文抓包不是单独的 crypto 正确性证明；不自创加密协议。
- 退出 App/停止桥接不停止 Pi Web，不取消原任务或释放别人的租约；回滚后原网页仍可操作未决问题。
- 手机关闭 Wi-Fi 后真实蜂窝验证，不以同 Wi-Fi 测试替代；Windows/WSL 冷启动与睡眠恢复仅在另批时做。
- 正常工作流需模型输入时使用用户本来批准的任务，或另获最小功能测试授权；不做模型性能/指令遵循测试，不换 provider。

逐项标通过/失败/未验证。保留脱敏证据，不能把只读源码、测试用例存在、历史 M1 或包已安装改写成新端到端通过。

## 14. 回滚与数据保护

- 只停止/撤销新 App/Host 的连接和设备身份，释放自己持有的资源。不要全局 reset/logout、停止共享 Server/daemon 或注销原 DSH。
- 不停止 Pi Web，不取消原 Agent/问答。桥接掉线后原网页必须仍可完成待回答问题；不能替用户自动回答或拒绝。
- 不确定提交保留状态并核对，不重发 prompt；已经生效的业务操作不能靠卸载 App 自动撤销。
- 插件/包装器若有获批变更，准备源代码工件、依赖版本和配置引用的对应回滚；等待活跃工具/问卷结束，或另获明确中断授权，不在悬挂问卷中直接热删实现。
- 不覆盖 runtime/session 文件，不回放旧备份恢复当前状态；新密钥清理按明确范围另批，不能误删 DSH 或 Pi Web 目录。
- 如取消原生认证配置，先确认所有远端入口关闭；不能留下远端在线但密码被撤销的中间态。

## 15. 已执行的子代理与独立审查，不能扩张结论

初始工作流 `2ac90871-6da9-42da-9bfe-b34c1ba6df8c`：

- 本地 scout `e07f4271-49bf-46c7-a3d7-f522a1001f8e`：首次 read 后端启动失败，部署检查未完成。父代理补查明确单列，不算 scout 通过。 其报告中无系统时钟支持的“2026-07-17”不采用，按本轮 2026-11-16 宿主日志定位。
- researcher `185cc2c7-8e5f-4e3f-8dff-56c32c3ea56b`：实际调用成功 web_search、fetch_content、get_search_content，父代理检查原始调用和部分原文；不是只看包安装。日志有两次搜索/抓取和 16 次内容读取结果；部分 URL 404/source_check unclear 不能当通过。
- reviewer `96dc07d6-b416-4d8d-a6d0-cb524e312ad1`：仅条件通过初拟设计，文件工具受阻且没有独立网页工具，未放行部署。

App/P2P 修订 reviewer `85ba38bd-3239-4b22-9b98-5b2fc977dc44`：新上下文基于提供的证据，条件通过“待验证技术路线”；部署/兼容性承诺/业务写入 BLOCK。没有独立操作手机或核验源码，且早于最终完整问卷、WebView 和 SSE 冲突收敛，**不能当这些新增项已获独立放行**。

报告位于 `runtime/agent/sessions/--home-allen-feishu-local--/subagent-artifacts/outputs/<workflow-or-run-id>/`，受插件保留策略管理，未来可能清理；本文和锁定源码链接才是跨工作区持久依据。

M3 只记本次真实执行到的子代理/搜索能力。文件兼容性、完整工具回传/UI 呈现等仍未验收，不升级为整体完成。

## 16. 工具与协作注意事项

- 当前原工作区为 `/home/allen/feishu-local`，包/执行 cwd 曾与文件工具项目根不一致。
- read 曾报 `path is outside project`；子代理 read 报 `filesystem unavailable: backend error: filesystem helper exited during startup`。ctx_execute_file 将项目根解析成 `/home/allen/pi-web/node_modules/@agegr/pi-web`，对安装根文档拒绝读取。未修改权限/allow rule 或工具安装，未反复换模型。
- 文档/元数据使用现有可用执行工具检查；记录文件级工具检查未执行，不冒充其通过。切新工作区后重新核对实际 cwd、文件权限与工具根，不能假定自动修复。
- 子代理网页 responseId 不保证父会话可读，曾返回 No stored results；使用已保存日志检查调用，不循环重试。工作区切换后不要依赖旧 ctx 索引或网页缓存可见。
- memory_search 缺 qmd，未安装修复；直接记忆文件可用。交接不能依赖语义记忆检索成功。
- 旧 `docs/acp-integration.md` 404，现行路径为 docs/acp-remote.md；不要反复抓坏路径。
- context-mode 提示版本过旧，未升级。授权不等于允许顺便升级工具链。
- 中文沟通，不用 Markdown 表格；明确区分事实、用户决策、建议和未验证。大输出用 context-mode 过滤/索引；网页先抓取索引再检索；读写前确认工具路径覆盖。不要向日志打印秘密。
- 本交接没有新建部署根 AGENTS.md，避免新增自动加载的上下文影响运行中的工作空间；新开发仓库建立后再放项目约定。

## 17. 锁定来源与下一位 Agent 的阅读顺序

先读本文，再读部署 [README](file:///home/allen/pi-web/README.md)、[MILESTONES](file:///home/allen/pi-web/MILESTONES.md)、`service.mjs`。历史 [MIGRATION](file:///home/allen/pi-web/MIGRATION.md)、[RESULTS](file:///home/allen/pi-web/RESULTS.md) 保留历史失败和路径，不重写成当前测试通过。[M2-PLAN](file:///home/allen/pi-web/M2-PLAN.md) 已归档，不再作为当前需求/授权依据。

下面链接均为实际调研读取的官方源码/文档；测试链接只证明测试用例存在，本阶段未执行这些测试。

### Pi Web 0.17 基线

- [rpc-manager：registry、事件、UI绑定与回答](https://github.com/agegr/pi-web/blob/174bff967807cdb59abb0204198d3d7cc19c862d/lib/rpc-manager.ts)
- [UI/消息类型](https://github.com/agegr/pi-web/blob/174bff967807cdb59abb0204198d3d7cc19c862d/lib/types.ts)
- [SSE路由](https://github.com/agegr/pi-web/blob/174bff967807cdb59abb0204198d3d7cc19c862d/app/api/agent/%5Bid%5D/events/route.ts)
- [SSE快照与恢复](https://github.com/agegr/pi-web/blob/174bff967807cdb59abb0204198d3d7cc19c862d/lib/agent-event-stream.ts)
- [30秒心跳](https://github.com/agegr/pi-web/blob/174bff967807cdb59abb0204198d3d7cc19c862d/lib/agent-event-wire.ts)
- [问答RPC测试源码](https://github.com/agegr/pi-web/blob/174bff967807cdb59abb0204198d3d7cc19c862d/lib/rpc-manager-extension-ui.test.mjs)

### Remote Android APK 对应基线

- [v0.6.4 发布页与APK更新记录](https://github.com/liguobao/ds-harness-remote/releases/tag/v0.6.4)
- [协议、原生DSH/ACP和Android预览边界](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/docs/protocol.md)
- [网络与传输](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/docs/network.md)
- [E2E与首次信任](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/docs/end-to-end-encryption.md)
- [Host注册契约](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/docs/plugin-integration.md)
- [Pi目录/历史](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/src/services/pi.ts)
- [ACP通用UI投影与Pi工具增量](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/src/services/cursor.ts)
- [QuestionCard与消息组件](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/src/screens/chat/messages.tsx)
- [原问卷/审批回答分流](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/src/state/prompt-actions.ts)
- [事件接收](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/src/state/session-event-actions.ts)
- [ACP owner与live输出](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/packages/plugin/src/acp/gateway.ts)
- [HTTP/WS Host、20秒与64MiB限制](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/packages/plugin/src/loopback-host.ts)
- [desktop本地代理、Cookie/来源及空块循环](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/packages/plugin/src/loopback-preview.ts)
- [转发schema与上限](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/packages/protocol/src/loopback.ts)
- [Android依赖](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/package.json)
- [Android原生模块接入方式](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/plugins/with-remote-foreground-service.js)
- [Pi测试源码，未执行](https://github.com/liguobao/ds-harness-remote/blob/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0/apps/android/tests/pi.test.ts)

### 当前问答插件基线

- [公共事件与答案结构](https://github.com/juicesharp/rpiv-mono/blob/ce6d3530410812ca504ec294995581a52170f9e1/packages/rpiv-ask-user-question/events.ts)
- [RPC unsupported_host与first-wins](https://github.com/juicesharp/rpiv-mono/blob/ce6d3530410812ca504ec294995581a52170f9e1/packages/rpiv-ask-user-question/answer-channel.ts)
- [真实RPC逐题/多选数字回退](https://github.com/juicesharp/rpiv-mono/blob/ce6d3530410812ca504ec294995581a52170f9e1/packages/rpiv-ask-user-question/rpc-fallback.ts)
- [工具入口与mode路由](https://github.com/juicesharp/rpiv-mono/blob/ce6d3530410812ca504ec294995581a52170f9e1/packages/rpiv-ask-user-question/ask-user-question.ts)
- [外部回答测试源码，未执行](https://github.com/juicesharp/rpiv-mono/blob/ce6d3530410812ca504ec294995581a52170f9e1/packages/rpiv-ask-user-question/ask-user-question.external-answer.test.ts)

### Android / WebView 官方依据

- [WebResourceRequest字段](https://developer.android.com/reference/android/webkit/WebResourceRequest)
- [WebViewClient拦截边界](https://developer.android.com/reference/android/webkit/WebViewClient)
- [本地内容与安全来源](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
- [react-native-webview 13.16.1 API](https://github.com/react-native-webview/react-native-webview/blob/v13.16.1/docs/Reference.md)

## 18. 切换工作区后的接手提示词

可交给新会话，按实际所选工作区调整路径；这段话本身不授权实施：

```text
先阅读 /home/allen/pi-web/M2-HANDOFF.md，以及其指向的部署 README、MILESTONES、service.mjs。
本工作区是开发目录，/home/allen/pi-web 是活跃部署目录，禁止把 runtime/凭据/会话拷进 Git。
继续核对锁定源码与当前状态，给出完整原生问卷和加密 WebView 的接口设计、最小改动清单、分阶段验证与回滚。
保持同一 Pi Web 活跃实例，不另起 pi-acp/Agent；不占 VPN；P2P优先且各路径E2E；优先作者服务器但尚未实测准入。
完整问卷必须适配，不能最终降级数字输入；网页是额外兜底，不替代原生问卷验收。
目前只完成方案与文档交接。开始代码、依赖安装、原型测试、账号/设备注册、APK构建或部署前，先确认该阶段的明确授权。
不改DSH、不借凭据、不覆写会话、不换模型/provider、不做模型性能测试；工具失败据实记录，不循环重试模型。
```

## 19. 本次文档交接的完成边界

本次正式文档仅新建本文，更新 README/MILESTONES 入口与旧 M2-PLAN 的归档声明；历史 MIGRATION/RESULTS 不重写。另在 agent MEMORY.md 记录交接入口和已确认决策，不保存秘密或会话正文；qmd 仍缺失，不声称语义搜索可用。尚未创建推荐开发目录或任何实现模块，没有新 AGENTS 自动上下文文件，没有安装、登录、构建、模型测试、服务重启或公网变更。

正式实现前仍有未验证项：独立 Host runtime 接入方式、同实例控制语义、结构化问卷 RPC 补充、Android 本地代理选型/安全来源、真实 Server 准入与价格、实际 APK/蜂窝/P2P/E2E与双端交互。本文没有把它们包装成通过。

### 文档落盘后的自检回执

2026-11-16T13:39:21Z：四份交接相关文档共 67 个 Markdown 链接完成 URL 语法/本地目标存在性检查，无错误；本轮没有重新在线验证每个远端链接。文档写入前后，上述 8 项运行/依赖文件指纹全部一致。Pi Web 仍 active/running，MainPID=287、NRestarts=0。推荐开发目录仍未创建。该自检不是 App、问卷、P2P 或网页转发的功能验收。

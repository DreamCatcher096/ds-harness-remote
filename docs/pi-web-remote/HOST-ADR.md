# G3：独立 Host 接入决定

状态：用户要求继续实现后，按下一门槛 G3 收敛；不因此授权 Android、账号/设备注册、真实托管连接、模型、生产或独立审查。

此文保留 G3 当时边界。后续 P3 已追加原生链路授权与实现，现行聊天接口见 [P3 决定](P3-ADR.md)，验证见 [P3 结果](P3-RESULTS.md)；不是生产／真机可用声明。

## 复用范围

复用现有 ConnectionController、HostServerConnection、IdentityStore、ServerCredentialStore、HostServerApi 与 Node RTC factory，沿用既有 Noise／membership／固定公钥校验。不导入 HostPluginRuntime、ACP/Codex domain 或 Cordis 服务入口。

ConnectionController 的工厂类型缩为实际需要的 handle/closePeerStreams 接口，原 RpcRouter 结构兼容，原业务行为保留。IdentityStore 增加只读 Host 状态加载，不调用 loadOrCreate，避免文件竞争触发补建身份。Server API 增加默认兼容的禁注册策略；新 Host 明确关闭自动注册，包括凭据后续过期情形。诊断实现标识使用 pi-web-host@source-0a0ac9a1，不宣称是已发布版本，也不冒充 Harness 版本。

新入口放 apps/pi-web-host，不新建空 workspace 包清单或修改锁文件。使用已有 plugin 的 esbuild 工具将有限源码闭包构成独立 Node 工件；构建不执行、安装或启动上游 runtime。构建图必须证明没有 service/ACP/Codex 域入口。

## 首版业务契约

在原 Remote RPC envelope 中新增 pi-web.describe、pi-web.session.snapshot/subscribe/read/unsubscribe、pi-web.questionnaire.submit/cancel/operation.get 和 pi-web.ui.respond；类型及严格参数 schema 位于 packages/protocol/src/pi-web.ts。

只声明 pi-web.attach.v1（及实际 session 快照报告的问卷就绪）。不宣告 Harness/ACP、完整聊天、发送/Stop、历史或网页代理能力。现有 Android 尚不能识别该 backend，不改为兼容 ACP。

订阅为每个认证连接拥有的随机句柄。subscribe 从原 SSE 的 connected 边界取得快照、epoch/seq 与 pending UI ID 集合（最多 128），再通过 read 拉取后续原帧；最多 16 个句柄、同句柄一次只允许一个 read，空等 10 秒返回空 events/done=false，真实结束才 done=true。保留一个未完成的底层读取，不能因超时漏掉后来到达的帧。客户端不读时不无限积压；连接断开/替换/撤销、资源超限只释放自己的 HTTP/句柄，不调用原 Agent abort。空闲句柄 60 秒释放。

此拉取 API 用于原生事件接线，不是 WebView HTTP 代理，也不代表原 loopback-host 的 20/30 秒问题已修复。每帧至多 1 MiB、订阅累计 64 MiB；到限额/epoch 或 seq 缺口必须显式 resync，不无限移除上限或重发业务写入。

HTTP 目标固定为 127.0.0.1:30141，路径由真实 session ID 构成，仅使用已实现的 /api/remote 路由。没有任意 URL、CONNECT、跨目标重定向、客户端传入的 HTTP header/凭据或会话创建路径。默认 Node HTTP 直连回环，不使用环境代理。命令只执行一次；网络失败返回 unknown 类结果，先查询，不自动重试。

问卷 operationId 按认证连接给出的 peerDeviceId 做 SHA-256 命名空间（不是新加密协议），连接换代后同设备仍能查原操作；客户端自报身份字段会被 strict schema 拒绝。原插件仍是唯一 accepted 裁决者。所有快照、帧、回执都核对 session/instance；不能拿普通 HTTP 200 或其他会话的 receipt 冒充成功。

## 生命周期与身份

构造器无文件、网络或进程副作用；start 才读取显式工作树外状态目录，要求独立 Host 标记、已有且验证的身份和凭据。无身份/凭据则 fail closed，不初始化、迁移、登录、借用 DSH_HOME 或自动注册。本轮测试只用临时身份/内存通道及假 HTTP/控制面，不进行真实账号操作。

服务端账号与首次公钥分发仍沿用已经接受的信任边界。真正托管准入、注册工具和生产配置留到独立授权；此阶段不提供“自动注册后顺便接通”的 CLI。

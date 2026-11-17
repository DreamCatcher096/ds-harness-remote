# P3：原生聊天与完整问卷接线决定

日期：2026-11-17。状态：已在固定开发源码中实现，已执行无账号／无模型隔离验证；不是生产或真机可用声明。结果见 [执行记录](P3-RESULTS.md)。

## 1. 用户决定与边界

本轮按用户明确要求交付：只读会话目录／历史 → 指定原实例附着 → 原生聊天／思考／普通工具结果 → 发送／停止 → 完整问卷整份提交／取消／回执。

不做 WebView，不改生产；不连接作者服务或真实账号／手机／模型，不启动 Pi Web、ACP 或 SDK AgentSession，不构建 APK、不注册、不部署、不使用子代理或独立审查。用户选择不初始化 BMad，直接沿用现有工程约定。既有 Noise、身份、控制面和安全边界不变。

## 2. 源码事实与消息关联

固定 Pi SDK 1.5.2 的 message_start/update 没有持久 entry ID；SDK 在 message_end 公共 listener 返回后才向 SessionManager 追加消息。不能把时间戳、响应文本、显示顺序或客户端 UUID 当作原消息 ID。

本轮取舍：

- 历史 messageId 直接取当前 branch 中真实 entry.id，工具仍用原 toolCallId。相同文本、不同 ID 始终保留。
- 尚未落盘的回复单独显示为临时 streaming 区，不声称它已有持久 messageId，不与历史做文本去重。
- connected 在注册原 wrapper listener 后同步读取 chat／streaming／tools／问卷，建立本订阅 epoch/seq 边界。
- 高频 message_start/update、工具部分输出每 150ms 至多合并发布一次 chat.live，只替换临时区，不重复传全部历史。
- 终结／结构状态通过微任务读取已持久化 branch，发布 chat.state 权威尾页和状态；临时区由 message_end 明确清除。普通浏览器不收到这套冗余投影，旧 agent 路由行为保留。
- 每个新订阅独立 epoch，seq 只证明该订阅内连续性，不是磁盘游标。缺口／结束／超限先释放旧流，再只读重建一次；失败停在 resync-required，不忙轮询，不补发 prompt／答案。
- 同 session、不同 agentInstanceId 进入 replaced；只有用户重新选择新目录行才能接受新实例。

## 3. 只读目录与历史

Pi Web 开发树新增 `/api/remote/catalog`、`/api/remote/[id]/history` 和 `lib/remote-chat.ts`。Host 暴露 `pi-web.sessions.list`、`pi-web.session.history`；严格参数 schema 与编解码方法同步添加在 protocol 包。

- 活跃会话直接读取现有 registry／原 SessionManager branch；不调用 getRpcSession，因为它会顺手初始化 registry。
- 冷会话只读 sessions 目录的 header／JSONL；不用会写索引的 scanner，不用可能迁移旧格式的 SessionManager.open。不创建／恢复 Agent，不创建目录、不修改原会话。
- 冷历史按真实 parentId 还原最后 leaf 的 branch；目录目前使用真实 ID 作 title、cwd 作辅助识别，不额外自动命名或生成标题。
- before 是真实消息 ID；未知游标、指定旧实例明确拒绝，不回退新实例或猜测页边界。
- 目录最多 1000 项；单冷文件最多 64 MiB；历史每页最多 100 条／512 KiB。越界明确失败，不返回假完整列表。
- 展示字段为白名单：文本、思考、工具名／调用 ID／输入摘要、普通工具结果。每内容块至多 16K 字符，最多 64 块，截断显式标记。不发系统提示、provider 签名、任意工具 details 或图片二进制；不自动抓取外链。

## 4. 发送／停止、回执和幂等边界

新增 `pi-web.session.prompt`、`pi-web.session.abort`、`pi-web.session.operation.get`，映射到原 wrapper 的 chat.prompt/abort/operation.get。只访问固定回环目标，不进入旧的冷启动路由，不接受模型、provider、任意地址或客户端身份字段。

- 查找／接收命令时校验真实 session/instance；异步 send 在 binding、prompt admission、MCP 等待之后、实际作用于 SDK 前再次验证。始终持有原 wrapper 引用，不重新查找后改投替代实例。
- prompt 只接受显式文字发送；忙碌拒绝，不隐式 steer/follow-up、不替用户排队。Stop 沿用原 wrapper abort 语义，不把取消网络订阅当 Stop。
- accepted：原 wrapper send 成功返回；prompt 是原 SDK preflight 已受理，不表示模型任务或后续工具完成。
- rejected：有证据证明执行前拒绝，例如 busy、实例校验失败、非法参数、容量耗尽或 operation-conflict。客户端识别 Host 可证明的执行前 RPC 拒绝，不把它显示成成功。
- unknown：传输丢失、无法核对原回执、执行路径异常或尚未完成；不推断未执行。原 SDK 拒绝若没有可靠的执行前分类，也保守显示 unknown。
- 每实例最多 256 条聊天操作内存记录；保存 payload 指纹和回执，不保存 prompt 正文。相同 ID／内容返回原状态，异内容拒绝。容量满拒绝新写入，不驱逐后允许旧 ID 再执行。
- Host 按已认证 peerDeviceId 对聊天／问卷 operationId 做稳定命名空间；跨连接仍可查询同设备原操作，不接客户端自报 peer。
- 不跨崩溃保存操作，不承诺持久 exactly-once。客户端不会自动重放任何业务写入；Stop 长时间不返回时也可能保持 unknown。

## 5. client-core 状态机

`packages/client-core/src/pi-web-client.ts` 导出 PiWebRemoteClient；只依赖现有认证 RPC，不引入执行器、第二套持久化或安全协议。

状态：idle、attaching、ready、read-only、disconnected、resync-required、replaced、closed。

- 能力发现区分 Host 实现支持与上游实际就绪；只读 catalog 与 session snapshot 必须报告真实 pi-web.chat.v1。
- browse 冷历史从不订阅／启动；attach 以 subscribe 的 connected 快照而非较早 snapshot 作为事件边界。
- release／suspend 仅清理自己的流；closed 是终态。连接替换、切会话、异步订阅返回／read／回执均受 generation 和真实 ref 校验。
- 同认证主机重连可保留内存 unknown 操作并查询原回执；不同 Server／本机身份／Host pinned key／membership 不共用客户端。App 进程重启不恢复待发写入。
- 权威问卷 snapshot 仅列 pending，关闭后可能直接消失。客户端保留最多 128 个本地失效表单，用于显示“已在其他端处理／原调用已关闭”；未收到终态时不伪造 answered/cancelled。unknown 仍优先查询原回执。
- 对提交中／unknown 的同一问卷禁止另发新提交／取消；原 ref 的查询不重新消费工具。单个 extension_ui_closed 不代表整份问卷结束。

## 6. Android 独立 backend

AndroidRemoteConnection 先发现 pi-web.describe；仅 METHOD_NOT_FOUND 才继续既有 Harness 能力发现。若有 Pi Web 声明但错误／不支持，失败关闭，不冒充 ACP 兼容。

- Pi Web 建立独立 PiWebRemoteClient；不创建 Harness proxy 或 AgentAcpClient，不宣告 agent.acp.pi.v1。
- App 依据真实 Host kind 进入 `screens/pi-web-screen.tsx`，不经过原 ACP workspace/session/prompt/model actions；原 `services/pi.ts` 与 ACP Pi 能力原样保留。独立页面不混入旧 ACP backend 枚举。
- 支持目录选择、冷历史分页（独立较早页，不按文本拼接）、真实历史消息、思考／文本流式区、普通工具结果、显式发送／停止、只读恢复与操作查询。
- 表单按 questionIndex/optionIndex 处理单选、多选、自由文字、每题／整份备注、整份提交和明确取消。允许显式空位置，由原插件裁决，不沿用旧 allAnswered 规则。
- preview 仅作为原生安全文本显示，不执行 HTML／JS；没有 WebView。相同 label 的投影依旧按索引处理；真实插件仍禁止同一题重复 label，本轮不修改它的校验规则。
- 显示提交中、unknown、已采纳、其他端处理／关闭；页面离开、断线、返回键不自动取消问卷或任务。
- 普通工具结果已展示；其他扩展自定义交互只读提示，不展示数字问卷 walker 冒充完整原生表单，不按标题猜 dialog 属于哪份问卷。Host 既有 ui.respond 方法保持不变。
- 模型／provider、创建／恢复会话、附件上传、图片显示、队列编辑和通用文件／终端入口不在本轮新 backend UI 中提供；没有暗中调用相应 API。

## 7. 保留门槛

这一交付只证明源码和隔离契约。未验证：APK 并存标识／签名、模拟器／真机交互、真实认证／作者服务准入、P2P/TURN/Relay、生产原实例／模型业务、屏幕后台行为及布局／无障碍实测。

WebView、手机回环代理和旧 loopback 20/30 秒冲突仍属后续阶段；没有修复或启用它们。生产桥接补丁未安装，新 Host 未部署。独立审查、账号／设备操作、真实业务写入及生产变更仍分别需要授权。

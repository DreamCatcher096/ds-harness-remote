# 完整原生问卷契约草案 v0

状态：保留的 v0 设计草案，不作为已发布 API。G1/G2 隔离实现已按 [桥接 ADR](MINIMAL-BRIDGE-ADR.md) 收敛并通过无模型契约测试，见 [执行记录](MINIMAL-BRIDGE-RESULTS.md)；生产仍无新接口。主要差异：revision 为 opaque string；只有真实工具 AbortSignal 的 aborted，没有伪造超时；首版 HTTP 仅做附着、问卷与普通 UI，不含 prompt/Stop。下列草案中的接口名称/字段不能直接当部署事实。
依据为锁定版问答插件的公共事件/`resolveExternalAnswer`/`OpenQuestionnaire`，以及 Pi Web 的 RPC UI 生命周期。实施方案见 [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)。

P3 客户端落地补充：权威快照只列 pending 问卷，关闭后可能直接移除；客户端以同实例的 pending 集合和真实 toolCallId/revision 使旧表单失效。未见终态时不猜 answered/cancelled，本地 closed 提示与原权威状态分开；unknown 仍须查原操作。实现与证据见 [P3 决定](P3-ADR.md)、[P3 执行结果](P3-RESULTS.md)。

## 1. 身份与权威

- 业务问卷键为 `(sessionId, toolCallId)`，两者来自原 Pi Web/插件，禁止从标题或显示顺序推断。
- 另带 `agentInstanceId`，用于拒绝同 session 被重建后的旧请求。它由原 wrapper 提供，不是 Host PID、App 本地 ID 或替代 Agent。
- `revision` 标识问题结构版本；同一结构的网页局部作答不改变它。结构替换使旧提交失效。
- 题目/选项使用插件的 0-based `questionIndex` / `optionIndexes`，不以 label、翻译文字或伪造 frameRpcId 标识。
- 权威 first-wins 控制器在原插件调用内；操作回执由与该控制器同生命周期的桥接维护。Host 只是有界缓存/转发，不能独立返回 accepted。
- Host 从认证连接取得 peer 身份，验证其会话权限；不接受客户端自行声明的 user/deviceId 作为授权依据。

## 2. 拟议快照与操作

能力：`pi-web.questionnaire.v1`。只有 Pi Web/插件桥接真正就绪才宣告；缺失时明确标为未支持，不能降级数字输入后称完整问卷完成。

```ts
// 仅为契约草案，不是已导出的类型。
type QuestionnaireRef = {
  sessionId: string;
  agentInstanceId: string;
  toolCallId: string;
  revision: number;
};

type QuestionnaireSnapshot = QuestionnaireRef & {
  state: "open" | "answered" | "cancelled" | "aborted" | "expired";
  questions: readonly {
    questionIndex: number;
    question: string;
    header?: string;
    multiSelect: boolean;
    options: readonly {
      optionIndex: number;
      label: string;
      description?: string;
      preview?: string;
    }[];
  }[];
  expiresAt?: number; // 仅有真实上游截止时间时才有
};

type AnswerEntry = {
  questionIndex: number;
  optionIndexes?: readonly number[];
  text?: string;
  notes?: string;
};

type Submit = QuestionnaireRef & {
  operationId: string;
  answers: readonly AnswerEntry[];
  globalNote?: string;
};

type Cancel = QuestionnaireRef & { operationId: string };
```

建议固定操作为 get/submit/cancel/operation.get 和 snapshot/closed/operation-result 事件；实际路由名在接口审查时锁定。
外部答案转入现有 `rpiv:ask-user:answer` 的字段形状，operationId 与插件 requestId 明确关联；会话隔离由桥接增加，不能用一个跨会话广播猜归属。

- Submit 必须包含整份问题的答案位置；单选只能一个合法选项或自定义文字，多选接受选项和/或文字。重复题号、越界/重复选项、无效文字等由原验证器裁决。
- 有意未选择与漏传答案不是一回事。空多选/空答的合法性必须核对 `resolveExternalAnswer` 与现有 TUI/RPC 结果，沿用插件规则，不沿用 QuestionCard 的 `allAnswered` 擅自收紧，也不静默允许缺题。
- Cancel 明确对应整份拒答；不以空 answers 冒充取消，不把 App 关闭/断线当取消。
- 原插件已有 notes/globalNote 字段，桥接保留；首版是否提供对应编辑控件和 preview 展示样式待定，不把字段保留说成 UI 已支持。
- 标题、说明、preview、notes 按内容展示；禁止执行其中 HTML/JS，长内容有明确传输/渲染预算，不破坏选项索引。

## 3. 权威状态机

```text
                         ┌─ answered（整份答案赢得提交）
open ─ 校验 + 原子决胜 ────┼─ cancelled（用户明确整份取消）
                         ├─ aborted（原工具/会话 Stop）
                         └─ expired（真实超时）

invalid：保持 open
客户端断线/网页关闭：保持原权威状态，不自动 settle
终态：不回到 open；迟到回调不能再完成工具
```

实现顺序：校验作用域/实例/revision → 查同操作回执 → 校验完整答案 → 单一同步临界点决胜 → 撤销本问卷 UI → 发布回执/关闭 → 原工具返回一次结果。

`accepted` 只表示原控制器已接受该最终决定，不表示模型后续回答已经完成。回执与工具结果可能分别到达，UI 应区分“答案已采纳”和“Agent 已继续”。
Stop、超时、取消均使用原工具语义，不能全部伪装为用户回答或通用网络失败。终态是事实，不依赖手机的本地倒计时。

## 4. 网页与手机竞争语义

1. 网页逐题选择只是该 walker 的局部草稿，尚不等于整份完成。App 不导入/合并这些局部选择，避免把未确认草稿误当最终答案。
2. 网页 walker 完成整份答案时与 App submit 进入同一控制器；第一次合法决胜生效。网页最后一题完成意味着 walker 的整份结果就绪，不虚构现有网页已有复核页。
3. 网页已部分作答、App 先提交：App 整份答案生效，网页属于该问卷的当前对话关闭，后续题不再打开。
4. 网页先完成：App 收到 closed，冻结旧草稿并显示“已在其他端处理”；不显示本端提交成功。
5. 真正同时到达：按原控制器顺序只有一个赢家；败方收到明确 already-closed，而不是 HTTP 200 即成功。
6. 任一端明确取消与 submit 同样竞争；后到取消不能撤回已采纳答案，后到答案不能覆盖已取消问卷。
7. App 发出请求但连接中断：进入 unknown，不自动再次 submit，也不以本地已选状态猜测成功；恢复后先查 operation 和权威快照。

基础 dialog 的关闭并不等同整份问卷结束：网页从一题进入下一题也会关闭一个 dialog。App 不能观察单个 `extension_ui_closed` 就判定整份已答。

## 5. RPC walker 的最小合作设计

现状：公开 answer channel 拒绝 rpc host；工具 RPC 路径单独 await walker。只删除 `unsupported_host` 会造成答案回执与原工具等待分离。

拟议调整：

- 在执行入口为该 toolCallId 建立共同完成对象，TUI 与 RPC 路径保留各自 UI，但最终都由它返回 `QuestionnaireResult`。
- 每份问卷持有独立 AbortController；将 signal 传入该问卷的 select/input，不能使用整个 Agent 的停止控制器代替。
- 外部答案赢得提交后，关闭/解除等待只属于该问卷的 dialog；walker 在 await 返回及打开下一题前检查终态。signal 导致的 undefined 不能再把已答结果覆写成取消。
- walker 完成/用户取消、Agent abort 和超时都走同一终结路径，清理 listener、计时器和待回答集合，工具只返回一次。
- UI 请求如需 toolCallId/dialogId 关联，由权威创建点显式登记或增量字段传出，不按标题/时间/请求顺序匹配。
- 校验 Pi SDK 的 UI signal 和 Pi Web 的 pendingUi cleanup 语义。现有 Pi Web 有 signal 合并与 pending UI 管理只是可复用依据，不证明这条新接线已完成。
- 非桥接 host 的行为保持原样；新事件尽量 append-only。若需要破坏已有 rpiv 公共契约，另设版本，而非静默改字段含义。

桥接读取与答案注入的 SDK 边界仍待落实；实施前必须阅读对应 SDK/扩展文档，并说明 lifecycle 注册、session 隔离和卸载清理如何实现。

## 6. 回执、幂等与保留期

建议回执包含 ref、operationId、verdict、可选错误码及权威终态。verdict 至少覆盖：

- `accepted`：该操作赢得完成；另带 `outcome: answered | cancelled`。
- `invalid`：字段/答案不合法，问卷仍 open；提供结构化错误，不解析本地化错误文字。
- `stale`：实例/问卷结构已变更或作用域已失效；要求刷新，不猜测新 ref。
- `already-closed`：另一操作/网页/Stop/超时已终结该问卷。
- `operation-conflict`：相同 operationId 携带不同 payload，拒绝执行。
- `unknown`：查询时无法证明该操作结果；不是 accepted，也不是“确定未执行”。

授权失败在业务裁决之前 fail closed；未授权方不能通过回执探测问卷或答案存在性。

幂等键建议包含实例、session、toolCall、授权 peer 与 operationId；存规范化 payload 指纹和原回执，不写答案正文进日志。相同操作相同内容返回原结果；即使问卷已经关闭也先返回仍保留的原操作结果。不同内容用同 ID 必须拒绝。

控制器保留有界终态/tombstone 和操作记录，具体 TTL/容量在契约实现时给出并测试。缓存过期或原 Pi Web 进程重启后不得宣称还能恢复完整回执；新 instanceId 会阻止旧请求再次执行。**不承诺跨进程崩溃的持久 exactly-once，不写 session JSONL 来伪造它。**

重复网络包的服务端幂等保护，不是客户端自动重放授权。首版客户端不持久化待发答案/审批句柄；App 进程重启只恢复权威快照，不自动续发旧操作。

## 7. 订阅与 UI 状态

- 订阅先安装 listener/缓冲，再获取与事件边界一致的当前问卷快照；必须处理“打开/关闭恰好发生在快照期间”的竞争。
- 每个订阅有 epoch/seq；缺口或换代丢弃旧增量并 resync。Host 的 seq 不能冒充 Pi Web 持久游标。
- App 本地最小状态：loading、editing、submitting、unknown、closed；只有可编辑/open 时可以生成新提交。
- 权威 closed 使所有投影失效；late response 必须核对 host/账号/session/instance/问卷/revision/operation，不能更新已切换的页面。
- 取消按钮是明确动作；返回键/切网页仅离开视图。是否把返回键提供为“询问是否整份取消”的交互可后续确认，但不能默认取消。
- 原生与 WebView 使用同一问卷权威。关闭网页只关闭自己的流/handle，不能撤销原生提交或整个工具。

## 8. 首批核心契约场景

按命名矩阵覆盖，不为 UI 配色或文字堆测试：

- 单选/多选/自定义/多题；重复标签也能按索引正确回答；合法空答案规则与上游一致。
- 错题号、缺题、重复题、越界选项、空白文字、错误实例/版本/身份均拒绝且不消费合法问卷。
- 网页先、App 先、同时、网页部分答案后 App 全量提交；一个原调用结果。
- 同 operation 同内容、同 ID 异内容、迟到请求、关闭后提交、回执丢失后查询与缓存过期。
- 取消/Stop/超时、RPC input 等待中被外部完成、不误关另一问卷、不打开下一题。
- 断线/后台恢复/Host 重启/Pi Web 重启及 snapshot 窗口竞争；不自动重发。

上述均未执行。Node 契约、RPC 对话集成和真实 Android/桌面端竞答需分别记证据，不互相代替。

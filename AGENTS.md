# Pi Web Remote：Agent 工作约定

## 项目与当前授权

本仓库是 DSH Remote 的 Pi Web 定向派生开发仓库，不是生产安装，也不是已有 DSH profile。
沟通及本项目新增文档使用中文，不用 Markdown 表格；明确区分源码事实、用户决定、设计提案和执行结果。

2026-11-16 用户授权：阅读交接文档、初始化本项目（包括 Git、AGENTS.md）、规划具体实现。
本轮范围是获取固定版本源码、仓库与文档初始化、只读分析和文档/仓库静态自检。
**不因此执行依赖安装、业务代码实现、项目测试、原型运行、APK 构建、账号/设备注册或部署。**
后续按用户明确批准的阶段推进；不用重复询问已经确定的产品方向，也不扩大新授权的范围。

本轮新增授权：用户要求解决 Pi Web／问答插件最小桥接，并确认“实现并验证”。允许在 `~/projects/pi-web-bridge` 与 `~/projects/rpiv-mono-bridge` 建立上述固定版本源码分支，完成 G1/G2；审查脚本后冻结依赖安装、运行无模型契约测试及静态诊断。不启动 Pi Web 服务或模型会话，不接生产，不涉及 Host/Android 实现、注册、APK 或部署；不授权子代理或独立审查。

后续新增授权：用户在确认尚未上线的原因后要求“继续实现”。本轮按下一门槛 G3 推进独立 Pi Web Host 的隔离源码实现、冻结依赖、无账号/无模型夹具与构建闭包检查。暂不进入 Android/WebView，不真实连接托管服务、不注册或登录、不启动 Pi Web/SDK/模型、不部署；仍不授权子代理/独立审查。不得清理此前意外写入的共享 npm 缓存。

P3 新增授权：用户明确要求推进原生聊天与完整问卷接线，先不做 WebView、不改生产。允许在现有三个固定源码开发树内补齐聊天协议／Host、client-core 状态机与 Android 独立 Pi Web 入口，使用冻结依赖、假上游／固定事件及静态构建检查验证。不连接真实账号、手机或模型，不启动 Pi Web／SDK AgentSession，不构建 APK／部署，仍不授权子代理或独立审查。用户选择不初始化 BMad，直接按本项目约定执行。P3 源码契约和执行证据见 docs/pi-web-remote/P3-ADR.md 与 P3-RESULTS.md。

P3.1 新增授权：用户同意实际测试 App，优先模拟器，不可用再真机＋ADB；已明确批准在工作树外按官方许可证隔离安装固定 Android 工具链／模拟器，不 sudo、不更改 KVM 权限。测试 APK 使用 `dev.piweb.remote.fixture`、显示名“Pi Web Remote 测试”、scheme `piwebremote-fixture` 和全新隔离调试签名。允许离线夹具构建／安装／原生交互验证，不连接账号、真实 Host、生产或模型，不做 WebView，不借用旧 App 数据／签名；仍无子代理／独立审查授权。

P3.1 界面纠偏决定：用户指出临时页与已安装 App 不同，明确选择“先对齐原 App UI，再继续模拟器验证”。复用原有 TopBar／聊天消息／输入区／抽屉与问卷视觉；独立 Pi Web backend 不冒充 ACP，未支持的模型、附件、会话创建等操作不接线。离线测试控制默认收起，保留明确测试标记；此前临时页观察不算最终界面验收。

先读：

1. [项目入口与当前状态](docs/pi-web-remote/README.md)
2. [交接文档开发副本](docs/pi-web-remote/reference/M2-HANDOFF.md)
3. [源码与初始化记录](docs/pi-web-remote/SOURCE-BASELINE.md)
4. [实施方案](docs/pi-web-remote/IMPLEMENTATION-PLAN.md)
5. [问卷契约草案](docs/pi-web-remote/QUESTIONNAIRE-CONTRACT.md)
6. [验收与回滚](docs/pi-web-remote/ACCEPTANCE.md)

## 不可破坏的边界

- 开发目录：`/home/allen/projects/pi-web-remote`。生产目录：`/home/allen/pi-web`，只读参考，不在生产目录 git init，不从生产安装复制 runtime、node_modules、凭据或会话。
- 唯一执行后端是当前 Pi Web 持有的原 Pi SDK/Agent。不启动第二份 Pi Web、`pi`、`pi-acp` 或 SDK 会话冒充同步；不直接写/回放 session JSONL。
- 不改既有 DSH 安装、profile、服务或身份；不借用 DSH 的 token、deviceId、私钥、模型或 provider 凭据。新 Host 和定制 App 使用独立身份。
- Pi Web 生命周期由 `pi-web.service` 管理。不得未经批准修改包装器、运行配置、监听地址、防火墙或服务；不得启动现有安装器、自动迁移、自动登录/注册流程。
- Android 不占 VPN 槽位；P2P 优先，TURN/Relay 兜底；跨网业务始终走原 Remote Noise 加密通道，不自创加密、不明文降级。
- 优先研究作者托管服务。准入、账号、费用及真实连通未验证，不自建/购买服务器替代验证。已接受服务端账号授权及首次公钥分发/固定的信任边界，不重复列为未决。
- 完整原生问卷必须包含单选、多选、自由输入、整份提交、取消、原调用关联、明确回执和跨端失效；不能以数字输入或切网页代替验收。
- App 内 Pi Web 网页必须经同一套加密网络访问；Host 目标固定 `127.0.0.1:30141`，不得扩成任意内网、CONNECT 或通用 TCP 代理。
- 网页入口具有 Pi Web 本身的高权限操作能力；配置隔离不是 OS 沙箱，原生按钮隐藏也不构成网页权限隔离。
- 不自动切换模型/provider，不执行模型性能或指令遵循测试。Pi Web 内置子代理保持关闭，沿用已有 pi-subagents；需要子代理/独立审查时先取得相应授权。
- 不记录 token、私钥、Authorization、Cookie、完整对话或工具输出。诊断证据须脱敏，截图、APK、签名材料和运行状态不入库。

## 源码与工程规则

- 基线固定为 `0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`（0.6.4 APK 重建源码依据），本地标签 `baseline/dsh-remote-apk-0.6.4-build71`。不拿 release tag 或 main 替代它。
- 保留 MIT 许可证与上游归属。上游原根 AGENTS 可通过该标签读取；其中历史授权、安装/发布操作和验收结论不适用于本项目。
- 上游线协议以 `docs/protocol.md` 为依据；`pi-web.*` 的有限接口已在隔离源码分支实现，准确范围见 Host ADR/执行记录；生产未安装，Android 已有源码接线但真实网络／生产未验收，不能将提案、隔离测试或源码实现宣传为部署可用。变更时同步类型、能力协商和文档。
- 优先复用 protocol、crypto、client-core、webrtc 与现有 Android UI。禁止直接启动会自动初始化 ACP/Codex 的原 Host runtime 来充当 Pi Web Host。
- Pi Web 核心或问答插件若需改动，获批后在 `~/projects/` 下各自建立固定版本源码分支，不编辑生产 node_modules。
- 只改当前任务必要文件；先读再改，不做顺手重构，不造假版本/能力/frameRpcId，不建立第二套会话持久化。
- 未开始实现时不建空功能模块，不提前更换 package 名称、版本或 lockfile，不发布根包或推送上游。
- `apps/android/AGENTS.md` 的 Expo 57 版本文档要求继续有效。其他上游客户端/Server 能力不是本轮待办，不按上游 TODO 扩大项目。

## 实施与验证纪律

- 多步骤任务先给出简短计划和成功标准；遇到无法从源码确定的关键决策先澄清。
- 只读源码结论不等于执行通过；上游测试记录不等于本项目测试；Node 契约测试不等于 Android 真机验证。
- 问卷和普通 UI 答案按真实 ID 关联；未知/关闭 ID 不得因 HTTP 200 显示成功。网络断开不自动重发 prompt、答案或其他业务写入。
- 先定义权威状态机、幂等边界、取消和重连，再接 UI。无法保证同实例/单次完成时应停止，不以兼容降级掩盖。
- 测试预算聚焦协议、安全和状态转换：问卷竞争、同实例接入、SSE/背压、身份与来源隔离。纯文案、配色或布局不另堆测试。
- 实现获批后保持锁文件冻结；安装/检查前显式设置工作树外的开发 HOME、XDG、npm cache/userconfig，不能继承工具进程的生产 HOME。npm 生命周期脚本默认跳过，网络代理仅按既有批准值透传，不继承凭据。发现生产缓存意外写入须记录，不擅自删除共享缓存。上游基线工具为 Node 24.9、pnpm 9.15.4。先审查 scripts，再按受影响包运行检查；全仓构建必须串行。初始化阶段未执行安装/测试；G1/G2 和 G3 的实际命令及结果以各执行记录为准。
- 大输出用 context-mode 分析；代码导航优先 LSP/结构化工具。工具失败保留原始错误，不调模型、不擅自升级工具、不开权限绕过。
- 修改代码后主动检查实际变更路径的 LSP 诊断；空缓存、无语言服务器、缺依赖均不是检查通过。文档改动可进行链接、Git diff 和忽略规则静态检查。
- 发布、账号操作、真实蜂窝/P2P、模型输入和生产变更按独立授权执行。回滚只清理新增资源，不停止原 Pi Web、DSH 或原任务。

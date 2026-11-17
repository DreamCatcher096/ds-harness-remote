# Pi Web Remote

**让 Android 成为同一个 Pi Web 会话的原生远程入口，而不是再启动一个 Agent。**

[中文](README.zh.md) · [English](README.en.md) · [日本語](README.ja.md)

Pi Web Remote 是基于 [DSH Remote](https://github.com/liguobao/ds-harness-remote) 的独立派生项目。我们复用其加密传输、协议和 Android 界面，为 Pi Web 增加原生聊天与完整问卷入口，而不是继续扩展通用的 DSH／多 Agent 客户端。

> **当前是开发中的源码项目，不是开箱即用的手机远程方案。** 已完成隔离源码、契约测试与离线 Android 模拟器验证；真实账号、Host、跨网链路、手机真机和生产部署仍未验收。上游发布的 App 和 npm 包不包含本项目的 Pi Web 定制。

## 为什么做这个项目

在电脑上使用 Pi Web 后，希望离开电脑时，仍能在手机上查看和操作**同一个正在运行的会话与 Agent 实例**，保留原有工具、项目上下文和任务，而不是在手机端或 Host 端另起一个 Pi。

本项目的目标是：

- **同实例接入**：由独立 Host 桥接现有 Pi Web 持有的原 SDK／Agent，不通过启动 `pi`、`pi-acp` 或第二个 SDK 会话来模拟同步。
- **原生聊天**：在 Android 中读取会话目录与历史，展示流式文本、思考与普通工具结果，并显式发送文字或停止原任务。
- **完整原生问卷**：支持单选、多选、自由输入、整份提交、取消、明确回执和跨端失效，不用数字输入或跳转网页代替。
- **复用加密网络**：沿用 Remote 的 Noise 端到端加密通道，P2P 优先、TURN／Relay 兜底，不占 Android VPN 槽位。
- **后续网页入口**：计划通过同一套加密网络内嵌 Pi Web 网页；当前阶段不实现或启用 WebView。

## 当前做到哪里

### 已实现并在隔离环境验证

- `pi-web.*` 协议、独立 Pi Web Host、client-core 状态机及 Android 独立 Pi Web 入口。
- 原实例关联、会话目录／历史、流式展示、发送／停止及问卷提交／取消的契约。
- 按真实会话、实例、调用和题目／选项标识关联操作；回执不确定时显示 `unknown`，先查询原操作，不自动重发业务写入。
- 复用原 App 的顶部栏、消息、输入区、抽屉及问卷视觉，而不是用临时演示页替代。
- 离线模拟器中的发送／停止、整份问卷、取消丢回执后的重连查询、跨端失效与实例换代等原生交互。

证据与限制见 [P3 源码及契约记录](docs/pi-web-remote/P3-RESULTS.md) 和 [P3.1 离线模拟器记录](docs/pi-web-remote/P3.1-RESULTS.md)。这些记录不是本 README 更新时重新运行的测试。

### 尚未完成或验证

- 作者托管服务对独立 Host 的准入、账号要求、费用，以及真实 P2P／TURN／Relay 和蜂窝连接。
- 正常 App 登录与真实 Host 联调、手机真机验收、真实原实例／模型业务和生产部署。
- 内嵌 Pi Web 网页／WebView。
- Pi Web 原生入口中的模型／provider 切换、附件／图片、创建／恢复会话、通用文件和终端入口；不因上游具备这些功能就宣称本项目已接通。

现有测试 APK 是 **x86_64 离线模拟器包，没有 INTERNET 权限**，不能当作普通 ARM 手机的联网业务包。模拟器＋内存假 RPC 验证不等于真实端到端验证。

## 接入方式

以下是目标业务链路；真实网络联调仍待完成：

```text
Android 原生 Pi Web 页面
  ↕ Remote Noise 加密通道（P2P / TURN / Relay）
独立 Pi Web Host
  ↕ 受限 HTTP / SSE，固定目标 127.0.0.1:30141
现有 Pi Web + 最小桥接改动
  ↕ 原有 SDK / Agent 实例
原会话、工具与任务
```

Host 不承担模型执行，不启动原 DSH Host runtime，也不把 Pi Web 伪装成 ACP backend。Pi Web 和问答插件还需要匹配的桥接改动；本仓库保存了[可移植补丁与执行记录](docs/pi-web-remote/MINIMAL-BRIDGE-RESULTS.md)，生产尚未安装这些改动。

## 从哪里开始

定制源码位于开发分支 [`m2/pi-web-remote`](https://github.com/DreamCatcher096/ds-harness-remote/tree/m2/pi-web-remote)，不要把 fork 的 `main` 当作本项目的定制版本：

```sh
git clone --branch m2/pi-web-remote --single-branch https://github.com/DreamCatcher096/ds-harness-remote.git pi-web-remote
cd pi-web-remote
```

这只获取源码，不会安装依赖、注册账号或启动服务。继续开发前请先阅读：

- [项目入口与当前状态](docs/pi-web-remote/README.md)
- [实施方案](docs/pi-web-remote/IMPLEMENTATION-PLAN.md)与[验收边界](docs/pi-web-remote/ACCEPTANCE.md)
- [原生聊天与问卷决定](docs/pi-web-remote/P3-ADR.md)、[Host 设计](docs/pi-web-remote/HOST-ADR.md)及[线协议](docs/protocol.md)
- [源码与固定版本基线](docs/pi-web-remote/SOURCE-BASELINE.md)
- [开发协作与安全约定](AGENTS.md)

主要代码：`apps/pi-web-host/` 为独立 Host，`apps/android/` 为 Android 客户端，`packages/protocol/` 与 `packages/client-core/` 提供协议和客户端状态机，`docs/pi-web-remote/patches/` 保存配套桥接补丁。

保留的其他子项目和历史文档可能仍描述上游 DSH Remote 的功能、安装或发布流程；它们不是 Pi Web Remote 的可用性承诺，也不是本项目的一键安装说明。

## 安全与开发边界

- 新 Host／App 使用独立身份，不借用既有 DSH 的设备身份、私钥或登录态。
- Pi Web 目标固定为 `127.0.0.1:30141`，不扩成任意内网、CONNECT 或通用 TCP 代理；跨网业务不明文降级。
- 断线、退出页面或重连不自动重发 prompt、问卷答案等业务写入，也不自动停止原任务。
- 登录由用户本人完成；真实业务测试逐项确认。不在 Issue、日志或仓库中放入 token、Cookie、私钥、会话文件或完整对话。
- 配置隔离不是 OS 沙箱；未来网页入口具有 Pi Web 本身的权限，隐藏原生按钮不构成权限隔离。

## 上游归属与许可证

本项目 fork 自 [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote)，开发基线固定为 [`0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`](https://github.com/liguobao/ds-harness-remote/tree/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0)。感谢原作者及贡献者提供的协议、加密、传输与 Android UI 基础。

项目沿用 [MIT 许可证](LICENSE)，保留原版权声明：`Copyright (c) 2026 DSH Remote contributors`。各子模块及第三方组件的许可证与 NOTICE 仍需遵守；重写 README 不改变这些义务。

Pi Web Remote 是独立派生项目，不代表 DSH Remote、Pi Web 或 DeepSeek 官方发布或背书。相关名称与商标归各自权利人所有。

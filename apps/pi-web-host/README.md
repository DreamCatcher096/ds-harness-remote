# 独立 Pi Web Host（G3／P3 隔离实现）

基于 Remote 固定提交 0a0ac9a1；保留上游 MIT 与归属。此目录不是生产安装，也不是 DSH profile。

实现：认证连接层复用、固定 Pi Web HTTP/SSE 接入、问卷及普通 UI 的有限 RPC、连接/句柄清理、独立 Node bundle。没有 Pi SDK、ACP/Codex 执行器、HostPluginRuntime、自动注册、会话持久化或网页通用代理。

- 接口和资源预算见 [线协议](../../docs/protocol.md) 与 [Host ADR](../../docs/pi-web-remote/HOST-ADR.md)。
- 验证与异常见 [本轮结果](../../docs/pi-web-remote/HOST-RESULTS.md)。
- Pi Web/问答插件需使用上一阶段桥接源码；现有生产安装没有这些接口。不要回退到会冷启动的旧 agent 路由。

## 构建与验证

从仓库根执行，使用已冻结且审查过的依赖；不在此目录另行 npm install，不改包名/版本/锁文件。安装和验证前显式隔离 HOME/XDG/npm 配置与缓存，不能继承工具进程的生产 HOME。完整示例见结果文档。

```bash
# 跨源码夹具需显式提供两个固定开发树；完整隔离环境见 P3-RESULTS.md。
PI_WEB_BRIDGE_SOURCE=/home/allen/projects/pi-web-bridge \
PI_WEB_QUESTIONNAIRE_SOURCE=/home/allen/projects/rpiv-mono-bridge/packages/rpiv-ask-user-question \
node node_modules/vitest/vitest.mjs run --config apps/pi-web-host/vitest.config.ts
node node_modules/typescript/bin/tsc -p apps/pi-web-host/tsconfig.json
node apps/pi-web-host/build.mjs
node apps/pi-web-host/dist/host.mjs --help
```

构建图会拒绝 ACP/Codex/service 入口及未经审查的外部依赖；只保留 Node 内建与可选原生 wrtc，纯 JS werift 已内联。工件和 graph 在被忽略的 dist/，不入库。

## 启动边界

构造/close 没有文件/网络/进程副作用。CLI 只接受显式 `--connect --state <绝对目录> --server <HTTPS origin>`；本轮只验证 --help，**没有执行真实 --connect**。

state 必须在任何 Git 工作树、生产 Pi Web 与默认 .dsh 路径之外；目录/身份/信任/凭据/标记须同用户私有且非 symlink，标记 kind 必须是 pi-web-remote-host、deviceId 必须匹配已有独立身份。凭据须与 Server origin 和 deviceId 对应。通过纯读取路径加载；缺失/过期即拒绝，不创建、不修复、不迁移、不登录或注册。

该标记不是授权，更不能给已有 DSH profile 加个标记后借用身份。新身份与作者服务注册、受限 Pi Web 认证传递、真实网络及部署均需另行授权，本轮没有提供自动授权工具。断开/关闭 Host 只撤销自己的 HTTP/Noise 连接，不停止 Pi Web、原任务或 DSH。

P3 已增加只读会话目录／历史、原实例发送／停止和操作查询，并接入 client-core 与 Android 独立 Pi Web 页面；原 ACP Pi 接线保持独立。范围和结果见 [P3 决定](../../docs/pi-web-remote/P3-ADR.md)、[P3 结果](../../docs/pi-web-remote/P3-RESULTS.md)。没有 WebView、APK、真实手机／托管服务或生产验收。配置隔离不是 OS 沙箱。
